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

/// Downloads over HTTPS with Windows' TLS stack, as the updater does. No cookies and no proxy settings are read.
pub struct HttpSource;

impl Source for HttpSource {
    fn open(&self, url: &str, from: u64) -> Result<Opened, String> {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        // Only the catalog's own addresses are ever opened.
        if !url.starts_with("https://huggingface.co/") {
            return Err("That address is not one OpenNote downloads from.".to_owned());
        }
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
        let mut request = agent.get(url);
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let response = request.call().map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let resumed = match status {
            200 => false,
            206 => true,
            other => return Err(format!("The server answered with status {other}.")),
        };
        Ok(Opened {
            resumed,
            reader: Box::new(response.into_body().into_reader()),
        })
    }
}
