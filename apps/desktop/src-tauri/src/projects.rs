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
    /// User-facing label. Starts as the folder name and can be edited without
    /// changing the directory a session runs in.
    pub name: String,
    /// The user's explicit position in the project picker. Unlike
    /// [`last_selected`], selecting a project does not change this value.
    #[serde(default)]
    pub position: usize,
    /// Used only to restore the selected project on startup. It must not sort
    /// the picker because selecting a project should not undo manual ordering.
    pub last_selected: String,
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

/// Reads `projects.json`, most recently selected first — so the picker's order
/// and its default are both just `projects[0]`. A missing or empty file means
/// no projects yet, not an error — same convention as the session index.
pub async fn read_projects() -> Result<Vec<Project>> {
    let path = get_home_app_dir().await?.join("projects.json");

    let contents = match fs::read_to_string(path).await {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).context("could not open projects file"),
    };

    if contents.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut projects: Vec<Project> = serde_json::from_str(&contents)?;
    // Older Windows builds stored the whole verbatim path as the cached name
    // because they only recognized `/` as a separator. Repair those entries as
    // they are read; other cached names still preserve their attach-time label.
    for project in &mut projects {
        repair_legacy_name(project);
    }
    // Builds before explicit ordering was added have no position field, which
    // deserializes as zero for every project. Preserve their old recency order
    // once, then use that order as their initial explicit order.
    let legacy_order = projects.len() > 1 && projects.iter().all(|p| p.position == 0);
    if legacy_order {
        // RFC 3339 stamps compare correctly as strings at fixed width.
        projects.sort_by(|a, b| b.last_selected.cmp(&a.last_selected));
        for (position, project) in projects.iter_mut().enumerate() {
            project.position = position;
        }
    } else {
        projects.sort_by_key(|project| project.position);
    }

    Ok(projects)
}

/// Caller must hold `PROJECTS_LOCK`: this rewrites the whole file, so a
/// concurrent writer would drop the other's entry.
async fn write_projects(projects: &[Project]) -> Result<()> {
    let path = get_home_app_dir().await?.join("projects.json");
    let contents = serde_json::to_string(projects)?;
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
pub async fn add_project(path: &str) -> Result<Vec<Project>> {
    let path = canonical(path).await?;

    let _guard = PROJECTS_LOCK.lock().await;
    let mut projects = read_projects().await?;
    let now = now_rfc3339();

    match projects.iter_mut().find(|p| p.path == path) {
        Some(existing) => existing.last_selected = now,
        None => projects.push(Project {
            name: basename(&path),
            path,
            position: projects
                .iter()
                .map(|project| project.position)
                .max()
                .unwrap_or(0)
                + 1,
            last_selected: now,
        }),
    }

    write_projects(&projects).await?;

    Ok(projects)
}

/// Changes only the user-facing label; the directory and session history stay
/// untouched. Empty names are rejected here as well as in the UI so persisted
/// projects always have a usable picker label.
pub async fn rename_project(path: &str, name: &str) -> Result<Vec<Project>> {
    let name = name.trim();
    anyhow::ensure!(!name.is_empty(), "project name cannot be empty");

    let _guard = PROJECTS_LOCK.lock().await;
    let mut projects = read_projects().await?;
    let project = projects
        .iter_mut()
        .find(|project| project.path == path)
        .with_context(|| format!("project is not attached: {path}"))?;

    project.name = name.to_string();
    write_projects(&projects).await?;

    Ok(projects)
}

/// Detaches a project. Sessions that ran in it are untouched — they keep their
/// own recorded paths and stay in the sidebar.
pub async fn remove_project(path: &str) -> Result<Vec<Project>> {
    let _guard = PROJECTS_LOCK.lock().await;
    let mut projects = read_projects().await?;

    projects.retain(|p| p.path != path);
    write_projects(&projects).await?;

    Ok(projects)
}

/// Persists the order of the attached projects. The frontend sends every
/// attached path in its new order, so special picker entries never enter this
/// contract and cannot be moved.
pub async fn reorder_projects(paths: &[String]) -> Result<Vec<Project>> {
    let _guard = PROJECTS_LOCK.lock().await;
    let projects = read_projects().await?;
    anyhow::ensure!(
        paths.len() == projects.len(),
        "project order must include every attached project"
    );

    let mut reordered = Vec::with_capacity(projects.len());
    for (position, path) in paths.iter().enumerate() {
        let mut project = projects
            .iter()
            .find(|project| project.path == *path)
            .with_context(|| format!("project is not attached: {path}"))?
            .clone();
        anyhow::ensure!(
            reordered
                .iter()
                .all(|existing: &Project| existing.path != project.path),
            "project order contains a duplicate"
        );
        project.position = position;
        reordered.push(project);
    }

    write_projects(&reordered).await?;

    Ok(reordered)
}

/// Stamps a project as the most recently selected. This is separate from the
/// explicit picker order, so selecting a project never moves it in the list.
pub async fn set_last_selected_project(path: &str) -> Result<()> {
    let _guard = PROJECTS_LOCK.lock().await;
    let mut projects = read_projects().await?;

    let Some(project) = projects.iter_mut().find(|p| p.path == path) else {
        return Ok(());
    };

    project.last_selected = now_rfc3339();

    write_projects(&projects).await
}

/// Repairs the path labels written by builds that did not recognize Windows
/// separators. Other cached names remain untouched so attach-time labels are
/// preserved when a directory is no longer available.
fn repair_legacy_name(project: &mut Project) {
    if project.name == project.path {
        project.name = basename(&project.path);
    }
}

/// Trailing path segment. Mirrors the frontend's `basename` so a project's
/// cached label matches what the UI would derive from the path.
fn basename(path: &str) -> String {
    path.trim_end_matches(|separator| separator == '/' || separator == '\\')
        .rsplit(|separator| separator == '/' || separator == '\\')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_position_sorts_first() {
        let mut projects = vec![
            Project {
                path: "/a".into(),
                name: "a".into(),
                position: 1,
                last_selected: "2026-08-01T00:00:00Z".into(),
            },
            Project {
                path: "/b".into(),
                name: "b".into(),
                position: 0,
                last_selected: "2026-08-08T00:00:00Z".into(),
            },
        ];

        projects.sort_by_key(|project| project.position);

        assert_eq!(projects[0].path, "/b");
    }

    #[test]
    fn basename_handles_both_path_separators_and_root() {
        assert_eq!(basename("/Users/y/proj"), "proj");
        assert_eq!(basename("/Users/y/proj/"), "proj");
        assert_eq!(basename(r"C:\Users\y\proj"), "proj");
        assert_eq!(basename(r"C:\Users\y\proj\"), "proj");
        assert_eq!(basename(r"\\?\C:\Users\y\proj"), "proj");
        assert_eq!(basename("/"), "/");
    }

    #[test]
    fn repairs_a_legacy_path_as_the_cached_name() {
        let mut project = Project {
            path: r"\\?\C:\Users\y\proj".into(),
            name: r"\\?\C:\Users\y\proj".into(),
            position: 0,
            last_selected: String::new(),
        };

        repair_legacy_name(&mut project);

        assert_eq!(project.name, "proj");
    }
}
