//! Sending a report, only after the person has reviewed it and agreed.
//!
//! Nothing here sends anything by itself. A report can only reach the network through these steps:
//!
//! 1. [`prepare`] reads one report, scrubs it again, and returns a [`PendingSend`] that holds the exact text
//!    that would be sent. It fails unless the person has opted in (see [`Consent`]) and
//!    [`Settings::endpoint`] holds a web address. The consent is unasked and the address is empty by
//!    default.
//! 2. The interface shows [`PendingSend::payload`] to the person and asks whether to send it.
//! 3. If they agree, the interface passes back the [`PendingSend::digest`] of what it showed to
//!    [`PendingSend::agree`], which returns an [`Agreement`]. A digest of anything else is refused.
//! 4. [`send`] takes the pending report and the agreement, and gives the text to a [`Transport`].
//!
//! The crate has no network code. The app supplies the [`Transport`], so the choice of HTTP client stays in
//! one place, and a build without a transport can't send at all.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::consent::Consent;
use crate::scrub::Scrubber;
use crate::store::{CrashStore, StoreError};

/// The crash report settings. The app stores them with its other settings.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Whether to save crash reports on this computer. Off until the person turns it on. Saving a report
    /// does not send it. It counts only together with a yes in [`Settings::consent`].
    pub enabled: bool,
    /// What the person decided on the consent screen. Nothing is saved or sent without a current yes.
    pub consent: Consent,
    /// Where a report goes when the person chooses to send it. Empty by default, so nothing can be sent
    /// until someone configures an address. It must start with `https://`. A local address may start with
    /// `http://`, for a collector on the same computer.
    pub endpoint: String,
}

impl Settings {
    /// Settings of a person who said yes at `now` and chose an address to send to (which may be empty).
    pub fn opted_in(now: u64, endpoint: impl Into<String>) -> Settings {
        Settings {
            enabled: true,
            consent: Consent::accepted(now),
            endpoint: endpoint.into(),
        }
    }

    /// Whether reports may be saved: the switch is on and the person said yes to the current wording.
    pub fn saving_allowed(&self) -> bool {
        self.enabled && self.consent.saving_allowed()
    }
}

/// Why a report was not sent.
#[derive(Debug, thiserror::Error)]
pub enum SendError {
    /// The person has not said yes to crash reports, or said yes to older wording.
    #[error("the person has not opted in to crash reports")]
    NotOptedIn,
    /// No address is set, so nothing is ever sent.
    #[error("no address is set for crash reports")]
    NotConfigured,
    /// The address is not an `https://` address, or a local `http://` one.
    #[error("the crash report address must start with https://")]
    InvalidEndpoint,
    /// The digest does not match the text that was to be sent.
    #[error("the person has not reviewed this report")]
    NotReviewed,
    /// The agreement is for another report.
    #[error("the agreement is for another report")]
    WrongAgreement,
    /// The report could not be read.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// The transport could not deliver the report.
    #[error("the report could not be sent: {0}")]
    Transport(String),
}

/// Delivers a report. The app implements it with its HTTP client.
pub trait Transport {
    /// Posts `body`, JSON text, to `endpoint`. The error is a short description that holds no report text.
    fn post(&self, endpoint: &str, body: &[u8]) -> Result<(), String>;
}

/// A report that is ready to show to the person. It can't be sent without an [`Agreement`].
#[derive(Debug)]
pub struct PendingSend {
    id: String,
    endpoint: String,
    payload: String,
    digest: String,
}

/// The person's agreement to send one report. Only [`PendingSend::agree`] makes one.
#[derive(Debug)]
pub struct Agreement {
    digest: String,
}

impl PendingSend {
    /// The id of the report.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The address it would be sent to, for the interface to show.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Exactly what would be sent. Show all of it.
    pub fn payload(&self) -> &str {
        &self.payload
    }

    /// A fingerprint of [`PendingSend::payload`], to pass back to [`PendingSend::agree`].
    pub fn digest(&self) -> &str {
        &self.digest
    }

    /// Records that the person reviewed the text with this digest and agreed to send it. Fails when the
    /// digest is not the one of the text that would be sent.
    pub fn agree(&self, reviewed_digest: &str) -> Result<Agreement, SendError> {
        if reviewed_digest == self.digest {
            Ok(Agreement {
                digest: self.digest.clone(),
            })
        } else {
            Err(SendError::NotReviewed)
        }
    }
}

/// Reads a report and prepares it for review. Nothing is sent. Fails with [`SendError::NotOptedIn`] unless
/// the person said yes to the current wording, and with [`SendError::NotConfigured`] when the settings have
/// no address.
pub fn prepare(
    store: &CrashStore,
    id: &str,
    settings: &Settings,
    scrubber: &Scrubber,
) -> Result<PendingSend, SendError> {
    if !settings.consent.saving_allowed() {
        return Err(SendError::NotOptedIn);
    }
    let endpoint = check_endpoint(&settings.endpoint)?;
    let payload = store.load(id, scrubber)?.to_json();
    let digest = digest(&payload);
    Ok(PendingSend {
        id: id.to_owned(),
        endpoint,
        payload,
        digest,
    })
}

/// Sends a report the person agreed to send. The report stays in the store until the caller deletes it.
pub fn send(pending: &PendingSend, agreement: Agreement, transport: &dyn Transport) -> Result<(), SendError> {
    if agreement.digest != pending.digest {
        return Err(SendError::WrongAgreement);
    }
    transport
        .post(&pending.endpoint, pending.payload.as_bytes())
        .map_err(SendError::Transport)
}

/// The address with spaces around it removed, if it is one that reports may go to.
fn check_endpoint(endpoint: &str) -> Result<String, SendError> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err(SendError::NotConfigured);
    }
    // Before the host part ends, a colon may only start a port. In `http://localhost:x@collector.example.net/`,
    // the colon starts a password and the host is the remote one.
    let local = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
        .iter()
        .any(|prefix| {
            endpoint.strip_prefix(prefix).is_some_and(|rest| {
                let port = host_part(rest);
                port.is_empty()
                    || port.strip_prefix(':').is_some_and(|digits| {
                        (1..=5).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
                    })
            })
        });
    let https = endpoint.strip_prefix("https://").is_some_and(|rest| {
        let host = host_part(rest);
        !host.is_empty() && !host.contains('@')
    });
    // A backslash is a path separator to some URL parsers and part of the user name to others.
    let clean = endpoint.len() <= 2048
        && !endpoint
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\');
    if (https || local) && clean {
        Ok(endpoint.to_owned())
    } else {
        Err(SendError::InvalidEndpoint)
    }
}

/// The part of an address after its scheme and before the first `/`, `?`, or `#`: the user part, the host, and
/// the port.
fn host_part(rest: &str) -> &str {
    &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())]
}

fn digest(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
#[path = "send_tests.rs"]
mod tests;
