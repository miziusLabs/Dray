//! Token and cost accounting.
//!
//! The harnesses report disjoint things — Claude Code gives cost in USD but no
//! context-window occupancy, Codex gives occupancy and rate limits but never a
//! cost — so nearly every field is optional. Show cost only when
//! [`Usage::cost_usd`] is set and a context gauge only when
//! [`Usage::context_window`] is set; neither is universal.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    /// Broken out only by harnesses that report it separately; others fold
    /// thinking tokens into `output_tokens`.
    pub reasoning_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub context_window: Option<ContextWindow>,
    pub rate_limit: Option<RateLimit>,
    pub model: Option<String>,
}

impl Usage {
    /// Whether this carries anything worth emitting. The mapper debounces on
    /// this to avoid one `UsageUpdate` per token-count line.
    pub fn is_empty(&self) -> bool {
        *self == Usage::default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextWindow {
    pub used_tokens: u64,
    pub max_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct RateLimit {
    pub used_percent: Option<f64>,
    pub window_minutes: Option<u64>,
    /// RFC3339, normalized from whatever the harness reports.
    pub resets_at: Option<String>,
    pub plan_type: Option<String>,
}
