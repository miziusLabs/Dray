//! Slash-command discovery for Pi and its installed extensions.
//!
//! Pi exposes extension, prompt-template, and skill commands through the RPC
//! protocol. Asking Pi itself keeps this list aligned with the resources loaded
//! from `~/.pi/agent` and the current project.

use crate::models::{Effort, Model, PiModel};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, process::Stdio, sync::OnceLock, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::Mutex,
    time::timeout,
};
use ts_rs::TS;

const REQUEST_ID: &str = "dray-list-commands";
const MODELS_REQUEST_ID: &str = "dray-list-models";
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const HIDDEN: [&str; 4] = ["clear", "fast", "model", "rename"];

static CACHE: OnceLock<Mutex<HashMap<String, Vec<SlashCommand>>>> = OnceLock::new();
static EXTENSION_CACHE: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();

/// One command the user may type. `name` carries no leading slash — the picker
/// adds it — and may be namespaced by an extension.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub argument_hint: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Skills are displayed with `$` while Pi still receives `/skill:`.
    pub is_skill: bool,
}

/// Returns commands registered by Pi extensions, prompt templates, and skills.
pub async fn list_commands(cwd: &str) -> Result<Vec<SlashCommand>> {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(hit) = cache.lock().await.get(cwd).cloned() {
        return Ok(hit);
    }

    let (commands, extension_names) = timeout(PROBE_TIMEOUT, probe(cwd))
        .await
        .context("timed out asking Pi for its slash commands")??;
    cache.lock().await.insert(cwd.to_string(), commands.clone());
    EXTENSION_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .await
        .insert(cwd.to_string(), extension_names);
    Ok(commands)
}

/// Returns models available through Pi's configured providers.
///
/// The RPC response is structured and includes provider names, unlike the
/// human-oriented `--list-models` output. Offline mode still exposes the local
/// catalog and avoids turning model selection into a network request.
pub async fn list_models(cwd: Option<&str>) -> Result<Vec<Model>> {
    timeout(PROBE_TIMEOUT, probe_models(cwd))
        .await
        .context("timed out asking Pi for its models")?
}

async fn probe_models(cwd: Option<&str>) -> Result<Vec<Model>> {
    let mut command = crate::binpath::pi_command().await;
    if let Some(home) = dirs::home_dir() {
        command.env("PI_CODING_AGENT_DIR", home.join(".pi/agent"));
    }

    let mut child = command
        .args(["--mode", "rpc", "--no-session", "--offline", "--approve"])
        .env("PATH", crate::binpath::agent_path())
        .current_dir(cwd.unwrap_or("."))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("couldn't start Pi to list its models")?;

    let mut stdin = child.stdin.take().context("failed to take Pi stdin")?;
    let stdout = child.stdout.take().context("failed to take Pi stdout")?;
    stdin
        .write_all(
            serde_json::json!({"id": MODELS_REQUEST_ID, "type": "get_available_models"})
                .to_string()
                .as_bytes(),
        )
        .await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;

    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await? {
        let Some(response) = matching_response_with_id(&line, MODELS_REQUEST_ID) else {
            continue;
        };
        let result = models_from_response(&response)?;
        child.kill().await.ok();
        return Ok(result);
    }

    bail!("Pi closed without answering get_available_models")
}

/// Whether a prompt is a Pi extension command that may complete without an
/// agent turn. This keeps commands such as the installed `llama` extension from
/// leaving Dray's status machine busy forever.
pub async fn is_extension_command(cwd: &str, prompt: &str) -> Result<bool> {
    let Some(name) = prompt
        .strip_prefix('/')
        .and_then(|text| text.split_whitespace().next())
        .filter(|name| !name.is_empty())
    else {
        return Ok(false);
    };

    list_commands(cwd).await?;
    Ok(EXTENSION_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .await
        .get(cwd)
        .is_some_and(|names| names.iter().any(|candidate| candidate == name)))
}

async fn probe(cwd: &str) -> Result<(Vec<SlashCommand>, Vec<String>)> {
    let mut command = crate::binpath::pi_command().await;
    if let Some(home) = dirs::home_dir() {
        command.env("PI_CODING_AGENT_DIR", home.join(".pi/agent"));
    }

    let mut child = command
        .args(["--mode", "rpc", "--no-session", "--offline", "--approve"])
        .env("PATH", crate::binpath::agent_path())
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("couldn't start Pi to list its commands")?;

    let mut stdin = child.stdin.take().context("failed to take Pi stdin")?;
    let stdout = child.stdout.take().context("failed to take Pi stdout")?;
    stdin
        .write_all(
            serde_json::json!({"id": REQUEST_ID, "type": "get_commands"})
                .to_string()
                .as_bytes(),
        )
        .await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;

    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await? {
        let Some(response) = matching_response(&line) else {
            continue;
        };
        let commands = response
            .get("data")
            .and_then(|data| data.get("commands"))
            .and_then(Value::as_array)
            .context("Pi's get_commands reply had an unfamiliar shape")?;

        let extension_names = commands
            .iter()
            .filter(|command| command.get("source").and_then(Value::as_str) == Some("extension"))
            .filter_map(|command| command.get("name").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        let result = commands
            .iter()
            .filter_map(|command| {
                let name = command.get("name")?.as_str()?;
                if HIDDEN.contains(&name) {
                    return None;
                }
                let is_skill = command.get("source").and_then(Value::as_str) == Some("skill");
                let name = if is_skill {
                    name.strip_prefix("skill:").unwrap_or(name)
                } else {
                    name
                };
                Some(SlashCommand {
                    name: name.to_string(),
                    description: command
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    argument_hint: String::new(),
                    aliases: Vec::new(),
                    is_skill,
                })
            })
            .collect();
        return Ok((result, extension_names));
    }

    bail!("Pi closed without answering get_commands")
}

fn models_from_response(response: &Value) -> Result<Vec<Model>> {
    let models = response
        .get("data")
        .and_then(|data| data.get("models"))
        .and_then(Value::as_array)
        .context("Pi's get_available_models reply had an unfamiliar shape")?;

    Ok(models
        .iter()
        .filter_map(|model| {
            let provider = model.get("provider")?.as_str()?;
            let id = model.get("id")?.as_str()?;
            let name = model.get("name").and_then(Value::as_str).unwrap_or(id);
            Some(Model {
                id: crate::models::ModelId::Pi,
                pi_model: Some(PiModel {
                    provider: provider.to_string(),
                    id: id.to_string(),
                }),
                label: name.to_string(),
                efforts: vec![
                    Effort::Off,
                    Effort::Low,
                    Effort::Medium,
                    Effort::High,
                    Effort::Xhigh,
                    Effort::Max,
                ],
                default_effort: Some(Effort::High),
            })
        })
        .collect())
}

fn matching_response(line: &str) -> Option<Value> {
    matching_response_with_id(line, REQUEST_ID)
}

fn matching_response_with_id(line: &str, request_id: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("response")
        || value.get("id").and_then(Value::as_str) != Some(request_id)
    {
        return None;
    }
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_pi_command_response() {
        let line = r#"{"id":"dray-list-commands","type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"llama","description":"Manage models"},{"name":"skill:plan","description":"Plan work"}]}}"#;
        let response = matching_response(line).expect("response should match");
        let commands = response["data"]["commands"].as_array().unwrap();
        assert_eq!(commands[0]["name"], "llama");
    }

    #[test]
    fn ignores_unrelated_rpc_records() {
        assert!(matching_response(r#"{"type":"agent_start"}"#).is_none());
        assert!(matching_response(
            r#"{"id":"other","type":"response","command":"get_state","success":true}"#
        )
        .is_none());
        assert!(matching_response("not json").is_none());
    }

    #[test]
    fn maps_provider_models_to_selectable_pi_models() {
        let response: Value = serde_json::from_str(
            r#"{"data":{"models":[{"provider":"openai","id":"gpt-5","name":"GPT-5"}]}}"#,
        )
        .unwrap();

        let models = models_from_response(&response).unwrap();
        assert_eq!(models[0].label, "GPT-5");
        assert_eq!(models[0].default_effort, Some(Effort::High));
        assert_eq!(
            models[0].pi_model,
            Some(PiModel {
                provider: "openai".into(),
                id: "gpt-5".into(),
            })
        );
    }
}
