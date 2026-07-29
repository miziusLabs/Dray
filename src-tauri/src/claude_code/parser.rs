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
        let events = parse_fixture(include_str!("claude_code_printed.jsonl"));
        assert!(!events.is_empty(), "expected at least one event");
    }

    #[test]
    fn parses_system_init_and_result() {
        let events = parse_fixture(include_str!("claude_code_printed.jsonl"));

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
        let events = parse_fixture(include_str!("claude_code_complex.jsonl"));

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
        let events = parse_fixture(include_str!("claude_code_complex.jsonl"));

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

    #[test]
    fn parses_object_and_string_tool_results() {
        let events = parse_fixture(include_str!("claude_code_complex.jsonl"));
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
