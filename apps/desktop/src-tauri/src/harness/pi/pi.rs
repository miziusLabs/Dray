//! Pi Coding Agent process integration.
//!
//! Pi's RPC mode keeps one child alive, loads the user's normal global and
//! project extensions, and sends every event as one JSON line. The app keeps its
//! own normalized log while Pi keeps the model-context session file.

use crate::events::{AgentEvent, AgentEventPayload};
use crate::harness::Harness::Pi;
use crate::models::{Effort, Model};
use crate::session::{flush_queued, publish_status, QueuedMessages, Session, StatusTracker};
use crate::store::{self, append_session_event, next_seq_by_session_id};
use anyhow::{Context, Result};
use serde_json::Value;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{ChildStderr, ChildStdin, ChildStdout},
    sync::Mutex,
};

pub mod commands;
pub mod mapper;
pub mod parser;
pub use parser::PiEvent;

/// Removes the Pi context transcript owned by a deleted Dray session.
///
/// Pi's filename includes its creation timestamp, so cleanup matches the exact
/// session-id suffix rather than guessing or deleting another session's file.
pub async fn delete_session_data(session_id: &str) -> Result<()> {
    let dir = store::get_home_app_dir().await?.join("pi-sessions");
    let suffix = format!("_{session_id}.jsonl");
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(&suffix) {
            tokio::fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}

/// Updates a Pi transcript's stored cwd after Dray relocates its worktree.
///
/// Pi refuses to open a session whose header points at a deleted directory in
/// RPC mode, so the header must follow the durable Dray index when cleanup moves
/// the session back to the project root.
pub async fn relocate_session_data(session_id: &str, cwd: &str) -> Result<()> {
    let dir = store::get_home_app_dir().await?.join("pi-sessions");
    let suffix = format!("_{session_id}.jsonl");
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_name().to_string_lossy().ends_with(&suffix) {
            continue;
        }

        let path = entry.path();
        let contents = tokio::fs::read_to_string(&path).await?;
        let (header_line, rest) = contents.split_once('\n').unwrap_or((&contents, ""));
        let mut header: Value = serde_json::from_str(header_line)
            .with_context(|| format!("invalid Pi session header in {}", path.display()))?;
        if header.get("type").and_then(Value::as_str) != Some("session") {
            continue;
        }
        header["cwd"] = Value::String(cwd.to_string());
        let mut updated = serde_json::to_string(&header)?;
        if !rest.is_empty() || contents.ends_with('\n') {
            updated.push('\n');
            updated.push_str(rest);
        }
        tokio::fs::write(path, updated).await?;
    }
    Ok(())
}

/// Starts one persistent Pi RPC child for a Dray session.
///
/// Pi's own session file is placed in a stable Dray-owned directory so a
/// session can still resume after its worktree is relocated or removed. The
/// user configuration and extensions remain the normal `~/.pi/agent` ones.
pub async fn init(
    session_id: &str,
    model: &Model,
    effort: Option<Effort>,
    _permission_mode: crate::events::ApprovalPolicy,
    cwd: &str,
    session_cwd: &str,
    _worktree_name: Option<&str>,
    _is_new_session: bool,
    fork_from: Option<&str>,
    app: &AppHandle,
) -> Result<Session> {
    let app_dir = store::get_home_app_dir().await?;
    let session_dir = app_dir.join("pi-sessions");
    tokio::fs::create_dir_all(&session_dir).await?;

    let session_dir = session_dir
        .to_str()
        .context("Pi session directory is not valid UTF-8")?;
    let mut args = vec![
        "--mode",
        "rpc",
        "--session-dir",
        session_dir,
        // A desktop session is already an explicit user action. This lets Pi
        // load project-local extensions and context files without an invisible
        // trust prompt in its headless RPC mode.
        "--approve",
    ];
    if let Some(pi_model) = &model.pi_model {
        args.push("--provider");
        args.push(&pi_model.provider);
        args.push("--model");
        args.push(&pi_model.id);
    }
    if let Some(effort) = effort {
        args.push("--thinking");
        args.push(effort.as_arg());
    }
    if let Some(parent) = fork_from {
        // Pi performs the lazy fork while opening RPC mode and keeps the new
        // transcript under the id Dray already assigned to this session.
        args.extend(["--fork", parent, "--session-id", session_id]);
    } else {
        // The same form creates a missing session and resumes an existing one.
        args.extend(["--session-id", session_id]);
    }

    let mut command = crate::binpath::pi_command().await;
    if let Some(home) = dirs::home_dir() {
        command.env("PI_CODING_AGENT_DIR", home.join(".pi/agent"));
    }
    if let Some(endpoint) = crate::orchestration::child_endpoint() {
        command.env("DRAY_ENDPOINT", endpoint);
    }

    let mut child = command
        .args(args)
        .current_dir(cwd)
        .env("DRAY_SESSION_ID", session_id)
        .env("PATH", crate::binpath::agent_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("couldn't start pi")?;

    #[cfg(windows)]
    let process_job = crate::session::ProcessJob::attach(&child);

    let stdin = Arc::new(Mutex::new(
        child.stdin.take().context("failed to take stdin")?,
    ));
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let stdout_events = events.clone();
    let status: Arc<Mutex<StatusTracker>> = Arc::new(Mutex::new(StatusTracker::default()));
    let stdout_status = status.clone();
    let stopped = Arc::new(AtomicBool::new(false));
    let stdout_stopped = stopped.clone();
    let seq_start = if _is_new_session {
        0
    } else {
        next_seq_by_session_id(session_id).await?
    };
    let seq = Arc::new(AtomicU64::new(seq_start));
    let stdout_seq = seq.clone();
    let flush_seq = seq.clone();
    let queued: QueuedMessages = Arc::new(Mutex::new(Vec::new()));
    let stdout_queued = queued.clone();
    let flush_events = events.clone();
    let flush_stdin = stdin.clone();
    let pending_ui = mapper::PendingUiRequests::default();
    let stdout_pending_ui = pending_ui.clone();
    let session_id_owned = session_id.to_string();
    let session_cwd_owned = session_cwd.to_string();
    let app_for_stdout = app.clone();

    tokio::spawn(async move {
        if let Err(error) = read_stdout(
            stdout,
            &session_id_owned,
            &session_cwd_owned,
            stdout_events,
            stdout_seq,
            stdout_status,
            stdout_stopped,
            stdout_queued,
            flush_seq,
            flush_events,
            flush_stdin,
            stdout_pending_ui,
            &app_for_stdout,
        )
        .await
        {
            eprintln!("Failed to read Pi stdout: {error}");
        }
    });

    tokio::spawn(async move {
        if let Err(error) = read_stderr(stderr).await {
            eprintln!("Failed to read Pi stderr: {error}");
        }
    });

    Ok(Session {
        id: session_id.to_string(),
        child,
        stdin,
        harness: Pi,
        cwd: session_cwd.to_string(),
        model: model.id,
        pi_model: model.pi_model.clone(),
        effort,
        permission_mode: _permission_mode,
        events,
        seq,
        status,
        stopped,
        #[cfg(windows)]
        process_job,
        pi_ui_requests: pending_ui,
        queued,
    })
}

/// Reads and persists Pi's normalized events one RPC line at a time.
async fn read_stdout(
    stdout: ChildStdout,
    session_id: &str,
    session_cwd: &str,
    events: Arc<Mutex<Vec<AgentEvent>>>,
    stdout_seq: Arc<AtomicU64>,
    status: Arc<Mutex<StatusTracker>>,
    stopped: Arc<AtomicBool>,
    queued: QueuedMessages,
    flush_seq: Arc<AtomicU64>,
    flush_events: Arc<Mutex<Vec<AgentEvent>>>,
    flush_stdin: Arc<Mutex<ChildStdin>>,
    pending_ui: mapper::PendingUiRequests,
    app: &AppHandle,
) -> Result<()> {
    let mut lines = BufReader::new(stdout).lines();
    let mut mapper =
        mapper::Mapper::with_seq_and_ui(session_id, session_cwd, stdout_seq, pending_ui);

    while let Some(line) = lines.next_line().await? {
        if stopped.load(Relaxed) {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }

        let pi_event = match parser::parse_line(&line) {
            Ok(event) => event,
            Err(error) => {
                record_failure(session_id, "parse", &error.to_string(), &line).await;
                continue;
            }
        };

        if matches!(pi_event, PiEvent::Unrecognized) {
            record_failure(session_id, "unknown_subtype", "unmodeled Pi event", &line).await;
        }

        let mapped = match mapper.map(pi_event) {
            Ok(events) => events,
            Err(error) => {
                record_failure(session_id, "map", &error.to_string(), &line).await;
                continue;
            }
        };

        for mut agent_event in mapped {
            if stopped.load(Relaxed) {
                return Ok(());
            }

            if let AgentEventPayload::TurnCompleted { ref mut head, .. } = agent_event.payload {
                *head = crate::git::snapshot_tree(session_cwd).await;
                if stopped.load(Relaxed) {
                    return Ok(());
                }
            }

            if let AgentEventPayload::ToolCallCompleted { ref mut result, .. } = agent_event.payload
            {
                crate::attachments::archive_result_images(session_id, &mut result.images).await;
            }

            let at_boundary = matches!(
                agent_event.payload,
                AgentEventPayload::ToolCallStarted { .. }
                    | AgentEventPayload::ToolCallCompleted { .. }
                    | AgentEventPayload::TurnCompleted { .. }
            );

            if stopped.load(Relaxed) {
                return Ok(());
            }
            if let Err(error) = app.emit("agent_event", &agent_event) {
                eprintln!("[pi emit err] {error}");
            }

            let next_status = {
                let mut tracker = status.lock().await;
                if agent_event.subagent.is_none() {
                    tracker.note_tool_call(&agent_event.payload);
                }
                tracker.on_event(&agent_event.payload)
            };
            if let Some(next) = next_status {
                if stopped.load(Relaxed) {
                    return Ok(());
                }
                publish_status(session_id, next, app).await;
            }

            if stopped.load(Relaxed) {
                return Ok(());
            }

            // Deltas and usage are previews/live counters. Their committed
            // counterparts are the assistant message and settled event, so they
            // do not belong in Dray's append-only transcript.
            if matches!(
                agent_event.payload,
                AgentEventPayload::Delta(_)
                    | AgentEventPayload::UsageUpdate(_)
                    | AgentEventPayload::ModelRequestStarted
                    | AgentEventPayload::QuestionsAsked { .. }
                    | AgentEventPayload::ExtensionNotification { .. }
            ) {
                continue;
            }

            events.lock().await.push(agent_event.clone());
            if let Err(error) = append_session_event(session_id, agent_event).await {
                eprintln!("[pi write err] {error}");
            }

            if stopped.load(Relaxed) {
                return Ok(());
            }

            if at_boundary {
                flush_queued(
                    session_id,
                    Pi,
                    &queued,
                    &flush_seq,
                    &flush_events,
                    &flush_stdin,
                    &status,
                    app,
                )
                .await;
            }
        }
    }

    Ok(())
}

/// Logs a malformed or unsupported Pi record without stopping the read loop.
async fn record_failure(session_id: &str, stage: &str, detail: &str, raw: &str) {
    eprintln!("[pi {stage} err] {detail}\n[{stage} err] raw line: {raw}");
    if let Err(error) = store::record_parse_failure(session_id, stage, detail, raw).await {
        eprintln!("[pi failure log err] {error}");
    }
}

/// Copies Pi's stderr to the app process for diagnostics.
async fn read_stderr(stderr: ChildStderr) -> Result<()> {
    let mut lines = BufReader::new(stderr).lines();
    while let Some(line) = lines.next_line().await? {
        eprintln!("Pi stderr: {line}");
    }
    Ok(())
}
