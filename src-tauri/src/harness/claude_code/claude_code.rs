use crate::events::{AgentEvent, AgentEventPayload};
use crate::store::{append_session_event, next_seq_by_session_id};
use crate::harness::{claude_code, Harness::ClaudeCode};
use crate::models::{Effort, Model};
use crate::session::Session;
use anyhow::{Context, Result};
use std::process::Stdio;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{ChildStderr, ChildStdout, Command},
    sync::Mutex,
};
pub mod parser;
pub use parser::ClaudeCodeEvent;
pub mod mapper;

/// Takes a resolved [`Model`] rather than an id: there's no way to build one
/// outside `models`, so an unknown model can't reach the spawn and this doesn't
/// re-validate what the caller already checked.
pub async fn init(
    session_id: &str,
    model: &Model,
    effort: Option<Effort>,
    cwd: &str,
    worktree_name: Option<&str>,
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
        // Infallible for a `Model`: only `claude_models()` builds one, and none
        // of those carry `Unknown`.
        model
            .id
            .as_arg()
            .context("model has no CLI alias")?,
    ];

    // Omitted for models with no effort levels. The CLI accepts and ignores the
    // flag there, so this is about not recording an effort the session never had.
    if let Some(effort) = effort {
        args.extend(["--effort", effort.as_arg()]);
    }

    if is_new_session {
        args.extend(["--session-id", session_id]);
    } else {
        args.extend(["--resume", session_id]);
    };

    // Only on creation: the CLI resolves the tree relative to its own cwd, so
    // the child must start at the project root even though the session's
    // recorded `cwd` is the worktree it ends up in.
    if let Some(name) = worktree_name {
        args.extend(["-w", name]);
    }

    let mut child = Command::new("claude")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("couldn't start claude")?;

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let stdout_events = events.clone();

    let seq_start: u64 = if is_new_session {
        0
    } else {
        next_seq_by_session_id(session_id).await?
    };

    let seq = Arc::new(AtomicU64::new(seq_start));
    let stdout_seq = seq.clone();

    let stdout_session_id = session_id.to_string();

    let app = app.clone();
    tokio::spawn(async move {
        let session_id = stdout_session_id;
        if let Err(error) = read_stdout(stdout, &session_id, stdout_events, stdout_seq, &app).await
        {
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
        model: model.id,
        effort,
        events,
        seq,
    })
}

async fn read_stdout(
    stdout: ChildStdout,
    session_id: &str,
    events: Arc<Mutex<Vec<AgentEvent>>>,
    stdout_seq: Arc<AtomicU64>,
    app: &AppHandle,
) -> Result<()> {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    // One mapper per session: it carries state across lines (the open message
    // id, the seq counter), so it must outlive the loop body.
    let mut mapper = claude_code::mapper::Mapper::new(stdout_seq);

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let claude_event = match parser::parse_line(&line) {
            Ok(ev) => ev,
            Err(err) => {
                eprintln!("[claude parse err] {err}\n[parse err] raw line: {line}");
                continue;
            }
        };

        let agent_event = match mapper.map(claude_event) {
            Ok(Some(ev)) => ev,
            Ok(None) => continue,
            Err(err) => {
                eprintln!("[claude map err] {err}");
                continue;
            }
        };

        if let Err(err) = app.emit("agent_event", &agent_event) {
            eprintln!("[claude emit err] {err}");
        }

        // Deltas are emitted for the live view but never retained
        if matches!(agent_event.payload, AgentEventPayload::Delta(_)) {
            continue;
        }

        events.lock().await.push(agent_event.clone());

        if let Err(err) = append_session_event(session_id, agent_event).await {
            eprintln!("[claude write err] {err}");
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
