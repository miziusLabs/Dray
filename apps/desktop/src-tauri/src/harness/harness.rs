//! The Pi Coding Agent integration used by Dray.

#[path = "pi/pi.rs"]
pub mod pi;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    /// Legacy persisted sessions are resumed with Pi rather than rejected.
    #[serde(alias = "claude_code", alias = "codex")]
    Pi,
}
