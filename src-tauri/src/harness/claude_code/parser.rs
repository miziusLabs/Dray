use std::format;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClaudeCodeEvent {
    System(SystemEvent),
    StreamEvent {
        event: StreamFrame,
        session_id: String,
        parent_tool_use_id: Option<String>,
        uuid: String,
        #[serde(default)]
        ttft_ms: Option<u64>,
    },
    Assistant {
        message: AssistantMessage,
        parent_tool_use_id: Option<String>,
        session_id: String,
        uuid: String,
        #[serde(default)]
        request_id: Option<String>,
        #[serde(default)]
        subagent_type: Option<String>,
        #[serde(default)]
        task_description: Option<String>,
    },
    User {
        message: UserMessage,
        parent_tool_use_id: Option<String>,
        session_id: String,
        uuid: String,
        #[serde(default)]
        timestamp: Option<String>,
        #[serde(default)]
        tool_use_result: Option<Value>,
        #[serde(default)]
        subagent_type: Option<String>,
        #[serde(default)]
        task_description: Option<String>,
    },
    Result(ResultEvent),
    RateLimitEvent {
        rate_limit_info: RateLimitInfo,
        uuid: String,
        session_id: String,
    },
}

/// Camel-cased on the wire, unlike every other Claude Code payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitInfo {
    #[serde(default)]
    pub status: Option<String>,
    /// Unix seconds, not RFC3339 like [`crate::events::RateLimit::resets_at`].
    #[serde(default)]
    pub resets_at: Option<i64>,
    #[serde(default)]
    pub rate_limit_type: Option<String>,
    #[serde(default)]
    pub overage_status: Option<String>,
    #[serde(default)]
    pub overage_disabled_reason: Option<String>,
    #[serde(default)]
    pub is_using_overage: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum SystemEvent {
    HookStarted {
        hook_id: String,
        hook_name: String,
        hook_event: String,
        uuid: String,
        session_id: String,
    },
    HookResponse {
        hook_id: String,
        hook_name: String,
        hook_event: String,
        output: String,
        stdout: String,
        stderr: String,
        exit_code: i32,
        outcome: String,
        uuid: String,
        session_id: String,
    },
    Init {
        cwd: String,
        session_id: String,
        tools: Vec<String>,
        mcp_servers: Vec<McpServer>,
        model: String,
        #[serde(rename = "permissionMode")]
        permission_mode: PermissionMode,
        slash_commands: Vec<String>,
        #[serde(rename = "apiKeySource")]
        api_key_source: String,
        claude_code_version: String,
        output_style: String,
        agents: Vec<String>,
        skills: Vec<String>,
        plugins: Vec<Plugin>,
        analytics_disabled: bool,
        product_feedback_disabled: bool,
        uuid: String,
        memory_paths: Value,
        fast_mode_state: String,
    },
    Status {
        status: Option<String>,
        #[serde(default, rename = "permissionMode")]
        permission_mode: Option<PermissionMode>,
        uuid: String,
        session_id: String,
    },
    TaskStarted {
        task_id: String,
        tool_use_id: String,
        description: String,
        subagent_type: String,
        task_type: String,
        prompt: String,
        uuid: String,
        session_id: String,
    },
    TaskProgress {
        task_id: String,
        tool_use_id: String,
        description: String,
        subagent_type: String,
        usage: TaskUsage,
        last_tool_name: String,
        uuid: String,
        session_id: String,
    },
    TaskUpdated {
        task_id: String,
        patch: TaskPatch,
        uuid: String,
        session_id: String,
    },
    TaskNotification {
        task_id: String,
        tool_use_id: String,
        status: String,
        output_file: String,
        summary: String,
        usage: TaskUsage,
        uuid: String,
        session_id: String,
    },
    /// A one-line recap of the turn that just ended, emitted just before its
    /// `result`. `summarizes_uuid` names the assistant message it describes.
    PostTurnSummary {
        summarizes_uuid: String,
        status_category: String,
        status_detail: String,
        /// Empty when nothing is wanted from the user.
        needs_action: String,
        uuid: String,
        session_id: String,
    },
    /// The full set of outstanding background tasks, republished whenever it
    /// changes — an empty `tasks` means everything has drained. A turn's
    /// `result` can arrive while this is non-empty, so the two together are what
    /// say whether the session is idle.
    BackgroundTasksChanged {
        tasks: Vec<BackgroundTask>,
        uuid: String,
        session_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundTask {
    pub task_id: String,
    pub task_type: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum ResultEvent {
    Success {
        is_error: bool,
        api_error_status: Option<Value>,
        duration_ms: u64,
        duration_api_ms: u64,
        #[serde(default)]
        ttft_ms: Option<u64>,
        #[serde(default)]
        ttft_stream_ms: Option<u64>,
        #[serde(default)]
        time_to_request_ms: Option<u64>,
        num_turns: u32,
        result: String,
        stop_reason: String,
        session_id: String,
        total_cost_usd: f64,
        usage: Usage,
        /// Per-model breakdown, keyed by model name — a different shape from
        /// [`Usage`], and nothing consumes it yet.
        #[serde(rename = "modelUsage")]
        model_usage: Value,
        permission_denials: Vec<Value>,
        terminal_reason: String,
        fast_mode_state: String,
        #[serde(default)]
        origin: Option<ResultOrigin>,
        uuid: String,
    },
    /// A turn that ended without completing — today, the user interrupting a
    /// streaming response.
    ///
    /// Not a field-optional [`Success`]: there is no `result` text to report,
    /// `stop_reason` is null where `Success` always carries one, and `errors`
    /// exists nowhere else. Branch on `terminal_reason`, not on the prose the
    /// CLI emits alongside it as a `user` text block.
    ///
    /// [`Success`]: Self::Success
    ErrorDuringExecution {
        is_error: bool,
        duration_ms: u64,
        duration_api_ms: u64,
        num_turns: u32,
        #[serde(default)]
        stop_reason: Option<String>,
        session_id: String,
        total_cost_usd: f64,
        usage: Usage,
        #[serde(rename = "modelUsage")]
        model_usage: Value,
        permission_denials: Vec<Value>,
        terminal_reason: String,
        fast_mode_state: String,
        /// Diagnostic strings; free-form, and not meant for display.
        #[serde(default)]
        errors: Vec<String>,
        uuid: String,
    },
}

/// One Anthropic SSE frame, as carried in `stream_event.event`.
///
/// These stream the assistant's response as it is produced. Frames address
/// content blocks by `index` within the message opened by [`MessageStart`], and
/// a block's identity (`id`/`name` for a tool call) arrives up front in
/// [`ContentBlockStart`] — only its *contents* are streamed.
///
/// [`MessageStart`]: Self::MessageStart
/// [`ContentBlockStart`]: Self::ContentBlockStart
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamFrame {
    MessageStart {
        message: StreamMessage,
    },
    ContentBlockStart {
        index: u32,
        content_block: ContentBlock,
    },
    ContentBlockDelta {
        index: u32,
        delta: ContentDelta,
    },
    ContentBlockStop {
        index: u32,
    },
    MessageDelta {
        delta: MessageDelta,
        #[serde(default)]
        usage: Option<Usage>,
        #[serde(default)]
        context_management: Option<Value>,
    },
    MessageStop,
    /// A frame type this build doesn't model. Anthropic adds frame types over
    /// time, and dropping the whole line over one unknown frame would lose
    /// content we *can* read.
    #[serde(other)]
    Unrecognized,
}

/// A committed assistant message.
///
/// Claude Code emits one `assistant` event **per content block**, not per
/// message: `content` is always length 1, and several events share one `id`.
/// Since the wire carries no block index, a consumer needing one derives it by
/// counting blocks per `id` in arrival order.
///
/// The blocks are the same shapes the stream frames carry, so [`ContentBlock`]
/// is reused — a streamed block and its committed counterpart deserialize into
/// the same type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub id: String,
    pub model: String,
    pub role: String,
    pub content: Vec<ContentBlock>,
    /// Null on every fixture event; the terminal reason arrives on `result`.
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

/// A `user` event's message.
///
/// Two unrelated things share this event type: what the human typed, which
/// arrives as a bare string, and what the CLI feeds back to the model — tool
/// results, abort notices — which arrives as a block array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMessage {
    pub role: String,
    pub content: UserContent,
}

/// Untagged: nothing labels which shape a line uses, so serde picks the arm by
/// JSON type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Blocks(Vec<UserContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UserContentBlock {
    Text {
        text: String,
    },
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        content: ToolResultContent,
        /// Absent on success rather than `false`, so this can't be a bare bool.
        #[serde(default)]
        is_error: Option<bool>,
    },
    /// Images are documented but appear in no capture, so they'd land here
    /// alongside genuinely unknown blocks.
    #[serde(other)]
    Unrecognized,
}

/// A tool result's payload: usually one flat string, but tools that return
/// structured output send a block array instead.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolResultContent {
    Text(String),
    Blocks(Vec<UserContentBlock>),
    #[default]
    Missing,
}

impl ToolResultContent {
    /// Flattens either shape to displayable text, dropping non-text blocks.
    pub fn as_text(&self) -> String {
        match self {
            Self::Text(text) => text.clone(),
            Self::Blocks(blocks) => blocks
                .iter()
                .filter_map(|block| match block {
                    UserContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Self::Missing => String::new(),
        }
    }
}

/// The message envelope opened by [`StreamFrame::MessageStart`]. `content` is
/// always empty here — blocks arrive as subsequent frames.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMessage {
    pub id: String,
    pub model: String,
    pub role: String,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

/// A content block's identity, known when the block opens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        #[serde(default)]
        thinking: String,
        #[serde(default)]
        signature: Option<String>,
    },
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: Value,
        #[serde(default)]
        caller: Option<Value>,
    },
    #[serde(other)]
    Unrecognized,
}

/// An incremental update to an open content block.
///
/// `input_json_delta` fragments are *not* individually parseable — they only
/// form valid JSON once every fragment for the block has been concatenated.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentDelta {
    TextDelta {
        text: String,
    },
    InputJsonDelta {
        partial_json: String,
    },
    ThinkingDelta {
        thinking: String,
    },
    SignatureDelta {
        signature: String,
    },
    #[serde(other)]
    Unrecognized,
}

/// Terminal metadata for a message, carried on
/// [`StreamFrame::MessageDelta`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDelta {
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub stop_sequence: Option<String>,
    #[serde(default)]
    pub stop_details: Option<Value>,
}

/// Anthropic's token accounting, as it appears on `result`, `assistant.message`,
/// and the `message_start`/`message_delta` stream frames.
///
/// The four token counts are present everywhere; the rest varies by location
/// (`message_delta` omits the cache-tier breakdown, only `result` carries
/// `server_tool_use` and `speed`), so everything beyond them is optional.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Tokens served from cache — cheap, and the bulk of a long session.
    pub cache_read_input_tokens: u64,
    /// Tokens written *into* the cache, billed at a premium.
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub cache_creation: Option<CacheCreation>,
    #[serde(default)]
    pub server_tool_use: Option<ServerToolUse>,
    #[serde(default)]
    pub service_tier: Option<String>,
    #[serde(default)]
    pub speed: Option<String>,
    #[serde(default)]
    pub inference_geo: Option<String>,
    /// Per-request breakdown when a turn took several model calls.
    #[serde(default)]
    pub iterations: Vec<UsageIteration>,
}

/// `cache_creation_input_tokens` split by TTL, which are priced differently.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct CacheCreation {
    #[serde(default)]
    pub ephemeral_5m_input_tokens: u64,
    #[serde(default)]
    pub ephemeral_1h_input_tokens: u64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ServerToolUse {
    #[serde(default)]
    pub web_search_requests: u64,
    #[serde(default)]
    pub web_fetch_requests: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageIteration {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub cache_creation: Option<CacheCreation>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskUsage {
    pub total_tokens: u64,
    pub tool_uses: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskPatch {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub end_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultOrigin {
    pub kind: String,
}

// `McpServer` and `PermissionMode` are shared with the normalized model rather
// than duplicated here — the wire shapes match, so these deserialize straight
// into the `events` types.
pub use crate::events::{McpServer, PermissionMode};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub name: String,
    pub path: String,
    pub source: String,
}

pub fn parse_line(line: &str) -> Result<ClaudeCodeEvent> {
    serde_json::from_str(line).with_context(|| format!("Failed to parse {line}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_fixture(fixture: &str) -> Vec<ClaudeCodeEvent> {
        fixture
            .lines()
            .filter(|line| {
                let line = line.trim();
                !line.is_empty() && !line.starts_with("//")
            })
            .map(|line| parse_line(line).unwrap_or_else(|err| panic!("{err}\n{line}")))
            .collect()
    }

    #[test]
    fn parses_simple_fixture() {
        let events = parse_fixture(include_str!("fixtures/printed.jsonl"));
        assert!(!events.is_empty(), "expected at least one event");
    }

    #[test]
    fn parses_system_init_and_result() {
        let events = parse_fixture(include_str!("fixtures/printed.jsonl"));

        assert!(
            events
                .iter()
                .any(|e| matches!(e, ClaudeCodeEvent::System(SystemEvent::Init { .. }))),
            "missing system/init"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ClaudeCodeEvent::StreamEvent { .. })),
            "missing stream_event"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ClaudeCodeEvent::Assistant { .. })),
            "missing assistant"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, ClaudeCodeEvent::Result(ResultEvent::Success { .. }))),
            "missing result/success"
        );
    }

    #[test]
    fn parses_complex_fixture() {
        let events = parse_fixture(include_str!("fixtures/complex.jsonl"));

        assert_eq!(events.len(), 177);
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, ClaudeCodeEvent::User { .. }))
                .count(),
            30
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    event,
                    ClaudeCodeEvent::System(SystemEvent::TaskStarted { .. })
                ))
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    event,
                    ClaudeCodeEvent::System(SystemEvent::TaskProgress { .. })
                ))
                .count(),
            29
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    event,
                    ClaudeCodeEvent::System(SystemEvent::TaskUpdated { .. })
                ))
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    event,
                    ClaudeCodeEvent::System(SystemEvent::TaskNotification { .. })
                ))
                .count(),
            1
        );
    }

    #[test]
    fn parses_nullable_status_and_result_origin() {
        let events = parse_fixture(include_str!("fixtures/complex.jsonl"));

        assert!(events.iter().any(|event| matches!(
            event,
            ClaudeCodeEvent::System(SystemEvent::Status { status: None, .. })
        )));

        assert!(events.iter().any(|event| matches!(
            event,
            ClaudeCodeEvent::Result(ResultEvent::Success {
                origin: Some(ResultOrigin { kind }),
                ..
            }) if kind == "task-notification"
        )));
    }

    fn stream_frames(fixture: &str) -> Vec<StreamFrame> {
        parse_fixture(fixture)
            .into_iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::StreamEvent { event, .. } => Some(event),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn parses_every_stream_frame_variant() {
        let frames = stream_frames(include_str!("fixtures/complex.jsonl"));

        // No frame in the fixtures should land in the catch-all: if one does,
        // it's a shape this build doesn't model yet.
        assert!(
            !frames
                .iter()
                .any(|f| matches!(f, StreamFrame::Unrecognized)),
            "a stream frame fell through to Unrecognized"
        );

        for expected in [
            "message_start",
            "message_delta",
            "message_stop",
            "content_block_start",
            "content_block_delta",
            "content_block_stop",
        ] {
            assert!(
                frames.iter().any(|f| match (f, expected) {
                    (StreamFrame::MessageStart { .. }, "message_start") => true,
                    (StreamFrame::MessageDelta { .. }, "message_delta") => true,
                    (StreamFrame::MessageStop, "message_stop") => true,
                    (StreamFrame::ContentBlockStart { .. }, "content_block_start") => true,
                    (StreamFrame::ContentBlockDelta { .. }, "content_block_delta") => true,
                    (StreamFrame::ContentBlockStop { .. }, "content_block_stop") => true,
                    _ => false,
                }),
                "missing {expected}"
            );
        }
    }

    #[test]
    fn stream_frames_expose_block_identity_and_content() {
        let frames = stream_frames(include_str!("fixtures/complex.jsonl"));

        // A tool call's id and name arrive when the block opens, before any of
        // its arguments have streamed — that's what lets the UI label a tool
        // call immediately.
        assert!(frames.iter().any(|f| matches!(
            f,
            StreamFrame::ContentBlockStart {
                content_block: ContentBlock::ToolUse { id, name, .. },
                ..
            } if id.starts_with("toolu_") && !name.is_empty()
        )));

        assert!(frames.iter().any(|f| matches!(
            f,
            StreamFrame::ContentBlockDelta {
                delta: ContentDelta::TextDelta { text },
                ..
            } if !text.is_empty()
        )));

        assert!(frames.iter().any(|f| matches!(
            f,
            StreamFrame::ContentBlockDelta {
                delta: ContentDelta::InputJsonDelta { .. },
                ..
            }
        )));

        assert!(frames.iter().any(|f| matches!(
            f,
            StreamFrame::MessageStart { message } if message.id.starts_with("msg_")
        )));
    }

    /// Concatenated `input_json_delta` fragments reconstruct the tool call's
    /// arguments. Individually they are not valid JSON.
    #[test]
    fn input_json_deltas_concatenate_into_valid_json() {
        let frames = stream_frames(include_str!("fixtures/complex.jsonl"));

        let mut by_index: std::collections::BTreeMap<u32, String> =
            std::collections::BTreeMap::new();
        for frame in &frames {
            if let StreamFrame::ContentBlockDelta {
                index,
                delta: ContentDelta::InputJsonDelta { partial_json },
            } = frame
            {
                by_index.entry(*index).or_default().push_str(partial_json);
            }
        }

        assert!(!by_index.is_empty(), "no input_json_delta frames");
        for (index, json) in by_index {
            serde_json::from_str::<Value>(&json)
                .unwrap_or_else(|e| panic!("block {index} did not reassemble: {e}\n{json}"));
        }
    }

    /// Unknown frame and delta types degrade instead of failing the line —
    /// `thinking` blocks appear in neither fixture, so this is the safety net
    /// for shapes we haven't captured.
    #[test]
    fn unknown_stream_shapes_degrade() {
        let line = r#"{"type":"stream_event","event":{"type":"some_future_frame"},"session_id":"s","parent_tool_use_id":null,"uuid":"u"}"#;
        assert!(matches!(
            parse_line(line).unwrap(),
            ClaudeCodeEvent::StreamEvent {
                event: StreamFrame::Unrecognized,
                ..
            }
        ));

        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"some_future_delta","x":1}},"session_id":"s","parent_tool_use_id":null,"uuid":"u"}"#;
        assert!(matches!(
            parse_line(line).unwrap(),
            ClaudeCodeEvent::StreamEvent {
                event: StreamFrame::ContentBlockDelta {
                    delta: ContentDelta::Unrecognized,
                    ..
                },
                ..
            }
        ));
    }

    /// `thinking` blocks stream as their own block and delta types. Neither
    /// fixture contains one, so this pins the shape from the documented format.
    #[test]
    fn parses_thinking_blocks() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":null}},"session_id":"s","parent_tool_use_id":null,"uuid":"u"}"#;
        assert!(matches!(
            parse_line(line).unwrap(),
            ClaudeCodeEvent::StreamEvent {
                event: StreamFrame::ContentBlockStart {
                    content_block: ContentBlock::Thinking { .. },
                    ..
                },
                ..
            }
        ));

        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hm"}},"session_id":"s","parent_tool_use_id":null,"uuid":"u"}"#;
        assert!(matches!(
            parse_line(line).unwrap(),
            ClaudeCodeEvent::StreamEvent {
                event: StreamFrame::ContentBlockDelta {
                    delta: ContentDelta::ThinkingDelta { .. },
                    ..
                },
                ..
            }
        ));
    }

    #[test]
    fn parses_assistant_messages_as_single_blocks() {
        let events = parse_fixture(include_str!("fixtures/complex.jsonl"));

        let messages: Vec<&AssistantMessage> = events
            .iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::Assistant { message, .. } => Some(message),
                _ => None,
            })
            .collect();

        assert_eq!(messages.len(), 48);

        // One event per content block, so several share an id — that's what
        // forces a consumer to derive block indices by arrival order.
        let distinct_ids: std::collections::HashSet<&str> =
            messages.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(distinct_ids.len(), 20);

        for message in &messages {
            assert_eq!(message.content.len(), 1, "expected exactly one block");
            assert_eq!(message.role, "assistant");
            assert!(message.usage.is_some());
        }

        assert!(messages.iter().any(|m| matches!(
            m.content.first(),
            Some(ContentBlock::Text { text }) if !text.is_empty()
        )));

        assert!(messages.iter().any(|m| matches!(
            m.content.first(),
            Some(ContentBlock::ToolUse { id, name, input, .. })
                if id.starts_with("toolu_") && !name.is_empty() && input.is_object()
        )));

        assert!(
            !messages
                .iter()
                .any(|m| matches!(m.content.first(), Some(ContentBlock::Unrecognized))),
            "an assistant content block fell through to Unrecognized"
        );
    }

    #[test]
    fn parses_usage_including_nested_breakdowns() {
        let events = parse_fixture(include_str!("fixtures/complex.jsonl"));

        let usages: Vec<&Usage> = events
            .iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::Result(ResultEvent::Success { usage, .. }) => Some(usage),
                _ => None,
            })
            .collect();

        assert_eq!(usages.len(), 2);
        for usage in &usages {
            assert!(usage.input_tokens > 0);
            assert!(usage.output_tokens > 0);
            assert!(usage.cache_read_input_tokens > 0);

            let cache = usage
                .cache_creation
                .expect("result usage carries a cache_creation breakdown");
            assert_eq!(
                cache.ephemeral_5m_input_tokens + cache.ephemeral_1h_input_tokens,
                usage.cache_creation_input_tokens,
                "tier split must sum to the total"
            );

            assert!(usage.server_tool_use.is_some());
            assert!(!usage.iterations.is_empty());
        }

        // message_delta omits the cache-tier breakdown, so the same struct has to
        // tolerate its absence.
        let stream_usage = events.iter().find_map(|event| match event {
            ClaudeCodeEvent::StreamEvent {
                event: StreamFrame::MessageDelta { usage, .. },
                ..
            } => usage.as_ref(),
            _ => None,
        });
        let stream_usage = stream_usage.expect("message_delta carries usage");
        assert!(stream_usage.output_tokens > 0);
        assert!(stream_usage.cache_creation.is_none());
    }

    /// A real stdin-driven session: two prompts, an async subagent, and a third
    /// turn the agent started for itself when the subagent reported back.
    #[test]
    fn parses_a_multi_turn_session() {
        let events = parse_fixture(include_str!("fixtures/multi_turn.jsonl"));
        assert_eq!(events.len(), 382);

        // `init` is per turn, not per session — and the tool list grows between
        // them as deferred tools load.
        let tool_counts: Vec<usize> = events
            .iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::System(SystemEvent::Init { tools, .. }) => Some(tools.len()),
                _ => None,
            })
            .collect();
        assert_eq!(tool_counts.len(), 3);
        assert!(tool_counts[0] < tool_counts[1]);

        assert!(events.iter().any(|event| matches!(
            event,
            ClaudeCodeEvent::System(SystemEvent::PostTurnSummary { status_detail, .. })
                if !status_detail.is_empty()
        )));

        // Published non-empty while the subagent runs, then empty once it
        // drains — the pair is what distinguishes "turn over" from "idle".
        let task_sets: Vec<usize> = events
            .iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::System(SystemEvent::BackgroundTasksChanged { tasks, .. }) => {
                    Some(tasks.len())
                }
                _ => None,
            })
            .collect();
        assert_eq!(task_sets, vec![1, 0]);

        assert!(events
            .iter()
            .any(|event| matches!(event, ClaudeCodeEvent::RateLimitEvent { .. })));

        // The turn the agent started for itself, rather than in response to a
        // prompt.
        assert!(events.iter().any(|event| matches!(
            event,
            ClaudeCodeEvent::Result(ResultEvent::Success {
                origin: Some(ResultOrigin { kind }),
                ..
            }) if kind == "task-notification"
        )));
    }

    /// Interrupting a streaming response ends the turn with a `result` line
    /// whose subtype is *not* `success`. Before this variant existed the line
    /// failed to parse, so an interrupted turn emitted no terminal event at
    /// all — the swallow-and-continue path turned it into a hung UI.
    #[test]
    fn parses_an_interrupted_turn() {
        let events = parse_fixture(include_str!("fixtures/interrupted.jsonl"));

        assert!(events.iter().any(|event| matches!(
            event,
            ClaudeCodeEvent::Result(ResultEvent::ErrorDuringExecution {
                terminal_reason,
                stop_reason: None,
                errors,
                ..
            }) if terminal_reason == "aborted_streaming" && !errors.is_empty()
        )));

        // The CLI also narrates the abort as a user text block, which is what
        // makes it indistinguishable from a prompt at the block level.
        assert!(events.iter().any(|event| matches!(
            event,
            ClaudeCodeEvent::User { message: UserMessage { content: UserContent::Blocks(blocks), .. }, .. }
                if matches!(
                    blocks.first(),
                    Some(UserContentBlock::Text { text }) if text.starts_with("[Request interrupted")
                )
        )));
    }

    fn user_messages(fixture: &str) -> Vec<UserMessage> {
        parse_fixture(fixture)
            .into_iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::User { message, .. } => Some(message),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn parses_user_tool_results() {
        let messages = user_messages(include_str!("fixtures/complex.jsonl"));
        assert_eq!(messages.len(), 30);

        let blocks: Vec<&UserContentBlock> = messages
            .iter()
            .flat_map(|message| match &message.content {
                UserContent::Blocks(blocks) => blocks.iter(),
                UserContent::Text(_) => [].iter(),
            })
            .collect();

        assert_eq!(
            blocks.len(),
            30,
            "every fixture user message is a tool result"
        );
        assert!(
            !blocks
                .iter()
                .any(|block| matches!(block, UserContentBlock::Unrecognized)),
            "a user content block fell through to Unrecognized"
        );

        // Both payload shapes appear, and the flattening covers each.
        assert!(blocks.iter().any(|block| matches!(
            block,
            UserContentBlock::ToolResult { content: ToolResultContent::Text(text), .. }
                if !text.is_empty()
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            UserContentBlock::ToolResult { content: ToolResultContent::Blocks(inner), .. }
                if !inner.is_empty()
        )));
        for block in &blocks {
            if let UserContentBlock::ToolResult {
                tool_use_id,
                content,
                ..
            } = block
            {
                assert!(tool_use_id.starts_with("toolu_"));
                assert!(!content.as_text().is_empty());
            }
        }

        // `is_error` is omitted on success rather than sent as false.
        assert_eq!(
            blocks
                .iter()
                .filter(|block| matches!(
                    block,
                    UserContentBlock::ToolResult {
                        is_error: Some(true),
                        ..
                    }
                ))
                .count(),
            2
        );
    }

    /// A typed prompt is a bare string, not a block array — the one shape the
    /// fixtures don't contain, since they start after the prompt was sent.
    #[test]
    fn parses_typed_prompts_as_bare_strings() {
        let line = r#"{"type":"user","message":{"role":"user","content":"hey"},"parent_tool_use_id":null,"session_id":"s","uuid":"u"}"#;
        let ClaudeCodeEvent::User { message, .. } = parse_line(line).unwrap() else {
            panic!("expected a user event");
        };
        assert!(matches!(message.content, UserContent::Text(text) if text == "hey"));
    }

    /// An image block would be the realistic unknown here; it must not cost the
    /// sibling text block on the same message.
    #[test]
    fn unknown_user_blocks_degrade() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBOR"}},{"type":"text","text":"what is this"}]},"parent_tool_use_id":null,"session_id":"s","uuid":"u"}"#;
        let ClaudeCodeEvent::User { message, .. } = parse_line(line).unwrap() else {
            panic!("expected a user event");
        };
        let UserContent::Blocks(blocks) = message.content else {
            panic!("expected blocks");
        };
        assert!(matches!(blocks[0], UserContentBlock::Unrecognized));
        assert!(matches!(&blocks[1], UserContentBlock::Text { text } if text == "what is this"));
    }

    #[test]
    fn parses_object_and_string_tool_results() {
        let events = parse_fixture(include_str!("fixtures/complex.jsonl"));
        let tool_results: Vec<&Value> = events
            .iter()
            .filter_map(|event| match event {
                ClaudeCodeEvent::User {
                    tool_use_result: Some(result),
                    ..
                } => Some(result),
                _ => None,
            })
            .collect();

        assert!(tool_results.iter().any(|result| result.is_object()));
        assert!(tool_results.iter().any(|result| result.is_string()));
    }
}
