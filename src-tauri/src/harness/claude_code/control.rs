//! The lines this app writes *out* on the CLI's control channel.
//!
//! The mirror of [`parser`](super::parser), which models the lines coming back:
//! one enum tagged on `subtype`, so adding a control the CLI supports is adding
//! a variant, and the envelope around it is written in exactly one place.
//!
//! Worth typing even though nothing here can fail to serialize, because a
//! wrongly shaped request is not reported. The CLI answers what it recognizes
//! and stays quiet otherwise, so a drifted envelope presents as a control that
//! silently stopped working — the same failure mode a malformed
//! [`control_response`](super::permissions) has in the other direction.

use serde::Serialize;
use uuid::Uuid;

/// A control the CLI can apply to a running child.
///
/// Only the subtypes this app sends. `set_effort` is deliberately absent: the
/// CLI has no such subtype, and an `effort` field on `set_model` is accepted and
/// ignored — so changing effort means respawning, not sending anything here.
#[derive(Debug, Serialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum ControlRequest<'a> {
    SetModel {
        model: &'a str,
    },
    SetPermissionMode {
        mode: &'a str,
    },
    Interrupt,
    /// Asked of a throwaway child rather than a session's, and answered without
    /// a model call. See [`commands`](super::commands).
    Initialize,
}

/// A [`ControlRequest`] in the envelope the CLI reads it from.
#[derive(Debug, Serialize)]
pub struct ControlLine<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    /// The reply carries this back, and matching on it is the only way to tell
    /// our own answer from everything else on the stream — so it is public.
    pub request_id: String,
    request: ControlRequest<'a>,
}

impl<'a> ControlLine<'a> {
    pub fn new(request: ControlRequest<'a>) -> Self {
        Self {
            kind: "control_request",
            request_id: Uuid::now_v7().to_string(),
            request,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Pins the shape against what the CLI was verified to accept. A struct
    /// variant flattens into the envelope's `request`; a unit variant is the
    /// `subtype` alone.
    #[test]
    fn wraps_a_request_in_the_envelope_the_cli_reads() {
        let line = ControlLine::new(ControlRequest::SetModel { model: "opus" });
        let value = serde_json::to_value(&line).unwrap();

        assert_eq!(value["type"], "control_request");
        assert_eq!(value["request_id"], line.request_id);
        assert_eq!(
            value["request"],
            json!({"subtype": "set_model", "model": "opus"})
        );
    }

    #[test]
    fn a_request_with_no_arguments_carries_its_subtype_alone() {
        let value = serde_json::to_value(ControlLine::new(ControlRequest::Interrupt)).unwrap();

        assert_eq!(value["request"], json!({"subtype": "interrupt"}));
    }

    /// Each line needs its own id, or a reply matches the wrong request.
    #[test]
    fn every_line_is_identified_separately() {
        let one = ControlLine::new(ControlRequest::Initialize);
        let two = ControlLine::new(ControlRequest::Initialize);

        assert_ne!(one.request_id, two.request_id);
    }
}
