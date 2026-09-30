//! Downloads: the [`Fetch`] trait, so tests can serve files from memory, and its `ureq` implementation.

use std::{fmt, io::Write};

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
}

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

/// The production fetcher: a `ureq` agent with Windows TLS and proxy settings, HTTPS-only redirects, and
/// 10 s connect and 30 s read timeouts (section 18.5). The updater work package fills it in.
#[derive(Debug, Default, Clone, Copy)]
pub struct UreqFetch;

impl Fetch for UreqFetch {
    fn get(&self, _url: &Url, _max_bytes: u64, _sink: &mut dyn Write) -> Result<FetchOutcome, FetchError> {
        Err(FetchError::Unreachable(
            "the ureq fetcher isn't implemented yet".to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn local_http_is_allowed_only_in_test_endpoint_builds() {
        assert_eq!(Url::parse("http://127.0.0.1:8080/latest.json").is_ok(), TEST_ENDPOINTS);
        assert!(Url::parse("http://127.0.0.2/latest.json").is_err());
        assert!(Url::parse("http://127.0.0.1.example.org/x").is_err());
    }
}
