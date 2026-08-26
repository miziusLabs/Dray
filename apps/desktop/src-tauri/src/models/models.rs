//! The model/effort menu the UI renders and the CLI accepts.
//!
//! Only aliases go on the wire — `claude --model opus` always resolves to the
//! latest Opus, so pinning a dated id here would silently freeze sessions to an
//! old model as new ones ship.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    /// The `--effort` flag value.
    pub fn as_arg(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }

    /// The inverse, for a value arriving from outside the app — the `dray`
    /// CLI's `--effort`. Strict for [`ModelId::from_arg`]'s reason: a typo is
    /// worth reporting, where silently running a different effort is not.
    pub fn from_arg(alias: &str) -> Option<Self> {
        match alias {
            "low" => Some(Effort::Low),
            "medium" => Some(Effort::Medium),
            "high" => Some(Effort::High),
            "xhigh" => Some(Effort::Xhigh),
            "max" => Some(Effort::Max),
            _ => None,
        }
    }
}

/// The `--model` alias, typed. `Unknown` exists so an index entry naming a
/// model this build no longer lists still deserializes — losing one session's
/// model beats failing the whole index read and emptying the sidebar. It maps
/// to no alias, so [`find_model`] rejects it and it can't reach a spawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum ModelId {
    Opus,
    Sonnet,
    Fable,
    Haiku,
    /// Uses the model/provider configured by Pi in `~/.pi/agent`.
    Pi,
    #[serde(other)]
    Unknown,
}

impl Default for ModelId {
    fn default() -> Self {
        Self::Unknown
    }
}

impl ModelId {
    /// `None` for [`ModelId::Unknown`] — there is no alias to pass the CLI.
    /// Callers hold a [`Model`] by then, so this is unreachable in practice.
    pub fn as_arg(self) -> Option<&'static str> {
        match self {
            ModelId::Opus => Some("opus"),
            ModelId::Sonnet => Some("sonnet"),
            ModelId::Fable => Some("fable"),
            ModelId::Haiku => Some("haiku"),
            ModelId::Pi | ModelId::Unknown => None,
        }
    }

    /// The inverse of [`as_arg`](Self::as_arg), for an alias arriving from
    /// outside the app — the `dray` CLI's `--model`. Deliberately not
    /// `#[serde(other)]`-style forgiving: an unrecognized alias is a typo worth
    /// reporting, where silently running a different model is not.
    pub fn from_arg(alias: &str) -> Option<Self> {
        match alias {
            "opus" => Some(ModelId::Opus),
            "sonnet" => Some(ModelId::Sonnet),
            "fable" => Some(ModelId::Fable),
            "haiku" => Some(ModelId::Haiku),
            "pi" => Some(ModelId::Pi),
            _ => None,
        }
    }
}

/// What an orchestrated session runs when nobody said. [`ModelId::default`]
/// cannot serve here — it is `Unknown`, which exists so an old index entry
/// still deserializes and which has no CLI alias at all.
///
/// Deliberately *not* the composer's seed. That one opens a picker the user is
/// about to touch, so it starts cheap; this one is a session nobody is sitting
/// in front of, doing a whole task unattended, and the cost of it being weak is
/// work that has to be redone by hand. Effort follows from the model's own
/// default, which is `High` for every model that has levels.
pub fn default_model() -> ModelId {
    ModelId::Opus
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PiModel {
    pub provider: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    /// The harness-specific model family. Pi models carry their provider and
    /// concrete id in [`pi_model`].
    pub id: ModelId,
    pub pi_model: Option<PiModel>,
    pub label: String,
    /// Empty means the model has no effort levels. The CLI tolerates `--effort`
    /// on such a model and ignores it, so this drives the UI and keeps the
    /// persisted value honest rather than preventing a crash.
    pub efforts: Vec<Effort>,
    pub default_effort: Option<Effort>,
}

/// The full model list the UI's picker is built from.
pub fn claude_models() -> Vec<Model> {
    use Effort::*;

    vec![
        Model {
            id: ModelId::Fable,
            pi_model: None,
            label: "Fable 5".into(),
            efforts: vec![Low, Medium, High, Xhigh, Max],
            default_effort: Some(High),
        },
        Model {
            id: ModelId::Opus,
            pi_model: None,
            label: "Opus 5".into(),
            efforts: vec![Low, Medium, High, Xhigh, Max],
            default_effort: Some(High),
        },
        Model {
            id: ModelId::Sonnet,
            pi_model: None,
            label: "Sonnet 5".into(),
            efforts: vec![Low, Medium, High, Xhigh, Max],
            default_effort: Some(High),
        },
        Model {
            id: ModelId::Haiku,
            pi_model: None,
            label: "Haiku 4.5".into(),
            efforts: Vec::new(),
            default_effort: None,
        },
    ]
}

/// The model exposed by Pi when the user wants to keep model selection in
/// `~/.pi/agent/settings.json` and let Pi resolve its provider and model.
pub fn configured_pi_model() -> Model {
    Model {
        id: ModelId::Pi,
        pi_model: None,
        label: "Pi (configured)".into(),
        efforts: Vec::new(),
        default_effort: None,
    }
}

/// Returns the model specification for a selected id. Pi's catalog is loaded
/// separately because its providers and model ids come from the user's config.
pub fn find_model(id: ModelId, pi_model: Option<&PiModel>) -> Option<Model> {
    if id == ModelId::Pi {
        return Some(match pi_model {
            Some(pi_model) => Model {
                id,
                pi_model: Some(pi_model.clone()),
                label: format!("{}/{}", pi_model.provider, pi_model.id),
                efforts: Vec::new(),
                default_effort: None,
            },
            None => configured_pi_model(),
        });
    }

    claude_models()
        .into_iter()
        .find(|m| m.id == id)
        .map(|mut m| {
            m.pi_model = None;
            m
        })
}

/// The effort actually sent for `(model, requested)`. `None` means omit the
/// flag — either the model takes none, or the request isn't one it supports.
pub fn resolve_effort(model: &Model, requested: Option<Effort>) -> Option<Effort> {
    if model.efforts.is_empty() {
        return None;
    }

    match requested {
        Some(e) if model.efforts.contains(&e) => Some(e),
        _ => model.default_effort,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verified against the CLI: `--effort` on Haiku is accepted and ignored,
    /// so this pins a UI/persistence rule, not a spawn failure.
    #[test]
    fn haiku_never_takes_an_effort() {
        let haiku = find_model(ModelId::Haiku, None).unwrap();

        assert_eq!(resolve_effort(&haiku, Some(Effort::Max)), None);
        assert_eq!(resolve_effort(&haiku, None), None);
    }

    #[test]
    fn unsupported_effort_falls_back_to_the_model_default() {
        let opus = find_model(ModelId::Opus, None).unwrap();

        assert_eq!(resolve_effort(&opus, Some(Effort::Low)), Some(Effort::Low));
        assert_eq!(resolve_effort(&opus, None), Some(Effort::High));
    }

    #[test]
    fn pi_model_keeps_provider_and_id_together() {
        let selected = PiModel {
            provider: "openai".into(),
            id: "gpt-5".into(),
        };
        let model = find_model(ModelId::Pi, Some(&selected)).unwrap();

        assert_eq!(model.pi_model, Some(selected));
        assert_eq!(model.id, ModelId::Pi);
    }

    /// The serialized id is what `--model` receives, so it must stay a bare
    /// alias — a dated name would freeze sessions to a model that stops
    /// receiving updates.
    #[test]
    fn model_ids_serialize_as_bare_aliases() {
        for model in claude_models() {
            let wire = serde_json::to_string(&model.id).unwrap();
            assert!(
                !wire.contains('-'),
                "{wire} looks like a dated id; the CLI wants an alias"
            );
        }
    }

    /// An index entry naming a model this build dropped must not fail the whole
    /// index read, and must not reach a spawn either.
    #[test]
    fn a_retired_model_reads_back_as_unknown_and_is_rejected() {
        let id: ModelId = serde_json::from_str("\"opus-4-1-20250805\"").unwrap();

        assert_eq!(id, ModelId::Unknown);
        assert!(find_model(id, None).is_none());
    }
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    /// The frontend sends `effort: null` for a model with no levels; Tauri
    /// deserializes command args from JSON, so this is the real shape.
    #[test]
    fn effort_round_trips_through_null() {
        let none: Option<Effort> = serde_json::from_str("null").unwrap();
        assert_eq!(none, None);

        let some: Option<Effort> = serde_json::from_str("\"xhigh\"").unwrap();
        assert_eq!(some, Some(Effort::Xhigh));

        assert_eq!(
            serde_json::to_string(&Some(Effort::Max)).unwrap(),
            "\"max\""
        );
    }

    /// Every level the CLI documents must survive the round trip, or a session
    /// persisted with it fails to load.
    #[test]
    fn every_effort_matches_its_cli_arg() {
        for e in [
            Effort::Low,
            Effort::Medium,
            Effort::High,
            Effort::Xhigh,
            Effort::Max,
        ] {
            let json = serde_json::to_string(&e).unwrap();
            assert_eq!(json, format!("\"{}\"", e.as_arg()));
        }
    }
}
