//! Claude Code events → normalized [`AgentEvent`]s.
//!
//! Stateful and per-session: `content_block_start` doesn't carry the message id
//! its `BlockRef` needs — that arrived earlier on `message_start`.

use crate::{
    events::{
        now_rfc3339, AgentEvent, AgentEventPayload, BlockRef, BlockType, DeltaEvent, ErrorSource,
        SessionInfo, Settings, Subagent, ToolResult, ToolType, TurnStatus, Usage,
    },
    harness::{
        claude_code::{
            parser::{
                self, AssistantMessage, ContentBlock, ContentDelta, ResultEvent, StreamFrame,
                SystemEvent, UserContent, UserContentBlock, UserMessage,
            },
            ClaudeCodeEvent,
        },
        Harness,
    },
};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering::Relaxed},
        Arc,
    },
};

use uuid::Uuid;

pub struct Mapper {
    /// Set by `message_start`, read by the block frames that follow it.
    current_msg_id: Option<String>,
    /// Next block index per message id, for committed `assistant` events.
    ///
    /// Claude Code emits one `assistant` event per content block, all sharing a
    /// `message.id`, and none of them carry an index — so the only way to
    /// address a block is to count arrivals. Deltas can't supply it either:
    /// subagent messages get no stream frames at all.
    block_indices: HashMap<String, u32>,
    /// Events the app synthesizes itself (the user's own prompt) must be
    /// numbered through this same counter, or `seq` develops gaps.
    seq: Arc<AtomicU64>,
    // tool_use_id/subagent_id as str
    subagent_seq: HashMap<String, u64>,
}

/// A mapper with a counter of its own, for tests and one-off mapping. The real
/// session shares its counter with [`Session`](crate::session::Session).
impl Default for Mapper {
    fn default() -> Self {
        Self::new(Arc::new(AtomicU64::new(0)))
    }
}

impl Mapper {
    pub fn new(seq: Arc<AtomicU64>) -> Self {
        Self {
            current_msg_id: None,
            block_indices: HashMap::new(),
            seq,
            subagent_seq: HashMap::new(),
        }
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
                let (tool_use_id, label) = system_event_subagent_info(&system_event);

                let subagent = subagent(tool_use_id, label);
                let payload = self.handle_system_event(system_event)?;
                Ok(payload.map(|p| self.build(session_id, subagent, None, p)))
            }

            ClaudeCodeEvent::StreamEvent {
                event,
                session_id,
                parent_tool_use_id,
                ..
            } => {
                let subagent = subagent(parent_tool_use_id, None);
                let payload = self.handle_stream_event(event)?;
                Ok(payload.map(|p| self.build(session_id, subagent, None, p)))
            }

            ClaudeCodeEvent::Assistant {
                message,
                parent_tool_use_id,
                session_id,
                subagent_type,
                ..
            } => {
                let payload = self.handle_assistant_msg(message, parent_tool_use_id.as_deref())?;
                let subagent = subagent(parent_tool_use_id, subagent_type);
                Ok(payload.map(|p| self.build(session_id, subagent, None, p)))
            }

            ClaudeCodeEvent::User {
                message,
                parent_tool_use_id,
                session_id,
                timestamp,
                tool_use_result,
                subagent_type,
                ..
            } => {
                let payload = Self::handle_user_msg(message, tool_use_result);
                let subagent = subagent(parent_tool_use_id, subagent_type);
                Ok(payload.map(|p| self.build(session_id, subagent, timestamp, p)))
            }

            ClaudeCodeEvent::Result(result_event) => {
                let session_id = match &result_event {
                    ResultEvent::Success { session_id, .. }
                    | ResultEvent::ErrorDuringExecution { session_id, .. } => session_id.clone(),
                };

                let payload = Self::handle_result_event(result_event)
                    .with_context(|| format!("mapping result event for session {session_id}"))?;
                Ok(Some(self.build(session_id, None, None, payload)))
            }

            // Parsed but unmapped: `RateLimit` wants RFC3339 where the wire
            // sends unix seconds, and nothing consumes it yet.
            ClaudeCodeEvent::RateLimitEvent { .. } => Ok(None),
        }
    }

    /// `&self` because the counter is atomic: `Session` advances the same one
    /// concurrently when it writes a prompt.
    fn get_seq(&self) -> u64 {
        self.seq.fetch_add(1, Relaxed)
    }

    /// Ordering within one subagent's own stream.
    fn get_subagent_seq(&mut self, subagent_id: &str) -> u64 {
        let next = self
            .subagent_seq
            .entry(subagent_id.to_string())
            .or_insert(0);
        let seq = *next;
        *next += 1;
        seq
    }

    /// The only place `AgentEvent`s are built, so `seq` can't be skipped or
    /// double-assigned.
    fn build(
        &mut self,
        session_id: String,
        subagent: Option<Subagent>,
        timestamp: Option<String>,
        payload: AgentEventPayload,
    ) -> AgentEvent {
        let seq = match &subagent {
            // The spawn announcement is the main thread's, even though it names
            // a subagent.
            Some(_) if matches!(payload, AgentEventPayload::SubagentStarted { .. }) => {
                self.get_seq()
            }
            Some(sub) => self.get_subagent_seq(&sub.id),
            None => self.get_seq(),
        };

        AgentEvent {
            id: Uuid::now_v7().to_string(),
            session_id,
            harness: Harness::ClaudeCode,
            seq,
            ts: timestamp.unwrap_or_else(now_rfc3339),
            // No Claude Code line carries one; the session layer opens a turn
            // when it writes a prompt.
            turn_id: None,
            subagent,
            payload,
            raw: None,
        }
    }

    /// Routes a system event by subtype. Most subtypes have no mapping yet
    /// and fall through to `None`.
    fn handle_system_event(&mut self, e: SystemEvent) -> Result<Option<AgentEventPayload>> {
        match e {
            SystemEvent::Init { .. } => Self::handle_init(e).map(Some),
            SystemEvent::TaskStarted { .. }
            | SystemEvent::TaskProgress { .. }
            | SystemEvent::TaskNotification { .. } => Self::handle_task(e).map(Some),
            _ => Ok(None),
        }
    }

    /// Maps a subagent lifecycle event: `TaskStarted`, `TaskProgress`, or
    /// `TaskNotification`. Errors on any other variant.
    fn handle_task(e: SystemEvent) -> Result<AgentEventPayload> {
        match e {
            SystemEvent::TaskStarted {
                task_id,
                description,
                prompt,
                subagent_type,
                ..
            } => Ok(AgentEventPayload::SubagentStarted {
                agent_id: task_id,
                label: subagent_type,
                description: Some(description),
                prompt: Some(prompt),
            }),
            SystemEvent::TaskProgress {
                task_id,
                description,
                usage,
                last_tool_name,
                ..
            } => Ok(AgentEventPayload::SubagentProgress {
                agent_id: task_id,
                description: Some(description),
                last_tool: Some(last_tool_name),
                usage: Some(Usage::from(usage)),
            }),
            // SystemEvent::TaskUpdated { task_id, patch, uuid, session_id }
            SystemEvent::TaskNotification {
                task_id,
                status,
                summary,
                usage,
                ..
            } => Ok(AgentEventPayload::SubagentCompleted {
                agent_id: task_id,
                status,
                summary: Some(summary),
                usage: Some(Usage::from(usage)),
            }),
            other => bail!("handle_task called with a non-task system event: {other:?}"),
        }
    }

    /// Maps `system/init` into `TurnStarted`. This is per turn, not just per
    /// session — Claude Code sends `init` again for every turn.
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

            Ok(AgentEventPayload::TurnStarted(session_info))
        } else {
            bail!("handle_init called with a non-init system event")
        }
    }

    /// Maps one SSE frame to a `Delta`, tracking `current_msg_id` as frames arrive.
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
                let block_type = match content_block {
                    ContentBlock::Text { .. } => BlockType::Text,
                    ContentBlock::Thinking { .. } => BlockType::Thinking,
                    ContentBlock::ToolUse { id, name, .. } => BlockType::ToolUse { id, name },
                    // Skip the preview rather than guess a kind; the committed
                    // `assistant` event still carries the content.
                    ContentBlock::Unrecognized => return Ok(None),
                };

                let block = self.block_ref(index)?;
                Ok(Some(AgentEventPayload::Delta(DeltaEvent::BlockStart {
                    block,
                    block_type,
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
        &mut self,
        message: AssistantMessage,
        parent_tool_use_id: Option<&str>,
    ) -> Result<Option<AgentEventPayload>> {
        // Subagent content maps the same way as main-thread content; only the
        // envelope differs, via `parent_tool_use_id` → `ThreadRef`. The subagent
        // *lifecycle* (started, progress, finished) arrives on system events
        // instead.
        //
        // Only main-thread content is streamed, so only it has a preview to
        // supersede. Keyed on `parent_tool_use_id` rather than on whether this
        // message id matches the open one: subagent events interleave *inside*
        // a main message's start/stop window, sharing the same stdout.
        let streamed = parent_tool_use_id.is_none()
            && self.current_msg_id.as_deref() == Some(message.id.as_str());
        // Consumed even when unused, so a later block of the same message still
        // lines up with the index its preview used.
        let block = self.next_block_ref(&message.id);
        let block = streamed.then_some(block);

        let content_block = match message.content.into_iter().next() {
            Some(block) => block,
            None => bail!("assistant message carried no content block"),
        };

        let payload = match content_block {
            ContentBlock::Text { text } => AgentEventPayload::AssistantText { block, text },
            ContentBlock::Thinking { thinking, .. } => AgentEventPayload::Reasoning {
                block,
                text: thinking,
                encrypted: false,
            },
            ContentBlock::ToolUse {
                id, name, input, ..
            } => AgentEventPayload::ToolCallStarted {
                tool_type: tool_type(&name),
                call_id: id,
                name,
                input,
                raw_input: None,
                title: None,
            },
            // A block shape this build doesn't model. Its index was already
            // consumed above, so later blocks keep their place — dropping the
            // event is better than failing the line over one unknown block.
            ContentBlock::Unrecognized => return Ok(None),
        };

        Ok(Some(payload))
    }

    /// A `user` event is either the human's prompt or a tool result being fed
    /// back to the model, told apart by the shape of `content`.
    ///
    /// Every user message in the fixtures carries exactly one block (806 of 806
    /// across captures), so only the first is read; a second block would need
    /// this to return several payloads.
    fn handle_user_msg(
        message: UserMessage,
        tool_use_result: Option<Value>,
    ) -> Option<AgentEventPayload> {
        let block = match message.content {
            UserContent::Text(text) => return Some(user_message(text)),
            UserContent::Blocks(blocks) => blocks.into_iter().next()?,
        };

        match block {
            // A bare text block here is a prompt the CLI wrapped in an array, or
            // its own narration of an abort — never a tool result, which is why
            // no `tool_use_id` accompanies it.
            UserContentBlock::Text { text } if is_interrupt_notice(&text) => {
                Some(AgentEventPayload::Error {
                    source: ErrorSource::Harness,
                    message: text,
                    fatal: false,
                })
            }
            UserContentBlock::Text { text } => Some(user_message(text)),

            UserContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => Some(AgentEventPayload::ToolCallCompleted {
                call_id: tool_use_id,
                result: ToolResult {
                    text: content.as_text(),
                    is_error: is_error.unwrap_or(false),
                    // The sidecar `tool_use_result` field, whose shape is
                    // per-tool: a Read carries its file contents, a Task its
                    // agent id.
                    structured: tool_use_result,
                    exit_code: None,
                    duration_ms: None,
                },
            }),

            UserContentBlock::Unrecognized => None,
        }
    }

    /// Maps a turn's terminal `result` line — success or an interrupted turn —
    /// into `TurnCompleted`.
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

            // An interrupted turn is still a completed one: same payload, error
            // status, and `terminal_reason` as the stop reason since the wire's
            // own `stop_reason` is null here.
            ResultEvent::ErrorDuringExecution {
                duration_ms,
                usage,
                total_cost_usd,
                terminal_reason,
                ..
            } => Ok(AgentEventPayload::TurnCompleted {
                status: TurnStatus::Error,
                stop_reason: Some(terminal_reason),
                final_text: None,
                usage: Some(map_usage(&usage, Some(total_cost_usd))),
                duration_ms: Some(duration_ms),
            }),
        }
    }

    /// Address the next block of a committed message.
    ///
    /// Counting arrivals reproduces the indices the stream frames use for the
    /// same message (`text` → 0, `tool_use` → 1), so a committed block and its
    /// streamed preview agree on their [`BlockRef`].
    fn next_block_ref(&mut self, message_id: &str) -> BlockRef {
        let next = self
            .block_indices
            .entry(message_id.to_string())
            .or_insert(0);
        let index = *next;
        *next += 1;

        BlockRef {
            message_id: message_id.to_string(),
            index,
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

/// A `parent_tool_use_id` is exactly what marks an event as a subagent's, so
/// its presence decides the whole thing. The label rides along on the same
/// events (`subagent_type`), needing no lookup against `task_started`.
/// Whether a `user` text block is the CLI narrating an interruption rather than
/// something the user said. The block carries no other signal, but matching
/// prose fails safe: the abort is reported for real on the `result` line
/// (`terminal_reason`), so a reworded notice costs a stray message, not a lost
/// turn-end.
fn is_interrupt_notice(text: &str) -> bool {
    text.starts_with("[Request interrupted by user")
}

fn user_message(text: String) -> AgentEventPayload {
    AgentEventPayload::UserMessage {
        text,
        images: vec![],
    }
}

fn subagent(parent_tool_use_id: Option<String>, label: Option<String>) -> Option<Subagent> {
    parent_tool_use_id.map(|id| Subagent { id, label })
}

/// Classify a tool by its Claude Code name.
///
/// A rendering hint only — which icon and component the UI reaches for — so an
/// unrecognized name falls back to [`ToolType::Other`] rather than failing.
fn tool_type(name: &str) -> ToolType {
    match name {
        "Bash" | "BashOutput" | "KillShell" => ToolType::Shell,
        "Read" | "NotebookRead" => ToolType::FileRead,
        "Write" | "Edit" | "NotebookEdit" => ToolType::FileEdit,
        "Grep" | "Glob" => ToolType::Search,
        "WebFetch" | "WebSearch" => ToolType::Web,
        "Agent" | "Task" => ToolType::SubagentSpawn,
        name if name.starts_with("mcp__") => ToolType::Mcp,
        _ => ToolType::Other,
    }
}

impl From<parser::TaskUsage> for Usage {
    fn from(wire: parser::TaskUsage) -> Self {
        Self {
            total_tokens: Some(wire.total_tokens),
            ..Default::default()
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
        | SystemEvent::TaskNotification { session_id, .. }
        | SystemEvent::PostTurnSummary { session_id, .. }
        | SystemEvent::BackgroundTasksChanged { session_id, .. } => session_id,
    }
}

fn system_event_subagent_info(e: &SystemEvent) -> (Option<String>, Option<String>) {
    match e {
        SystemEvent::TaskStarted {
            tool_use_id,
            subagent_type,
            ..
        }
        | SystemEvent::TaskProgress {
            tool_use_id,
            subagent_type,
            ..
        } => (Some(tool_use_id.clone()), Some(subagent_type.clone())),
        SystemEvent::TaskNotification { tool_use_id, .. } => (Some(tool_use_id.clone()), None),
        _ => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map_fixture(mapper: &mut Mapper, fixture: &str) -> Vec<AgentEvent> {
        fixture
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| mapper.map(parser::parse_line(line).unwrap()).unwrap())
            .collect()
    }

    fn assert_dense_from_zero(events: &[&AgentEvent]) {
        let seqs: Vec<u64> = events.iter().map(|event| event.seq).collect();
        assert_eq!(seqs, (0..seqs.len() as u64).collect::<Vec<_>>());
    }

    /// Committed blocks carry no index, so the mapper counts arrivals. The
    /// indices must be dense per message and agree with the ones the stream
    /// frames used, or streamed text attaches to the wrong committed block.
    #[test]
    fn derives_dense_block_indices_matching_the_stream() {
        let fixture = include_str!("fixtures/complex.jsonl");
        let mut mapper = Mapper::default();
        let mut committed: HashMap<String, Vec<u32>> = HashMap::new();
        let mut streamed: HashMap<String, Vec<u32>> = HashMap::new();

        for line in fixture.lines().filter(|line| !line.trim().is_empty()) {
            let Ok(Some(event)) =
                mapper.map(crate::harness::claude_code::parser::parse_line(line).unwrap())
            else {
                continue;
            };

            match &event.payload {
                AgentEventPayload::AssistantText {
                    block: Some(block), ..
                }
                | AgentEventPayload::Reasoning {
                    block: Some(block), ..
                } => {
                    committed
                        .entry(block.message_id.clone())
                        .or_default()
                        .push(block.index);
                }
                AgentEventPayload::Delta(DeltaEvent::BlockStart { block, .. }) => {
                    streamed
                        .entry(block.message_id.clone())
                        .or_default()
                        .push(block.index);
                }
                _ => {}
            }
        }

        assert!(!committed.is_empty());
        assert_eq!(
            committed.len(),
            streamed.len(),
            "only streamed messages should carry a BlockRef"
        );
        for (message_id, indices) in &committed {
            let expected: Vec<u32> = (0..indices.len() as u32).collect();
            assert_eq!(indices, &expected, "non-dense indices for {message_id}");
        }

        // Where a message was also streamed, the first committed block must
        // share the first streamed block's index.
        for (message_id, streamed_indices) in &streamed {
            if let Some(committed_indices) = committed.get(message_id) {
                assert_eq!(
                    streamed_indices.first(),
                    committed_indices.first(),
                    "streamed and committed disagree for {message_id}"
                );
            }
        }
    }

    #[test]
    fn classifies_tool_types_by_name() {
        assert_eq!(tool_type("Bash"), ToolType::Shell);
        assert_eq!(tool_type("Read"), ToolType::FileRead);
        assert_eq!(tool_type("Edit"), ToolType::FileEdit);
        assert_eq!(tool_type("Agent"), ToolType::SubagentSpawn);
        assert_eq!(tool_type("mcp__supabase__query"), ToolType::Mcp);
        assert_eq!(tool_type("SomethingNew"), ToolType::Other);
    }

    /// Every `user` event in the fixture is a tool result, and each one must
    /// carry the id of the call it answers — that's the only join back to the
    /// `ToolCallStarted` the UI is waiting on.
    #[test]
    fn maps_tool_results_with_their_call_id() {
        let mut mapper = Mapper::default();
        let completions: Vec<(String, ToolResult)> = include_str!("fixtures/complex.jsonl")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| mapper.map(parser::parse_line(line).unwrap()).unwrap())
            .filter_map(|event| match event.payload {
                AgentEventPayload::ToolCallCompleted { call_id, result } => Some((call_id, result)),
                _ => None,
            })
            .collect();

        assert_eq!(completions.len(), 30);
        for (call_id, result) in &completions {
            assert!(call_id.starts_with("toolu_"), "{call_id} is not a call id");
            assert!(!result.text.is_empty(), "result text was dropped");
        }
        assert_eq!(
            completions.iter().filter(|(_, r)| r.is_error).count(),
            2,
            "is_error is absent on success, not false"
        );
        // The per-tool sidecar rides along on the results that carry one.
        assert!(completions.iter().any(|(_, r)| r.structured.is_some()));
    }

    /// A prompt reaches the mapper two ways — bare string, or wrapped in a lone
    /// `text` block — and both are the same user message. The block form has no
    /// `tool_use_id` because it answers no tool call.
    #[test]
    fn maps_both_prompt_shapes_to_user_messages() {
        for line in [
            r#"{"type":"user","message":{"role":"user","content":"hi"},"parent_tool_use_id":null,"session_id":"s","uuid":"u"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"parent_tool_use_id":null,"session_id":"s","uuid":"u"}"#,
        ] {
            let event = Mapper::default()
                .map(parser::parse_line(line).unwrap())
                .unwrap()
                .expect("a prompt is an event");
            assert!(matches!(
                event.payload,
                AgentEventPayload::UserMessage { text, .. } if text == "hi"
            ));
        }
    }

    /// A subagent is ordered among its own events: it renders in a separate
    /// panel and outlives the turn that spawned it, so numbering it against the
    /// main conversation would order two independent streams as one.
    #[test]
    fn numbers_each_subagent_apart_from_the_main_thread() {
        let mut mapper = Mapper::default();
        let events = map_fixture(&mut mapper, include_str!("fixtures/complex.jsonl"));

        let (subagent_events, main_events): (Vec<&AgentEvent>, Vec<&AgentEvent>) =
            events.iter().partition(|event| {
                event.subagent.is_some()
                    && !matches!(event.payload, AgentEventPayload::SubagentStarted { .. })
            });

        assert!(!subagent_events.is_empty() && !main_events.is_empty());
        assert_dense_from_zero(&main_events);
        assert_dense_from_zero(&subagent_events);

        // Both restart at 0, so the two sequences are only meaningful apart —
        // a consumer that merged them would see duplicate keys.
        let started = events
            .iter()
            .find(|e| matches!(e.payload, AgentEventPayload::SubagentStarted { .. }))
            .expect("the fixture spawns a subagent");
        assert!(
            started.subagent.is_some(),
            "the spawn still names its subagent"
        );
        assert!(
            main_events.iter().any(|e| e.seq == started.seq),
            "the spawn announcement belongs to the main conversation"
        );
    }

    /// Each subagent counts independently, so a second one starts over at 0
    /// rather than continuing the first's sequence.
    #[test]
    fn gives_every_subagent_its_own_sequence() {
        let mut mapper = Mapper::default();
        let mut event = |parent: &str, seq_line: String| {
            mapper
                .map(parser::parse_line(&seq_line).unwrap())
                .unwrap()
                .map(|e| (parent.to_string(), e.seq))
        };

        let line = |parent: &str| {
            format!(
                r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"toolu_x","content":"ok"}}]}},"parent_tool_use_id":"{parent}","session_id":"s","uuid":"u"}}"#
            )
        };

        let seqs: Vec<(String, u64)> = ["agent_a", "agent_b", "agent_a", "agent_b", "agent_a"]
            .iter()
            .filter_map(|parent| event(parent, line(parent)))
            .collect();

        let a: Vec<u64> = seqs
            .iter()
            .filter(|(p, _)| p == "agent_a")
            .map(|(_, s)| *s)
            .collect();
        let b: Vec<u64> = seqs
            .iter()
            .filter(|(p, _)| p == "agent_b")
            .map(|(_, s)| *s)
            .collect();

        assert_eq!(a, vec![0, 1, 2]);
        assert_eq!(b, vec![0, 1]);
    }

    /// The counter is shared with the session, which numbers the user's own
    /// prompt through it — the CLI never echoes prompts back, so a second
    /// counter would hand two events the same `seq`.
    #[test]
    fn continues_a_sequence_the_session_has_already_advanced() {
        let seq = Arc::new(AtomicU64::new(0));
        // Stands in for `Session::send_msg` writing a prompt.
        let prompt_seq = seq.fetch_add(1, Relaxed);
        assert_eq!(prompt_seq, 0);

        let mut mapper = Mapper::new(Arc::clone(&seq));
        let events = map_fixture(&mut mapper, include_str!("fixtures/printed.jsonl"));
        let first = events.first().expect("the fixture maps at least one event");
        assert_eq!(first.seq, 1, "the mapper resumed after the prompt");
    }

    /// The two ids a task event carries are different: `tool_use_id`
    /// correlates the subagent's events, `task_id` is the CLI's internal agent
    /// handle. Only the first appears anywhere else, so it's the one the
    /// envelope must hold.
    #[test]
    fn keys_subagent_events_on_the_spawning_call() {
        let mut mapper = Mapper::default();
        let subagent_events: Vec<AgentEvent> = include_str!("fixtures/complex.jsonl")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| mapper.map(parser::parse_line(line).unwrap()).unwrap())
            .filter(|event| {
                matches!(
                    event.payload,
                    AgentEventPayload::SubagentStarted { .. }
                        | AgentEventPayload::SubagentProgress { .. }
                        | AgentEventPayload::SubagentCompleted { .. }
                )
            })
            .collect();

        assert_eq!(subagent_events.len(), 31);
        for event in &subagent_events {
            let subagent = event
                .subagent
                .as_ref()
                .expect("task events name a subagent");
            assert_eq!(subagent.id, "toolu_01XZvNi7gNM53ByhyDb5LN45");
        }

        assert!(subagent_events.iter().any(|e| matches!(
            &e.payload,
            AgentEventPayload::SubagentStarted { agent_id, label, .. }
                if agent_id == "aa402df71b1918f96" && label == "Explore"
        )));

        // `description` is rewritten per progress event, which is what makes it
        // usable as a live status line.
        let descriptions: std::collections::HashSet<&str> = subagent_events
            .iter()
            .filter_map(|e| match &e.payload {
                AgentEventPayload::SubagentProgress { description, .. } => description.as_deref(),
                _ => None,
            })
            .collect();
        assert!(
            descriptions.len() > 1,
            "progress descriptions never changed"
        );

        assert!(subagent_events.iter().any(|e| matches!(
            &e.payload,
            AgentEventPayload::SubagentCompleted { status, usage: Some(usage), .. }
                if status == "completed" && usage.total_tokens == Some(27160)
        )));
    }

    /// An interrupted turn reports the abort twice — as prose in a `user` text
    /// block, and as `terminal_reason` on the result. The prose must not become
    /// a `UserMessage`, and the result must still close the turn.
    #[test]
    fn maps_an_interrupted_turn() {
        let mut mapper = Mapper::default();
        let payloads: Vec<AgentEventPayload> = include_str!("fixtures/interrupted.jsonl")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| mapper.map(parser::parse_line(line).unwrap()).unwrap())
            .map(|event| event.payload)
            .collect();

        assert!(
            !payloads
                .iter()
                .any(|p| matches!(p, AgentEventPayload::UserMessage { .. })),
            "the interrupt notice was attributed to the user"
        );

        assert!(payloads.iter().any(|p| matches!(
            p,
            AgentEventPayload::Error {
                source: ErrorSource::Harness,
                fatal: false,
                ..
            }
        )));

        assert!(payloads.iter().any(|p| matches!(
            p,
            AgentEventPayload::TurnCompleted {
                status: TurnStatus::Error,
                stop_reason: Some(reason),
                final_text: None,
                ..
            } if reason == "aborted_streaming"
        )));
    }

    /// The wire is snake_case and every `Usage` field is `Option`, so a plain
    /// `from_value::<Usage>()` parses *successfully* into all-`None`. This pins
    /// real numbers so that silent regression can't return.
    #[test]
    fn maps_result_usage_from_wire() {
        let fixture = include_str!("fixtures/complex.jsonl");
        let mut mapper = Mapper::default();
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
