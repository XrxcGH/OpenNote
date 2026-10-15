//! For the end-to-end builds only (the `test-endpoints` feature, which release builds never have: build.rs compiles
//! a marker into them and `check-release-exe.ts` refuses an exe that holds it). It lets a test drive the real app
//! against a mock service without a real account:
//!
//! - `OPENNOTE_TEST_CONNECTOR_BASE=http://127.0.0.1:<port>` sends every connector request to that mock instead, as
//!   `<base>/<original host>/<original path and query>`. The pinned-host check still runs on the real address first,
//!   so the test also proves a token would only have gone to the service's own host.
//!
//! - `OPENNOTE_TEST_CONNECTED=microsoft:alice@example.com,google:bob@example.com` starts with those connectors
//!   already connected, with every access they can be granted and a fixed test token in memory. Nothing is written
//!   to the Credential Manager.

use std::sync::Arc;

use super::{
    files::{Connection, Holds},
    http::{HostPolicy, Http, HttpError, HttpRequest, HttpResponse},
    registry,
    secret::Secret,
    service::{unix_now, Connectors, Parts},
    store::{target_name, MemoryStore, SecretStore},
};
use crate::paths::Paths;

const BASE: &str = "OPENNOTE_TEST_CONNECTOR_BASE";
const CONNECTED: &str = "OPENNOTE_TEST_CONNECTED";
const TOKEN: &str = "test-token-not-a-secret";

struct Redirect {
    inner: Arc<dyn Http>,
    base: String,
}

impl Http for Redirect {
    fn send(&self, policy: &HostPolicy, request: &HttpRequest, max_bytes: usize) -> Result<HttpResponse, HttpError> {
        if !policy.allows(&request.url) {
            return Err(HttpError::ForeignHost);
        }
        let url = url::Url::parse(&request.url).map_err(|_| HttpError::ForeignHost)?;
        let host = url.host_str().ok_or(HttpError::ForeignHost)?;
        let query = url.query().map(|query| format!("?{query}")).unwrap_or_default();
        let moved = HttpRequest {
            method: request.method,
            url: format!("{}/{host}{}{query}", self.base, url.path()),
            headers: request.headers.clone(),
            body: request.body.clone(),
        };
        self.inner.send(&HostPolicy::new(["127.0.0.1"]), &moved, max_bytes)
    }
}

/// The connectors for a test build that asks for the mock, or None for an ordinary start.
pub(super) fn connectors(paths: &Paths) -> Option<Connectors> {
    let base = std::env::var(BASE).ok()?;
    let base = base.trim_end_matches('/').to_owned();
    if !base.starts_with("http://127.0.0.1:") {
        return None;
    }
    let mut parts = Parts::real(paths);
    let store = Arc::new(MemoryStore::default());
    parts.store = store.clone();
    parts.http = Arc::new(Redirect {
        inner: parts.http.clone(),
        base,
    });
    parts.offline = Arc::new(|| false);
    let connectors = Connectors::with(parts);
    for entry in std::env::var(CONNECTED).unwrap_or_default().split(',') {
        let Some((id, account)) = entry.split_once(':') else {
            continue;
        };
        let Some(def) = registry::find(id.trim()) else { continue };
        let account = account.trim().to_owned();
        if store.put(&target_name(def.id, &account), &Secret::new(TOKEN)).is_err() {
            continue;
        }
        let connection = Connection {
            account,
            scopes: def.scopes().into_iter().map(str::to_owned).collect(),
            connected_unix: unix_now(),
            holds: Holds::Access,
            base_url: None,
            expired: false,
            last_used_unix: None,
        };
        connectors.insert_test_connection(def.id, connection);
    }
    Some(connectors)
}

impl Connectors {
    fn insert_test_connection(&self, id: &str, connection: Connection) {
        self.lock().connections.insert(id.to_owned(), connection);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::{
        http::UreqHttp,
        mock::{MockServer, Reply},
        registry::Method,
    };

    fn redirect(server: &MockServer) -> Redirect {
        Redirect {
            inner: Arc::new(UreqHttp::default()),
            base: server.url(""),
        }
    }

    #[test]
    fn a_request_to_a_pinned_host_goes_to_the_mock_under_that_host() {
        let server = MockServer::start();
        server.route(
            "/graph.microsoft.com/v1.0/me/onenote/notebooks",
            vec![Reply::json(200, serde_json::json!({ "value": [] }))],
        );
        let policy = HostPolicy::new(["graph.microsoft.com"]);
        let request = HttpRequest::new(Method::Get, "https://graph.microsoft.com/v1.0/me/onenote/notebooks?a=1")
            .header("Authorization", "Bearer t");
        let reply = redirect(&server).send(&policy, &request, 1024).expect("answers");
        assert_eq!(reply.status, 200);
        let seen = server.requests_to("/graph.microsoft.com/v1.0/me/onenote/notebooks");
        assert_eq!(seen.len(), 1);
        assert!(seen[0].target.ends_with("?a=1"));
        assert_eq!(seen[0].header("authorization"), Some("Bearer t"));
    }

    #[test]
    fn a_request_to_any_other_host_is_still_refused() {
        let server = MockServer::start();
        let policy = HostPolicy::new(["graph.microsoft.com"]);
        let request = HttpRequest::new(Method::Get, "https://evil.example/v1.0/me");
        assert_eq!(
            redirect(&server).send(&policy, &request, 1024).err(),
            Some(HttpError::ForeignHost)
        );
        assert!(server.requests().is_empty());
    }
}
