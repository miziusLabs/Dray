use crate::{
    events::{
        AgentEvent,
        AgentEventPayload::{self, Delta},
        BlockKind, BlockRef, DeltaEvent, SessionInfo, Settings,
    },
    harness::{
        self,
        claude_code::{
            parser::{ContentBlock, ContentDelta, StreamFrame, SystemEvent},
            ClaudeCodeEvent,
        },
        Harness,
    },
};
use anyhow::{bail, Result};
use uuid::Uuid;

pub struct Mapper {
    current_msg_id: Option<String>,
}

impl Mapper {
    pub fn map(&mut self, event: ClaudeCodeEvent) -> Result<AgentEvent> {
        match event {
            ClaudeCodeEvent::System(system_event) => Self::handle_system_event(system_event),

            ClaudeCodeEvent::StreamEvent {
                event,
                session_id,
                parent_tool_use_id,
                ..
            } => self.handle_stream_event(event, session_id, parent_tool_use_id),

            _ => Ok(AgentEvent {
                id: todo!(),
                session_id: todo!(),
                harness: todo!(),
                seq: todo!(),
                ts: todo!(),
                turn_id: todo!(),
                thread: todo!(),
                payload: todo!(),
                raw: todo!(),
            }),
        }
    }

    fn handle_system_event(e: SystemEvent) -> Result<AgentEvent> {
        match e {
            SystemEvent::Init { .. } => Self::handle_init(e),
            _ => Ok(AgentEvent {
                id: todo!(),
                session_id: todo!(),
                harness: todo!(),
                seq: todo!(),
                ts: todo!(),
                turn_id: todo!(),
                thread: todo!(),
                payload: todo!(),
                raw: todo!(),
            }),
        }
    }

    // system event handlers
    fn handle_init(e: SystemEvent) -> Result<AgentEvent> {
        if let SystemEvent::Init {
            cwd,
            session_id,
            tools,
            mcp_servers,
            model,
            permission_mode,
            claude_code_version,
            skills,
            plugins,
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
                subagent_types: Vec::new(),
                settings: Some(settings),
            };

            let payload = AgentEventPayload::SessionStarted(session_info);

            let agent_event = AgentEvent {
                id: Uuid::now_v7().to_string(),
                session_id,
                harness: crate::harness::Harness::ClaudeCode,
                seq: todo!(),
                ts: todo!(),
                turn_id: todo!(),
                thread: todo!(),
                payload,
                raw: todo!(),
            };

            Ok(agent_event)
        } else {
            bail!("asdas")
        }
    }

    fn handle_stream_event(
        &mut self,
        event: StreamFrame,
        session_id: String,
        parent_tool_use_id: Option<String>,
    ) -> Result<AgentEvent> {
        match event {
            StreamFrame::MessageStart { message } => {
                self.current_msg_id = Some(message.id);
                // the only job of message start is to set the msg id, so i'm thinking if i should make the return value result<option<ae>>
            }
            StreamFrame::ContentBlockStart {
                index,
                content_block,
            } => {
                let block_kind = match content_block {
                    ContentBlock::Text { .. } => BlockKind::Text,
                    ContentBlock::Thinking { .. } => BlockKind::Thinking,
                    ContentBlock::ToolUse { .. } => BlockKind::ToolUse,
                    _ => todo!(),
                };
                let block = BlockRef {
                    message_id: match self.current_msg_id {
                        Some(id) => id,
                        None => bail!("no msg id found"),
                    },
                    index,
                };

                //contentblock tool type has usable info like tool use id and stuff which we are not storing in BlockRef, any reason for that? are we handling that differently?
                let block_start = DeltaEvent::BlockStart { block, block_kind };

                let payload = AgentEventPayload::Delta(block_start);

                Ok(AgentEvent {
                    id: Uuid::now_v7().to_string(),
                    session_id,
                    harness: harness::Harness::ClaudeCode,
                    seq: todo!(),
                    ts: todo!(),
                    turn_id: todo!(),
                    thread: todo!(),
                    payload,
                    raw: todo!(),
                })
            }
            StreamFrame::ContentBlockDelta { index, delta } => {
                let block = BlockRef {
                    message_id: self.current_msg_id.unwrap_or("".to_string()),
                    index,
                };
                let delta_event;

                match delta {
                    ContentDelta::TextDelta { text } => {
                        delta_event = DeltaEvent::TextDelta { block, text }
                    }
                    ContentDelta::InputJsonDelta { partial_json } => {
                        delta_event = DeltaEvent::InputDelta {
                            block,
                            partial_json,
                        }
                    }
                    ContentDelta::ThinkingDelta { thinking } => {
                        todo!()
                        //looks liek we are yet to add thinking delta in DeltaEvent
                    }
                    ContentDelta::SignatureDelta { signature } => todo!(),
                    ContentDelta::Unrecognized => todo!(),
                }

                let payload = AgentEventPayload::Delta(delta_event);

                Ok(AgentEvent {
                    id: Uuid::now_v7().to_string(),
                    session_id,
                    harness: harness::Harness::ClaudeCode,
                    seq: todo!(),
                    ts: todo!(),
                    turn_id: todo!(),
                    thread: todo!(),
                    payload,
                    raw: todo!(),
                })
            }
            _ => {
                todo!()
            }
        }
    }
}
