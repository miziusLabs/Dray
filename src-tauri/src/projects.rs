use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::{fs, sync::Mutex};
use ts_rs::TS;

use crate::{events::now_rfc3339, store::get_home_app_dir};

/// A directory the user attached, and the root a session runs in. Distinct from
/// [`crate::store::SessionIndexItem::project_path`], which records where a
/// session *did* run — a project can be detached without rewriting history.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// Canonicalized at attach time, so this is the only spelling of the path
    /// that ever reaches the index or the sidebar's grouping key.
    pub path: String,
    /// Folder name as of attaching. Cached so a project whose directory was
    /// since renamed or removed still has a label.
    pub name: String,
    pub added: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ProjectsFile {
    #[serde(default)]
    pub projects: Vec<Project>,
    /// Seeds the composer's project picker on the next launch.
    #[serde(default)]
    pub last_selected: Option<String>,
}

static PROJECTS_LOCK: Mutex<()> = Mutex::const_new(());

/// Resolves symlinks and drops any trailing slash, so `/x/proj` and `/x/proj/`
/// can't become two projects and split the sidebar's grouping.
async fn canonical(path: &str) -> Result<String> {
    let resolved = fs::canonicalize(path)
        .await
        .with_context(|| format!("no such directory: {path}"))?;

    Ok(resolved.to_string_lossy().into_owned())
}

/// Reads `projects.json`. A missing or empty file means no projects yet, not an
/// error — same convention as the session index.
pub async fn read_projects() -> Result<ProjectsFile> {
    let path = get_home_app_dir().await?.join("projects.json");

    let contents = match fs::read_to_string(path).await {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ProjectsFile::default()),
        Err(e) => return Err(e).context("could not open projects file"),
    };

    if contents.trim().is_empty() {
        return Ok(ProjectsFile::default());
    }

    Ok(serde_json::from_str(&contents)?)
}

/// Caller must hold `PROJECTS_LOCK`: this rewrites the whole file, so a
/// concurrent writer would drop the other's entry.
async fn write_projects(file: &ProjectsFile) -> Result<()> {
    let path = get_home_app_dir().await?.join("projects.json");
    let contents = serde_json::to_string(file)?;
    let tmp = path.with_extension("json.tmp");

    fs::write(&tmp, contents)
        .await
        .context("failed to write projects")?;

    fs::rename(&tmp, &path)
        .await
        .context("failed to rename projects")?;

    Ok(())
}

/// Attaches a directory and selects it. Re-attaching a known project is a
/// no-op apart from the selection, so the picker's "Attach" can double as
/// "switch to one I already have" without growing duplicates.
pub async fn add_project(path: &str) -> Result<ProjectsFile> {
    let path = canonical(path).await?;

    let _guard = PROJECTS_LOCK.lock().await;
    let mut file = read_projects().await?;

    if !file.projects.iter().any(|p| p.path == path) {
        file.projects.push(Project {
            name: basename(&path),
            path: path.clone(),
            added: now_rfc3339(),
        });
    }

    file.last_selected = Some(path);
    write_projects(&file).await?;

    Ok(file)
}

/// Detaches a project. Sessions that ran in it are untouched — they keep their
/// own recorded paths and stay in the sidebar.
pub async fn remove_project(path: &str) -> Result<ProjectsFile> {
    let _guard = PROJECTS_LOCK.lock().await;
    let mut file = read_projects().await?;

    file.projects.retain(|p| p.path != path);
    if file.last_selected.as_deref() == Some(path) {
        file.last_selected = file.projects.first().map(|p| p.path.clone());
    }

    write_projects(&file).await?;

    Ok(file)
}

/// Remembers the picker's choice for the next launch. Skips the rewrite when
/// nothing changed — this fires on every project switch.
pub async fn set_last_selected_project(path: &str) -> Result<()> {
    let _guard = PROJECTS_LOCK.lock().await;
    let mut file = read_projects().await?;

    if file.last_selected.as_deref() == Some(path) {
        return Ok(());
    }

    file.last_selected = Some(path.to_string());
    write_projects(&file).await
}

/// Trailing path segment. Mirrors the frontend's `basename` so a project's
/// cached label matches what the UI would derive from the path.
fn basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_file_written_before_these_fields_still_reads() {
        let file: ProjectsFile = serde_json::from_str("{}").unwrap();

        assert!(file.projects.is_empty());
        assert!(file.last_selected.is_none());
    }

    #[test]
    fn basename_handles_trailing_slash_and_root() {
        assert_eq!(basename("/Users/y/proj"), "proj");
        assert_eq!(basename("/Users/y/proj/"), "proj");
        assert_eq!(basename("/"), "/");
    }
}
