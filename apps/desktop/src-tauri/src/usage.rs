//! Fetches the authenticated Codex subscription usage windows.
//!
//! Codex exposes this through the same OAuth session used by Pi/Codex CLI. The
//! access token never crosses the Tauri boundary; only percentages and reset
//! timestamps are returned to the frontend.

use anyhow::{Context, Result};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::fs;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub percentage: f64,
    pub reset_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsage {
    pub five_hour: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
}

#[derive(Debug, Clone)]
struct Credentials {
    path: PathBuf,
    auth: Value,
    access_token: String,
    refresh_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowKind {
    FiveHour,
    Weekly,
}

/// Fetches the current five-hour and weekly Codex windows.
pub async fn fetch() -> Result<CodexUsage> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .context("could not create usage HTTP client")?;

    let mut last_error = None;
    for path in auth_paths() {
        let Some(credentials) = load_credentials(path).await else {
            continue;
        };

        match fetch_for_credentials(&client, credentials).await {
            Ok(usage) => return Ok(usage),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Codex is not logged in")))
}

async fn fetch_for_credentials(
    client: &Client,
    mut credentials: Credentials,
) -> Result<CodexUsage> {
    let mut response = usage_request(client, &credentials).await?;

    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        if let Some(refresh_token) = credentials.refresh_token.clone() {
            refresh_credentials(client, &mut credentials, &refresh_token).await?;
            response = usage_request(client, &credentials).await?;
        }
    }

    let status = response.status();
    if !status.is_success() {
        return Err(anyhow::anyhow!("Codex usage request failed ({status})"));
    }

    let primary_header = response
        .headers()
        .get("x-codex-primary-used-percent")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok());
    let secondary_header = response
        .headers()
        .get("x-codex-secondary-used-percent")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok());
    let body: Value = response
        .json()
        .await
        .context("Codex returned invalid usage data")?;
    let rate_limit = body.get("rate_limit").and_then(Value::as_object);

    Ok(CodexUsage {
        five_hour: select_window(
            rate_limit,
            WindowKind::FiveHour,
            primary_header,
            secondary_header,
        ),
        weekly: select_window(
            rate_limit,
            WindowKind::Weekly,
            primary_header,
            secondary_header,
        ),
    })
}

async fn usage_request(client: &Client, credentials: &Credentials) -> Result<reqwest::Response> {
    let mut request = client
        .get(USAGE_URL)
        .bearer_auth(&credentials.access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "Dray");
    if let Some(account_id) = &credentials.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .await
        .context("could not reach Codex usage API")
}

async fn refresh_credentials(
    client: &Client,
    credentials: &mut Credentials,
    refresh_token: &str,
) -> Result<()> {
    let response = client
        .post(REFRESH_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .context("could not refresh Codex login")?;
    let status = response.status();
    if !status.is_success() {
        return Err(anyhow::anyhow!("Codex login refresh failed ({status})"));
    }
    let refreshed: RefreshResponse = response
        .json()
        .await
        .context("Codex returned invalid refreshed credentials")?;
    if refreshed.access_token.is_empty() {
        return Err(anyhow::anyhow!("Codex returned an empty access token"));
    }

    credentials.access_token = refreshed.access_token.clone();
    if let Some(token) = &refreshed.refresh_token {
        credentials.refresh_token = Some(token.clone());
    }
    save_refreshed_auth(credentials, &refreshed).await;
    Ok(())
}

/// Persisting a rotated Pi token is best effort. The new token is still used
/// for this request, and the CLI may have made the auth file read-only or
/// replaced it concurrently.
async fn save_refreshed_auth(credentials: &Credentials, refreshed: &RefreshResponse) {
    let mut auth = credentials.auth.clone();
    if let Some(entry) = auth.get_mut("openai-codex").and_then(Value::as_object_mut) {
        entry.insert(
            "access".into(),
            Value::String(refreshed.access_token.clone()),
        );
        if let Some(token) = &credentials.refresh_token {
            entry.insert("refresh".into(), Value::String(token.clone()));
        }
        if let Some(expires_in) = refreshed.expires_in {
            entry.insert(
                "expires".into(),
                Value::from(now_ms() + expires_in as i64 * 1000),
            );
        }
    }

    if let Ok(contents) = serde_json::to_string_pretty(&auth) {
        let _ = fs::write(&credentials.path, contents).await;
    }
}

async fn load_credentials(path: PathBuf) -> Option<Credentials> {
    let contents = fs::read_to_string(&path).await.ok()?;
    let auth: Value = serde_json::from_str(&contents).ok()?;

    let entry = auth.get("openai-codex")?.clone();
    let entry = entry.as_object()?;
    let access_token = entry.get("access")?.as_str()?.to_string();
    if access_token.is_empty() {
        return None;
    }
    Some(Credentials {
        path,
        auth,
        access_token,
        refresh_token: entry
            .get("refresh")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        account_id: entry
            .get("accountId")
            .or_else(|| entry.get("account_id"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

fn auth_paths() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| vec![home.join(".pi/agent/auth.json")])
        .unwrap_or_default()
}

fn select_window(
    rate_limit: Option<&Map<String, Value>>,
    kind: WindowKind,
    primary_header: Option<f64>,
    secondary_header: Option<f64>,
) -> Option<UsageWindow> {
    let candidates = [
        (
            rate_limit.and_then(|value| value.get("primary_window")),
            primary_header,
            false,
        ),
        (
            rate_limit.and_then(|value| value.get("secondary_window")),
            secondary_header,
            true,
        ),
    ];

    candidates
        .iter()
        .find(|(window, _, _)| window_kind(*window).is_some_and(|candidate| candidate == kind))
        .or_else(|| {
            candidates.iter().find(|(window, _, is_secondary)| {
                window_kind(*window).is_none()
                    && ((*is_secondary && matches!(kind, WindowKind::Weekly))
                        || (!*is_secondary && matches!(kind, WindowKind::FiveHour)))
            })
        })
        .and_then(|(window, header, _)| usage_window(*window, *header))
}

fn window_kind(window: Option<&Value>) -> Option<WindowKind> {
    let seconds = window?.get("limit_window_seconds")?.as_f64()?;
    if (seconds - 18_000.0).abs() < 1.0 {
        Some(WindowKind::FiveHour)
    } else if (seconds - 604_800.0).abs() < 1.0 {
        Some(WindowKind::Weekly)
    } else {
        None
    }
}

fn usage_window(window: Option<&Value>, header_percent: Option<f64>) -> Option<UsageWindow> {
    let window = window.and_then(Value::as_object);
    let percentage = window
        .and_then(|value| value.get("used_percent").and_then(Value::as_f64))
        .or(header_percent)?
        .clamp(0.0, 100.0);
    let reset_at = window.and_then(reset_at_ms);
    Some(UsageWindow {
        percentage,
        reset_at,
    })
}

fn reset_at_ms(window: &Map<String, Value>) -> Option<i64> {
    if let Some(value) = window.get("reset_at").and_then(Value::as_f64) {
        return Some(if value > 10_000_000_000.0 {
            value as i64
        } else {
            (value * 1000.0) as i64
        });
    }
    window
        .get("reset_after_seconds")
        .and_then(Value::as_f64)
        .map(|seconds| now_ms() + (seconds * 1000.0) as i64)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classifies_windows_by_duration_and_uses_headers_as_fallback() {
        let rate_limit = json!({
            "primary_window": { "limit_window_seconds": 604800 },
            "secondary_window": { "limit_window_seconds": 18000 }
        });
        let object = rate_limit.as_object().unwrap();

        let weekly =
            select_window(Some(object), WindowKind::Weekly, Some(10.0), Some(20.0)).unwrap();
        let five_hour =
            select_window(Some(object), WindowKind::FiveHour, Some(10.0), Some(20.0)).unwrap();
        assert_eq!(weekly.percentage, 10.0);
        assert_eq!(five_hour.percentage, 20.0);
    }

    #[test]
    fn falls_back_to_primary_and_secondary_slots_without_durations() {
        let rate_limit = json!({
            "primary_window": { "used_percent": 12 },
            "secondary_window": { "used_percent": 34 }
        });
        let object = rate_limit.as_object().unwrap();
        assert_eq!(
            select_window(Some(object), WindowKind::FiveHour, None, None)
                .unwrap()
                .percentage,
            12.0
        );
        assert_eq!(
            select_window(Some(object), WindowKind::Weekly, None, None)
                .unwrap()
                .percentage,
            34.0
        );
    }
}
