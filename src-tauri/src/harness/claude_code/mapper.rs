//! Claude Code events → normalized [`AgentEvent`]s.
//!
//! Stateful and per-session: `content_block_start` doesn't carry the message id
//! its `BlockRef` needs — that arrived earlier on `message_start`.

use crate::{
    events::{
        AgentEvent, AgentEventPayload, BlockKind, BlockRef, DeltaEvent, SessionInfo, Settings,
        ThreadRef, ToolKind, TurnStatus, Usage,
    },
    harness::{
        claude_code::{
            parser::{
                self, AssistantMessage, ContentBlock, ContentDelta, ResultEvent, StreamFrame,
                SystemEvent,
            },
            ClaudeCodeEvent,
        },
        Harness,
    },
};
use anyhow::{bail, Context, Result};
use uuid::Uuid;

pub struct Mapper {
    /// Set by `message_start`, read by the block frames that follow it.
    current_msg_id: Option<String>,
    /// Events the app synthesizes itself (the user's own prompt) must be
    /// numbered through this same counter, or `seq` develops gaps.
    seq: u64,
}

impl Default for Mapper {
    fn default() -> Self {
        Self {
            current_msg_id: None,
            seq: 0,
        }
    }
}

impl Mapper {
    pub fn new() -> Self {
        Self::default()
    }

    /// Map one parsed line. `Ok(None)` means the line only advanced state.
    ///
    /// Envelope fields are pulled off here rather than in the handlers: every
    /// event type carries `session_id`, `parent_tool_use_id` only the three that
    /// can be subagent traffic, and `timestamp` only `user`.
    pub fn map(&mut self, event: ClaudeCodeEvent) -> Result<Option<AgentEvent>> {
        match event {
            ClaudeCodeEvent::System(system_event) => {
                let session_id = system_event_session_id(&system_event).to_string();
                let payload = self.handle_system_event(system_event)?;
                Ok(payload.map(|p| self.build(session_id, None, None, p)))
            }

            ClaudeCodeEvent::StreamEvent {
                event,
                session_id,
                parent_tool_use_id,
                ..
            } => {
                let payload = self.handle_stream_event(event)?;
                Ok(payload.map(|p| self.build(session_id, parent_tool_use_id, None, p)))
            }

            ClaudeCodeEvent::Assistant {
                message,
                parent_tool_use_id,
                session_id,
                uuid,
                request_id,
                subagent_type,
                task_description,
            } => {
                let payload = self.handle_assistant_msg(
                    message,
                    parent_tool_use_id.clone(),
                    subagent_type,
                    task_description,
                )?;

                Ok(Some(self.build(
                    session_id,
                    parent_tool_use_id,
                    None,
                    payload,
                )))
            }

            ClaudeCodeEvent::User {
                message,
                parent_tool_use_id,
                session_id,
                uuid,
                timestamp,
                tool_use_result,
                subagent_type,
                task_description,
            } => {
                // again user contains sub agent stuff here so i'm skipping sub ag like i did in Assistant.
                // the message of ClaudeCodeEvent::User needs parsing first.
                // the content inside the content is sometimes array and sometimes string in user type. looks like for sub agent initiation where there's prompt in user it returns array in the content with type: text and value in text but for actual tool calls like bash where there's command it directly returns the tool result in the text.
            }

            ClaudeCodeEvent::Result(result_event) => {
                let session_id = match &result_event {
                    ResultEvent::Success { session_id, .. } => session_id.to_string(),
                };

                let payload = Self::handle_result_event(result_event).context("info")?;
                Ok(Some(self.build(session_id, None, None, payload)))
            }

            _ => Ok(None),
        }
    }

    /// The only place `AgentEvent`s are built, so `seq` can't be skipped or
    /// double-assigned.
    fn build(
        &mut self,
        session_id: String,
        parent_tool_use_id: Option<String>,
        timestamp: Option<String>,
        payload: AgentEventPayload,
    ) -> AgentEvent {
        let seq = self.seq;
        self.seq += 1;

        AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id,
            harness: Harness::ClaudeCode,
            seq,
            ts: timestamp.unwrap_or_else(now_rfc3339),
            // No Claude Code line carries one; the session layer opens a turn
            // when it writes a prompt.
            turn_id: None,
            thread: parent_tool_use_id.map(|thread_id| ThreadRef {
                thread_id,
                label: None,
                depth: 1,
            }),
            payload,
            raw: None,
        }
    }

    fn handle_system_event(&mut self, e: SystemEvent) -> Result<Option<AgentEventPayload>> {
        match e {
            SystemEvent::Init { .. } => Self::handle_init(e).map(Some),
            // yet to handle the sub agent system events
            _ => Ok(None),
        }
    }

    fn handle_init(e: SystemEvent) -> Result<AgentEventPayload> {
        if let SystemEvent::Init {
            cwd,
            session_id: _,
            tools,
            mcp_servers,
            model,
            permission_mode,
            claude_code_version,
            agents,
            fast_mode_state,
            ..
        } = e
        {
            let settings = Settings {
                model: Some(model.clone()),
                approval_policy: Some(permission_mode),
                sandbox: None,
                writable_roots: Vec::new(),
                network_access: None,
                fast_mode: Some(fast_mode_state),
            };

            let session_info = SessionInfo {
                cwd: Some(cwd),
                model: Some(model),
                harness_version: Some(claude_code_version),
                tools,
                mcp_servers,
                subagent_types: agents,
                settings: Some(settings),
            };

            Ok(AgentEventPayload::SessionStarted(session_info))
        } else {
            bail!("handle_init called with a non-init system event")
        }
    }

    fn handle_stream_event(&mut self, event: StreamFrame) -> Result<Option<AgentEventPayload>> {
        match event {
            StreamFrame::MessageStart { message } => {
                self.current_msg_id = Some(message.id);
                Ok(None)
            }

            StreamFrame::ContentBlockStart {
                index,
                content_block,
            } => {
                let block_kind = match content_block {
                    ContentBlock::Text { .. } => BlockKind::Text,
                    ContentBlock::Thinking { .. } => BlockKind::Thinking,
                    ContentBlock::ToolUse { id, name, .. } => BlockKind::ToolUse { id, name },
                    // Skip the preview rather than guess a kind; the committed
                    // `assistant` event still carries the content.
                    ContentBlock::Unrecognized => return Ok(None),
                };

                let block = self.block_ref(index)?;
                Ok(Some(AgentEventPayload::Delta(DeltaEvent::BlockStart {
                    block,
                    block_kind,
                })))
            }

            StreamFrame::ContentBlockDelta { index, delta } => {
                let block = self.block_ref(index)?;

                let delta_event = match delta {
                    ContentDelta::TextDelta { text } => DeltaEvent::TextDelta { block, text },
                    ContentDelta::InputJsonDelta { partial_json } => DeltaEvent::InputDelta {
                        block,
                        partial_json,
                    },
                    // Thinking text rides on TextDelta; the block's BlockStart
                    // already established it as thinking.
                    ContentDelta::ThinkingDelta { thinking } => DeltaEvent::TextDelta {
                        block,
                        text: thinking,
                    },
                    // A signature over the thinking block, not display content.
                    ContentDelta::SignatureDelta { .. } => return Ok(None),
                    ContentDelta::Unrecognized => return Ok(None),
                };

                Ok(Some(AgentEventPayload::Delta(delta_event)))
            }

            StreamFrame::ContentBlockStop { index } => {
                let block = self.block_ref(index)?;
                Ok(Some(AgentEventPayload::Delta(DeltaEvent::BlockStop {
                    block,
                })))
            }

            // The committed `assistant` and `result` events carry these facts.
            StreamFrame::MessageDelta { .. } | StreamFrame::MessageStop => Ok(None),
            // Q: don't we need to clear the current msg id from self when msg stops or will the next message start update it so no need to handle it here?
            StreamFrame::Unrecognized => Ok(None),
        }
    }

    fn handle_assistant_msg(
        &self,
        message: AssistantMessage,
        parent_tool_use_id: Option<String>,
        subagent_type: Option<String>,
        task_description: Option<String>,
    ) -> Result<AgentEventPayload> {
        // this is where we handle the assistant type for the usual msgs of type text or tool use or anything on main session and also the sub agents. i'm going to start with the main handling first. I don't know what to do with the assistant results of sub agents, they do have task progress where they inform whats going on from the system event and i'm seeing both the assistant and system event task progress holds the same information, you can verify it , check it with complex.jsonl cause i might have not read it properly, its a lot of lines. oh seems like tool_use_id or parent_tool_use_id is what connects them (assistant texts -> subagent); maybe i'll skip sub agents for now, and come back to it later. the parent assistant text itself don't have the parent_tool_use_id. this is a bit complicated in as sense that its big and lots of pieces to connect. so i'm skking this just for now.

        let block = self.block_ref(0)?;
        let content_block = match message.content.get(0) {
            Some(v) => v,
            None => bail!("as"),
        };

        let payload = match content_block {
            ContentBlock::Text { text } => AgentEventPayload::AssistantText {
                block,
                text: text.to_string(),
            },
            ContentBlock::Thinking { thinking, .. } => AgentEventPayload::AssistantText {
                block,
                text: thinking.to_string(),
            },
            ContentBlock::ToolUse {
                id, name, input, ..
            } => {
                let tool_kind = serde_json::from_str::<ToolKind>(name)?;
                AgentEventPayload::ToolCallStarted {
                    call_id: id.to_string(),
                    name: name.to_string(),
                    tool_kind,
                    input: input.clone(),
                    raw_input: None,
                    title: None,
                }
            }
            ContentBlock::Unrecognized => todo!(),
        };

        Ok(payload)
    }

    fn handle_result_event(e: ResultEvent) -> Result<AgentEventPayload> {
        match e {
            ResultEvent::Success {
                is_error,
                duration_ms,
                usage,
                total_cost_usd,
                result,
                stop_reason,
                ..
            } => {
                let status = if is_error {
                    TurnStatus::Error
                } else {
                    TurnStatus::Success
                };

                Ok(AgentEventPayload::TurnCompleted {
                    status,
                    stop_reason: Some(stop_reason),
                    final_text: Some(result),
                    usage: Some(map_usage(&usage, Some(total_cost_usd))),
                    duration_ms: Some(duration_ms),
                })
            }
        }
    }

    /// Errors rather than substituting a placeholder id — `BlockRef` is the join
    /// key, so a wrong one silently attaches text to the wrong block.
    fn block_ref(&self, index: u32) -> Result<BlockRef> {
        match &self.current_msg_id {
            Some(message_id) => Ok(BlockRef {
                message_id: message_id.clone(),
                index,
            }),
            None => bail!("content block frame arrived before any message_start"),
        }
    }
}

/// `total_cost_usd` is a sibling of `usage` on the wire rather than a member, so
/// it arrives separately.
///
/// Claude Code reports no context window or rate limits, and folds thinking
/// tokens into `output_tokens`.
fn map_usage(wire: &parser::Usage, cost_usd: Option<f64>) -> Usage {
    Usage {
        input_tokens: Some(wire.input_tokens),
        output_tokens: Some(wire.output_tokens),
        cached_input_tokens: Some(wire.cache_read_input_tokens),
        cache_write_tokens: Some(wire.cache_creation_input_tokens),
        reasoning_tokens: None,
        total_tokens: Some(wire.input_tokens + wire.output_tokens),
        cost_usd,
        context_window: None,
        rate_limit: None,
        model: None,
    }
}

/// Hand-rolled to avoid a date dependency for one display-only field; `seq`, not
/// `ts`, is the ordering key.
fn now_rfc3339() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();

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

/// Reaches the `session_id` every variant carries without consuming the event.
fn system_event_session_id(e: &SystemEvent) -> &str {
    match e {
        SystemEvent::HookStarted { session_id, .. }
        | SystemEvent::HookResponse { session_id, .. }
        | SystemEvent::Init { session_id, .. }
        | SystemEvent::Status { session_id, .. }
        | SystemEvent::TaskStarted { session_id, .. }
        | SystemEvent::TaskProgress { session_id, .. }
        | SystemEvent::TaskUpdated { session_id, .. }
        | SystemEvent::TaskNotification { session_id, .. } => session_id,
    }
}

// fn result_session_id(e: &ResultEvent) -> &str {
//     match e {
//         ResultEvent::Success { session_id, .. } => session_id
//     }
// }

#[cfg(test)]
mod tests {
    use super::*;

    /// The wire is snake_case and every `Usage` field is `Option`, so a plain
    /// `from_value::<Usage>()` parses *successfully* into all-`None`. This pins
    /// real numbers so that silent regression can't return.
    #[test]
    fn maps_result_usage_from_wire() {
        let fixture = include_str!("fixtures/complex.jsonl");
        let mut mapper = Mapper::new();
        let mut turns = 0;

        for line in fixture.lines().filter(|line| !line.trim().is_empty()) {
            let event =
                match mapper.map(crate::harness::claude_code::parser::parse_line(line).unwrap()) {
                    Ok(Some(event)) => event,
                    Ok(None) => continue,
                    Err(err) => panic!("{err}\n{line}"),
                };

            if let AgentEventPayload::TurnCompleted {
                status,
                usage: Some(usage),
                ..
            } = &event.payload
            {
                turns += 1;
                assert_eq!(*status, TurnStatus::Success);
                assert!(usage.input_tokens.is_some());
                assert!(usage.output_tokens.is_some());
                assert!(usage.cached_input_tokens.is_some());
                assert!(usage.cache_write_tokens.is_some());
                assert!(usage.cost_usd.is_some());
                assert!(!usage.is_empty());
            }
        }

        // Not a session terminator: one result arrives per completed turn.
        assert_eq!(turns, 2);
    }
}
