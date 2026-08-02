use std::{path::PathBuf, vec};

use anyhow::{Context, Ok, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::fs;

use crate::{events::AgentEvent, session::Harness};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub name: String,
    pub worktree_branch: String,
    pub original_branch: String,
    pub worktree_path: String,
    pub original_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionIndexItem {
    pub session_id: String,
    pub harness: Harness,
    pub cwd: String,
    pub title: String,
    pub created: String,
    pub modified: String,
    pub archived: bool,
    pub pinned: bool,
    pub git_branch: Option<String>,
    pub worktree: Option<Worktree>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIndexByProject {
    pub path: String,
    pub indexes: Vec<SessionIndexItem>,
}

pub async fn get_app_dir(app: &AppHandle) -> Result<PathBuf> {
    let path = app.path().app_data_dir()?;
    fs::create_dir_all(&path).await?;

    Ok(path)
}

pub async fn get_home_app_dir() -> Result<PathBuf> {
    let path = dirs::home_dir()
        .context("could not resolve home directory")?
        .join(".automedon");
    fs::create_dir_all(&path).await?;
    Ok(path)
}

pub async fn get_sessions_dir() -> Result<PathBuf> {
    let path = get_home_app_dir().await?.join("sessions");

    fs::create_dir_all(&path).await?;

    Ok(path)
}

pub async fn list_sessions() -> Result<Vec<SessionIndexItem>> {
    let path = get_sessions_dir().await?.join("index.json");

    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(path).await?;

    if contents.is_empty() {
        return Ok(Vec::new());
    }

    let items = serde_json::from_str::<Vec<SessionIndexItem>>(&contents)?;

    Ok(items)
}

pub async fn list_sessions_by_project() -> Result<Vec<SessionIndexByProject>> {
    let sessions = list_sessions().await?;
    let mut sessions_grouped: Vec<SessionIndexByProject> = Vec::new();

    for session in sessions {
        if let Some(project) = sessions_grouped.iter_mut().find(|p| p.path == session.cwd) {
            project.indexes.push(session);
        } else {
            sessions_grouped.push(SessionIndexByProject {
                path: session.cwd.clone(),
                indexes: vec![session],
            });
        }
    }

    Ok(sessions_grouped)
}

pub async fn append_session_index_item(session: SessionIndexItem) -> Result<()> {
    let mut sessions = list_sessions().await?;
    sessions.push(session);

    let path = get_sessions_dir().await?.join("index.json");
    let contents = serde_json::to_string(&sessions)?;

    fs::write(path, contents)
        .await
        .context("failed to write session index")?;

    Ok(())
}

pub async fn get_session_by_id(session_id: &str) -> Result<Vec<AgentEvent>> {
    let path = get_sessions_dir().await?.join(session_id);

    let buffer = fs::read_to_string(&path)
        .await
        .context("could not open session file")?;

    let events = serde_json::from_str::<Vec<AgentEvent>>(&buffer)?;

    Ok(events)
}

pub async fn append_session_event(session_id: &str, event: AgentEvent) -> Result<()> {
    let mut events = get_session_by_id(session_id).await?;
    events.push(event);

    let contents = serde_json::to_string(&events)?;

    let path = get_sessions_dir().await?.join(session_id);
    fs::write(path, contents)
        .await
        .context("failed to append event")?;

    Ok(())
}
