use crate::{
    events::{now_rfc3339, AgentEvent, AgentEventPayload},
    fs::{
        append_session_event, append_session_index_item, list_session_events, resolve_worktree_name,
        touch_session_index_item, worktree_path, SessionIndexItem, SessionSnapshot,
    },
    harness::{claude_code, Harness::ClaudeCode},
    models::{find_model, resolve_effort, Effort, Model, ModelId},
};
use anyhow::{bail, Context, Result};
use serde_json::json;
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
    pub async fn send_msg(
        &self,
        session_id: &str,
        prompt: &str,
        harness: Harness,
        model: ModelId,
        effort: Option<Effort>,
        cwd: &str,
        use_worktree: bool,
        worktree_name: Option<&str>,
        is_new_session: bool,
        app: &AppHandle,
    ) -> Result<Option<SessionSnapshot>> {
        let model_spec =
            find_model(model).with_context(|| format!("unknown model {model:?}"))?;
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

            // Indexed before the process spawns, so a session that fails to
            // start is still visible rather than vanishing without a trace.
            let item = SessionIndexItem::new(
                session_id,
                harness,
                &session_cwd,
                cwd,
                worktree_name.as_deref(),
                prompt,
                model,
                effort,
            );
            append_session_index_item(item.clone()).await?;

            let mut session = Session::init(
                session_id,
                harness,
                &model_spec,
                effort,
                cwd,
                worktree_name.as_deref(),
                is_new_session,
                app,
            )
            .await?;
            session.send_msg(prompt, app).await?;
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

        if let Some(s) = sessions_guard.get_mut(session_id) {
            // Before the send, so the index reflects intent even if writing to
            // the child fails — the prompt event is persisted ahead of stdin too.
            touch_session_index_item(session_id, model, effort).await?;
            if s.model != model {
                s.set_model(&model_spec).await?;
            }

            s.send_msg(prompt, app).await?;
            return Ok(None);
        }

        touch_session_index_item(session_id, model, effort).await?;

        // Resume spawns straight into the recorded `cwd` — the worktree already
        // exists, and passing `-w` again would try to recreate it.
        let mut session = Session::init(
            session_id,
            harness,
            &model_spec,
            effort,
            cwd,
            None,
            is_new_session,
            app,
        )
        .await?;
        session.send_msg(prompt, app).await?;
        sessions_guard.insert(session_id.to_string(), session);
        Ok(None)
    }
}

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub child: Child,
    pub stdin: ChildStdin,
    pub harness: Harness,
    pub model: ModelId,
    pub effort: Option<Effort>,
    pub events: Arc<Mutex<Vec<AgentEvent>>>,
    pub seq: Arc<AtomicU64>,
}

impl Session {
    pub async fn init(
        session_id: &str,
        harness: Harness,
        model: &Model,
        effort: Option<Effort>,
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

    pub async fn send_msg(&mut self, prompt: &str, app: &AppHandle) -> Result<()> {
        let seq = self.seq.fetch_add(1, Relaxed);

        let payload = AgentEventPayload::UserMessage {
            text: prompt.to_string(),
            images: Vec::new(),
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

        let line = format!("{prompt}\n");

        let _ = self.stdin.write_all(line.as_bytes()).await?;
        let _ = self.stdin.flush().await?;

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

        self.stdin
            .write_all(format!("{request}\n").as_bytes())
            .await?;
        self.stdin.flush().await?;
        self.model = model.id;

        Ok(())
    }

    pub async fn kill(mut self) -> Result<()> {
        let _ = self.child.kill().await?;
        Ok(())
    }
}
