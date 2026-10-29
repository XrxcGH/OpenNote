//! Sending a crash report the person reviewed (docs/HARDENING.md, "How a report is sent"). The crashreport crate
//! has no network code; this is the only place a report can leave the computer. It runs only from
//! `crash_send`, after the person agreed to the exact text, and never while Work offline is on.

use std::time::Duration;

use opennote_crashreport::Transport;
use ureq::Agent;

/// How long a send may take, in all.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Posts the report as JSON with `ureq` and Windows' TLS stack, as the updater does. No cookies, no `Referer`,
/// no proxy, and no redirects: a report goes to the address the person saw, and nowhere else.
pub struct HttpTransport;

fn agent() -> Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    Agent::config_builder()
        .tls_config(tls)
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT))
        .user_agent(concat!("OpenNote/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

impl Transport for HttpTransport {
    fn post(&self, endpoint: &str, body: &[u8]) -> Result<(), String> {
        if super::offline() {
            return Err("Work offline is on.".to_owned());
        }
        // The messages say what went wrong without repeating the address or any of the report.
        let response = agent()
            .post(endpoint)
            .header("Content-Type", "application/json")
            .send(body)
            .map_err(|_| "The collector could not be reached.".to_owned())?;
        let status = response.status().as_u16();
        if (200..300).contains(&status) {
            Ok(())
        } else {
            Err(format!("The collector answered with status {status}."))
        }
    }
}
