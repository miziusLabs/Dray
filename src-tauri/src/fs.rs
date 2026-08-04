use std::{path::PathBuf, vec};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::{fs, io::AsyncWriteExt, sync::Mutex};
use uuid::Uuid;

use crate::{
    events::{now_rfc3339, AgentEvent},
    session::Harness,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionIndexItem {
    pub session_id: String,
    pub harness: Harness,
    /// Where the agent actually runs. Equals `project_path` for a normal
    /// session; points inside `.claude/worktrees/<name>` for a worktree one.
    pub cwd: String,
    /// Repo root — the grouping key, so worktree sessions still list under
    /// their project rather than each becoming a project of their own.
    pub project_path: String,
    pub branch: Option<String>,
    /// `Some` marks this a worktree session; Claude Code names the branch
    /// `worktree-<name>`.
    pub worktree_name: Option<String>,
    pub title: String,
    pub created: String,
    pub modified: String,
    pub archived: bool,
    pub pinned: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIndexByProject {
    pub path: String,
    pub indexes: Vec<SessionIndexItem>,
}

static INDEX_LOCK: Mutex<()> = Mutex::const_new(());

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

pub async fn list_session_index_items() -> Result<Vec<SessionIndexItem>> {
    let path = get_sessions_dir().await?.join("index.json");

    let contents = match fs::read_to_string(path).await {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).context("could not open session file"),
    };

    if contents.is_empty() {
        return Ok(Vec::new());
    }

    let items = serde_json::from_str::<Vec<SessionIndexItem>>(&contents)?;

    Ok(items)
}

pub async fn list_sessions_by_project() -> Result<Vec<SessionIndexByProject>> {
    let sessions = list_session_index_items().await?;
    let mut sessions_grouped: Vec<SessionIndexByProject> = Vec::new();

    for session in sessions {
        if let Some(project) = sessions_grouped
            .iter_mut()
            .find(|p| p.path == session.project_path)
        {
            project.indexes.push(session);
        } else {
            sessions_grouped.push(SessionIndexByProject {
                path: session.project_path.clone(),
                indexes: vec![session],
            });
        }
    }

    Ok(sessions_grouped)
}

impl SessionIndexItem {
    /// Everything the index needs is known when the first prompt is sent, so a
    /// session appears in the list even if its process fails to start.
    pub fn new(
        session_id: &str,
        harness: Harness,
        cwd: &str,
        project_path: &str,
        worktree_name: Option<&str>,
        first_prompt: &str,
    ) -> Self {
        let now = now_rfc3339();

        Self {
            session_id: session_id.to_string(),
            harness,
            cwd: cwd.to_string(),
            project_path: project_path.to_string(),
            branch: worktree_name.map(|name| format!("worktree-{name}")),
            worktree_name: worktree_name.map(str::to_string),
            title: title_from_prompt(first_prompt),
            created: now.clone(),
            modified: now,
            archived: false,
            pinned: false,
        }
    }
}

/// `claude -w <name>` places the tree here and names its branch
/// `worktree-<name>` — both confirmed against the worktree fixtures.
pub fn worktree_path(project_path: &str, name: &str) -> String {
    PathBuf::from(project_path)
        .join(".claude")
        .join("worktrees")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

const ADJECTIVES: [&str; 16] = [
    "amber", "brisk", "calm", "dusky", "eager", "fleet", "gentle", "hazy", "ivory", "jolly",
    "keen", "lucid", "mellow", "noble", "opal", "quiet",
];

const COLORS: [&str; 16] = [
    "azure", "bronze", "crimson", "denim", "emerald", "fuchsia", "gold", "hazel", "indigo", "jade",
    "khaki", "lilac", "maroon", "navy", "olive", "plum",
];

const NOUNS: [&str; 16] = [
    "atlas", "beacon", "cedar", "delta", "ember", "fjord", "grove", "harbor", "isle", "jetty",
    "kite", "lantern", "meadow", "nimbus", "orchard", "pebble",
];

/// Three-word name from v7 UUID entropy — avoids a `rand` dependency, and
/// collisions only matter against worktrees that already exist on disk.
fn random_worktree_name() -> String {
    let bytes = Uuid::now_v7().into_bytes();
    let pick = |i: usize, list: &[&'static str; 16]| list[(bytes[i] as usize) % list.len()];

    format!(
        "{}-{}-{}",
        pick(8, &ADJECTIVES),
        pick(10, &COLORS),
        pick(12, &NOUNS)
    )
}

/// Worktrees outlive the sessions that made them, so a name already on disk
/// would silently attach this session to someone else's tree.
pub fn resolve_worktree_name(project_path: &str, requested: Option<&str>) -> Result<String> {
    if let Some(name) = requested {
        let path = worktree_path(project_path, name);
        if PathBuf::from(&path).exists() {
            bail!("a worktree named '{name}' already exists at {path}");
        }
        return Ok(name.to_string());
    }

    for _ in 0..16 {
        let name = random_worktree_name();
        if !PathBuf::from(worktree_path(project_path, &name)).exists() {
            return Ok(name);
        }
    }

    bail!("could not find an unused worktree name after 16 attempts")
}

/// Char-based so a multi-byte prompt can't panic on a byte-index slice.
fn title_from_prompt(prompt: &str) -> String {
    const MAX: usize = 60;
    let title = prompt.trim().replace('\n', " ");

    if title.chars().count() <= MAX {
        return title;
    }

    let truncated: String = title.chars().take(MAX).collect();
    format!("{}…", truncated.trim_end())
}

pub async fn append_session_index_item(session: SessionIndexItem) -> Result<()> {
    let _guard = INDEX_LOCK.lock().await;

    let mut sessions = list_session_index_items().await?;
    sessions.push(session);

    let path = get_sessions_dir().await?.join("index.json");
    let contents = serde_json::to_string(&sessions)?;
    let tmp = path.with_extension("json.tmp");

    fs::write(&tmp, contents)
        .await
        .context("failed to write session index")?;

    fs::rename(&tmp, &path)
        .await
        .context("failed to rename session index")?;

    Ok(())
}

pub async fn get_session_by_id(session_id: &str) -> Result<Vec<AgentEvent>> {
    let path = get_session_path(session_id).await?;

    let buffer = match fs::read_to_string(&path).await {
        Ok(buf) => buf,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).context("could not open session file"),
    };

    let events = buffer
        .lines()
        .map(serde_json::from_str::<AgentEvent>)
        .collect::<Result<Vec<_>, _>>()
        .context("malformed session file")?;

    Ok(events)
}

pub async fn append_session_event(session_id: &str, event: AgentEvent) -> Result<()> {
    let path = get_session_path(session_id).await?;

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .context("failed to open session file")?;

    let line = format!("{}\n", serde_json::to_string(&event)?);

    file.write_all(line.as_bytes()).await?;

    Ok(())
}

pub async fn next_seq_by_session_id(session_id: &str) -> Result<u64> {
    let path = get_session_path(session_id).await?;

    let buf = match fs::read_to_string(&path).await {
        Ok(buf) => buf,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e).context("could not read session file"),
    };

    let seq = match buf.lines().next_back() {
        Some(v) => {
            let json: Value = serde_json::from_str(v)?;
            json.get("seq").and_then(|s| s.as_u64()).unwrap_or(0)
        }
        None => 0,
    };

    Ok(seq + 1)
}

pub async fn get_session_path(session_id: &str) -> Result<PathBuf> {
    let path = get_sessions_dir()
        .await?
        .join(format!("{session_id}.jsonl"));

    Ok(path)
}
