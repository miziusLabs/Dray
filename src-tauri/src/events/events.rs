//! Normalized, harness-agnostic event model.
//!
//! Every harness parses its own wire format, then maps it onto [`AgentEvent`].
//! The frontend, the on-disk log, and the session index only see this
//! vocabulary, so adding a harness means writing one mapper.
//!
//! # Log evolution rules
//!
//! Persisted `events.jsonl` outlives any single build, so:
//!
//! 1. Never remove, rename, or retype a shipped field — add alongside instead.
//! 2. Every field added from here on is `Option<T>` or `#[serde(default)]`, so
//!    new code reads old lines.
//! 3. Readers skip lines they cannot parse. Unknown payload kinds don't need
//!    that; they land in [`AgentEventPayload::Unrecognized`].

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub mod usage;

pub use usage::{ContextWindow, RateLimit, Usage};

// `Harness` is a harness concept, not an event one; it lives in `crate::harness`
// and is used here only as a field type.
use crate::harness::Harness;

/// One normalized event: an envelope (who, when, what order, which conversation)
/// wrapping a [`payload`](Self::payload) (what happened).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub session_id: String,
    pub harness: Harness,
    /// Position in the session's event log, and the cursor for reconnecting a UI
    /// to a running session. One counter per session, shared by mapped stdout
    /// lines and events the app synthesizes itself, seeded from the persisted log
    /// on resume. Never sort by `ts` — most Claude Code events omit it.
    pub seq: u64,
    pub ts: String,
    pub turn_id: Option<String>,
    /// `None` = main conversation, `Some` = the subagent that produced this.
    pub subagent: Option<Subagent>,
    pub payload: AgentEventPayload,
    /// `None` on the emitted path — raw lines are archived separately — but
    /// always populated for [`AgentEventPayload::Unknown`], which is useless
    /// without it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

/// A running subagent, whose events interleave with the main conversation's on
/// one stdout stream.
///
/// Claude Code identifies these by `parent_tool_use_id` — the id of the tool
/// call that spawned it, so this equals the `call_id` of the corresponding
/// [`AgentEventPayload::ToolCallStarted`] and is what nests a subagent's work
/// under it. Codex uses `agent_path`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    pub id: String,
    /// Drives the collapsed subagent card's title.
    pub label: Option<String>,
}

/// What happened.
///
/// Permission request/resolve is deliberately absent: no captured fixture shows
/// their shape, so the variants would be a guess. Add once captured.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentEventPayload {
    // ---------- session / turn lifecycle ----------
    /// Claude Code emits one `init` per turn, not per session — the tool list
    /// grows between them as deferred tools load — so this carries whatever the
    /// turn was configured with. The first of a session is the session's.
    ///
    /// A turn is not the same as a prompt: the agent opens one for itself when
    /// an async subagent reports back.
    TurnStarted(SessionInfo),
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
        /// `Some` only when this content was also streamed, naming the preview
        /// it supersedes. `None` — the common case, covering Claude Code
        /// subagents and all of Codex — means nothing was streamed and the
        /// event simply appends in `seq` order.
        #[serde(default)]
        block: Option<BlockRef>,
        text: String,
    },
    /// `encrypted` records that a reasoning step happened but its content is
    /// unreadable, which is how Codex reports reasoning it won't disclose.
    Reasoning {
        #[serde(default)]
        block: Option<BlockRef>,
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
        tool_type: ToolType,
        /// Always an object. JSON-encoded argument strings are parsed here;
        /// unparseable input becomes `{"_unparsed": "…"}` rather than dropped.
        input: Value,
        /// Input that isn't JSON at all — Codex's `custom_tool_call.input` is raw
        /// JS source.
        raw_input: Option<String>,
        title: Option<String>,
    },
    ToolCallCompleted {
        call_id: String,
        result: ToolResult,
    },
    /// Structured file changes. Codex reports these first-class; Claude Code
    /// does not, so its edits currently surface as ordinary
    /// [`ToolType::FileEdit`] calls.
    FileEdits {
        call_id: Option<String>,
        #[serde(default)]
        edits: Vec<FileEdit>,
    },

    // ---------- subagents ----------
    /// Which subagent these describe is on the envelope's [`Subagent`], as it is
    /// for every other event a subagent produces. `agent_id` is the harness's
    /// own internal handle — a *different* id, not a correlation key.
    SubagentStarted {
        agent_id: String,
        label: String,
        description: Option<String>,
        prompt: Option<String>,
    },
    SubagentProgress {
        agent_id: String,
        /// What the subagent is doing right now — Claude Code rewrites this per
        /// progress event, so it drives a live status line without expanding
        /// the subagent's own events.
        description: Option<String>,
        last_tool: Option<String>,
        usage: Option<Usage>,
    },
    SubagentCompleted {
        agent_id: String,
        status: String,
        summary: Option<String>,
        usage: Option<Usage>,
    },
    /// The full set of outstanding background tasks, republished whole on every
    /// change — an empty list means the session's async work has drained.
    /// Latest wins; consumers keep the last one rather than accumulating.
    ///
    /// Not redundant with the subagent lifecycle events above: those describe
    /// one task's own progress, this says how many are still open — which is
    /// half of "is the session done", since a turn's result can arrive while
    /// this is non-empty.
    BackgroundTasksChanged {
        #[serde(default)]
        tasks: Vec<BackgroundTask>,
    },

    // ---------- accounting / control ----------
    /// Debounce these in the mapper: harnesses emit token counts far more often
    /// than the figures meaningfully change.
    UsageUpdate(Usage),
    /// The plan's usage limit, emitted **only when there is something to act
    /// on** — the limit is reached, or requests have moved to usage billing. A
    /// session running comfortably under its limit reports the fact constantly
    /// and produces none of these.
    ///
    /// The status vocabulary is only partly known (`allowed` is the one value
    /// captured), so the wire's own strings are carried through rather than
    /// collapsed into a boolean the mapper would have to guess at.
    RateLimited {
        /// `allowed` is the steady state and never reaches here.
        status: Option<String>,
        /// When the window rolls over, RFC3339 — converted from the unix
        /// seconds the wire sends.
        resets_at: Option<String>,
        /// Which window. `five_hour` observed, and at least one longer window
        /// is believed to exist; not branched on anywhere.
        limit_type: Option<String>,
        /// Whether overage is available, which is what separates "blocked
        /// until it resets" from "still working, now billed as usage".
        overage_status: Option<String>,
        /// Requests are already being billed as usage rather than covered.
        #[serde(default)]
        using_overage: bool,
        /// Why overage isn't available — `org_level_disabled` observed.
        overage_disabled_reason: Option<String>,
    },
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

    /// A payload `kind` this build doesn't know — a log written by a newer
    /// version. Produced by the deserializer, never a mapper; the envelope
    /// survives so the event keeps its place. Distinct from
    /// [`Unknown`](Self::Unknown), a harness line the mapper couldn't classify.
    #[serde(other)]
    Unrecognized,
}

/// One outstanding background task. The harness's wire shape is snake_case, so
/// the parser keeps its own struct and the mapper converts — sharing this one
/// would break on `task_id` vs `taskId`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub task_id: String,
    /// Free-form kind string — `local_agent` observed, set undocumented.
    pub task_type: String,
    pub description: String,
}

/// How a turn ended. Claude Code reports this as `is_error` on its result
/// event; Codex live emits `turn.completed` (a failed turn is uncaptured so
/// far). A user-abort outcome likely deserves its own variant once one has been
/// captured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Success,
    Error,
}

/// Joins streamed content to its committed counterpart. A message is often
/// `[text, tool_use, …]` and each block arrives as its own event; Claude Code's
/// committed events carry no index, so the mapper derives one by counting blocks
/// per `message_id` in arrival order.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct BlockRef {
    pub message_id: String,
    pub index: u32,
}

/// Incremental content for a block.
///
/// **Deltas are a preview, never the source of truth**: the committed event for
/// the same [`BlockRef`] supersedes whatever they accumulated. Absent deltas are
/// the common case — Codex emits none, Claude Code none for subagent output — so
/// consumers must render correctly without them.
/// Tagged on `delta`, not `type`: [`AgentEventPayload::Delta`] is a newtype
/// variant, so these fields flatten into the payload object alongside its own
/// `type` tag. Two tags of the same name serialize but never deserialize.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(
    tag = "delta",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DeltaEvent {
    BlockStart {
        block: BlockRef,
        block_type: BlockType,
    },
    /// Carries *thinking* text too — the shapes are identical and the block's
    /// [`BlockStart`](Self::BlockStart) already said which kind it is, so a
    /// second variant would duplicate that fact.
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

/// A tool call's identity rides here rather than on [`BlockRef`], which stays a
/// cheap map key. It arrives before any arguments have streamed, so the UI can
/// label the call while [`DeltaEvent::InputDelta`] fragments are still landing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum BlockType {
    Text,
    Thinking,
    ToolUse { id: String, name: String },
}

/// A rendering hint — which icon and component to use. Nothing depends on this
/// for correctness, and [`ToolType::Other`] must always render acceptably.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum ToolType {
    Shell,
    FileRead,
    FileEdit,
    Search,
    Web,
    Mcp,
    SubagentSpawn,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub path: String,
    pub change: FileChange,
    pub unified_diff: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum FileChange {
    Add,
    Update,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum HookPhase {
    Started,
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum ErrorSource {
    /// The harness reported an error of its own.
    Harness,
    /// We failed to parse or map the line.
    Parser,
    /// The child process failed — spawn, stderr, unexpected exit.
    Process,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ImageRef {
    pub path: Option<String>,
    pub url: Option<String>,
    pub mime_type: Option<String>,
}

/// Session-level facts, known at startup.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase", default)]
pub struct SessionInfo {
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub harness_version: Option<String>,
    pub tools: Vec<String>,
    pub mcp_servers: Vec<McpServer>,
    pub subagent_types: Vec<String>,
    pub settings: Option<Settings>,
}

/// Shared with the harness parsers rather than duplicated — the wire shape
/// matches, so they deserialize straight into this.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    /// Free-form: `connected`, `pending`, `needs-auth` observed, set undocumented.
    pub status: String,
}

/// Settings that can change mid-session, so they arrive as events rather than
/// living only on [`SessionInfo`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub model: Option<String>,
    /// How much the agent may do without asking. Modeled on Claude Code's
    /// `permissionMode`, which is a closed set; Codex's `approval_policy` maps
    /// onto these, gaining variants if it turns out to need them.
    pub approval_policy: Option<PermissionMode>,
    pub sandbox: Option<String>,
    pub writable_roots: Vec<String>,
    pub network_access: Option<bool>,
    pub fast_mode: Option<String>,
}

/// Permission stance a session *runs under*, in roughly increasing order of
/// autonomy. Every variant is settable, so this is what the app stores and
/// sends — see [`PermissionMode`] for the wider set the CLI reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub enum ApprovalPolicy {
    /// Read-only: research and propose, change nothing.
    Plan,
    /// Prompt per action.
    Manual,
    /// Edits apply without prompting; other tools still ask.
    AcceptEdits,
    #[default]
    Auto,
    DontAsk,
    /// Every permission check bypassed.
    BypassPermissions,
}

impl ApprovalPolicy {
    /// The `--permission-mode` flag value. Total, unlike the inbound direction:
    /// the frontend always sends a real mode, so there is nothing to omit.
    pub fn as_arg(self) -> &'static str {
        match self {
            ApprovalPolicy::Plan => "plan",
            ApprovalPolicy::Manual => "manual",
            ApprovalPolicy::AcceptEdits => "acceptEdits",
            ApprovalPolicy::Auto => "auto",
            ApprovalPolicy::DontAsk => "dontAsk",
            ApprovalPolicy::BypassPermissions => "bypassPermissions",
        }
    }
}

/// What the CLI *reports* in `system/init`, which is a wider set than it
/// accepts: `default` names the harness's own prompting stance, and
/// `--permission-mode` rejects that name while offering `manual` for the same
/// thing. Kept separate from [`ApprovalPolicy`] rather than remapped, so a
/// round trip can't quietly turn one into the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    #[default]
    Default,
    Plan,
    Manual,
    AcceptEdits,
    Auto,
    DontAsk,
    BypassPermissions,
}

/// Hand-rolled to avoid a date dependency for one display-only field; `seq`, not
/// `ts`, is the ordering key.
pub fn now_rfc3339() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();

    rfc3339(now.as_secs() as i64, now.subsec_millis())
}

/// Unix seconds → RFC3339, for wire fields carrying an epoch timestamp where
/// this model uses strings — Claude Code's `resetsAt`, notably.
pub fn rfc3339_from_unix(secs: i64) -> String {
    rfc3339(secs, 0)
}

fn rfc3339(secs: i64, millis: u32) -> String {
    // Days since epoch → civil date, per Howard Hinnant's algorithm.
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        d,
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60,
        secs_of_day % 60,
        millis
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rule 2: new code reads old lines. Flags and collections deserialize when
    /// absent instead of failing the line.
    #[test]
    fn old_lines_without_defaulted_fields_still_parse() {
        let v: AgentEventPayload =
            serde_json::from_str(r#"{"type":"user_message","text":"hi"}"#).unwrap();
        assert!(matches!(
            v,
            AgentEventPayload::UserMessage { ref text, ref images } if text == "hi" && images.is_empty()
        ));

        let v: AgentEventPayload = serde_json::from_str(
            r#"{"type":"reasoning","block":{"messageId":"m","index":0},"text":"t"}"#,
        )
        .unwrap();
        assert!(matches!(
            v,
            AgentEventPayload::Reasoning {
                encrypted: false,
                ..
            }
        ));
    }

    /// Rule 1 corollary: old code reads new lines. Unknown fields are ignored,
    /// and an unknown payload kind degrades to `Unrecognized` instead of
    /// failing the whole line.
    #[test]
    fn new_lines_degrade_gracefully() {
        let v: AgentEventPayload = serde_json::from_str(
            r#"{"type":"turn_completed","status":"success","someFutureField":42}"#,
        )
        .unwrap();
        assert!(matches!(
            v,
            AgentEventPayload::TurnCompleted {
                status: TurnStatus::Success,
                ..
            }
        ));

        let v: AgentEventPayload =
            serde_json::from_str(r#"{"type":"from_the_future","payload":9001}"#).unwrap();
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
        assert!(s.contains(r#""type":"delta""#) && s.contains(r#""delta":"text_delta""#));
        let back: AgentEventPayload = serde_json::from_str(&s).unwrap();
        assert_eq!(s, serde_json::to_string(&back).unwrap());
    }

    /// Every settable mode's wire name is also its flag value, so persisting a
    /// mode and passing it to `--permission-mode` can't drift apart.
    #[test]
    fn every_settable_policy_matches_its_cli_arg() {
        for p in [
            ApprovalPolicy::Plan,
            ApprovalPolicy::Manual,
            ApprovalPolicy::AcceptEdits,
            ApprovalPolicy::Auto,
            ApprovalPolicy::DontAsk,
            ApprovalPolicy::BypassPermissions,
        ] {
            let json = serde_json::to_string(&p).unwrap();
            assert_eq!(json, format!("\"{}\"", p.as_arg()));
        }
    }

    /// The CLI reports `default` in `system/init` even though its flag won't
    /// take it. `PermissionMode` exists to hold that variant; `ApprovalPolicy`
    /// must not gain it back, or an unsettable mode reaches the flag.
    ///
    /// Verified against v2.1.224: `plan`, `acceptEdits`, `bypassPermissions`
    /// and `dontAsk` each report themselves, while both `auto` and `manual`
    /// report `default` — so it names a real stance rather than an omitted
    /// flag, and the init event can't say which of the two is in effect.
    #[test]
    fn reported_default_parses_as_permission_mode_only() {
        let m: PermissionMode = serde_json::from_str(r#""default""#).unwrap();
        assert_eq!(m, PermissionMode::Default);

        assert!(serde_json::from_str::<ApprovalPolicy>(r#""default""#).is_err());
    }

    /// An index entry written before `permissionMode` existed reads as `auto`,
    /// which is also the composer's default — so old sessions resume under the
    /// mode the picker would show for them.
    #[test]
    fn default_policy_is_auto() {
        assert_eq!(ApprovalPolicy::default(), ApprovalPolicy::Auto);
    }
}
