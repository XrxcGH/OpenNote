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
    /// when `127.0.0.1` is listed, so they can serve answers from a local mock. That branch is only in tests and
    /// in builds with the `test-endpoints` feature (see `test_hook.rs`), never in a release.
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
        let local_test =
            (cfg!(test) || cfg!(feature = "test-endpoints")) && url.scheme() == "http" && host == "127.0.0.1";
        if !local_test && (url.scheme() != "https" || url.port().is_some()) {
            return false;
        }
        self.hosts.contains(&host)
    }
}

#[derive(Clone)]
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
    /// Whether a redirect is followed, on a pinned host only. When false the 3xx comes back with its `Location`, for
    /// a step whose next address is on another service, such as a Canvas upload that answers with the confirm
    /// address on the Canvas host.
    pub follow_redirects: bool,
}

impl HttpRequest {
    pub fn new(method: Method, url: impl Into<String>) -> HttpRequest {
        HttpRequest {
            method,
            url: url.into(),
            headers: Vec::new(),
            body: None,
            follow_redirects: true,
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
            .https_only(!(cfg!(test) || cfg!(feature = "test-endpoints")))
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
            if redirect && request.follow_redirects {
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
            // A redirect handed back unfollowed carries its target as a full address.
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .map(
                    |location| match Url::parse(&current).and_then(|base| base.join(location)) {
                        Ok(full) if redirect => full.into(),
                        _ => location.to_owned(),
                    },
                );
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

    /// Answers one request on a local port with `answer`, and gives the address.
    fn answer_once(answer: &'static str) -> String {
        use std::{io::Write, net::TcpListener};
        let listener = TcpListener::bind("127.0.0.1:0").expect("binds");
        let address = format!(
            "http://127.0.0.1:{}/upload",
            listener.local_addr().expect("port").port()
        );
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                // The whole request is read before the answer goes out: a socket closed with request bytes still
                // unread resets the connection on Windows, and the client then sees a network error, not the answer.
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                while !request.windows(4).any(|end| end == b"\r\n\r\n") {
                    match stream.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => request.extend_from_slice(&buffer[..count]),
                    }
                }
                let _ = stream.write_all(answer.as_bytes());
                let _ = stream.flush();
                let _ = stream.shutdown(std::net::Shutdown::Write);
                // The socket stays open until the client has read the answer and closed its side. Dropping it at once
                // can reset the connection on Windows while the answer is still in flight, and the client then sees
                // a network error, not the answer.
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                while matches!(stream.read(&mut buffer), Ok(count) if count > 0) {}
            }
        });
        address
    }

    const MOVED: &str = concat!(
        "HTTP/1.1 301 Moved\r\nLocation: https://canvas.example/api/v1/files/1/create_success\r\n",
        "Content-Length: 0\r\nConnection: close\r\n\r\n"
    );

    #[test]
    fn an_unfollowed_redirect_to_another_host_comes_back_with_its_location() {
        let address = answer_once(MOVED);
        let mut request = HttpRequest::new(Method::Post, address);
        request.follow_redirects = false;
        let response = UreqHttp::default()
            .send(&HostPolicy::new(["127.0.0.1"]), &request, 1024)
            .unwrap_or_else(|_| panic!("the 301 comes back"));
        assert_eq!(response.status, 301);
        assert_eq!(
            response.location.as_deref(),
            Some("https://canvas.example/api/v1/files/1/create_success")
        );
    }

    #[test]
    fn a_followed_redirect_to_another_host_is_refused() {
        let address = answer_once(MOVED);
        let request = HttpRequest::new(Method::Post, address);
        let result = UreqHttp::default().send(&HostPolicy::new(["127.0.0.1"]), &request, 1024);
        assert_eq!(result.err(), Some(HttpError::ForeignHost));
    }

    #[test]
    fn form_fields_are_encoded() {
        let fields = vec![("a".to_owned(), "b c&d".to_owned()), ("e".to_owned(), "f/g".to_owned())];
        assert_eq!(encode_form(&fields), "a=b+c%26d&e=f%2Fg");
    }
}
