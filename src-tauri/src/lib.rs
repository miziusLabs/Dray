use crate::{
    fs::{SessionIndexByProject, SessionIndexItem, SessionSnapshot},
    session::{Harness, SessionManager},
};
use tauri::{AppHandle, State};

#[path = "events/events.rs"]
pub mod events;
mod fs;
#[path = "harness/harness.rs"]
pub mod harness;
pub mod session;

#[tauri::command]
async fn send_msg(
    session_id: &str,
    prompt: &str,
    harness: &str,
    model: &str,
    effort: &str,
    cwd: &str,
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
            cwd,
            use_worktree,
            worktree_name,
            is_new_session,
            &app,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_sessions_by_project() -> Result<Vec<SessionIndexByProject>, String> {
    fs::list_sessions_by_project()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_session_index_items() -> Result<Vec<SessionIndexItem>, String> {
    fs::list_session_index_items()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_session_by_id(session_id: &str) -> Result<Option<SessionSnapshot>, String> {
    fs::get_session_by_id(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            send_msg,
            list_sessions_by_project,
            list_session_index_items,
            get_session_by_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
