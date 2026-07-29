use crate::session::{Harness, SessionManager};
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
    is_new_session: bool,
    app: AppHandle,
    manager: State<'_, SessionManager>,
) -> Result<(), String> {
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
            is_new_session,
            &app,
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![send_msg])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
