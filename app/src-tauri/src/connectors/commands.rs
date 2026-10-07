//! The commands of the Settings page. None of them returns a token, a code, or a client ID: they return the
//! state of each connector, and `connectors_request` returns what the service answered. A pasted token goes in
//! through `connectors_connect` and nowhere else.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::{async_runtime::spawn_blocking, State};

use super::{
    error::{ConnectorError, Failure},
    http::{Body, HttpRequest},
    registry::Method,
    service::Connectors,
    session::DEFAULT_MAX_BYTES,
    view::{ConnectInput, ConnectorView, Disconnected},
};
use crate::ipc::{codes, IpcError, IpcResult};

/// A request from the interface to a connector's service. The connector adds the token, so there is no
/// `Authorization` header here, and the address must be on the connector's own hosts.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// A text body, such as JSON.
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    /// Form fields, for a service that takes its token in the form, such as Moodle.
    #[serde(default)]
    pub form: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
    /// The `Location` header of an answer, for a resumable upload.
    pub location: Option<String>,
}

impl ApiRequest {
    pub(super) fn into_http(self, connector: &str) -> Result<HttpRequest, ConnectorError> {
        let bad = || ConnectorError::new(Failure::BadInput, connector);
        let method = Method::parse(&self.method).ok_or_else(bad)?;
        let mut request = HttpRequest::new(method, self.url);
        request.headers = self.headers.into_iter().collect();
        request.body = match (self.form, self.body) {
            (Some(_), Some(_)) => return Err(bad()),
            (Some(form), None) => Some(Body::Form(form.into_iter().collect())),
            (None, Some(text)) => Some(Body::Bytes {
                content_type: self.content_type.unwrap_or_else(|| "application/json".to_owned()),
                data: text.into_bytes(),
            }),
            (None, None) => None,
        };
        Ok(request)
    }
}

fn joined<T>(result: Result<Result<T, ConnectorError>, tauri::Error>) -> IpcResult<T> {
    match result {
        Ok(inner) => inner.map_err(IpcError::from),
        Err(_) => Err(IpcError::new(codes::INTERNAL, "The connector call stopped.")),
    }
}

#[tauri::command]
pub fn connectors_list(connectors: State<'_, Connectors>) -> Vec<ConnectorView> {
    connectors.list()
}

/// Signs in. For an OAuth connector this opens the person's browser and waits, up to five minutes, so the
/// interface shows a waiting card and offers `connectors_cancel`.
#[tauri::command]
pub async fn connectors_connect(
    connectors: State<'_, Connectors>,
    id: String,
    input: Option<ConnectInput>,
) -> IpcResult<ConnectorView> {
    let connectors = connectors.inner().clone();
    joined(spawn_blocking(move || connectors.connect(&id, input.unwrap_or_default())).await)
}

#[tauri::command]
pub fn connectors_cancel(connectors: State<'_, Connectors>, id: String) {
    connectors.cancel(&id);
}

#[tauri::command]
pub async fn connectors_disconnect(connectors: State<'_, Connectors>, id: String) -> IpcResult<Disconnected> {
    let connectors = connectors.inner().clone();
    joined(spawn_blocking(move || connectors.disconnect(&id)).await)
}

#[tauri::command]
pub async fn connectors_request(
    connectors: State<'_, Connectors>,
    id: String,
    scopes: Vec<String>,
    request: ApiRequest,
) -> IpcResult<ApiResponse> {
    let connectors = connectors.inner().clone();
    let work = move || {
        let request = request.into_http(&id)?;
        let wanted: Vec<&str> = scopes.iter().map(String::as_str).collect();
        let response = connectors.request(&id, &wanted, request, DEFAULT_MAX_BYTES)?;
        Ok(ApiResponse {
            status: response.status,
            content_type: response.content_type,
            body: String::from_utf8_lossy(&response.body).into_owned(),
            location: response.location,
        })
    };
    joined(spawn_blocking(work).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: serde_json::Value) -> ApiRequest {
        serde_json::from_value(json).expect("parses")
    }

    #[test]
    fn a_request_becomes_an_http_request_without_a_token() {
        let request = parse(serde_json::json!({
            "method": "post", "url": "https://graph.microsoft.com/v1.0/me/todo/lists",
            "headers": { "Accept": "application/json" }, "body": "{\"a\":1}"
        }))
        .into_http("microsoft")
        .expect("converts");
        assert_eq!(request.method, Method::Post);
        assert_eq!(request.headers, [("Accept".to_owned(), "application/json".to_owned())]);
        assert!(
            matches!(request.body, Some(Body::Bytes { ref content_type, .. }) if content_type == "application/json")
        );
    }

    #[test]
    fn odd_requests_are_refused_before_they_go_anywhere() {
        for json in [
            serde_json::json!({ "method": "TRACE", "url": "https://x.example/" }),
            serde_json::json!({ "method": "GET", "url": "https://x.example/", "body": "a", "form": { "b": "c" } }),
        ] {
            let error = parse(json).into_http("canvas").err().expect("refused");
            assert_eq!(error.failure, Failure::BadInput);
        }
    }

    #[test]
    fn the_response_has_no_field_that_could_hold_a_token_of_ours() {
        let json = serde_json::to_value(ApiResponse {
            status: 200,
            content_type: None,
            body: "x".into(),
            location: None,
        })
        .expect("serializes");
        let mut keys: Vec<_> = json.as_object().expect("an object").keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["body", "contentType", "location", "status"]);
    }
}
