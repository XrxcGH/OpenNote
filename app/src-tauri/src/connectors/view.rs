//! What the Settings page is told about a connector: its name and group, the access it asks for in the registry's
//! terms, and its state. There is no token, no client ID, and no address with a query in any of it.

use serde::{Deserialize, Serialize};

use super::{
    files::Connection,
    registry::{AuthKind, ConnectorDef, Group},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessView {
    pub capability: &'static str,
    pub writes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StateView {
    NotConnected,
    /// An OAuth connector that has no client ID yet.
    NeedsSetup,
    #[serde(rename_all = "camelCase")]
    Connected {
        account: String,
        connected_unix: u64,
    },
    /// The service refused to renew the sign-in. The person connects again.
    #[serde(rename_all = "camelCase")]
    Expired {
        account: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorView {
    pub id: &'static str,
    pub name: &'static str,
    pub group: Group,
    pub auth: AuthKind,
    /// The OpenNote features that use it, by ID.
    pub features: Vec<&'static str>,
    pub access: Vec<AccessView>,
    /// The hosts OpenNote talks to for it. A school connector shows its school's host.
    pub hosts: Vec<String>,
    pub state: StateView,
    /// The school's address, for a connector that has one.
    pub base_url: Option<String>,
    /// A sign-in is waiting for the browser.
    pub pending: bool,
    pub last_used_unix: Option<u64>,
}

/// The access, one entry per capability. A capability that any of its scopes changes data counts as a change.
fn access_of(def: &ConnectorDef) -> Vec<AccessView> {
    let mut access: Vec<AccessView> = Vec::new();
    for entry in def.access {
        match access.iter_mut().find(|seen| seen.capability == entry.capability) {
            Some(seen) => seen.writes |= entry.writes,
            None => access.push(AccessView {
                capability: entry.capability,
                writes: entry.writes,
            }),
        }
    }
    access
}

/// What `needs_setup` and `pending` say is passed in, because they come from files and from running sign-ins.
pub fn view_of(def: &ConnectorDef, connection: Option<&Connection>, needs_setup: bool, pending: bool) -> ConnectorView {
    let state = match connection {
        Some(connection) if connection.expired => StateView::Expired {
            account: connection.account.clone(),
        },
        Some(connection) => StateView::Connected {
            account: connection.account.clone(),
            connected_unix: connection.connected_unix,
        },
        None if needs_setup => StateView::NeedsSetup,
        None => StateView::NotConnected,
    };
    let school_host = connection
        .and_then(|connection| connection.base_url.as_deref())
        .and_then(|base| url::Url::parse(base).ok())
        .and_then(|base| base.host_str().map(str::to_owned));
    ConnectorView {
        id: def.id,
        name: def.name,
        group: def.group,
        auth: def.kind(),
        features: def.features.to_vec(),
        access: access_of(def),
        hosts: def
            .hosts
            .iter()
            .map(|host| (*host).to_owned())
            .chain(school_host)
            .collect(),
        state,
        base_url: connection.and_then(|connection| connection.base_url.clone()),
        pending,
        last_used_unix: connection.and_then(|connection| connection.last_used_unix),
    }
}

/// What the person typed on the page to connect. A token appears only here, going in.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectInput {
    pub base_url: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RevokeOutcome {
    /// There was no connection to remove.
    Nothing,
    /// The service forgot the sign-in.
    Revoked,
    /// The service has no way to revoke from here. The sign-in is removed from this computer only.
    NotSupported,
    /// Work offline was on, so the service wasn't told.
    SkippedOffline,
    /// The service couldn't be told. The sign-in is removed from this computer only.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disconnected {
    pub view: ConnectorView,
    pub revoke: RevokeOutcome,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::{files::Holds, registry};

    fn connection(expired: bool) -> Connection {
        Connection {
            account: "sam@example.com".into(),
            scopes: vec!["scope".into()],
            connected_unix: 1_790_000_000,
            holds: Holds::Refresh,
            base_url: None,
            expired,
            last_used_unix: None,
        }
    }

    #[test]
    fn states_follow_the_connection_and_the_setup() {
        let google = registry::find("google").expect("google");
        let state = |connection: Option<&Connection>, setup| view_of(google, connection, setup, false).state;
        assert_eq!(state(None, true), StateView::NeedsSetup);
        assert_eq!(state(None, false), StateView::NotConnected);
        assert_eq!(
            state(Some(&connection(false)), true),
            StateView::Connected {
                account: "sam@example.com".into(),
                connected_unix: 1_790_000_000
            }
        );
        assert_eq!(
            state(Some(&connection(true)), false),
            StateView::Expired {
                account: "sam@example.com".into()
            }
        );
    }

    #[test]
    fn the_wire_form_has_no_secret_fields_and_uses_camel_case() {
        let view = view_of(
            registry::find("google").expect("google"),
            Some(&connection(false)),
            false,
            true,
        );
        let json = serde_json::to_value(&view).expect("serializes");
        assert_eq!(json["state"]["kind"], "connected");
        assert_eq!(json["state"]["connectedUnix"], 1_790_000_000);
        assert_eq!(json["auth"], "oauth");
        assert_eq!(json["group"], "google");
        assert_eq!(json["pending"], true);
        let text = json.to_string().to_lowercase();
        for word in ["token", "secret", "clientid", "verifier"] {
            assert!(!text.contains(word), "the view mentions {word}");
        }
    }

    #[test]
    fn access_is_listed_once_per_capability() {
        let view = view_of(registry::find("google").expect("google"), None, false, false);
        let capabilities: Vec<_> = view.access.iter().map(|access| access.capability).collect();
        assert_eq!(
            capabilities,
            [
                "account",
                "calendarRead",
                "tasksWrite",
                "classroomRead",
                "driveFiles",
                "youtubeRead",
                "driveRead",
                "youtubeUpload",
                "youtubeCaptions",
                "driveAppData"
            ]
        );
        assert!(
            view.access
                .iter()
                .find(|a| a.capability == "tasksWrite")
                .expect("tasks")
                .writes
        );
        assert!(
            !view
                .access
                .iter()
                .find(|a| a.capability == "calendarRead")
                .expect("calendar")
                .writes
        );
    }

    #[test]
    fn a_school_connector_shows_its_school_host() {
        let canvas = registry::find("canvas").expect("canvas");
        assert!(view_of(canvas, None, false, false).hosts.is_empty());
        let mut connected = connection(false);
        connected.base_url = Some("https://school.example.edu".into());
        let view = view_of(canvas, Some(&connected), false, false);
        assert_eq!(view.hosts, ["school.example.edu"]);
        assert_eq!(view.base_url.as_deref(), Some("https://school.example.edu"));
    }
}
