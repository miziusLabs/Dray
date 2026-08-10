use crate::{
    events::ApprovalPolicy,
    git::BranchList,
    models::{Effort, Model, ModelId},
    projects::Project,
    session::{Harness, SessionManager},
    store::{SessionIndexByProject, SessionIndexItem, SessionSnapshot, SessionStatus},
};
use std::collections::HashMap;
use tauri::{AppHandle, State};

pub mod binpath;
#[path = "events/events.rs"]
pub mod events;
pub mod git;
#[path = "harness/harness.rs"]
pub mod harness;
#[path = "models/models.rs"]
pub mod models;
pub mod projects;
pub mod session;
pub mod store;
pub mod title;

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

/// One side of the archived split. The sidebar's toggle is the only caller, and
/// it never wants both at once, so the flag it holds is the argument.
#[tauri::command]
async fn list_session_index_items(archived: bool) -> Result<Vec<SessionIndexItem>, String> {
    store::list_session_index_items_by_archived(archived)
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

/// Stops the in-flight turn without killing the session — the CLI aborts its
/// tools and streaming, ends the turn, and stays alive for the next prompt.
#[tauri::command]
async fn interrupt_session(
    session_id: &str,
    manager: State<'_, SessionManager>,
) -> Result<(), String> {
    manager
        .interrupt(session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Answers a permission request the agent is blocked on. `option_id` names one
/// of the options carried on the `permission_requested` event — the standing
/// rule it may apply never leaves the backend, so the frontend cannot widen a
/// grant beyond what the CLI proposed.
#[tauri::command]
async fn respond_permission(
    session_id: &str,
    request_id: &str,
    option_id: &str,
    manager: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager
        .respond_permission(session_id, request_id, option_id, &app)
        .await
        .map_err(|e| e.to_string())
}

/// Answers the questions on a `questions_asked` event. `answers` is keyed by
/// each question's verbatim text — the CLI matches on the string — and a
/// question left out of it is one the user skipped, which is a real answer
/// rather than a refusal.
#[tauri::command]
async fn answer_questions(
    session_id: &str,
    request_id: &str,
    answers: HashMap<String, String>,
    manager: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager
        .answer_questions(session_id, request_id, answers, &app)
        .await
        .map_err(|e| e.to_string())
}

/// Clears a finished session's unread mark. The frontend calls this when the
/// user views the session; a `completed` badge is "finished and unread", so
/// reading is what retires it. Returns the status as written, `None` when
/// nothing changed — the session wasn't `completed`, or the id is unknown.
#[tauri::command]
async fn mark_session_idle(
    session_id: &str,
    manager: State<'_, SessionManager>,
) -> Result<Option<SessionStatus>, String> {
    manager
        .mark_idle(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SessionManager::default())
        .setup(|_app| {
            // A persisted `in_progress` can't be true anymore — no child
            // survived the restart. Spawned, not awaited: the reset needs no
            // window, and the frontend's first fetch lands well after it.
            tauri::async_runtime::spawn(async {
                if let Err(e) = store::reset_in_progress_sessions().await {
                    eprintln!("[status reset err] {e}");
                }
            });
            Ok(())
        })
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
            mark_session_idle,
            interrupt_session,
            respond_permission,
            answer_questions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
