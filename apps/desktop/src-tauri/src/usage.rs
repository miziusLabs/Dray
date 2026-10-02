//! Recorded Dray usage, independent of private ChatGPT/Codex endpoints.
use crate::events::{AgentEventPayload, Usage};
use anyhow::Result;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Default, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub reasoning_tokens: u64,
    pub completed_turns: u64,
    pub signed_in: bool,
    pub email: Option<String>,
}
impl AgentUsage {
    fn add(&mut self, usage: &Usage) {
        self.input_tokens += usage.input_tokens.unwrap_or(0);
        self.output_tokens += usage.output_tokens.unwrap_or(0);
        self.cached_input_tokens += usage.cached_input_tokens.unwrap_or(0);
        self.reasoning_tokens += usage.reasoning_tokens.unwrap_or(0);
    }
}
pub async fn fetch() -> Result<AgentUsage> {
    let status = crate::account::status()?;
    let mut total = AgentUsage {
        signed_in: status.signed_in,
        email: status.email,
        ..AgentUsage::default()
    };
    let mut seen = std::collections::HashSet::new();
    for session in crate::store::list_session_index_items().await? {
        // Forks include copied history. Count only events originally emitted by
        // this session, as well as stable event IDs, to avoid duplicate usage.
        for event in crate::store::list_session_events(&session.session_id).await? {
            if !seen.insert(event.id) {
                continue;
            }
            match event.payload {
                AgentEventPayload::UsageUpdate(usage) => total.add(&usage),
                AgentEventPayload::TurnCompleted { .. } => total.completed_turns += 1,
                _ => {}
            }
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_and_reasoning_tokens_are_subsets_not_extra_consumption() {
        let mut usage = AgentUsage::default();
        usage.add(&Usage {
            input_tokens: Some(100),
            output_tokens: Some(20),
            cached_input_tokens: Some(80),
            reasoning_tokens: Some(10),
            ..Usage::default()
        });
        assert_eq!(usage.input_tokens + usage.output_tokens, 120);
        assert_eq!(usage.cached_input_tokens, 80);
    }
}
