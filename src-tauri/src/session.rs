use crate::{
    events::{now_rfc3339, AgentEvent, AgentEventPayload, ApprovalPolicy, PermissionBehavior},
    git,
    harness::{
        claude_code::{
            self,
            permissions::{answer_response, decision_response, PendingPermissions},
        },
        Harness::ClaudeCode,
    },
    models::{find_model, resolve_effort, Effort, Model, ModelId},
    store::{
        append_session_event, append_session_index_item, delete_session, get_session_index_item,
        list_session_events, resolve_worktree_name, set_session_status,
        touch_session_index_item, worktree_path, SessionIndexItem, SessionSnapshot,
        SessionStatus,
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
        atomic::{AtomicU64, Ordering::Relaxed},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, ChildStdin},
    sync::Mutex,
};

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
    background_tasks: usize,
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
                (self.background_tasks == 0)
                    .then(|| self.set(SessionStatus::Completed))
                    .flatten()
            }
            AgentEventPayload::BackgroundTasksChanged { tasks } => {
                self.background_tasks = tasks.len();
                (tasks.is_empty() && !self.model_call_open)
                    .then(|| self.set(SessionStatus::Completed))
                    .flatten()
            }
            _ => None,
        }
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
    /// Routes a prompt to a session: spawns a new child, reuses a live one, or
    /// respawns via `--resume` when the id is known but its process is gone.
    pub async fn send_msg(
        &self,
        session_id: &str,
        prompt: &str,
        harness: Harness,
        model: ModelId,
        effort: Option<Effort>,
        permission_mode: ApprovalPolicy,
        cwd: &str,
        // Recorded, not acted on: the picker checks the branch out when the
        // user picks it, so by here the tree is already on it.
        branch: Option<&str>,
        use_worktree: bool,
        worktree_name: Option<&str>,
        is_new_session: bool,
        app: &AppHandle,
    ) -> Result<Option<SessionSnapshot>> {
        let model_spec = find_model(model).with_context(|| format!("unknown model {model:?}"))?;
        let effort = resolve_effort(&model_spec, effort);

        if is_new_session {
            let worktree_name = if use_worktree {
                Some(resolve_worktree_name(cwd, worktree_name)?)
            } else {
                None
            };

            let session_cwd = match &worktree_name {
                Some(name) => worktree_path(cwd, name),
                None => cwd.to_string(),
            };

            // Read back rather than taken from the caller: the picker sends
            // `None` when the user didn't touch it, and the repo is still on
            // some branch worth recording. Non-repos report `None` and stay that
            // way.
            let branch = match branch {
                Some(b) => Some(b.to_string()),
                None => git::list_branches(cwd).await?.current,
            };

            // Indexed before the process spawns, so a session that fails to
            // start is still visible rather than vanishing without a trace.
            let item = SessionIndexItem::new(
                session_id,
                harness,
                &session_cwd,
                cwd,
                worktree_name.as_deref(),
                branch.as_deref(),
                prompt,
                model,
                effort,
                permission_mode,
            );
            append_session_index_item(item.clone()).await?;

            // Detached: generation takes ~16s and the snapshot below is what the
            // composer waits on. The title written above stands until this lands.
            crate::title::spawn_title_generation(session_id, prompt, &session_cwd, app);

            // Taken before the child exists, so nothing it does can end up
            // inside its own baseline. A worktree has no directory to snapshot
            // yet — the CLI creates the tree after launch — so that case
            // resolves the fork point the tree will start from instead. Slightly
            // approximate: the CLI fetches `origin/<default>` first, so an
            // upstream commit landing in between would read as this turn's work.
            let baseline = if worktree_name.is_some() {
                git::base_ref_tree(cwd).await
            } else {
                git::snapshot_tree(&session_cwd).await
            };

            let mut session = Session::init(
                session_id,
                harness,
                &model_spec,
                effort,
                permission_mode,
                cwd,
                worktree_name.as_deref(),
                is_new_session,
                app,
            )
            .await?;
            session.send_msg(prompt, baseline, app).await?;
            // The prompt event is synthesized by `send_msg`, so read the log
            // back rather than returning empty — otherwise the frontend's first
            // render drops the user's own message.
            let events = list_session_events(session_id).await?;
            self.sessions
                .lock()
                .await
                .insert(session_id.to_string(), session);

            // Returned so the frontend learns the resolved worktree name and
            // the backend-truncated title rather than guessing either.
            return Ok(Some(SessionSnapshot {
                index_item: item,
                events,
            }));
        }

        let mut sessions_guard = self.sessions.lock().await;

        // Effort is fixed at spawn — the CLI has no `set_effort` control request
        // — so changing it means replacing the child. Resuming by id keeps the
        // conversation, and the log continues from the persisted seq.
        let effort_changed = sessions_guard
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
        let session_cwd = match get_session_index_item(session_id).await? {
            Some(item) => item.cwd,
            None => cwd.to_string(),
        };

        if let Some(s) = sessions_guard.get_mut(session_id) {
            // Before the send, so the index reflects intent even if writing to
            // the child fails — the prompt event is persisted ahead of stdin too.
            touch_session_index_item(session_id, model, effort, permission_mode).await?;
            if s.model != model {
                s.set_model(&model_spec).await?;
            }
            if s.permission_mode != permission_mode {
                s.set_permission_mode(permission_mode).await?;
            }

            // Last thing before the prompt goes down the pipe: the child is idle
            // but alive, so the narrower the gap the less of the user's own
            // editing lands on the turn's side of the diff.
            let baseline = git::snapshot_tree(&session_cwd).await;
            s.send_msg(prompt, baseline, app).await?;
            return Ok(None);
        }

        touch_session_index_item(session_id, model, effort, permission_mode).await?;

        let baseline = git::snapshot_tree(&session_cwd).await;

        // The worktree already exists, so no `-w` — passing it again would try
        // to recreate the tree.
        let mut session = Session::init(
            session_id,
            harness,
            &model_spec,
            effort,
            permission_mode,
            &session_cwd,
            None,
            is_new_session,
            app,
        )
        .await?;
        session.send_msg(prompt, baseline, app).await?;
        sessions_guard.insert(session_id.to_string(), session);
        Ok(None)
    }

    /// Interrupts a session's in-flight turn. Errors when no live child holds
    /// the id — nothing is running, so there is nothing to stop.
    pub async fn interrupt(&self, session_id: &str) -> Result<()> {
        let mut sessions_guard = self.sessions.lock().await;
        let Some(session) = sessions_guard.get_mut(session_id) else {
            bail!("no running session {session_id}");
        };
        session.interrupt().await
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

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub child: Child,
    /// Shared with the stdout task, which has to write back on its own: an
    /// unanswerable `control_request` must be refused from where it is read,
    /// since the CLI blocks its turn until something replies.
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub harness: Harness,
    pub model: ModelId,
    pub effort: Option<Effort>,
    pub permission_mode: ApprovalPolicy,
    pub events: Arc<Mutex<Vec<AgentEvent>>>,
    pub seq: Arc<AtomicU64>,
    /// Shared with the stdout task: sends flip it here, `result` and
    /// `background_tasks_changed` flip it there.
    pub status: Arc<Mutex<StatusTracker>>,
    /// Permission requests the mapper has registered and nobody has answered.
    pub pending_permissions: PendingPermissions,
}

impl Session {
    /// Spawns the child process for the given harness. Only `ClaudeCode` is
    /// implemented; other harnesses bail.
    pub async fn init(
        session_id: &str,
        harness: Harness,
        model: &Model,
        effort: Option<Effort>,
        permission_mode: ApprovalPolicy,
        cwd: &str,
        worktree_name: Option<&str>,
        is_new_session: bool,
        app: &AppHandle,
    ) -> Result<Session> {
        if let Harness::ClaudeCode = harness {
            claude_code::init(
                session_id,
                model,
                effort,
                permission_mode,
                cwd,
                worktree_name,
                is_new_session,
                app,
            )
            .await
        } else {
            bail!("unsupported harness {harness:?}")
        }
    }

    /// Builds and saves the user's own prompt event, then writes it to the
    /// child's stdin — the CLI never echoes it back.
    ///
    /// `baseline` is the caller's working-tree snapshot, taken before this
    /// prompt reaches the child. It is passed in rather than taken here because
    /// only the manager knows which directory to snapshot: a worktree session's
    /// tree does not exist until the CLI creates it.
    pub async fn send_msg(
        &mut self,
        prompt: &str,
        baseline: Option<String>,
        app: &AppHandle,
    ) -> Result<()> {
        let seq = self.seq.fetch_add(1, Relaxed);

        let payload = AgentEventPayload::UserMessage {
            text: prompt.to_string(),
            images: Vec::new(),
            baseline,
        };
        let agent_event = AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            harness: ClaudeCode,
            seq,
            ts: now_rfc3339(),
            // Nothing tracks turns yet; Claude Code opens one per `init`.
            turn_id: None,
            subagent: None,
            payload,
            raw: None,
        };

        app.emit("agent_event", &agent_event)?;

        let mut events_guard = self.events.lock().await;
        events_guard.push(agent_event.clone());
        drop(events_guard);

        append_session_event(&self.id, agent_event).await?;

        let prompt = json!({"type":"user","message":{"role":"user","content": prompt}});
        write_line(&self.stdin, &prompt).await?;

        // After the write: a prompt that never reached the child starts
        // nothing, and the command's error is what the frontend acts on.
        if let Some(next) = self.status.lock().await.on_send() {
            publish_status(&self.id, next, app).await;
        }

        Ok(())
    }

    /// Switches the model of a running child. Verified against the CLI: the
    /// reply after this arrives from the new model, so no respawn is needed.
    /// There is no `set_effort` counterpart — the CLI rejects that subtype, and
    /// an `effort` field on this request is accepted but ignored.
    pub async fn set_model(&mut self, model: &Model) -> Result<()> {
        let request = json!({
            "type": "control_request",
            "request_id": Uuid::now_v7().to_string(),
            "request": {"subtype": "set_model", "model": model.id.as_arg()},
        });

        write_line(&self.stdin, &request).await?;
        self.model = model.id;

        Ok(())
    }

    /// Interrupts the in-flight turn without killing the child. Verified
    /// against the CLI: it acks with a `control_response`, aborts running tools
    /// (`terminal_reason: "aborted_tools"`) or streaming
    /// (`"aborted_streaming"`), ends the turn as `error_during_execution`, and
    /// usually opens a follow-up turn to narrate the abort — so the status
    /// machine needs nothing special here, the resulting events drive it.
    pub async fn interrupt(&mut self) -> Result<()> {
        let request = json!({
            "type": "control_request",
            "request_id": Uuid::now_v7().to_string(),
            "request": {"subtype": "interrupt"},
        });

        write_line(&self.stdin, &request).await?;

        Ok(())
    }

    /// Switches the permission stance of a running child. Unlike effort, the CLI
    /// does have a `set_permission_mode` subtype, so this needs no respawn.
    pub async fn set_permission_mode(&mut self, mode: ApprovalPolicy) -> Result<()> {
        let arg = mode.as_arg();

        let request = json!({
            "type": "control_request",
            "request_id": Uuid::now_v7().to_string(),
            "request": {"subtype": "set_permission_mode", "mode": arg},
        });

        write_line(&self.stdin, &request).await?;
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
        let (pending, chosen) = {
            let mut guard = self
                .pending_permissions
                .lock()
                .expect("pending permissions mutex poisoned");

            let pending = guard
                .get(request_id)
                .with_context(|| format!("no pending permission request {request_id}"))?;

            let chosen = pending
                .options
                .get(option_id)
                .with_context(|| format!("unknown permission option {option_id}"))?
                .clone();

            // Only removed once the option resolved: an unknown id leaves the
            // request answerable rather than stranding the turn.
            let pending = guard.remove(request_id).expect("just read under this lock");
            (pending, chosen)
        };

        write_line(
            &self.stdin,
            &decision_response(request_id, &pending, &chosen),
        )
        .await?;

        let payload = AgentEventPayload::PermissionDecided {
            request_id: request_id.to_string(),
            tool_use_id: pending.tool_use_id,
            behavior: chosen.option.behavior,
            label: chosen.option.label,
            automatic: false,
        };

        // Emitted, never persisted — it exists to retire the request's card, and
        // the request itself is not persisted either. Still numbered through the
        // shared counter so the live transcript orders it correctly.
        let decision = AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            harness: ClaudeCode,
            seq: self.seq.fetch_add(1, Relaxed),
            ts: now_rfc3339(),
            turn_id: None,
            subagent: None,
            payload,
            raw: None,
        };

        app.emit("agent_event", &decision)?;

        Ok(())
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
        let pending = {
            let mut guard = self
                .pending_permissions
                .lock()
                .expect("pending permissions mutex poisoned");

            guard
                .remove(request_id)
                .with_context(|| format!("no pending permission request {request_id}"))?
        };

        write_line(&self.stdin, &answer_response(request_id, &pending, &answers)).await?;

        let payload = AgentEventPayload::PermissionDecided {
            request_id: request_id.to_string(),
            tool_use_id: pending.tool_use_id,
            behavior: PermissionBehavior::Allow,
            label: if answers.is_empty() {
                "Skipped".to_string()
            } else {
                "Answered".to_string()
            },
            automatic: false,
        };

        let decision = AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id: self.id.clone(),
            harness: ClaudeCode,
            seq: self.seq.fetch_add(1, Relaxed),
            ts: now_rfc3339(),
            turn_id: None,
            subagent: None,
            payload,
            raw: None,
        };

        app.emit("agent_event", &decision)?;

        Ok(())
    }

    /// Kills the child process. Takes `self` by value — a killed session can't
    /// be reused.
    pub async fn kill(mut self) -> Result<()> {
        let _ = self.child.kill().await?;
        Ok(())
    }
}

/// Writes one JSON line to a child's stdin. The CLI's input format is
/// line-delimited, so the newline and the flush are part of the message rather
/// than tidiness.
pub async fn write_line(stdin: &Arc<Mutex<ChildStdin>>, value: &serde_json::Value) -> Result<()> {
    let mut guard = stdin.lock().await;
    guard.write_all(format!("{value}\n").as_bytes()).await?;
    guard.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::claude_code::{mapper::Mapper, parser};

    /// The fixture's second turn spawns a background agent: its `result`
    /// arrives while a task is outstanding, the set drains later, and the CLI
    /// opens a promptless turn to report. The trajectory pins all of it — most
    /// importantly that the mid-flight `result` changes nothing.
    #[test]
    fn completion_waits_for_background_tasks_to_drain() {
        let mut mapper = Mapper::default();
        let mut tracker = StatusTracker::default();

        let mut transitions = vec![tracker.on_send().expect("a send starts work")];

        for line in include_str!("harness/claude_code/fixtures/multi_turn.jsonl")
            .lines()
            .filter(|line| !line.trim().is_empty())
        {
            let Ok(Some(event)) = mapper.map(parser::parse_line(line).unwrap()) else {
                continue;
            };
            if let Some(next) = tracker.on_event(&event.payload) {
                transitions.push(next);
            }
        }

        use SessionStatus::*;
        assert_eq!(
            transitions,
            vec![
                InProgress, // the send
                Completed,  // turn 1: result with nothing outstanding
                InProgress, // turn 2 opens
                // turn 2's result is *absent*: a background task was open
                Completed,  // the task set drains
                InProgress, // the promptless report-back turn
                Completed,  // its result
            ]
        );
    }

    /// Only a finished-and-unread session clears on read; selecting a running
    /// one must not stop it reading as busy.
    #[test]
    fn mark_seen_clears_only_completed() {
        let mut tracker = StatusTracker::default();
        assert_eq!(tracker.mark_seen(), None, "idle has nothing to clear");

        tracker.on_send();
        assert_eq!(tracker.mark_seen(), None, "a running session stays busy");

        tracker.on_event(&AgentEventPayload::TurnCompleted {
            status: crate::events::TurnStatus::Success,
            stop_reason: None,
            final_text: None,
            usage: None,
            duration_ms: None,
        });
        assert_eq!(tracker.mark_seen(), Some(SessionStatus::Idle));
        assert_eq!(tracker.mark_seen(), None, "already read");
    }
}
