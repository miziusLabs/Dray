//! Per-harness integrations.
//!
//! Each supported CLI gets a directory here holding two stages:
//!
//! - `parser.rs` — the CLI's wire format → a typed enum of *its own* events.
//!   Knows nothing about [`crate::events`].
//! - `mapper.rs` — those events → [`AgentEvent`](crate::events::AgentEvent).
//!   Knows nothing about the wire format.
//!
//! Keeping the seam there means a wire-format change touches only the parser,
//! and a vocabulary change touches only the mapper.

// Module entry files are named after their directory rather than `mod.rs`, so
// nothing in the tab bar is ambiguous. Only entry files need `#[path]`;
// children (`parser`, `mapper`) are declared normally.
#[path = "claude_code/claude_code.rs"]
pub mod claude_code;

use serde::{Deserialize, Serialize};

/// Which CLI is backing a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    ClaudeCode,
    Codex,
}
