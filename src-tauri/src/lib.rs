use crate::session::{Harness, SessionManager};
use anyhow::{bail, Result};
use tauri::{AppHandle, State};

// #[tauri::command]
// fn greet(name: &str) -> String {
//     format!("Hello, {}! You've been greeted from Rust!", name)
// }
pub mod claude_code;
mod fs;
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
) -> Result<()> {
    let harness = match harness {
        "claude_code" => Harness::ClaudeCode,
        "codex" => Harness::Codex,
        _ => bail!("invalid harness"),
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
        .await?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SessionManager::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
