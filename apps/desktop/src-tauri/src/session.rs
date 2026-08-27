use crate::{
    attachments,
    events::{
        now_rfc3339, AgentEvent, AgentEventPayload, ApprovalPolicy, ImageRef, MessageSender,
        PermissionBehavior,
    },
    git,
    harness::{pi, Harness::Pi},
    sandbox,
    models::{find_model, resolve_effort, Effort, Model, ModelId, PiModel},
    store::{
        append_session_event, append_session_index_item, clear_fork_from, copy_session_log,
        delete_session, get_session_index_item, list_session_events,
        resolve_unclaimed_cloud_name, set_session_status, touch_session_index_item,
        cloud_path, SessionIndexItem, SessionSnapshot, SessionStatus,
    },
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;
use uuid::Uuid;

// `Harness` is defined in `crate::harness`; re-exported so existing
// `crate::session::Harness` imports keep working.
pub use crate::harness::Harness;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering::Relaxed},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};
#[cfg(windows)]
use std::process::Stdio;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JobObjectExtendedLimitInformation,
    },
};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, ChildStdin},
    sync::Mutex,
};
#[cfg(windows)]
use tokio::process::Command;

/// Emitted as `session_status` when a session's status changes, so the sidebar
/// and composer update without a refetch. Like `SessionTitleEvent`, this is not
/// an `AgentEvent`: it's derived state, and must never reach the `.jsonl` log.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusEvent {
    pub session_id: String,
    pub status: SessionStatus,
    /// The entry's `modified` as the status write left it — completion bumps it,
    /// and the sidebar orders by it, so a session finishing has to move to the
    /// top without a refetch. `None` only when the id is no longer indexed.
    pub modified: Option<String>,
}

/// A prompt typed while a turn was running, held here until the turn reaches a
/// point where handing it to the CLI costs nothing.
///
/// It is *not* persisted while it waits, and that is what makes cancelling it
/// clean: the log is append-only, so a queued message written on arrival could
/// only be retracted with a tombstone event. Held here instead, a cancel leaves
/// no trace at all. Nothing is lost by waiting — the flush persists it, and the
/// only window where it exists solely in memory is one the user is still
/// allowed to take it back from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    pub id: String,
    pub session_id: String,
    /// The raw prompt. Attachments are resolved at flush rather than now, so
    /// what the composer gets back on a cancel is what the user typed.
    pub text: String,
    pub attachment_paths: Vec<String>,
    /// Held with the prompt rather than looked up at flush: a relayed message
    /// can wait out a long turn, and the sending session may be renamed or
    /// deleted before the boundary that delivers it.
    #[serde(default)]
    pub from: Option<MessageSender>,
}

/// Held prompts, oldest first. Shared with the stdout task, which is where the
/// boundary that flushes them is seen.
pub type QueuedMessages = Arc<Mutex<Vec<QueuedMessage>>>;

/// What a send did. The two fields are mutually exclusive in practice — a
/// session being created cannot already be running a turn — but they answer
/// different questions and the frontend acts on each separately.
#[derive(Debug, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SendOutcome {
    /// `Some` only when this send created the session.
    pub snapshot: Option<SessionSnapshot>,
    /// `Some` when a turn was already running, so the prompt is held rather
    /// than sent. The frontend draws it as pending and can still take it back.
    pub queued: Option<QueuedMessage>,
}

/// Drives [`SessionStatus`] from the mapped event stream plus the user's own
/// sends.
///
/// A `result` alone does not end the work: a background subagent keeps running
/// past it, and the CLI later opens a fresh turn — an `init` with no prompt —
/// to deliver what the subagent found. So completion takes two facts at once,
/// no model call open and no background tasks outstanding, and whichever event
/// clears the second fact is the one that reports it.
#[derive(Debug, Default)]
pub struct StatusTracker {
    status: SessionStatus,
    /// An `init` opened a model call that no `result` has closed yet.
    model_call_open: bool,
    /// Ids of the outstanding background tasks, not just how many. The count is
    /// all the status machine needs, but a cooperative Pi abort does not touch
    /// them.
    background_tasks: Vec<String>,
    /// Main-thread tool calls started and not yet finished. Not a status input —
    /// it decides whether an arriving prompt is written now or held.
    open_tool_calls: usize,
}

impl StatusTracker {
    /// The user sent a prompt; work is starting regardless of what stdout says.
    pub fn on_send(&mut self) -> Option<SessionStatus> {
        self.model_call_open = true;
        self.set(SessionStatus::InProgress)
    }

    /// Advances on one mapped event. `Some` when the status changed — the
    /// caller persists and emits only then.
    pub fn on_event(&mut self, payload: &AgentEventPayload) -> Option<SessionStatus> {
        match payload {
            // Fires per model call, not per prompt — including the call the
            // agent opens for itself to report a finished background task. That
            // one arrives with no send in front of it, so a completed session
            // must be able to go straight back to in-progress here.
            AgentEventPayload::TurnStarted(_) => {
                self.model_call_open = true;
                self.set(SessionStatus::InProgress)
            }
            AgentEventPayload::TurnCompleted { .. } => {
                self.model_call_open = false;
                (self.background_tasks.is_empty())
                    .then(|| self.set(SessionStatus::Completed))
                    .flatten()
            }
            AgentEventPayload::BackgroundTasksChanged { tasks } => {
                self.background_tasks = tasks.iter().map(|t| t.task_id.clone()).collect();
                (tasks.is_empty() && !self.model_call_open)
                    .then(|| self.set(SessionStatus::Completed))
                    .flatten()
            }
            _ => None,
        }
    }

    /// Whether anything at all is still working, background tasks included.
    ///
    /// The safe-to-replace-the-child question, and nothing else: a session whose
    /// turn ended while a background task runs is still `InProgress` here, and
    /// killing that child would take the task with it.
    pub fn is_busy(&self) -> bool {
        self.status == SessionStatus::InProgress
    }

    /// Whether a model call is open right now, which is what decides that an
    /// arriving prompt is queued rather than sent. Read *before* `on_send`,
    /// which opens one unconditionally and would answer for itself.
    ///
    /// Deliberately narrower than [`is_busy`](Self::is_busy). A background task
    /// holds the session in-progress long after its turn ended, but the CLI's
    /// main thread is idle and answers a prompt straight away — verified
    /// against v2.1.232, where a prompt written with a background `sleep 300`
    /// outstanding was answered in 1.8s. Queueing on status instead held that
    /// prompt until the task drained, and since a `local_bash` task emits none
    /// of the boundaries `read_stdout` flushes at, "until it drained" was the
    /// whole wait.
    pub fn turn_in_flight(&self) -> bool {
        self.model_call_open
    }

    /// The outstanding background tasks.
    ///
    /// The set is republished whole on every change, so this is simply the
    /// latest reading rather than anything accumulated.
    pub fn background_task_ids(&self) -> Vec<String> {
        self.background_tasks.clone()
    }

    /// Counts main-thread tool calls in and out. Fed separately from
    /// [`Self::on_event`] because only the caller holds the event envelope, and
    /// a *subagent's* tool call must not count: it runs on its own thread and
    /// its result is not a point where the CLI injects a queued prompt.
    pub fn note_tool_call(&mut self, payload: &AgentEventPayload) {
        match payload {
            AgentEventPayload::ToolCallStarted { .. } => self.open_tool_calls += 1,
            AgentEventPayload::ToolCallCompleted { .. } => {
                self.open_tool_calls = self.open_tool_calls.saturating_sub(1)
            }
            // A turn cannot end with a call still running, and a killed child
            // can end one without completing its calls — so the count is reset
            // here rather than left to drift up over a session.
            AgentEventPayload::TurnCompleted { .. } => self.open_tool_calls = 0,
            _ => {}
        }
    }

    /// Whether a main-thread tool call is running right now.
    ///
    /// This is what decides that a prompt goes out immediately instead of being
    /// held: the CLI injects a buffered prompt at the next tool *result*, and
    /// while a tool runs that result is still ahead — so writing now catches it,
    /// where waiting for the boundary this app can see would miss it by the few
    /// milliseconds between the result line and the model call that follows it.
    pub fn tool_in_flight(&self) -> bool {
        self.open_tool_calls > 0
    }

    /// The user read the finished session. Only `Completed` clears — selecting
    /// a running session must not stop it reading as busy.
    pub fn mark_seen(&mut self) -> Option<SessionStatus> {
        (self.status == SessionStatus::Completed)
            .then(|| self.set(SessionStatus::Idle))
            .flatten()
    }

    fn set(&mut self, next: SessionStatus) -> Option<SessionStatus> {
        (self.status != next).then(|| {
            self.status = next;
            next
        })
    }
}

/// Removes the Docker volume and empty host-side marker for a Cloud session.
///
/// This is best-effort on the delete path: the session row and transcript are
/// more important than reclaiming a Docker volume, and Docker may already have
/// removed a volume after an interrupted container.
async fn remove_session_cloud(item: &SessionIndexItem) {
    let Some(name) = item.cloud_name.as_deref() else {
        return;
    };

    sandbox::remove_volume(name).await;
    let _ = tokio::fs::remove_dir_all(cloud_path(name)).await;
}

/// Persists a status change and tells the frontend. Failures are logged, not
/// propagated: status is derived state, and losing one update must not take
/// down the stdout loop that noticed it.
pub async fn publish_status(session_id: &str, status: SessionStatus, app: &AppHandle) {
    // Read back off the write rather than recomputed here: which statuses bump
    // `modified` is `set_session_status`'s rule, and stating it twice is how the
    // sidebar and the disk drift apart.
    let modified = match set_session_status(session_id, status).await {
        Ok(item) => item.map(|i| i.modified),
        Err(e) => {
            eprintln!("[status write err] {e}");
            None
        }
    };

    let event = SessionStatusEvent {
        session_id: session_id.to_string(),
        status,
        modified,
    };
    if let Err(e) = app.emit("session_status", &event) {
        eprintln!("[status emit err] {e}");
    }
}

#[derive(Debug)]
pub struct SessionManager {
    pub sessions: Mutex<HashMap<String, Session>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl SessionManager {
    /// Stops every live session before the app exits. The map is drained before
    /// awaiting any child so no new send can race shutdown, and a failed kill
    /// is logged without preventing the remaining children from being cleaned.
    pub async fn kill_all(&self) {
        let mut guard = self.sessions.lock().await;
        let sessions = std::mem::take(&mut *guard);

        for (session_id, session) in sessions {
            if let Err(error) = session.kill().await {
                eprintln!("[session shutdown err] {session_id}: {error}");
            }
        }
        drop(guard);
    }

    /// Routes a prompt to a session: spawns a new child, reuses a live one, or
    /// respawns via `--resume` when the id is known but its process is gone.
    pub async fn send_msg(
        &self,
        session_id: &str,
        prompt: &str,
        // Absolute paths of what the composer had attached. Re-read here rather
        // than uploaded: the frontend holds a thumbnail, not bytes.
        attachment_paths: &[String],
        harness: Harness,
        _model: ModelId,
        pi_model: Option<PiModel>,
        effort: Option<Effort>,
        title_model: Option<PiModel>,
        title_effort: Option<Effort>,
        permission_mode: ApprovalPolicy,
        cwd: &str,
        // Recorded, not acted on for Cloud sessions. The branch picker supplies
        // metadata and never changes the host checkout when Cloud is enabled.
        branch: Option<&str>,
        use_cloud: bool,
        create_cloud_branch: bool,
        cloud_name: Option<&str>,
        // Branch metadata supplied by the orchestration socket. It resolves a
        // session id before calling here; Cloud itself does not resolve or
        // validate Git refs.
        base_ref: Option<&str>,
        is_new_session: bool,
        // Set only for a session created over the orchestration socket. The
        // composer never has one, and it is recorded rather than acted on —
        // the depth cap reads it back off the index on the *next* create.
        parent_session_id: Option<&str>,
        // The session that relayed this prompt, for a message arriving over the
        // orchestration socket. `None` everywhere else: the composer's prompts
        // are the user's own, and a `user_message` with a sender is drawn
        // differently.
        from: Option<MessageSender>,
        app: &AppHandle,
    ) -> Result<SendOutcome> {
        // An existing session's harness is durable state, just like its cwd;
        // the frontend's control state can lag while a session is being opened.
        let harness = if is_new_session {
            harness
        } else {
            get_session_index_item(session_id)
                .await?
                .map(|item| item.harness)
                .unwrap_or(harness)
        };
        debug_assert_eq!(harness, Pi);
        let (model, pi_model) = (ModelId::Pi, pi_model);
        let model_spec = find_model(model, pi_model.as_ref())
            .with_context(|| format!("unknown model {model:?}"))?;
        let effort = resolve_effort(&model_spec, effort);

        if is_new_session {
            let cloud_name = if use_cloud {
                Some(resolve_unclaimed_cloud_name(cwd, cloud_name).await?)
            } else {
                None
            };

            let session_cwd = match &cloud_name {
                Some(name) => {
                    let path = cloud_path(name);
                    tokio::fs::create_dir_all(&path).await?;
                    sandbox::ensure_image().await?;
                    path
                }
                None => cwd.to_string(),
            };

            // A Cloud has no checkout to inspect or modify. The selected branch
            // is metadata for the prompt and UI only; no local branch is
            // created, checked out, fetched, or mounted into the container.
            let selected_branch = match branch
                .map(str::to_string)
                .or_else(|| base_ref.map(str::to_string))
            {
                Some(branch) => Some(branch),
                None if cloud_name.is_some() => None,
                None => git::current_branch(cwd).await,
            };
            let base_branch = selected_branch
                .clone()
                .unwrap_or_else(|| "main".to_string());
            let recorded_branch = if cloud_name.is_some() && create_cloud_branch {
                cloud_name
                    .as_deref()
                    .map(|name| format!("cloud/{name}"))
            } else {
                selected_branch.clone()
            };
            let starting_prompt = match (
                cloud_name.as_deref(),
                create_cloud_branch,
                recorded_branch.as_deref(),
            ) {
                (Some(_), true, Some(target)) => cloud_start_prompt(prompt, target, &base_branch),
                _ => prompt.to_string(),
            };

            let mut item = SessionIndexItem::new(
                session_id,
                harness,
                &session_cwd,
                cwd,
                cloud_name.as_deref(),
                recorded_branch.as_deref(),
                prompt,
                model,
                effort,
                permission_mode,
                parent_session_id,
            );
            item.pi_model = pi_model.clone();

            // Index before the process starts, so startup failures remain
            // visible and the user can retry after building/fixing Docker.
            if let Err(error) = append_session_index_item(item.clone()).await {
                if let Some(name) = cloud_name.as_deref() {
                    sandbox::remove_volume(name).await;
                }
                let _ = tokio::fs::remove_dir_all(&session_cwd).await;
                return Err(error);
            }
            app.emit(crate::orchestration::SESSION_CREATED, &item).ok();

            // Cloud work is inside a Docker volume, not the host project, so
            // its changes must never be presented as local Git changes.
            let baseline = if cloud_name.is_none() {
                git::snapshot_tree(&session_cwd).await
            } else {
                None
            };

            let launch_cwd = if cloud_name.is_some() {
                session_cwd.as_str()
            } else {
                cwd
            };
            let mut session = Session::init(
                session_id,
                harness,
                &model_spec,
                effort,
                permission_mode,
                launch_cwd,
                &session_cwd,
                cloud_name.as_deref(),
                is_new_session,
                None,
                app,
            )
            .await?;
            session
                .send_msg(&starting_prompt, attachment_paths, baseline, from, app)
                .await?;
            let events = list_session_events(session_id).await?;
            self.sessions
                .lock()
                .await
                .insert(session_id.to_string(), session);

            crate::title::spawn_title_generation(
                session_id,
                prompt,
                launch_cwd,
                title_model.as_ref(),
                title_effort,
                app,
            );

            return Ok(SendOutcome {
                snapshot: Some(SessionSnapshot {
                    index_item: item,
                    events,
                }),
                queued: None,
            });
        }

        let mut sessions_guard = self.sessions.lock().await;

        // Decided here rather than by the caller: the frontend's own `busy` is
        // optimistic, and this is the only reading taken on the same lock the
        // write goes out under.
        // Three readings, not one, because the questions below differ: whether
        // anything is working at all decides that the child must not be
        // replaced, while only an open model call means this prompt has a turn
        // to be folded into.
        let (busy, turn_in_flight, tool_in_flight) = match sessions_guard.get(session_id) {
            Some(s) => {
                let tracker = s.status.lock().await;
                (
                    tracker.is_busy(),
                    tracker.turn_in_flight(),
                    tracker.tool_in_flight(),
                )
            }
            None => (false, false, false),
        };

        // Effort is fixed at spawn — the CLI has no `set_effort` control request
        // — so changing it means replacing the child. Resuming by id keeps the
        // conversation, and the log continues from the persisted seq.
        //
        // Never while anything runs, which is the *wider* reading on purpose:
        // the kill would destroy not just a turn in flight but every background
        // task the child is still carrying. The index still records the pick
        // below, so the next idle send is what respawns.
        let effort_changed = !busy
            && sessions_guard
                .get(session_id)
                .is_some_and(|s| s.effort != effort);

        if effort_changed {
            if let Some(s) = sessions_guard.remove(session_id) {
                s.kill().await?;
            }
        }

        // The caller's `cwd` is a hint for a new session only. From here on the
        // recorded one wins: with a project picker the two can disagree, and
        // resuming in the wrong directory is both silent and destructive. It is
        // also where the baseline gets snapshotted, so a stale value would
        // diff the wrong tree.
        let indexed = get_session_index_item(session_id).await?;
        let session_harness = indexed.as_ref().map(|item| item.harness).unwrap_or(harness);
        let session_cwd = match &indexed {
            Some(item) => item.cwd.clone(),
            None => cwd.to_string(),
        };

        if let Some(s) = sessions_guard.get_mut(session_id) {
            // Before the send, so the index reflects intent even if writing to
            // the child fails — the prompt event is persisted ahead of stdin too.
            touch_session_index_item(
                session_id,
                model,
                model_spec.pi_model.as_ref(),
                effort,
                permission_mode,
            )
            .await?;

            // A model call is open, so this prompt is held rather than sent, and
            // none of the live controls below fire with it. `set_model` and
            // `set_permission_mode` were verified switching an *idle* child;
            // what they do to a turn mid-flight is unknown, and a queued prompt
            // is not worth finding out on. The index above has the user's pick
            // either way, so the next idle send applies it.
            //
            // Gated on the turn, not on `busy`: a session holding a background
            // task reads busy with its main thread idle, and queueing there left
            // the prompt waiting on a boundary that task would never produce.
            if turn_in_flight {
                // A tool is running, so the CLI's next injection point — that
                // tool's result — is still ahead, and writing now is what lands
                // the prompt on it. Holding for the `tool_call_completed` this
                // app can see would miss it: the CLI dispatches the next model
                // call within a few milliseconds of emitting the result line, so
                // the prompt would sit in its buffer through another whole tool
                // call before being read. Measured, and the reason this branch
                // exists rather than one uniform hold.
                //
                // The cost is that there is no window to cancel in — which the
                // UI states by itself, since a prompt written straight through
                // draws no pending row and so offers no Esc.
                if tool_in_flight {
                    s.queue_and_flush(prompt, attachment_paths, from, app).await;
                    return Ok(SendOutcome::default());
                }

                let queued = s.queue_msg(prompt, attachment_paths, from).await;
                return Ok(SendOutcome {
                    snapshot: None,
                    queued: Some(queued),
                });
            }

            if s.model != model || s.pi_model != model_spec.pi_model {
                s.set_model(&model_spec).await?;
            }
            if s.permission_mode != permission_mode {
                s.set_permission_mode(permission_mode).await?;
            }

            // Last thing before the prompt goes down the pipe: the child is idle
            // but alive, so the narrower the gap the less of the user's own
            // editing lands on the turn's side of the diff.
            let baseline = git::snapshot_tree(&session_cwd).await;
            s.send_msg(prompt, attachment_paths, baseline, from, app)
                .await?;
            return Ok(SendOutcome::default());
        }

        touch_session_index_item(
            session_id,
            model,
            model_spec.pi_model.as_ref(),
            effort,
            permission_mode,
        )
        .await?;

        // A fork that has not spawned yet. Cloud forks get a fresh private
        // volume; the app transcript is still copied immediately, while the
        // next Pi process starts clean because the parent's Docker volume is
        // deliberately never mounted into another session.
        let fork_from = indexed.as_ref().and_then(|i| i.fork_from.clone());
        let cloud_name = indexed.as_ref().and_then(|i| i.cloud_name.clone());
        let session_cwd = match &cloud_name {
            Some(name) => {
                let path = cloud_path(name);
                tokio::fs::create_dir_all(&path).await?;
                sandbox::ensure_image().await?;
                path
            }
            None => session_cwd,
        };
        let baseline = if cloud_name.is_none() {
            git::snapshot_tree(&session_cwd).await
        } else {
            None
        };

        let starting_prompt = if let (Some(parent_id), Some(target)) = (
            fork_from.as_deref(),
            indexed.as_ref().and_then(|item| item.branch.as_deref()),
        ) {
            if create_cloud_branch {
                let based_on = get_session_index_item(parent_id)
                    .await?
                    .and_then(|item| item.branch)
                    .unwrap_or_else(|| "main".to_string());
                cloud_start_prompt(prompt, target, &based_on)
            } else {
                prompt.to_string()
            }
        } else {
            prompt.to_string()
        };

        let launch_cwd = if cloud_name.is_some() {
            session_cwd.as_str()
        } else {
            cwd
        };
        let mut session = Session::init(
            session_id,
            session_harness,
            &model_spec,
            effort,
            permission_mode,
            launch_cwd,
            &session_cwd,
            cloud_name.as_deref(),
            is_new_session,
            // A Cloud fork's application transcript is preserved, but its
            // Pi context lives in the parent's private Docker volume. Starting
            // a fresh Pi context is safer than mounting another session's
            // volume or accidentally sharing mutable state.
            if cloud_name.is_none() {
                fork_from.as_deref()
            } else {
                None
            },
            app,
        )
        .await?;

        // After the spawn, so a child that fails to start leaves the instruction
        // standing and the next send forks again. Cleared before the prompt goes
        // out for the opposite reason: from here the CLI owns a session under
        // this id, and forking the parent a second time would abandon it.
        if fork_from.is_some() {
            clear_fork_from(session_id).await?;
        }

        session
            .send_msg(&starting_prompt, attachment_paths, baseline, from, app)
            .await?;
        sessions_guard.insert(session_id.to_string(), session);
        Ok(SendOutcome::default())
    }

    /// Copies a session onto a new id, to be continued separately from the one
    /// it came from. `cloud` puts the fork in a tree of its own rather than
    /// leaving it in the parent's directory.
    ///
    /// Nothing spawns here. The CLI's fork only happens on a spawn, and spawning
    /// one to sit idle would cost a child process per fork and a turn's wait
    /// before the row appeared — so this writes the app's half now and leaves
    /// [`fork_from`](crate::store::SessionIndexItem::fork_from) as the
    /// instruction for the first send. The copied log is what the fork replays
    /// meanwhile, so it opens reading exactly like its parent.
    ///
    /// Refused while the parent is working. The CLI forks by reading the
    /// parent's transcript, which a live child is still appending to, so a fork
    /// taken mid-turn can inherit half of one.
    pub async fn fork(
        &self,
        session_id: &str,
        fork_id: &str,
        cloud: bool,
    ) -> Result<SessionSnapshot> {
        let parent = get_session_index_item(session_id)
            .await?
            .with_context(|| format!("unknown session {session_id}"))?;

        if let Some(s) = self.sessions.lock().await.get(session_id) {
            if s.status.lock().await.is_busy() {
                bail!("wait for the session to finish before forking it");
            }
        }

        // Resolved against the project rather than the parent's own name, so a
        // fork of a fork can't collide with the tree it came from — and against
        // the index as well as disk, since a fork's tree does not exist until
        // its first send.
        // A Cloud cannot be forked into the host checkout: doing so would
        // turn a Cloud fork into a different kind of session. Both menu
        // choices therefore remain Cloud sessions when the parent is Cloud.
        let cloud = cloud || parent.cloud_name.is_some();
        let cloud_name = if cloud {
            Some(resolve_unclaimed_cloud_name(&parent.project_path, None).await?)
        } else {
            None
        };

        let events = copy_session_log(session_id, fork_id).await?;

        // The parent never got a conversation off the ground — indexed, then its
        // spawn failed — so the CLI has no transcript under that id to fork
        // from. Refused here, where it can be said plainly; left to the first
        // send it would come back as the CLI's own "no conversation found".
        // Checked after the copy because that read is what answers it, and it
        // writes nothing when there is nothing to write.
        if events.is_empty() {
            bail!("this session has no conversation to fork yet");
        }

        let item = parent.fork(fork_id, cloud_name.as_deref());
        append_session_index_item(item.clone()).await?;

        Ok(SessionSnapshot {
            index_item: item,
            events,
        })
    }

    /// Stops everything the session is doing immediately.
    ///
    /// Pi's `abort` request is cooperative and can open a follow-up turn while
    /// background tasks continue running. Stop is an explicit user request to
    /// end *all* work, so remove the child from the live map and terminate its
    /// process tree. The next prompt resumes the persisted Pi session in a new
    /// child.
    pub async fn interrupt(&self, session_id: &str, app: &AppHandle) -> Result<()> {
        // Keep the manager lock until the idle status is published. Otherwise a
        // prompt sent in the small window after removal could respawn the
        // session and then receive this stop's late idle event.
        let mut sessions_guard = self.sessions.lock().await;
        let session = sessions_guard
            .remove(session_id)
            .with_context(|| format!("no running session {session_id}"))?;

        // `kill` marks the stdout reader before terminating the child, so data
        // already buffered in the pipe cannot publish a late in-progress or
        // completed status after this stop has been acknowledged.
        session.kill().await?;
        publish_status(session_id, SessionStatus::Idle, app).await;
        drop(sessions_guard);
        Ok(())
    }

    /// Stops one of a session's background tasks. Errors for a dead child like
    /// the rest of these: the task ran inside that process and died with it.
    pub async fn stop_task(&self, session_id: &str, task_id: &str) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.stop_task(task_id).await
    }

    /// Takes back the newest prompt still waiting on a boundary, returning it
    /// so the composer can put the text back where the user left it.
    ///
    /// A session with no live child answers `None` rather than erroring: the
    /// queue died with the process, which is the same "nothing to take back"
    /// the frontend already handles.
    pub async fn cancel_queued(&self, session_id: &str) -> Option<QueuedMessage> {
        let sessions_guard = self.sessions.lock().await;
        let session = sessions_guard.get(session_id)?;
        session.cancel_queued().await
    }

    /// Answers a permission request. Errors when the session has no live child:
    /// the request died with the process, and the CLI will re-ask on resume.
    pub async fn respond_permission(
        &self,
        session_id: &str,
        request_id: &str,
        option_id: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.respond_permission(request_id, option_id, app).await
    }

    /// Answers an `AskUserQuestion`. Fails for a dead child like
    /// [`respond_permission`](Self::respond_permission) does, and for the same
    /// reason: only the process that asked can be told.
    pub async fn answer_questions(
        &self,
        session_id: &str,
        request_id: &str,
        answers: HashMap<String, String>,
        app: &AppHandle,
    ) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.answer_questions(request_id, answers, app).await
    }

    /// Deletes a session: kills its child if one is running, then drops the
    /// index entry and the log. Returns whether the index held it.
    ///
    /// The child goes first and its lock is released before the disk work, so a
    /// dying process can't append one last event to a file we just removed.
    pub async fn delete(&self, session_id: &str) -> Result<bool> {
        let running = self.sessions.lock().await.remove(session_id);
        if let Some(session) = running {
            session.kill().await?;
        }

        // Local Pi sessions keep their context files beside Dray; Cloud Pi
        // sessions keep them in the Docker volume, which is removed below.
        if let Err(e) = pi::delete_session_data(session_id).await {
            eprintln!("could not delete Pi session data for {session_id}: {e}");
        }

        if let Some(item) = get_session_index_item(session_id).await? {
            remove_session_cloud(&item).await;
        }

        // Best-effort: the images are a convenience for the transcript that is
        // about to stop existing, so failing to remove them must not fail the
        // delete the user asked for.
        if let Err(e) = attachments::delete_session_attachments(session_id).await {
            eprintln!("could not delete attachments for {session_id}: {e}");
        }

        delete_session(session_id).await
    }

    /// Clears a finished session's unread mark: `Completed` → `Idle`, anything
    /// else untouched. Returns the status as written, `None` for no change.
    ///
    /// The live tracker is updated first so the in-memory machine agrees with
    /// the index; a session with no live process falls back to the index alone.
    pub async fn mark_idle(&self, session_id: &str) -> Result<Option<SessionStatus>> {
        let sessions_guard = self.sessions.lock().await;

        if let Some(session) = sessions_guard.get(session_id) {
            let Some(next) = session.status.lock().await.mark_seen() else {
                return Ok(None);
            };
            set_session_status(session_id, next).await?;
            return Ok(Some(next));
        }
        drop(sessions_guard);

        match get_session_index_item(session_id).await? {
            Some(item) if item.status == SessionStatus::Completed => {
                set_session_status(session_id, SessionStatus::Idle).await?;
                Ok(Some(SessionStatus::Idle))
            }
            _ => Ok(None),
        }
    }
}

/// Adds the branch instruction to the initial Cloud prompt. It is deliberately
/// plain text: a Cloud starts without a repository, so this is the contract Pi
/// can follow when it creates or edits a remote checkout itself.
pub fn cloud_start_prompt(prompt: &str, branch: &str, based_on: &str) -> String {
    format!(
        "{prompt}\n\nWork on branch `{branch}` based on `{based_on}`."
    )
}

/// Owns a Windows job containing the Pi process and all of its descendants.
/// Closing a job configured with `KILL_ON_JOB_CLOSE` terminates the whole tree
/// without waiting for `taskkill` to enumerate and reap every process.
#[cfg(windows)]
#[derive(Debug)]
pub struct ProcessJob {
    // Raw Windows handles are pointers and are not marked `Send` by Rust,
    // although this kernel handle is safe to move between threads. Keep its
    // numeric representation so SessionManager remains transferable.
    handle: usize,
}

#[cfg(windows)]
impl ProcessJob {
    /// Creates and configures a job after Pi is spawned. A failure falls back
    /// to the taskkill path, since being unable to install the optimization
    /// must not prevent a session from starting.
    pub fn attach(child: &Child) -> Option<Self> {
        let process = child.raw_handle()?;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            eprintln!("[process job err] could not create Windows job");
            return None;
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) != 0
        };
        let assigned = configured
            && unsafe { AssignProcessToJobObject(handle, process as HANDLE) != 0 };

        if !assigned {
            unsafe { CloseHandle(handle) };
            eprintln!("[process job err] could not assign Pi to Windows job");
            return None;
        }

        Some(Self {
            handle: handle as usize,
        })
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle as HANDLE) };
    }
}

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub child: Child,
    /// Shared with the stdout task, which has to write back on its own: an
    /// unanswerable `control_request` must be refused from where it is read,
    /// since the CLI blocks its turn until something replies.
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub harness: Harness,
    /// Whether the child is a Pi process inside a Docker Cloud sandbox.
    pub cloud: bool,
    /// The host-side directory used by the local UI. Cloud sessions keep their
    /// actual files in Docker and this directory remains empty.
    pub cwd: String,
    pub model: ModelId,
    pub pi_model: Option<PiModel>,
    pub effort: Option<Effort>,
    pub permission_mode: ApprovalPolicy,
    pub events: Arc<Mutex<Vec<AgentEvent>>>,
    pub seq: Arc<AtomicU64>,
    /// Shared with the stdout task: sends flip it here, `result` and
    /// `background_tasks_changed` flip it there.
    pub status: Arc<Mutex<StatusTracker>>,
    /// Set before a stop kills the child, so buffered stdout cannot publish
    /// stale events after the session has been stopped and removed from the map.
    pub stopped: Arc<AtomicBool>,
    /// Native Windows process-tree ownership. Unix keeps its existing child
    /// termination path and does not need an extra handle.
    #[cfg(windows)]
    pub process_job: Option<ProcessJob>,
    /// Pi extension dialogs waiting for an answer from the frontend.
    pub pi_ui_requests: pi::mapper::PendingUiRequests,
    /// Prompts typed during a running turn, waiting for the next boundary.
    /// Shared with the stdout task, which is what flushes them.
    pub queued: QueuedMessages,
}

impl Session {
    /// Spawns the child process for the selected harness.
    pub async fn init(
        session_id: &str,
        harness: Harness,
        model: &Model,
        effort: Option<Effort>,
        permission_mode: ApprovalPolicy,
        cwd: &str,
        // The host-side marker used for local UI snapshots. A Cloud's real
        // workspace is `/home/agent/workspace` inside Docker.
        session_cwd: &str,
        cloud_name: Option<&str>,
        is_new_session: bool,
        fork_from: Option<&str>,
        app: &AppHandle,
    ) -> Result<Session> {
        debug_assert_eq!(harness, Pi);
        pi::init(
            session_id,
            model,
            effort,
            permission_mode,
            cwd,
            session_cwd,
            cloud_name,
            is_new_session,
            fork_from,
            app,
        )
        .await
    }

    /// Builds and saves the user's own prompt event, then writes it to the
    /// child's stdin — the CLI never echoes it back.
    ///
    /// `baseline` is the caller's working-tree snapshot, taken before this
    /// prompt reaches the child. Cloud sessions pass `None` because their
    /// workspace lives in Docker and is not a host Git checkout.
    pub async fn send_msg(
        &mut self,
        prompt: &str,
        attachment_paths: &[String],
        baseline: Option<String>,
        from: Option<MessageSender>,
        app: &AppHandle,
    ) -> Result<()> {
        let extension_command = !self.cloud
            && self.harness == Pi
            && pi::commands::is_extension_command(&self.cwd, prompt)
                .await
                .unwrap_or(false);

        deliver_prompt(
            &self.id,
            self.harness,
            prompt,
            attachment_paths,
            baseline,
            false,
            from,
            &self.seq,
            &self.events,
            &self.stdin,
            app,
        )
        .await?;

        // Extension commands can complete without entering Pi's agent loop;
        // marking those as a turn would leave the session busy forever. Clear
        // the frontend's optimistic busy state when no background work remains.
        // If an extension starts its own agent run, its `agent_start` event still
        // opens the status machine normally.
        if extension_command {
            if !self.status.lock().await.is_busy() {
                publish_status(&self.id, SessionStatus::Idle, app).await;
            }
        } else if let Some(next) = self.status.lock().await.on_send() {
            publish_status(&self.id, next, app).await;
        }

        Ok(())
    }

    /// Holds a prompt typed during a running turn. Nothing is written or
    /// persisted here — [`flush_queued`] does both once the turn reaches a
    /// boundary, which is what leaves a cancel possible until then.
    pub async fn queue_msg(
        &self,
        prompt: &str,
        attachment_paths: &[String],
        from: Option<MessageSender>,
    ) -> QueuedMessage {
        let message = QueuedMessage {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            text: prompt.to_string(),
            attachment_paths: attachment_paths.to_vec(),
            from,
        };
        self.queued.lock().await.push(message.clone());
        message
    }

    /// Takes back the newest held prompt, newest-first because that is the one
    /// the user just typed and the only one the composer is offering to undo.
    ///
    /// `None` means the flush won the race, which needs no handling beyond
    /// leaving the composer alone: the prompt is on its way and the frontend
    /// learns so from the `user_message` that follows.
    pub async fn cancel_queued(&self) -> Option<QueuedMessage> {
        self.queued.lock().await.pop()
    }

    /// Holds a prompt and immediately hands it over, for the case where a tool
    /// call is already running.
    ///
    /// Through the queue rather than written directly, so a prompt already
    /// waiting goes out ahead of this one instead of being overtaken.
    pub async fn queue_and_flush(
        &self,
        prompt: &str,
        attachment_paths: &[String],
        from: Option<MessageSender>,
        app: &AppHandle,
    ) {
        self.queue_msg(prompt, attachment_paths, from).await;
        flush_queued(
            &self.id,
            self.harness,
            &self.queued,
            &self.seq,
            &self.events,
            &self.stdin,
            &self.status,
            app,
        )
        .await;
    }

    /// Switches the model of a running child. Verified against the CLI: the
    /// reply after this arrives from the new model, so no respawn is needed.
    /// There is no `set_effort` counterpart — the CLI rejects that subtype, and
    /// an `effort` field on this request is accepted but ignored.
    pub async fn set_model(&mut self, model: &Model) -> Result<()> {
        if self.harness == Pi {
            let pi_model = model
                .pi_model
                .as_ref()
                .context("Pi model is missing its provider")?;
            write_line(
                &self.stdin,
                &serde_json::json!({
                    "type": "set_model",
                    "provider": pi_model.provider,
                    "modelId": pi_model.id,
                }),
            )
            .await?;
            self.model = model.id;
            self.pi_model = Some(pi_model.clone());
            return Ok(());
        }

        Ok(())
    }

    /// Stops one background task by id.
    ///
    /// Separate from the session-level Stop because the CLI keeps them
    /// separate: a cooperative abort with no turn in flight acks and leaves
    /// every running task alone, while Stop intentionally terminates them all.
    ///
    /// Nothing is emitted here. The CLI republishes the task set and files a
    /// `task_notification` with `status: "stopped"` on its own, which is what
    /// settles the panel row and drives the status machine to completion — so
    /// minting anything would be a second source for what already arrives.
    ///
    /// The model is not told, and that is Pi's own behaviour rather
    /// than a gap left here. It notifies on a task *completing* — a
    /// `<task-notification>` user line naming the task and its exit — and says
    /// of stops in its own orphan-scan text that those made "via the UI, Monitor
    /// timeout, or agent teardown … leave no transcript marker". Synthesizing
    /// one would mean waking the model for a turn to announce something the
    /// harness deliberately keeps quiet.
    pub async fn stop_task(&mut self, task_id: &str) -> Result<()> {
        bail!("Pi does not expose background task controls for {task_id}")
    }

    /// Switches the permission stance of a running child. Unlike effort, the CLI
    /// does have a `set_permission_mode` subtype, so this needs no respawn.
    pub async fn set_permission_mode(&mut self, mode: ApprovalPolicy) -> Result<()> {
        // Pi permissions are configured by its global/project settings and
        // extensions; it has no runtime permission-mode RPC command.
        self.permission_mode = mode;
        Ok(())
    }

    /// Answers a pending permission request and records the decision.
    ///
    /// The reply goes out before the event is minted: the CLI's turn is blocked
    /// on it, and a failure to persist the transcript row is not worth holding
    /// an agent still for. Taking the entry out of the map is what makes this
    /// single-shot — a second click on a card the frontend hasn't repainted yet
    /// finds nothing and errors rather than double-answering.
    pub async fn respond_permission(
        &mut self,
        request_id: &str,
        option_id: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let _ = (request_id, option_id, app);
        bail!("Pi does not expose permission requests")
    }

    /// Sends the user's answers back and retires the card.
    ///
    /// Single-shot and reply-first for the same reasons as
    /// [`respond_permission`](Self::respond_permission), and it mints the same
    /// `PermissionDecided` — the frontend has one way to clear a pending card,
    /// and giving questions a second one would mean two things to keep in step.
    /// The verdict is always an allow; the label is what actually happened,
    /// since no option was picked.
    ///
    /// An empty map is a skip, not an error: the harness turns it into "the user
    /// did not answer", which is the truthful thing to tell the agent.
    pub async fn answer_questions(
        &mut self,
        request_id: &str,
        answers: HashMap<String, String>,
        app: &AppHandle,
    ) -> Result<()> {
        let pending = self
            .pi_ui_requests
            .lock()
            .expect("Pi UI request mutex poisoned")
            .remove(request_id)
            .with_context(|| format!("no pending Pi UI request {request_id}"))?;
        let label = answers
            .get(&pending.question)
            .cloned()
            .unwrap_or_else(|| "Skipped".into());
        write_line(&self.stdin, &pending.response(&answers)).await?;

        let decision = AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            harness: self.harness,
            seq: self.seq.fetch_add(1, Relaxed),
            ts: now_rfc3339(),
            turn_id: None,
            subagent: None,
            payload: AgentEventPayload::PermissionDecided {
                request_id: request_id.to_string(),
                tool_use_id: format!("pi-ui-{request_id}"),
                behavior: PermissionBehavior::Allow,
                label,
                automatic: false,
            },
            raw: None,
        };
        app.emit("agent_event", &decision)?;

        Ok(())
    }

    /// Kills the child process. Takes `self` by value — a killed session can't
    /// be reused. The stdout reader is marked first so buffered events cannot
    /// revive a session after it has been stopped.
    pub async fn kill(mut self) -> Result<()> {
        self.stopped.store(true, Relaxed);

        if self.cloud {
            // Killing the Docker client alone can orphan the container. Remove
            // it first; the named volume intentionally survives for resume.
            sandbox::remove_container(&self.id).await;
        }

        #[cfg(windows)]
        if let Some(process_job) = self.process_job.take() {
            // Closing the job is the fast, native tree termination path. Wait
            // only for the direct child to be reaped; no process enumeration or
            // synchronous taskkill command remains on the Stop critical path.
            drop(process_job);
            self.child.wait().await?;
            return Ok(());
        }

        terminate_child(&mut self.child).await
    }
}

/// Terminates a session's Pi process and, on Windows, every descendant tool.
///
/// New sessions use [`ProcessJob`] above. `taskkill /T` remains as a fallback
/// for a process that could not be assigned to a job (for example, when the
/// host has already placed it in an incompatible job).
async fn terminate_child(child: &mut Child) -> Result<()> {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let Some(pid) = child.id() else {
            return Ok(());
        };

        let mut command = Command::new("taskkill");
        crate::binpath::configure_command(&mut command);
        let killed = command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .is_ok_and(|status| status.success());

        if killed {
            child.wait().await?;
            return Ok(());
        }

        // The process may have exited between the first check and taskkill.
        // Reaping that race is preferable to reporting a failed Stop.
        if matches!(child.try_wait(), Ok(Some(_))) {
            return Ok(());
        }
    }

    child.kill().await?;
    Ok(())
}

/// Writes one JSON line to a child's stdin. The CLI's input format is
/// line-delimited, so the newline and the flush are part of the message rather
/// than tidiness.
///
/// Takes anything serializable rather than a built [`Value`](serde_json::Value),
/// so a typed line goes out without being rendered into one first.
pub async fn write_line(stdin: &Arc<Mutex<ChildStdin>>, value: &impl Serialize) -> Result<()> {
    let mut line = serde_json::to_string(value)?;
    line.push('\n');

    let mut guard = stdin.lock().await;
    guard.write_all(line.as_bytes()).await?;
    guard.flush().await?;
    Ok(())
}

/// Persists the user's own prompt event, emits it, then writes it to the
/// child's stdin — the CLI never echoes a prompt back, so this is the only
/// place it enters the transcript.
///
/// Free rather than a method because a queued prompt is delivered from the
/// stdout task, which holds the same handles but no `Session`.
#[allow(clippy::too_many_arguments)]
async fn deliver_prompt(
    session_id: &str,
    harness: Harness,
    prompt: &str,
    attachment_paths: &[String],
    baseline: Option<String>,
    queued: bool,
    from: Option<MessageSender>,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    stdin: &Arc<Mutex<ChildStdin>>,
    app: &AppHandle,
) -> Result<()> {
    let seq = seq.fetch_add(1, Relaxed);

    // Ahead of the event, because it is what decides the event's own text:
    // a non-image attachment becomes an `@path` mention on the prompt, and
    // the transcript has to show what the model was actually given.
    let prepared = attachments::prepare(session_id, prompt, attachment_paths).await?;

    let payload = AgentEventPayload::UserMessage {
        text: prepared.text.clone(),
        images: prepared
            .images
            .iter()
            .map(|i| ImageRef {
                path: Some(i.stored_path.clone()),
                url: None,
                mime_type: Some(i.mime_type.clone()),
            })
            .collect(),
        baseline,
        queued,
        from,
    };
    let agent_event = AgentEvent {
        id: Uuid::now_v7().to_string(),
        session_id: session_id.to_string(),
        harness,
        seq,
        ts: now_rfc3339(),
        // Nothing tracks turns yet; Pi opens one per `init`.
        turn_id: None,
        subagent: None,
        payload,
        raw: None,
    };

    app.emit("agent_event", &agent_event)?;

    let mut events_guard = events.lock().await;
    events_guard.push(agent_event.clone());
    drop(events_guard);

    append_session_event(session_id, agent_event).await?;

    debug_assert_eq!(harness, Pi);
    let mut line = json!({"type": "prompt", "message": prepared.text});
    if !prepared.images.is_empty() {
        line["images"] = json!(prepared
            .images
            .iter()
            .map(|image| json!({
                "type": "image",
                "data": image.data,
                "mimeType": image.mime_type,
            }))
            .collect::<Vec<_>>());
    }
    if queued {
        // Pi requires a delivery mode when a prompt arrives while its agent
        // loop is active. Dray's queued prompts are steering messages, so they
        // are delivered at the next tool boundary.
        line["streamingBehavior"] = json!("steer");
    }
    write_line(stdin, &line).await
}

/// Hands every held prompt to the child, oldest first.
///
/// Called from the stdout loop on a tool call starting or finishing, or on the
/// turn ending. Those are the points where writing costs nothing: the CLI
/// buffers a mid-turn prompt and injects it at its *next* tool result, so a
/// prompt written while a tool runs lands on that tool's result rather than
/// waiting for the one after — and a turn that never calls a tool would not
/// have absorbed it at all, so flushing at the end just starts the new turn the
/// CLI would have started anyway.
///
/// Verified against the CLI: nothing is written back to say a prompt was
/// absorbed, so the boundary is the app's only handle on when to let go of one.
///
/// Failures are logged, not propagated — the stdout loop must survive anything,
/// and a prompt that cannot be written is one the user can retype.
pub async fn flush_queued(
    session_id: &str,
    harness: Harness,
    queued: &QueuedMessages,
    seq: &Arc<AtomicU64>,
    events: &Arc<Mutex<Vec<AgentEvent>>>,
    stdin: &Arc<Mutex<ChildStdin>>,
    status: &Arc<Mutex<StatusTracker>>,
    app: &AppHandle,
) {
    // Drained under one lock so a cancel arriving mid-flush either takes a
    // message back before any of this or finds nothing — never races a
    // half-written batch.
    let batch: Vec<QueuedMessage> = std::mem::take(&mut *queued.lock().await);

    if batch.is_empty() {
        return;
    }

    for message in batch {
        // No baseline, and this is the load-bearing half of the queued case:
        // the changes panel pairs the newest baseline with the newest head
        // after it, so a snapshot taken here would cut the running turn's
        // range in two and credit it with only the work that came after this
        // prompt. `None` makes `changeRange` walk past it to the real prompt.
        if let Err(err) = deliver_prompt(
            session_id,
            harness,
            &message.text,
            &message.attachment_paths,
            None,
            true,
            message.from,
            seq,
            events,
            stdin,
            app,
        )
        .await
        {
            eprintln!("[queued flush err] {err}");
        }
    }

    // A flush at `turn_completed` lands just after the tracker marked the
    // session finished, and the prompt it just wrote opens a new turn the CLI
    // has not announced yet. Without this the composer reads idle for the
    // second or so until `init` arrives — offering to send into a session that
    // is already working. Redundant at a tool boundary, where the session is
    // in-progress and `on_send` reports no change.
    if let Some(next) = status.lock().await.on_send() {
        publish_status(session_id, next, app).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn_completed() -> AgentEventPayload {
        AgentEventPayload::TurnCompleted {
            status: crate::events::TurnStatus::Success,
            stop_reason: None,
            final_text: None,
            usage: None,
            duration_ms: None,
            head: None,
        }
    }

    /// The reason the two readings exist separately. A background task holds the
    /// session in-progress after its turn ended, and deciding to queue on *that*
    /// left the prompt waiting on a boundary a `local_bash` task never produces
    /// — so it sat there until the task drained, which the CLI itself never
    /// asked for: verified against v2.1.232, a prompt written in this state is
    /// answered in under two seconds.
    #[test]
    fn a_background_task_holds_the_session_busy_but_not_the_turn() {
        let mut tracker = StatusTracker::default();
        tracker.on_send();

        tracker.on_event(&AgentEventPayload::BackgroundTasksChanged {
            tasks: vec![crate::events::BackgroundTask {
                task_id: "b0n57ez9b".to_string(),
                task_type: "local_bash".to_string(),
                description: "sleep 300".to_string(),
            }],
        });
        assert!(tracker.turn_in_flight(), "the turn that spawned it is open");
        assert_eq!(
            tracker.background_task_ids(),
            vec!["b0n57ez9b".to_string()],
            "Stop has to name it — the CLI's interrupt leaves it running"
        );

        assert_eq!(
            tracker.on_event(&turn_completed()),
            None,
            "the task keeps the session from completing"
        );
        assert!(tracker.is_busy(), "so the child must not be replaced");
        assert!(
            !tracker.turn_in_flight(),
            "but the main thread is idle, so a prompt goes straight out"
        );

        // Stopping it drains the set, which is what the CLI republishes.
        assert_eq!(
            tracker.on_event(&AgentEventPayload::BackgroundTasksChanged { tasks: vec![] }),
            Some(SessionStatus::Completed)
        );
    }

    /// Only a finished-and-unread session clears on read; selecting a running
    /// one must not stop it reading as busy.
    #[test]
    fn cloud_branch_instruction_is_appended_exactly_once() {
        assert_eq!(
            cloud_start_prompt("Fix the issue", "cloud/123", "main"),
            "Fix the issue\n\nWork on branch `cloud/123` based on `main`."
        );
    }

    #[test]
    fn mark_seen_clears_only_completed() {
        let mut tracker = StatusTracker::default();
        assert_eq!(tracker.mark_seen(), None, "idle has nothing to clear");

        tracker.on_send();
        assert_eq!(tracker.mark_seen(), None, "a running session stays busy");

        tracker.on_event(&turn_completed());
        assert_eq!(tracker.mark_seen(), Some(SessionStatus::Idle));
        assert_eq!(tracker.mark_seen(), None, "already read");
    }
}
