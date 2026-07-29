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
        message: Value,
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
        message: Value,
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
        usage: Value,
        #[serde(rename = "modelUsage")]
        model_usage: Value,
        permission_denials: Vec<Value>,
        terminal_reason: String,
        fast_mode_state: String,
        #[serde(default)]
        origin: Option<ResultOrigin>,
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
        usage: Option<Value>,
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
    pub usage: Option<Value>,
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
pub use crate::events::{ApprovalPolicy as PermissionMode, McpServer};

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
