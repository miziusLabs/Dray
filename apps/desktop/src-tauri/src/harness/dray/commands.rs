//! Account-specific OpenAI model catalog and native skill discovery.
use crate::models::{AgentModel, Effort, Model, ModelId};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    pub argument_hint: String,
    pub aliases: Vec<String>,
    pub is_skill: bool,
}

pub async fn list_commands(cwd: &str) -> Result<Vec<SlashCommand>> {
    Ok(dray_agent::skills::discover(std::path::Path::new(cwd))
        .into_iter()
        .map(|skill| SlashCommand {
            name: skill.name,
            description: skill.description,
            argument_hint: String::new(),
            aliases: Vec::new(),
            is_skill: true,
        })
        .collect())
}

pub async fn list_models(_cwd: Option<&str>) -> Result<Vec<Model>> {
    if !crate::account::status()?.signed_in {
        return Ok(Vec::new());
    }
    let token = crate::account::access_token().await?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?
        .get("https://api.openai.com/v1/models")
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()?;
    let body: Value = response.json().await?;
    models_from_response(&body)
}

pub fn models_from_response(body: &Value) -> Result<Vec<Model>> {
    let models = body["models"]
        .as_array()
        .context("OpenAI returned an unfamiliar model catalog")?;
    Ok(models
        .iter()
        .filter(|model| model["visibility"] == "list")
        .filter_map(|model| {
            let id = model["slug"].as_str()?;
            let efforts = model["supported_reasoning_levels"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|level| {
                    let value = level.as_str().or_else(|| level["effort"].as_str())?;
                    Effort::from_arg(value)
                })
                .collect::<Vec<_>>();
            let default_effort = model["default_reasoning_level"]
                .as_str()
                .and_then(Effort::from_arg)
                .filter(|e| efforts.contains(e));
            Some(Model {
                id: ModelId::Dray,
                agent_model: Some(AgentModel {
                    provider: "openai".into(),
                    id: id.into(),
                }),
                label: model["display_name"].as_str().unwrap_or(id).into(),
                efforts,
                default_effort,
                context_window: model["context_window"].as_u64(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_uses_visible_account_models_and_server_reasoning_levels() {
        let models=models_from_response(&serde_json::json!({"models":[
            {"slug":"model-b","display_name":"Model B","visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}],"default_reasoning_level":"high"},
            {"slug":"hidden","visibility":"hidden"},
            {"slug":"model-a","visibility":"list"}
        ]})).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].label, "Model B");
        assert_eq!(models[0].efforts, vec![Effort::Low, Effort::High]);
        assert!(models[1].efforts.is_empty());
    }
}
