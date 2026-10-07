//! The HTTP client of the connectors, built the way the updater's is (`crates/updater/src/fetch.rs`): `ureq` with
//! Windows' TLS stack and certificate store, HTTPS only, and a pinned list of hosts. Every address, and every
//! redirect, is checked against the connector's hosts before a byte is sent, so a token can only go to the
//! service it belongs to. The messages of an error never hold an address, because an address can hold a code.

use std::{io::Read, time::Duration};

use url::Url;

use super::registry::Method;

/// The hosts a connector may talk to, as the client reads them. A user name before the host
/// (`graph.microsoft.com@evil.example`), a backslash, and any port but the default don't pass for a pinned host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPolicy {
    hosts: Vec<String>,
}

impl HostPolicy {
    pub fn new(hosts: impl IntoIterator<Item = impl Into<String>>) -> HostPolicy {
        HostPolicy {
            hosts: hosts.into_iter().map(|host| host.into().to_ascii_lowercase()).collect(),
        }
    }

    pub fn hosts(&self) -> &[String] {
        &self.hosts
    }

    /// Whether `text` is an HTTPS address on one of the hosts. Unit tests also accept `http://127.0.0.1:<port>`
    /// when `127.0.0.1` is listed, so they can serve answers from a local mock. That branch is not in any build.
    pub fn allows(&self, text: &str) -> bool {
        if text.contains('\\') {
            return false;
        }
        let Ok(url) = Url::parse(text) else { return false };
        if !url.username().is_empty() || url.password().is_some() {
            return false;
        }
        let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
            return false;
        };
        let local_test = cfg!(test) && url.scheme() == "http" && host == "127.0.0.1";
        if !local_test && (url.scheme() != "https" || url.port().is_some()) {
            return false;
        }
        self.hosts.contains(&host)
    }
}

pub enum Body {
    /// Sent as `application/x-www-form-urlencoded`.
    Form(Vec<(String, String)>),
    Bytes {
        content_type: String,
        data: Vec<u8>,
    },
}

pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Body>,
}

impl HttpRequest {
    pub fn new(method: Method, url: impl Into<String>) -> HttpRequest {
        HttpRequest {
            method,
            url: url.into(),
            headers: Vec::new(),
            body: None,
        }
    }

    pub fn header(mut self, name: &str, value: impl Into<String>) -> HttpRequest {
        self.headers.push((name.to_owned(), value.into()));
        self
    }

    pub fn form(mut self, fields: Vec<(String, String)>) -> HttpRequest {
        self.body = Some(Body::Form(fields));
        self
    }
}

pub struct HttpResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
    /// The `Location` header of an answer that is not a redirect: where a resumable upload goes on.
    pub location: Option<String>,
}

impl HttpResponse {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// The body as JSON, or None when it isn't.
    pub fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpError {
    /// The address, or a redirect, is not on a pinned host.
    ForeignHost,
    /// The service could not be reached, or the connection broke.
    Network,
    /// The answer is longer than the limit.
    TooLarge,
}

/// Sends one request. Tests serve answers from a mock instead of the network.
pub trait Http: Send + Sync {
    fn send(&self, policy: &HostPolicy, request: &HttpRequest, max_bytes: usize) -> Result<HttpResponse, HttpError>;
}

/// The most redirects one request follows.
const MAX_REDIRECTS: usize = 3;

pub struct UreqHttp {
    agent: ureq::Agent,
}

impl Default for UreqHttp {
    fn default() -> Self {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        let config = ureq::Agent::config_builder()
            .tls_config(tls)
            .https_only(!cfg!(test))
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(30)))
            .user_agent(concat!("OpenNote/", env!("CARGO_PKG_VERSION")))
            .build();
        Self { agent: config.into() }
    }
}

/// Form fields as a request body.
pub fn encode_form(fields: &[(String, String)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish()
}

impl UreqHttp {
    fn once(
        &self,
        request: &HttpRequest,
        url: &str,
        drop_body: bool,
    ) -> Result<ureq::http::Response<ureq::Body>, HttpError> {
        let mut builder = ureq::http::Request::builder().method(request.method.as_str()).uri(url);
        for (name, value) in &request.headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let body = match (&request.body, drop_body) {
            (Some(Body::Form(fields)), false) => {
                builder = builder.header("Content-Type", "application/x-www-form-urlencoded");
                Some(encode_form(fields).into_bytes())
            }
            (Some(Body::Bytes { content_type, data }), false) => {
                builder = builder.header("Content-Type", content_type.as_str());
                Some(data.clone())
            }
            _ => None,
        };
        let result = match body {
            Some(data) => self.agent.run(builder.body(data).map_err(|_| HttpError::Network)?),
            None => self.agent.run(builder.body(()).map_err(|_| HttpError::Network)?),
        };
        result.map_err(|_| HttpError::Network)
    }
}

impl Http for UreqHttp {
    fn send(&self, policy: &HostPolicy, request: &HttpRequest, max_bytes: usize) -> Result<HttpResponse, HttpError> {
        let mut current = request.url.clone();
        let mut drop_body = false;
        for _ in 0..=MAX_REDIRECTS {
            if !policy.allows(&current) {
                return Err(HttpError::ForeignHost);
            }
            let response = self.once(request, &current, drop_body)?;
            let status = response.status().as_u16();
            // A 308 with no Location is "Resume Incomplete" of a chunked upload (Google), an answer and not a redirect.
            let redirect = matches!(status, 301 | 302 | 303 | 307 | 308)
                && !(status == 308 && response.headers().get("location").is_none());
            if redirect {
                let location = response
                    .headers()
                    .get("location")
                    .and_then(|value| value.to_str().ok())
                    .ok_or(HttpError::Network)?;
                let next = Url::parse(&current)
                    .and_then(|base| base.join(location))
                    .map_err(|_| HttpError::Network)?;
                // A 303 turns the call into a plain GET. The others keep the method and the body.
                drop_body |= status == 303;
                current = next.into();
                continue;
            }
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let mut body = Vec::new();
            let limit = u64::try_from(max_bytes).unwrap_or(u64::MAX).saturating_add(1);
            response
                .into_body()
                .into_reader()
                .take(limit)
                .read_to_end(&mut body)
                .map_err(|_| HttpError::Network)?;
            if body.len() > max_bytes {
                return Err(HttpError::TooLarge);
            }
            return Ok(HttpResponse {
                status,
                content_type,
                body,
                location,
            });
        }
        Err(HttpError::Network)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> HostPolicy {
        HostPolicy::new(["graph.microsoft.com", "login.microsoftonline.com"])
    }

    #[test]
    fn allows_https_on_a_pinned_host_in_any_case() {
        let policy = policy();
        assert!(policy.allows("https://graph.microsoft.com/v1.0/me"));
        assert!(policy.allows("https://GRAPH.microsoft.com/v1.0/me?x=1"));
        assert!(policy.allows("https://login.microsoftonline.com:443/common/oauth2/v2.0/token"));
    }

    #[test]
    fn refuses_every_other_way_of_naming_a_server() {
        let policy = policy();
        for url in [
            "http://graph.microsoft.com/v1.0/me",
            "https://graph.microsoft.com.evil.example/v1.0/me",
            "https://evil.example/graph.microsoft.com",
            "https://graph.microsoft.com@evil.example/",
            "https://evil.example@graph.microsoft.com/",
            "https://graph.microsoft.com:8443/",
            "https://graph.microsoft.com\\@evil.example/",
            "https://127.0.0.1/",
            "ftp://graph.microsoft.com/",
            "//graph.microsoft.com/",
            "graph.microsoft.com",
            "",
        ] {
            assert!(!policy.allows(url), "{url}");
        }
    }

    #[test]
    fn a_plain_http_address_passes_only_for_the_local_mock_in_tests() {
        let policy = HostPolicy::new(["127.0.0.1"]);
        assert!(policy.allows("http://127.0.0.1:4555/token"));
        assert!(!HostPolicy::new(["graph.microsoft.com"]).allows("http://127.0.0.1:4555/token"));
        assert!(!policy.allows("http://localhost:4555/token"));
        assert!(!policy.allows("http://127.0.0.1.evil.example:4555/token"));
    }

    #[test]
    fn form_fields_are_encoded() {
        let fields = vec![("a".to_owned(), "b c&d".to_owned()), ("e".to_owned(), "f/g".to_owned())];
        assert_eq!(encode_form(&fields), "a=b+c%26d&e=f%2Fg");
    }
}
