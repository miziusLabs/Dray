use crate::claude_code::{self, ClaudeCodeEvent};
use anyhow::{bail, Result};
use serde_json::json;

// The one `Harness` definition lives in `events`; re-exported here so existing
// `crate::session::Harness` imports (lib.rs, fs.rs, claude_code.rs) keep working.
pub use crate::events::Harness;
use std::{collections::HashMap, sync::Arc};
use tauri::AppHandle;
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
            session.send_msg(prompt).await?;
            self.sessions
                .lock()
                .await
                .insert(session_id.to_string(), session);

            return Ok(());
        }

        let mut sessions_guard = self.sessions.lock().await;
        if let Some(s) = sessions_guard.get_mut(session_id) {
            s.send_msg(prompt).await?;
            return Ok(());
        }

        let mut session =
            Session::init(session_id, harness, model, effort, is_new_session, app).await?;
        session.send_msg(prompt).await?;
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
    pub events: Arc<Mutex<Vec<ClaudeCodeEvent>>>,
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

    pub async fn send_msg(&mut self, prompt: &str) -> Result<()> {
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
