use crate::events::{AgentEvent, AgentEventPayload, ApprovalPolicy};
use crate::harness::{claude_code, Harness::ClaudeCode};
use crate::models::{Effort, Model};
use crate::session::{publish_status, Session, StatusTracker};
use crate::store::{self, append_session_event, next_seq_by_session_id};
use anyhow::{Context, Result};
use std::process::Stdio;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{ChildStderr, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};
pub mod parser;
pub use parser::ClaudeCodeEvent;
pub mod mapper;
pub mod permissions;
use permissions::PendingPermissions;

/// Takes a resolved [`Model`] rather than an id: there's no way to build one
/// outside `models`, so an unknown model can't reach the spawn and this doesn't
/// re-validate what the caller already checked.
pub async fn init(
    session_id: &str,
    model: &Model,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
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
        model.id.as_arg().context("model has no CLI alias")?,
    ];

    // Omitted for models with no effort levels. The CLI accepts and ignores the
    // flag there, so this is about not recording an effort the session never had.
    if let Some(effort) = effort {
        args.extend(["--effort", effort.as_arg()]);
    }

    args.extend(["--permission-mode", permission_mode.as_arg()]);

    // The literal `stdio` is a special case, not a tool name: the flag otherwise
    // takes an MCP tool, and it is undocumented in `--help`. Without it the CLI
    // never asks — it auto-denies every call needing approval and reports
    // `system`/`permission_denied` — which is what made `manual` and `plan` look
    // broken rather than unasked.
    args.extend(["--permission-prompt-tool", "stdio"]);

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

    // Resolved rather than spawned by bare name: a bundled `.app` launched from
    // Finder inherits launchd's `PATH`, which holds no `claude`.
    let mut child = Command::new(crate::binpath::claude().await)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("couldn't start claude")?;

    let stdin = Arc::new(Mutex::new(child.stdin.take().context("failed to take stdin")?));
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let stderr = child.stderr.take().context("failed to take stderr")?;

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let stdout_events = events.clone();

    let status: Arc<Mutex<StatusTracker>> = Arc::new(Mutex::new(StatusTracker::default()));
    let stdout_status = status.clone();

    let pending_permissions = PendingPermissions::default();
    let stdout_pending = pending_permissions.clone();
    let stdout_stdin = stdin.clone();

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
        if let Err(error) = read_stdout(
            stdout,
            &session_id,
            stdout_events,
            stdout_seq,
            stdout_status,
            stdout_pending,
            stdout_stdin,
            &app,
        )
        .await
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
        permission_mode,
        events,
        seq,
        status,
        pending_permissions,
    })
}

/// Reads the child's stdout line by line: parses, maps, emits, and saves each
/// one. Logs and skips a bad line instead of stopping the loop.
async fn read_stdout(
    stdout: ChildStdout,
    session_id: &str,
    events: Arc<Mutex<Vec<AgentEvent>>>,
    stdout_seq: Arc<AtomicU64>,
    status: Arc<Mutex<StatusTracker>>,
    pending_permissions: PendingPermissions,
    stdin: Arc<Mutex<ChildStdin>>,
    app: &AppHandle,
) -> Result<()> {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    // One mapper per session: it carries state across lines (the open message
    // id, the seq counter), so it must outlive the loop body.
    let mut mapper = claude_code::mapper::Mapper::new(stdout_seq, pending_permissions);

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let claude_event = match parser::parse_line(&line) {
            Ok(ev) => ev,
            Err(err) => {
                record_failure(session_id, "parse", &err.to_string(), &line).await;
                continue;
            }
        };

        // A control request the CLI is blocked on, of a subtype this build
        // can't put to the user. Refused from here rather than left alone:
        // silence hangs the turn until the CLI's own deadline, and the read
        // loop is the only place holding both the request and the pipe back.
        if let ClaudeCodeEvent::ControlRequest {
            request_id,
            request: parser::ControlRequest::Unsupported,
        } = &claude_event
        {
            record_failure(session_id, "unsupported_request", "unanswerable", &line).await;

            let denial = permissions::auto_deny_response(
                request_id,
                "This client cannot answer that request.",
            );
            if let Err(err) = crate::session::write_line(&stdin, &denial).await {
                eprintln!("[claude auto-deny err] {err}");
            }
            continue;
        }

        // Parsed, but only by a catch-all — the line is a subtype this build
        // has never seen. Recorded alongside outright failures because it is
        // the same coverage gap; the catch-all only stops it costing the line.
        if let ClaudeCodeEvent::System(parser::SystemEvent::Unrecognized) = &claude_event {
            record_failure(session_id, "unknown_subtype", "unmodeled system subtype", &line).await;
        }

        let agent_event = match mapper.map(claude_event) {
            Ok(Some(ev)) => ev,
            Ok(None) => continue,
            Err(err) => {
                record_failure(session_id, "map", &err.to_string(), &line).await;
                continue;
            }
        };

        if let Err(err) = app.emit("agent_event", &agent_event) {
            eprintln!("[claude emit err] {err}");
        }

        if let Some(next) = status.lock().await.on_event(&agent_event.payload) {
            publish_status(session_id, next, app).await;
        }

        // Live-view only, never retained. Deltas are superseded by the
        // committed event; a usage update is a running counter whose final
        // value lands on `turn_completed` — and `thinking_tokens` alone fires
        // dozens of times per turn, which would be most of a session's log.
        //
        // A permission request is here for a different reason: it is a question,
        // and it can only be answered by the child that asked. That child does
        // not survive a restart, so a persisted request would come back as a
        // card whose buttons cannot work. Dropping it is what makes the stale
        // card impossible rather than merely unlikely. Nothing is lost — the
        // tool call it belongs to is persisted and shows the outcome either way,
        // and a live card survives re-selection because the frontend keeps a
        // loaded session in memory rather than re-reading it.
        //
        // Questions are dropped on the same reasoning, and the "nothing is lost"
        // half holds harder there: the `AskUserQuestion` result the harness
        // writes carries both the questions and the answers, so the transcript
        // keeps the whole exchange without this line.
        if matches!(
            agent_event.payload,
            AgentEventPayload::Delta(_)
                | AgentEventPayload::UsageUpdate(_)
                | AgentEventPayload::PermissionRequested { .. }
                | AgentEventPayload::QuestionsAsked { .. }
        ) {
            continue;
        }

        events.lock().await.push(agent_event.clone());

        if let Err(err) = append_session_event(session_id, agent_event).await {
            eprintln!("[claude write err] {err}");
        }
    }

    Ok(())
}

/// Logs an unreadable line and files it for investigation. Failing to *record*
/// a failure is itself only logged: the read loop must survive anything.
async fn record_failure(session_id: &str, stage: &str, detail: &str, raw: &str) {
    eprintln!("[claude {stage} err] {detail}\n[{stage} err] raw line: {raw}");

    if let Err(err) = store::record_parse_failure(session_id, stage, detail, raw).await {
        eprintln!("[claude failure log err] {err}");
    }
}

/// Copies the child's stderr to this process's, for logging only.
async fn read_stderr(stderr: ChildStderr) -> Result<()> {
    let reader = BufReader::new(stderr);
    let mut lines = reader.lines();

    while let Some(line) = lines.next_line().await? {
        eprintln!("Claude stderr: {line}");
    }

    Ok(())
}
