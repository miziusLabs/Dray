//! The Dray Coding Agent integration used by Dray.

#[path = "dray/dray.rs"]
pub mod dray;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    /// Legacy persisted sessions are resumed with Dray rather than rejected.
    #[serde(alias = "pi", alias = "claude_code", alias = "codex")]
    Dray,
}
