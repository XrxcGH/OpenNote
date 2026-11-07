//! Where model bytes come from.

use std::{io::Read, time::Duration};

/// What a server answered to a request for a file from some byte on.
pub struct Opened {
    /// True when the answer starts at the byte asked for, and false when the server sent the file from the start.
    pub resumed: bool,
    pub reader: Box<dyn Read + Send>,
}

/// Where model bytes come from. The app uses [`HttpSource`], and tests use a stand-in.
pub trait Source: Send + Sync {
    fn open(&self, url: &str, from: u64) -> Result<Opened, String>;
}

/// Downloads over HTTPS with Windows' TLS stack, as the updater does. No cookies and no proxy settings are read. It
/// opens only addresses that start with one of its allowed prefixes.
pub struct HttpSource {
    allowed: &'static [&'static str],
}

impl HttpSource {
    /// Allows only the addresses that start with one of `prefixes`.
    pub const fn allowing(prefixes: &'static [&'static str]) -> HttpSource {
        HttpSource { allowed: prefixes }
    }

    /// The model catalog's own host.
    pub const fn models() -> HttpSource {
        HttpSource::allowing(&["https://huggingface.co/"])
    }
}

/// What an answer to a request from byte `from` holds. `Some(true)` is the bytes from `from` on. `Some(false)` is
/// the whole file. `None` is an answer that can't be trusted. jsDelivr, for one, counts a range in its compressed
/// bytes. It answers 416, or 206 with a `Content-Range` that starts somewhere else. Then the file is asked for
/// again from the start, so a broken range never corrupts a download.
pub(crate) fn range_answer(status: u16, content_range: Option<&str>, from: u64) -> Result<Option<bool>, String> {
    match status {
        200 => Ok(Some(false)),
        206 if from > 0 => {
            let start = content_range
                .and_then(|value| value.trim().strip_prefix("bytes "))
                .and_then(|value| value.split('-').next())
                .and_then(|value| value.trim().parse::<u64>().ok());
            Ok((start == Some(from)).then_some(true))
        }
        206 => Ok(Some(true)),
        416 if from > 0 => Ok(None),
        other => Err(format!("The server answered with status {other}.")),
    }
}

/// A server's answer: the status, the `Content-Range` header, and the body.
type Answer = (u16, Option<String>, Box<dyn Read + Send>);

impl HttpSource {
    fn get(&self, url: &str, from: u64) -> Result<Answer, String> {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .tls_config(tls)
            .max_redirects(5)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .user_agent(concat!("OpenNote/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let mut request = agent.get(url).header("Accept-Encoding", "identity");
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let response = request.call().map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let range = response
            .headers()
            .get("Content-Range")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        Ok((status, range, Box::new(response.into_body().into_reader())))
    }
}

impl Source for HttpSource {
    fn open(&self, url: &str, from: u64) -> Result<Opened, String> {
        // Only the catalog's own addresses are ever opened.
        if !self.allowed.iter().any(|prefix| url.starts_with(prefix)) {
            return Err("That address is not one OpenNote downloads from.".to_owned());
        }
        let (status, range, reader) = self.get(url, from)?;
        if let Some(resumed) = range_answer(status, range.as_deref(), from)? {
            return Ok(Opened { resumed, reader });
        }
        drop(reader);
        let (status, range, reader) = self.get(url, 0)?;
        match range_answer(status, range.as_deref(), 0)? {
            Some(_) => Ok(Opened { resumed: false, reader }),
            None => Err(format!("The server answered with status {status}.")),
        }
    }
}
