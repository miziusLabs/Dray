use std::format;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClaudeCodeEvent {
    System(SystemEvent),
    StreamEvent {
        event: Value,
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
        status: String,
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
        uuid: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub name: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Plan,
    Auto,
    DontAsk,
    BypassPermissions,
}

pub fn parse_line(line: &str) -> Result<ClaudeCodeEvent> {
    serde_json::from_str(line).with_context(|| format!("Failed to parse {line}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fixture_ndjson() {
        let fixture = include_str!("../claude_code_printed.json");
        let mut ok = 0usize;
        let mut empty = 0usize;

        for (idx, line) in fixture.lines().enumerate() {
            if line.trim().is_empty() {
                empty += 1;
                continue;
            }
            parse_line(line).unwrap_or_else(|err| {
                panic!("line {} failed to parse: {err}\n{line}", idx + 1)
            });
            ok += 1;
        }

        assert!(ok > 0, "expected at least one event in fixture");
        println!("parsed {ok} events ({empty} blank lines skipped)");
    }

    #[test]
    fn parses_system_init_and_result() {
        let fixture = include_str!("../claude_code_printed.json");
        let events: Vec<ClaudeCodeEvent> = fixture
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| parse_line(l).expect("parse"))
            .collect();

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
}
