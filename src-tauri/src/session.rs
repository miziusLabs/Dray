use crate::{
    events::{now_rfc3339, AgentEvent, AgentEventPayload},
    fs::append_session_event,
    harness::{
        claude_code::{self, ClaudeCodeEvent},
        Harness::ClaudeCode,
    },
};
use anyhow::{bail, Result};
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
        model: &str,
        effort: &str,
        is_new_session: bool,
        app: &AppHandle,
    ) -> Result<()> {
        if is_new_session {
            let mut session =
                Session::init(session_id, harness, model, effort, is_new_session, app).await?;
            session.send_msg(prompt, app).await?;
            self.sessions
                .lock()
                .await
                .insert(session_id.to_string(), session);

            return Ok(());
        }

        let mut sessions_guard = self.sessions.lock().await;
        if let Some(s) = sessions_guard.get_mut(session_id) {
            s.send_msg(prompt, app).await?;
            return Ok(());
        }

        let mut session =
            Session::init(session_id, harness, model, effort, is_new_session, app).await?;
        session.send_msg(prompt, app).await?;
        sessions_guard.insert(session_id.to_string(), session);
        Ok(())
    }
}

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub child: Child,
    pub stdin: ChildStdin,
    pub harness: Harness,
    pub model: String,
    pub effort: String,
    pub events: Arc<Mutex<Vec<AgentEvent>>>,
    pub seq: Arc<AtomicU64>,
}

impl Session {
    pub async fn init(
        session_id: &str,
        harness: Harness,
        model: &str,
        effort: &str,
        is_new_session: bool,
        app: &AppHandle,
    ) -> Result<Session> {
        if let Harness::ClaudeCode = harness {
            claude_code::init(session_id, model, effort, is_new_session, app).await
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

    pub async fn kill(mut self) -> Result<()> {
        let _ = self.child.kill().await?;
        Ok(())
    }
}
