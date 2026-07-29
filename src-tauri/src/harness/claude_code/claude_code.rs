use crate::harness::Harness::ClaudeCode;
use crate::session::Session;
use anyhow::{Context, Result};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{ChildStderr, ChildStdout, Command},
    sync::Mutex,
};
pub mod parser;
pub use parser::ClaudeCodeEvent;

pub async fn init(
    session_id: &str,
    model: &str,
    effort: &str,
    is_new_session: bool,
    app: &AppHandle,
) -> Result<Session> {
    let mut args = vec![
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        model,
        "--effort",
        effort,
    ];

    if is_new_session {
        args.extend(["--session-id", session_id]);
    } else {
        args.extend(["--resume", session_id]);
    };

    let mut child = Command::new("claude")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("couldn't start claude")?;

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let events: Arc<Mutex<Vec<ClaudeCodeEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let stdout_events = Arc::clone(&events);

    let app = app.clone();
    tokio::spawn(async move {
        if let Err(error) = read_stdout(stdout, stdout_events, &app).await {
            eprintln!("Failed to read Claude stdout: {error}");
        }
    });

    tokio::spawn(async move {
        if let Err(error) = read_stderr(stderr).await {
            eprintln!("Failed to read Claude stderr: {error}");
        }
    });

    Ok(Session {
        id: session_id.to_string(),
        child,
        stdin,
        harness: ClaudeCode,
        model: model.to_string(),
        effort: effort.to_string(),
        events,
    })
}

async fn read_stdout(
    stdout: ChildStdout,
    events: Arc<Mutex<Vec<ClaudeCodeEvent>>>,
    app: &AppHandle,
) -> Result<()> {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        match parser::parse_line(&line) {
            Ok(value) => {
                // println!("[parse ok] {}", event_summary(&value));
                app.emit("events", &value)?;
                events.lock().await.push(value);
            }
            Err(err) => {
                eprintln!("[parse err] {err}");
                eprintln!("[parse err] raw line: {line}");
            }
        }
    }

    Ok(())
}

async fn read_stderr(stderr: ChildStderr) -> Result<()> {
    let reader = BufReader::new(stderr);
    let mut lines = reader.lines();

    while let Some(line) = lines.next_line().await? {
        eprintln!("Claude stderr: {line}");
    }

    Ok(())
}

// fn event_summary(event: &ClaudeCodeEvent) -> String {
//     match event {
//         ClaudeCodeEvent::System(system) => match system {
//             parser::SystemEvent::Init { model, cwd, .. } => {
//                 format!("system/init model={model} cwd={cwd}")
//             }
//             parser::SystemEvent::Status { status, .. } => {
//                 format!("system/status status={status}")
//             }
//             parser::SystemEvent::HookStarted { hook_name, .. } => {
//                 format!("system/hook_started hook={hook_name}")
//             }
//             parser::SystemEvent::HookResponse {
//                 hook_name, outcome, ..
//             } => format!("system/hook_response hook={hook_name} outcome={outcome}"),
//         },
//         ClaudeCodeEvent::StreamEvent { event, ttft_ms, .. } => {
//             let kind = event.get("type").and_then(|v| v.as_str()).unwrap_or("?");
//             match ttft_ms {
//                 Some(ms) => format!("stream_event type={kind} ttft_ms={ms}"),
//                 None => format!("stream_event type={kind}"),
//             }
//         }
//         ClaudeCodeEvent::Assistant { message, .. } => {
//             let preview = message
//                 .pointer("/content/0/text")
//                 .and_then(|v| v.as_str())
//                 .unwrap_or("");
//             let preview: String = preview.chars().take(80).collect();
//             format!("assistant text={preview:?}")
//         }
//         ClaudeCodeEvent::Result(result) => match result {
//             parser::ResultEvent::Success {
//                 result,
//                 duration_ms,
//                 total_cost_usd,
//                 ..
//             } => {
//                 let preview: String = result.chars().take(80).collect();
//                 format!(
//                     "result/success duration_ms={duration_ms} cost_usd={total_cost_usd} text={preview:?}"
//                 )
//             }
//         },
//     }
// }
