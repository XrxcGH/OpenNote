//! Downloads: the [`Fetch`] trait, so tests can serve files from memory, and its `ureq` implementation.

use std::{
    fmt,
    io::{self, Read, Write},
    time::Duration,
};

use crate::config::TEST_ENDPOINTS;

/// A URL the updater may read. Only HTTPS, except `http://127.0.0.1` in `test-endpoints` builds.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Url(String);

impl Url {
    /// Accepts an HTTPS URL with a host, or a local test URL in `test-endpoints` builds.
    pub fn parse(text: &str) -> Result<Url, FetchError> {
        if is_https(text) || (TEST_ENDPOINTS && is_local_test_url(text)) {
            Ok(Url(text.to_owned()))
        } else {
            Err(FetchError::InsecureUrl(text.to_owned()))
        }
    }

    /// Wraps one of this crate's own constant URLs. A unit test checks that each one parses.
    pub(crate) fn from_static(text: &'static str) -> Url {
        Url(text.to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether a release file may come from here: [`RELEASE_HOSTS`], or `http://127.0.0.1` in `test-endpoints`
    /// builds. The host is read the way a client reads it, so a user name in front (`github.com@evil.example`) or a
    /// backslash doesn't pass for GitHub, and only the default port is accepted.
    pub fn is_release_host(&self) -> bool {
        if TEST_ENDPOINTS && is_local_test_url(&self.0) {
            return true;
        }
        let Some(rest) = self.0.get(HTTPS.len()..) else {
            return false;
        };
        let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
        if authority.contains(['@', '\\']) {
            return false;
        }
        let host = authority.strip_suffix(":443").unwrap_or(authority);
        RELEASE_HOSTS.iter().any(|allowed| host.eq_ignore_ascii_case(allowed))
    }
}

/// Where the updater downloads from. A release's files are on `github.com`, which redirects them to GitHub's
/// release storage. The manifest isn't signed, so a manifest that names any other server is refused rather than
/// letting whoever edited it point every client at a server of their choosing.
pub const RELEASE_HOSTS: [&str; 4] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

impl fmt::Display for Url {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

const HTTPS: &str = "https://";

fn is_https(text: &str) -> bool {
    let scheme = text.get(..HTTPS.len()).is_some_and(|s| s.eq_ignore_ascii_case(HTTPS));
    let host = text
        .get(HTTPS.len()..)
        .and_then(|rest| rest.split(['/', '?', '#']).next());
    scheme && host.is_some_and(|h| !h.is_empty() && !h.contains(char::is_whitespace))
}

fn is_local_test_url(text: &str) -> bool {
    ["http://127.0.0.1:", "http://127.0.0.1/"]
        .iter()
        .any(|prefix| text.starts_with(prefix))
}

/// A finished download.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FetchOutcome {
    /// How many bytes went to the sink.
    pub bytes: u64,
}

#[derive(Debug)]
pub enum FetchError {
    /// No network connection. Checks skip quietly.
    Offline,
    /// The server couldn't be reached or the connection broke.
    Unreachable(String),
    /// The server answered with an HTTP error status.
    Status(u16),
    /// The response passed the size limit, so the download stopped.
    TooLarge { limit: u64 },
    /// A URL or redirect that isn't HTTPS.
    InsecureUrl(String),
    /// A URL or redirect to a server that isn't one of [`RELEASE_HOSTS`].
    ForeignHost(String),
    /// Writing to the sink failed.
    Io(std::io::Error),
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Offline => f.write_str("no network connection"),
            Self::Unreachable(reason) => write!(f, "couldn't reach the update server: {reason}"),
            Self::Status(status) => write!(f, "the update server answered with status {status}"),
            Self::TooLarge { limit } => write!(f, "the download passed its {limit}-byte limit"),
            Self::InsecureUrl(url) => write!(f, "refused a URL that isn't HTTPS: {url}"),
            Self::ForeignHost(url) => write!(f, "refused a URL on a server that isn't GitHub's: {url}"),
            Self::Io(error) => write!(f, "couldn't write the download: {error}"),
        }
    }
}

impl std::error::Error for FetchError {}

impl From<std::io::Error> for FetchError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// Reads one URL into a sink, stopping as soon as more than `max_bytes` arrive.
pub trait Fetch: Send + Sync {
    fn get(&self, url: &Url, max_bytes: u64, sink: &mut dyn Write) -> Result<FetchOutcome, FetchError>;
}

/// The most redirects one download follows. GitHub's release downloads take two.
pub const MAX_REDIRECTS: usize = 5;

/// The production fetcher (section 18.5): a `ureq` agent with the native TLS provider, which uses Windows SChannel
/// and the Windows certificate store, and the Windows proxy setting. Connecting may take 10 s, and each response
/// 30 s to start. It follows redirects itself, so every URL and every redirect passes [`Url::parse`]: HTTPS only,
/// or `http://127.0.0.1` in `test-endpoints` builds.
#[derive(Debug, Clone)]
pub struct UreqFetch {
    agent: ureq::Agent,
}

impl Default for UreqFetch {
    fn default() -> Self {
        Self::trusting(ureq::tls::RootCerts::PlatformVerifier)
    }
}

impl UreqFetch {
    /// A fetcher that trusts `roots`: the Windows certificate store, or in tests a local server's own certificate.
    fn trusting(roots: ureq::tls::RootCerts) -> Self {
        use ureq::tls::{TlsConfig, TlsProvider};
        // The provider's own feature must be on: ureq panics on an https address otherwise, and a release build
        // aborts on a panic (T1-1). The https tests below fail the same way if it is ever turned off.
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(roots)
            .build();
        let config = ureq::Agent::config_builder()
            .tls_config(tls)
            .https_only(!TEST_ENDPOINTS)
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_send_request(Some(Duration::from_secs(30)))
            .timeout_recv_response(Some(Duration::from_secs(30)))
            .timeout_recv_body(Some(Duration::from_secs(30 * 60)))
            .user_agent(concat!("OpenNote-updater/", env!("CARGO_PKG_VERSION")))
            .build();
        Self { agent: config.into() }
    }
}

impl Fetch for UreqFetch {
    fn get(&self, url: &Url, max_bytes: u64, sink: &mut dyn Write) -> Result<FetchOutcome, FetchError> {
        let mut current = url.clone();
        for _ in 0..=MAX_REDIRECTS {
            let response = self.agent.get(current.as_str()).call().map_err(from_ureq)?;
            let status = response.status().as_u16();
            if (300..400).contains(&status) {
                let location = response
                    .headers()
                    .get("location")
                    .and_then(|value| value.to_str().ok())
                    .ok_or(FetchError::Status(status))?;
                current = redirect_target(&current, location)?;
                continue;
            }
            if status != 200 {
                return Err(FetchError::Status(status));
            }
            let length = response.body().content_length();
            if length.is_some_and(|length| length > max_bytes) {
                return Err(FetchError::TooLarge { limit: max_bytes });
            }
            let reader = response.into_body().into_reader();
            return copy_limited(reader, max_bytes, sink);
        }
        Err(FetchError::Unreachable(format!("more than {MAX_REDIRECTS} redirects")))
    }
}

/// Where a redirect goes: HTTPS, on one of [`RELEASE_HOSTS`].
fn redirect_target(current: &Url, location: &str) -> Result<Url, FetchError> {
    let target = Url::parse(&resolve(current, location))?;
    if target.is_release_host() {
        Ok(target)
    } else {
        Err(FetchError::ForeignHost(target.to_string()))
    }
}

/// A redirect's target: an absolute URL as it is, or a path on the same server.
fn resolve(current: &Url, location: &str) -> String {
    if location.starts_with('/') && !location.starts_with("//") {
        let text = current.as_str();
        let host_end = text
            .find("://")
            .and_then(|scheme| text[scheme + 3..].find('/').map(|slash| scheme + 3 + slash));
        format!("{}{location}", &text[..host_end.unwrap_or(text.len())])
    } else {
        location.to_owned()
    }
}

/// Copies a body into the sink, stopping as soon as more than `max_bytes` arrive.
pub fn copy_limited(mut reader: impl Read, max_bytes: u64, sink: &mut dyn Write) -> Result<FetchOutcome, FetchError> {
    let mut buffer = vec![0u8; 64 * 1024];
    let mut bytes = 0u64;
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) => return Ok(FetchOutcome { bytes }),
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(FetchError::Unreachable(error.to_string())),
        };
        bytes += read as u64;
        if bytes > max_bytes {
            return Err(FetchError::TooLarge { limit: max_bytes });
        }
        sink.write_all(&buffer[..read])?;
    }
}

fn from_ureq(error: ureq::Error) -> FetchError {
    match error {
        ureq::Error::HostNotFound => FetchError::Offline,
        ureq::Error::Io(error) if error.kind() == io::ErrorKind::StorageFull => FetchError::Io(error),
        other => FetchError::Unreachable(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_https_download_from_a_server_without_tls_fails_cleanly() {
        // ureq panics on every https address unless its `native-tls` feature is on, and a release build aborts on a
        // panic (T1-1). A server that answers in plain HTTP must give an error, not a panic.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a local port");
        let port = listener.local_addr().expect("an address").port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            }
        });
        let url = Url::parse(&format!("https://127.0.0.1:{port}/latest.json")).expect("https");
        let mut sink = Vec::new();
        let result = UreqFetch::default().get(&url, 1024, &mut sink);
        assert!(matches!(result, Err(FetchError::Unreachable(_))), "{result:?}");
    }

    #[test]
    fn an_https_download_succeeds() {
        // T1-1: the TLS stack the app ships, end to end, against a local server with its own certificate.
        let (port, cert) = serve_tls(b"{\"version\":\"1.0.0\"}");
        let roots = ureq::tls::RootCerts::Specific(std::sync::Arc::new(vec![
            ureq::tls::Certificate::from_der(&cert).to_owned()
        ]));
        let url = Url::parse(&format!("https://127.0.0.1:{port}/latest.json")).expect("https");
        let mut sink = Vec::new();
        let result = UreqFetch::trusting(roots).get(&url, 1024, &mut sink);
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(sink, b"{\"version\":\"1.0.0\"}");
    }

    /// A local HTTPS server with a new self-signed certificate for 127.0.0.1, which answers every request with `body`.
    /// Returns its port and the certificate.
    fn serve_tls(body: &'static [u8]) -> (u16, Vec<u8>) {
        use std::io::{BufRead, BufReader};
        let key = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_owned()]).expect("a certificate");
        let cert = key.cert.der().to_vec();
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![key.cert.der().clone()],
                rustls::pki_types::PrivatePkcs8KeyDer::from(key.key_pair.serialize_der()).into(),
            )
            .expect("a server configuration");
        let config = std::sync::Arc::new(config);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a local port");
        let port = listener.local_addr().expect("an address").port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let Ok(connection) = rustls::ServerConnection::new(config.clone()) else {
                    break;
                };
                let mut tls = rustls::StreamOwned::new(connection, stream);
                let mut reader = BufReader::new(&mut tls);
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 && line != "\r\n" {
                    line.clear();
                }
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = tls.write_all(head.as_bytes()).and_then(|()| tls.write_all(body));
                tls.conn.send_close_notify();
                let _ = tls.flush();
            }
        });
        (port, cert)
    }

    #[test]
    fn accepts_https_urls_with_a_host() {
        for url in [
            "https://github.com/x.json",
            "HTTPS://example.org",
            "https://example.org?q=1",
        ] {
            assert!(Url::parse(url).is_ok(), "{url}");
        }
    }

    #[test]
    fn refuses_other_schemes_and_empty_hosts() {
        for url in [
            "http://github.com/x.json",
            "https://",
            "https:///x",
            "ftp://x",
            "",
            "https://a b/",
        ] {
            assert!(matches!(Url::parse(url), Err(FetchError::InsecureUrl(_))), "{url}");
        }
    }

    #[test]
    fn resolves_redirects_to_paths_on_the_same_server() {
        let url = Url::parse("https://github.com/XrxcGH/OpenNote/releases").expect("https");
        assert_eq!(resolve(&url, "/a/b.exe"), "https://github.com/a/b.exe");
        assert_eq!(resolve(&url, "https://objects.example/x"), "https://objects.example/x");
        let other = resolve(&url, "//other.example/x");
        assert!(Url::parse(&other).is_err(), "a scheme-relative redirect is refused");
    }

    #[test]
    fn knows_the_hosts_a_release_file_may_come_from() {
        for url in [
            "https://github.com/XrxcGH/OpenNote/releases/download/v1.0.0/OpenNote_Windows64.exe",
            "https://GitHub.com/x",
            "https://github.com:443/x",
            "https://objects.githubusercontent.com/github-production-release-asset/1?X-Amz=2",
            "https://release-assets.githubusercontent.com/x",
            "https://github.com?x=1",
        ] {
            assert!(Url::parse(url).expect("https").is_release_host(), "{url}");
        }
        for url in [
            "https://evil.example/big.bin",
            "https://github.com.evil.example/x",
            "https://evil.example/github.com/x",
            "https://evil.example?github.com",
            "https://github.com@evil.example/x",
            "https://github.com:secret@evil.example/x",
            "https://evil.example\\@github.com/x",
            "https://github.com:8443/x",
            "https://raw.githubusercontent.com/attacker/repo/main/big.bin",
            "https://githubusercontent.com/x",
            "https://notgithub.com/x",
        ] {
            assert!(!Url::parse(url).expect("https").is_release_host(), "{url}");
        }
    }

    #[test]
    fn follows_redirects_only_to_release_hosts() {
        let url = Url::parse("https://github.com/XrxcGH/OpenNote/releases/download/v1/x.exe").expect("https");
        let storage = "https://objects.githubusercontent.com/github-production-release-asset/1";
        assert_eq!(
            redirect_target(&url, storage).expect("GitHub's storage").as_str(),
            storage
        );
        assert_eq!(
            redirect_target(&url, "/XrxcGH/OpenNote/other")
                .expect("same server")
                .as_str(),
            "https://github.com/XrxcGH/OpenNote/other"
        );
        assert!(matches!(
            redirect_target(&url, "https://evil.example/big.bin"),
            Err(FetchError::ForeignHost(_))
        ));
        assert!(matches!(
            redirect_target(&url, "//evil.example/big.bin"),
            Err(FetchError::InsecureUrl(_))
        ));
        assert!(matches!(
            redirect_target(&url, "http://github.com/x"),
            Err(FetchError::InsecureUrl(_))
        ));
    }

    #[test]
    fn copies_a_body_up_to_its_limit() {
        let mut sink = Vec::new();
        let outcome = copy_limited(&[1u8; 10][..], 10, &mut sink).expect("fits");
        assert_eq!((outcome.bytes, sink.len()), (10, 10));
        let mut sink = Vec::new();
        assert!(matches!(
            copy_limited(&[1u8; 11][..], 10, &mut sink),
            Err(FetchError::TooLarge { limit: 10 })
        ));
    }

    #[test]
    fn local_http_is_allowed_only_in_test_endpoint_builds() {
        assert_eq!(Url::parse("http://127.0.0.1:8080/latest.json").is_ok(), TEST_ENDPOINTS);
        assert!(Url::parse("http://127.0.0.2/latest.json").is_err());
        assert!(Url::parse("http://127.0.0.1.example.org/x").is_err());
    }
}
