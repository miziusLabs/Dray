use crate::{
    events::ApprovalPolicy,
    git::BranchList,
    models::{Effort, Model, ModelId},
    projects::Project,
    session::{Harness, SessionManager},
    store::{SessionIndexByProject, SessionIndexItem, SessionSnapshot},
};
use tauri::{AppHandle, State};

#[path = "events/events.rs"]
pub mod events;
pub mod git;
#[path = "harness/harness.rs"]
pub mod harness;
#[path = "models/models.rs"]
pub mod models;
pub mod projects;
pub mod session;
mod store;

#[tauri::command]
async fn send_msg(
    session_id: &str,
    prompt: &str,
    harness: &str,
    model: ModelId,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    cwd: &str,
    branch: Option<&str>,
    use_worktree: bool,
    worktree_name: Option<&str>,
    is_new_session: bool,
    app: AppHandle,
    manager: State<'_, SessionManager>,
) -> Result<Option<SessionSnapshot>, String> {
    let harness = match harness {
        "claude_code" => Harness::ClaudeCode,
        "codex" => Harness::Codex,
        _ => return Err("invalid harness".into()),
    };

    manager
        .send_msg(
            session_id,
            prompt,
            harness,
            model,
            effort,
            permission_mode,
            cwd,
            branch,
            use_worktree,
            worktree_name,
            is_new_session,
            &app,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_models() -> Vec<Model> {
    models::claude_models()
}

#[tauri::command]
async fn list_sessions_by_project() -> Result<Vec<SessionIndexByProject>, String> {
    store::list_sessions_by_project()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_session_index_items() -> Result<Vec<SessionIndexItem>, String> {
    store::list_session_index_items()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_session_by_id(session_id: &str) -> Result<Option<SessionSnapshot>, String> {
    store::get_session_by_id(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_projects() -> Result<Vec<Project>, String> {
    projects::read_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_project(path: &str) -> Result<Vec<Project>, String> {
    projects::add_project(path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_project(path: &str) -> Result<Vec<Project>, String> {
    projects::remove_project(path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_last_selected_project(path: &str) -> Result<(), String> {
    projects::set_last_selected_project(path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_branches(cwd: &str) -> Result<BranchList, String> {
    git::list_branches(cwd).await.map_err(|e| e.to_string())
}

/// Returns the branch list as it stands after the switch, so the picker
/// re-renders from one round trip rather than following up with its own.
#[tauri::command]
async fn checkout_branch(cwd: &str, branch: &str, stash: bool) -> Result<BranchList, String> {
    git::checkout_branch(cwd, branch, stash)
        .await
        .map_err(|e| e.to_string())?;

    git::list_branches(cwd).await.map_err(|e| e.to_string())
}

/// Returns the entry as written so the sidebar re-renders from the stored value
/// rather than its own guess at it. `None` for an unknown id.
#[tauri::command]
async fn set_session_flags(
    session_id: &str,
    archived: Option<bool>,
    pinned: Option<bool>,
) -> Result<Option<SessionIndexItem>, String> {
    store::set_session_flags(session_id, archived, pinned)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            send_msg,
            list_models,
            list_sessions_by_project,
            list_session_index_items,
            get_session_by_id,
            list_projects,
            add_project,
            remove_project,
            set_last_selected_project,
            list_branches,
            checkout_branch,
            set_session_flags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
