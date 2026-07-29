//! Normalized, harness-agnostic event model.
//!
//! Every harness (Claude Code, Codex, …) parses its own wire format, then maps
//! it onto [`AgentEvent`]. The frontend, the on-disk log, and the session index
//! only ever see this vocabulary — adding a harness means writing one mapper and
//! touching nothing else.
//!
//! # Log evolution rules
//!
//! Persisted `events.jsonl` files outlive any single build, so this format only
//! evolves in backward-compatible ways:
//!
//! 1. **Never remove, rename, or retype a shipped field.** Add a new field
//!    alongside and stop writing the old one. (Old code tolerates new lines for
//!    free: serde ignores unknown fields.)
//! 2. **Every field added after this baseline must be `Option<T>` or carry
//!    `#[serde(default)]`**, so new code tolerates old lines.
//! 3. **Readers must skip lines they cannot parse** (and count them), mirroring
//!    the stdout parser's policy. Unknown payload kinds don't even need that:
//!    they deserialize as [`AgentEventPayload::Unrecognized`].

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod usage;

pub use usage::{ContextWindow, RateLimit, Usage};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    ClaudeCode,
    Codex,
}

/// One normalized event: an envelope (who, when, what order, which conversation)
/// wrapping a [`payload`](Self::payload) (what happened).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub session_id: String,
    pub harness: Harness,
    /// Position in the session's event log: 0, 1, 2, … One counter per session,
    /// shared by mapped stdout lines and events the app synthesizes itself
    /// (e.g. [`AgentEventPayload::UserMessage`] when the prompt is sent), and
    /// seeded from the persisted log on resume.
    ///
    /// **The** ordering key, and the cursor for reconnecting a UI to a running
    /// session ("give me everything after #N"). Never sort by `ts`, which most
    /// Claude Code events omit.
    pub seq: u64,
    pub ts: String,
    pub turn_id: Option<String>,
    /// `None` = main conversation, `Some` = subagent branch. Both harnesses
    /// mark this on the wire under their own name; normalizing it here is what
    /// lets the UI separate the two without knowing which harness it's reading.
    pub thread: Option<ThreadRef>,
    pub payload: AgentEventPayload,
    /// The originating harness line. `None` on the emitted path — raw lines are
    /// archived separately — but always populated for
    /// [`AgentEventPayload::Unknown`], which is useless without it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

/// Identifies a subagent branch. Claude Code addresses these by
/// `parent_tool_use_id`, Codex by `agent_path`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRef {
    pub thread_id: String,
    /// Drives the collapsed subagent card's title.
    pub label: Option<String>,
    /// Subagents can spawn subagents. The main thread uses `thread: None`
    /// rather than depth 0.
    #[serde(default)]
    pub depth: u8,
}

/// What happened.
///
/// Permission request/resolve is deliberately absent: no captured fixture shows
/// their shape, so the variants would be a guess. Add once captured.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum AgentEventPayload {
    // ---------- session / turn lifecycle ----------
    SessionStarted(SessionInfo),
    /// Claude Code has no equivalent, so its mapper synthesizes one when the
    /// prompt is written to stdin.
    TurnStarted {
        prompt_preview: Option<String>,
    },
    /// Not a session terminator — one arrives per completed turn.
    TurnCompleted {
        status: TurnStatus,
        stop_reason: Option<String>,
        final_text: Option<String>,
        usage: Option<Usage>,
        duration_ms: Option<u64>,
    },
    SettingsChanged(Settings),

    // ---------- conversation ----------
    UserMessage {
        text: String,
        #[serde(default)]
        images: Vec<ImageRef>,
    },
    AssistantText {
        block: BlockRef,
        text: String,
    },
    /// `encrypted` records that a reasoning step happened but its content is
    /// unreadable, which is how Codex reports reasoning it won't disclose.
    Reasoning {
        block: BlockRef,
        text: String,
        #[serde(default)]
        encrypted: bool,
    },

    // ---------- streaming ----------
    /// Incremental content, superseded by the committed event for the same
    /// [`BlockRef`]. See [`DeltaEvent`].
    Delta(DeltaEvent),

    // ---------- tools ----------
    ToolCallStarted {
        call_id: String,
        /// The harness's own tool name, verbatim (`"Bash"`, `"apply_patch"`).
        name: String,
        /// Named `tool_kind`, not `kind`: this enum is tagged on `kind`, and a
        /// field of that name collides with the tag.
        tool_kind: ToolKind,
        /// Always an object. Harnesses that pass arguments as a JSON-encoded
        /// string are parsed here; unparseable input is preserved as
        /// `{"_unparsed": "…"}` rather than dropped.
        input: Value,
        /// Input that isn't JSON at all, kept verbatim — Codex's
        /// `custom_tool_call.input` is raw JS source.
        raw_input: Option<String>,
        title: Option<String>,
    },
    ToolCallCompleted {
        call_id: String,
        result: ToolResult,
    },
    /// Structured file changes. Codex reports these first-class; Claude Code
    /// does not, so its edits currently surface as ordinary
    /// [`ToolKind::FileEdit`] calls.
    FileEdits {
        call_id: Option<String>,
        #[serde(default)]
        edits: Vec<FileEdit>,
    },

    // ---------- subagents ----------
    SubagentStarted {
        thread_id: String,
        label: String,
        description: Option<String>,
        prompt: Option<String>,
    },
    SubagentProgress {
        thread_id: String,
        last_tool: Option<String>,
        usage: Option<Usage>,
    },
    SubagentFinished {
        thread_id: String,
        status: String,
        summary: Option<String>,
        usage: Option<Usage>,
    },

    // ---------- accounting / control ----------
    /// Debounce these in the mapper: harnesses emit token counts far more often
    /// than the figures meaningfully change.
    UsageUpdate(Usage),
    Hook {
        name: String,
        event: String,
        phase: HookPhase,
        exit_code: Option<i32>,
        outcome: Option<String>,
    },
    ContextCompacted {
        message: Option<String>,
        window_number: Option<u32>,
    },
    Error {
        source: ErrorSource,
        message: String,
        #[serde(default)]
        fatal: bool,
    },
    /// A line we parsed but could not classify. Surfacing these beats silently
    /// dropping them.
    Unknown {
        harness_type: String,
    },

    /// Produced by the *deserializer*, never by a mapper: a payload `kind` this
    /// build doesn't know, i.e. a log written by a newer version of the app.
    /// The envelope (`seq`, `ts`, `thread`) still survives, so the event keeps
    /// its place in the log; the UI renders nothing for it.
    ///
    /// Distinct from [`Unknown`](Self::Unknown), which is a *harness line* the
    /// mapper couldn't classify.
    #[serde(other)]
    Unrecognized,
}

/// How a turn ended. Claude Code reports this as `is_error` on its result
/// event; Codex live emits `turn.completed` (a failed turn is uncaptured so
/// far). A user-abort outcome likely deserves its own variant once one has been
/// captured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Success,
    Error,
}

/// Identifies one content block within one assistant message, joining streamed
/// content to its committed counterpart.
///
/// A single message is often `[text, tool_use, …]`, and each block arrives as
/// its own event. Claude Code's committed events carry no index, so the mapper
/// derives one by counting blocks per `message_id` in arrival order.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockRef {
    pub message_id: String,
    pub index: u32,
}

/// Incremental content for a block.
///
/// **Deltas are a preview, never the source of truth**: the committed event for
/// the same [`BlockRef`] supersedes whatever they accumulated. Absent deltas are
/// the common case rather than an edge case — Codex emits none, and Claude Code
/// emits none for subagent output — so consumers must render correctly without
/// them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DeltaEvent {
    BlockStart {
        block: BlockRef,
        block_kind: BlockKind,
    },
    TextDelta {
        block: BlockRef,
        text: String,
    },
    /// A fragment of a tool call's JSON arguments, unparseable until every
    /// fragment for the block has been concatenated.
    InputDelta {
        block: BlockRef,
        partial_json: String,
    },
    BlockStop {
        block: BlockRef,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Text,
    Thinking,
    ToolUse,
}

/// A rendering hint — which icon and component to use. Nothing depends on this
/// for correctness, and [`ToolKind::Other`] must always render acceptably.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Shell,
    FileRead,
    FileEdit,
    Search,
    Web,
    Mcp,
    SubagentSpawn,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    /// Result content flattened to text; harnesses vary between a bare string
    /// and an array of blocks.
    pub text: String,
    /// Harnesses routinely omit the error flag on success, so this defaults to
    /// `false` rather than being treated as unknown.
    #[serde(default)]
    pub is_error: bool,
    /// The full result payload when the harness supplies a structured one.
    pub structured: Option<Value>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub path: String,
    pub change: FileChange,
    pub unified_diff: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChange {
    Add,
    Update,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookPhase {
    Started,
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorSource {
    /// The harness reported an error of its own.
    Harness,
    /// We failed to parse or map the line.
    Parser,
    /// The child process failed — spawn, stderr, unexpected exit.
    Process,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRef {
    pub path: Option<String>,
    pub url: Option<String>,
    pub mime_type: Option<String>,
}

/// Session-level facts, known at startup.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionInfo {
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub harness_version: Option<String>,
    pub tools: Vec<String>,
    pub mcp_servers: Vec<McpServerInfo>,
    pub subagent_types: Vec<String>,
    pub settings: Option<Settings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub status: String,
}

/// Settings that can change mid-session, so they arrive as events rather than
/// living only on [`SessionInfo`].
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub model: Option<String>,
    /// Free-form: Claude Code's `permissionMode` and Codex's `approval_policy`
    /// use different vocabularies, and neither looks stable enough yet to model
    /// as a shared enum without a lossy mapping.
    pub approval_policy: Option<String>,
    pub sandbox: Option<String>,
    pub writable_roots: Vec<String>,
    pub network_access: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rule 2: new code reads old lines. Flags and collections deserialize when
    /// absent instead of failing the line.
    #[test]
    fn old_lines_without_defaulted_fields_still_parse() {
        let v: AgentEventPayload =
            serde_json::from_str(r#"{"kind":"user_message","text":"hi"}"#).unwrap();
        assert!(matches!(
            v,
            AgentEventPayload::UserMessage { ref text, ref images } if text == "hi" && images.is_empty()
        ));

        let v: AgentEventPayload = serde_json::from_str(
            r#"{"kind":"reasoning","block":{"messageId":"m","index":0},"text":"t"}"#,
        )
        .unwrap();
        assert!(matches!(
            v,
            AgentEventPayload::Reasoning { encrypted: false, .. }
        ));
    }

    /// Rule 1 corollary: old code reads new lines. Unknown fields are ignored,
    /// and an unknown payload kind degrades to `Unrecognized` instead of
    /// failing the whole line.
    #[test]
    fn new_lines_degrade_gracefully() {
        let v: AgentEventPayload = serde_json::from_str(
            r#"{"kind":"turn_completed","status":"success","someFutureField":42}"#,
        )
        .unwrap();
        assert!(matches!(
            v,
            AgentEventPayload::TurnCompleted { status: TurnStatus::Success, .. }
        ));

        let v: AgentEventPayload =
            serde_json::from_str(r#"{"kind":"from_the_future","payload":9001}"#).unwrap();
        assert!(matches!(v, AgentEventPayload::Unrecognized));
    }

    /// The nested tag-in-tag shape (`kind` outer, `type` inner) survives a
    /// round trip.
    #[test]
    fn delta_round_trips() {
        let d = AgentEventPayload::Delta(DeltaEvent::TextDelta {
            block: BlockRef {
                message_id: "m".into(),
                index: 0,
            },
            text: "he".into(),
        });
        let s = serde_json::to_string(&d).unwrap();
        assert!(s.contains(r#""kind":"delta""#) && s.contains(r#""type":"text_delta""#));
        let back: AgentEventPayload = serde_json::from_str(&s).unwrap();
        assert_eq!(s, serde_json::to_string(&back).unwrap());
    }
}
