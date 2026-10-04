//! Why a connector call failed. Each reason has a fixed code that the interface turns into a sentence from its
//! strings. The messages are for the log, and none of them can hold a token, a code, a client ID, or a URL with a
//! query: they name the connector and the kind of failure only.

use std::fmt;

use crate::ipc::IpcError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// Work offline is on, so nothing signs in, refreshes, or sends.
    Offline,
    /// No connector has this ID.
    Unknown,
    /// The owner has not put a client ID in the connectors file or the build.
    NotConfigured,
    /// The person has not connected it.
    NotConnected,
    /// The sign-in no longer works, so the person has to connect again.
    Expired,
    /// The connection was made without the access a feature asked for.
    MissingAccess,
    /// A sign-in for this connector is already waiting for the browser.
    Busy,
    /// The person canceled in OpenNote.
    Canceled,
    /// Nobody finished signing in within five minutes.
    TimedOut,
    /// The person said no in the service's own page.
    Denied,
    /// The browser came back with the wrong state value or a damaged address.
    Mismatch,
    /// The loopback port could not be opened.
    PortInUse,
    /// The browser could not be opened.
    BrowserFailed,
    /// The service could not be reached.
    Network,
    /// The service answered, but refused the code, the token, or the request.
    Rejected,
    /// A school address or a token that is not acceptable.
    BadInput,
    /// An address that is not one of the connector's allowed hosts.
    ForeignHost,
    /// Windows Credential Manager, or the connections file, could not be used.
    Storage,
}

impl Failure {
    /// The code the interface receives.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Offline => "offline",
            Self::Unknown => "unknown",
            Self::NotConfigured => "notConfigured",
            Self::NotConnected => "notConnected",
            Self::Expired => "expired",
            Self::MissingAccess => "missingAccess",
            Self::Busy => "busy",
            Self::Canceled => "canceled",
            Self::TimedOut => "timedOut",
            Self::Denied => "denied",
            Self::Mismatch => "mismatch",
            Self::PortInUse => "portInUse",
            Self::BrowserFailed => "browserFailed",
            Self::Network => "network",
            Self::Rejected => "rejected",
            Self::BadInput => "badInput",
            Self::ForeignHost => "foreignHost",
            Self::Storage => "storage",
        }
    }

    const fn text(self) -> &'static str {
        match self {
            Self::Offline => "Work offline is on",
            Self::Unknown => "no such connector",
            Self::NotConfigured => "no client ID is set up",
            Self::NotConnected => "not connected",
            Self::Expired => "the sign-in expired",
            Self::MissingAccess => "the connection lacks the access asked for",
            Self::Busy => "a sign-in is already waiting",
            Self::Canceled => "canceled",
            Self::TimedOut => "the sign-in timed out",
            Self::Denied => "the person denied access",
            Self::Mismatch => "the browser's answer didn't match the sign-in",
            Self::PortInUse => "couldn't open the loopback port",
            Self::BrowserFailed => "couldn't open the browser",
            Self::Network => "couldn't reach the service",
            Self::Rejected => "the service refused it",
            Self::BadInput => "the address or token isn't acceptable",
            Self::ForeignHost => "the address isn't an allowed host",
            Self::Storage => "couldn't store the connection",
        }
    }
}

/// A failure and the connector it happened to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectorError {
    pub failure: Failure,
    pub connector: String,
}

impl ConnectorError {
    pub fn new(failure: Failure, connector: &str) -> Self {
        Self {
            failure,
            connector: connector.to_owned(),
        }
    }

    pub const fn code(&self) -> &'static str {
        self.failure.code()
    }
}

impl fmt::Display for ConnectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.connector, self.failure.text())
    }
}

impl std::error::Error for ConnectorError {}

impl From<ConnectorError> for IpcError {
    fn from(error: ConnectorError) -> Self {
        IpcError {
            code: error.code().to_owned(),
            message: error.to_string(),
            field: Some(error.connector),
        }
    }
}

pub type Result<T> = std::result::Result<T, ConnectorError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_failure_has_its_own_code() {
        let all = [
            Failure::Offline,
            Failure::Unknown,
            Failure::NotConfigured,
            Failure::NotConnected,
            Failure::Expired,
            Failure::MissingAccess,
            Failure::Busy,
            Failure::Canceled,
            Failure::TimedOut,
            Failure::Denied,
            Failure::Mismatch,
            Failure::PortInUse,
            Failure::BrowserFailed,
            Failure::Network,
            Failure::Rejected,
            Failure::BadInput,
            Failure::ForeignHost,
            Failure::Storage,
        ];
        let codes: std::collections::BTreeSet<_> = all.iter().map(|failure| failure.code()).collect();
        assert_eq!(codes.len(), all.len());
    }

    #[test]
    fn the_ipc_error_names_the_connector_and_nothing_else() {
        let error: IpcError = ConnectorError::new(Failure::Rejected, "dropbox").into();
        assert_eq!(error.code, "rejected");
        assert_eq!(error.field.as_deref(), Some("dropbox"));
        assert_eq!(error.message, "dropbox: the service refused it");
    }
}
