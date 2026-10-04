//! The two small files of the connectors, both in this device's folder and both free of secrets.
//!
//! - `connectors.json` is written by the owner, not by OpenNote. It holds the client ID of each service.
//!   Where a service wants one, it also holds the client secret of the app registration, which belongs to the
//!   app and not to the person. A build with no client IDs works once this file has them. docs/CONNECTORS.md
//!   says how to fill it in.
//! - `connections.json` is written by OpenNote. It holds only what Settings shows about each connection: the
//!   account name, the access that was granted, and when it was connected. A token never goes into it.

use std::{collections::BTreeMap, fs, io, path::Path};

use serde::{Deserialize, Serialize};

use super::secret::Secret;
use crate::settings::file::write_json;

pub const CONFIG_FILE: &str = "connectors.json";
pub const CONNECTIONS_FILE: &str = "connections.json";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ConfigFile {
    clients: BTreeMap<String, ClientEntry>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ClientEntry {
    client_id: String,
    client_secret: String,
    redirect_port: Option<u16>,
}

/// An app registration: what the service knows OpenNote by.
#[derive(Clone)]
pub struct Client {
    pub id: String,
    pub secret: Option<Secret>,
    /// A port to use instead of the default of a service that needs a fixed one.
    pub redirect_port: Option<u16>,
}

/// The longest client ID or secret accepted. Real ones are far shorter.
const MAX_CLIENT_TEXT: usize = 512;

fn clean(text: &str) -> Option<String> {
    let text = text.trim();
    let usable =
        !text.is_empty() && text.len() <= MAX_CLIENT_TEXT && !text.chars().any(|c| c.is_whitespace() || c.is_control());
    usable.then(|| text.to_owned())
}

/// The client IDs compiled into this build, from `OPENNOTE_<SERVICE>_CLIENT_ID` and `..._CLIENT_SECRET` at build
/// time. The repository holds none, so a build without them has none.
fn built_in(connector: &str) -> (Option<&'static str>, Option<&'static str>) {
    macro_rules! pair {
        ($name:literal) => {
            (
                option_env!(concat!("OPENNOTE_", $name, "_CLIENT_ID")),
                option_env!(concat!("OPENNOTE_", $name, "_CLIENT_SECRET")),
            )
        };
    }
    match connector {
        "microsoft" => pair!("MICROSOFT"),
        "google" => pair!("GOOGLE"),
        "slack" => pair!("SLACK"),
        "dropbox" => pair!("DROPBOX"),
        "box" => pair!("BOX"),
        "vimeo" => pair!("VIMEO"),
        _ => (None, None),
    }
}

/// The app registration for a connector: the connectors file first, then the build. A file that is missing or
/// can't be read counts as empty, so a damaged file never blocks the Settings page.
pub fn load_client(config: &Path, connector: &str) -> Option<Client> {
    let from_file = fs::read_to_string(config)
        .ok()
        .and_then(|text| serde_json::from_str::<ConfigFile>(&text).ok())
        .and_then(|file| {
            file.clients.get(connector).map(|entry| {
                (
                    clean(&entry.client_id),
                    clean(&entry.client_secret),
                    entry.redirect_port,
                )
            })
        });
    if let Some((Some(id), secret, redirect_port)) = from_file {
        return Some(Client {
            id,
            secret: secret.map(Secret::new),
            redirect_port,
        });
    }
    let (id, secret) = built_in(connector);
    Some(Client {
        id: clean(id?)?,
        secret: secret.and_then(clean).map(Secret::new),
        redirect_port: None,
    })
}

/// What a stored credential is: a refresh token to trade for access tokens, or an access token that doesn't expire,
/// such as a pasted personal token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Holds {
    Refresh,
    Access,
}

/// What OpenNote keeps about one connection, outside the credential store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub account: String,
    /// The access the service granted.
    pub scopes: Vec<String>,
    /// When the person connected, in seconds since 1970.
    pub connected_unix: u64,
    pub holds: Holds,
    /// The school's address, for a connector that needs one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// True once the service refused to renew the sign-in. The person connects again to clear it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub expired: bool,
    /// When a feature last used the connection, for the Privacy section.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_unix: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ConnectionsFile {
    #[serde(default)]
    connections: BTreeMap<String, Connection>,
}

/// Reads the connections. A missing or damaged file reads as no connections.
pub fn read_connections(path: &Path) -> BTreeMap<String, Connection> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<ConnectionsFile>(&text).ok())
        .map(|file| file.connections)
        .unwrap_or_default()
}

pub fn write_connections(path: &Path, connections: &BTreeMap<String, Connection>) -> io::Result<()> {
    let file = ConnectionsFile {
        connections: connections.clone(),
    };
    write_json(path, &serde_json::to_value(file).map_err(io::Error::other)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, text: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        fs::write(&path, text).expect("writes");
        path
    }

    #[test]
    fn a_client_comes_from_the_connectors_file() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let path = write(
            dir.path(),
            CONFIG_FILE,
            r#"{"clients":{"google":{"clientId":" example-id ","clientSecret":"example-secret"},
                "dropbox":{"clientId":"d-id","redirectPort":53999}}}"#,
        );
        let google = load_client(&path, "google").expect("has a client");
        assert_eq!(google.id, "example-id");
        assert_eq!(google.secret, Some(Secret::new("example-secret")));
        let dropbox = load_client(&path, "dropbox").expect("has a client");
        assert_eq!((dropbox.secret, dropbox.redirect_port), (None, Some(53999)));
        assert!(load_client(&path, "slack").is_none());
    }

    #[test]
    fn a_missing_empty_or_damaged_file_means_no_client() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        assert!(load_client(&dir.path().join("none.json"), "google").is_none());
        for text in [
            "",
            "not json",
            "[]",
            r#"{"clients":{"google":{"clientId":""}}}"#,
            r#"{"clients":{"google":{"clientId":"a b"}}}"#,
        ] {
            let path = write(dir.path(), "c.json", text);
            assert!(load_client(&path, "google").is_none(), "{text}");
        }
    }

    #[test]
    fn this_build_ships_with_no_client_ids() {
        // CI builds the app without them, and the repository holds none. A build for release sets them itself.
        if std::env::var("OPENNOTE_GOOGLE_CLIENT_ID").is_err() {
            assert!(load_client(Path::new("missing.json"), "google").is_none());
        }
    }

    #[test]
    fn connections_round_trip_and_hold_only_metadata() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let path = dir.path().join(CONNECTIONS_FILE);
        assert!(read_connections(&path).is_empty());
        let mut all = BTreeMap::new();
        all.insert(
            "canvas".to_owned(),
            Connection {
                account: "Sam Student".into(),
                scopes: vec![],
                connected_unix: 1_790_000_000,
                holds: Holds::Access,
                base_url: Some("https://school.example".into()),
                expired: false,
                last_used_unix: None,
            },
        );
        write_connections(&path, &all).expect("writes");
        assert_eq!(read_connections(&path), all);
        let text = fs::read_to_string(&path).expect("reads");
        let value: serde_json::Value = serde_json::from_str(&text).expect("json");
        let keys: Vec<&str> = value["connections"]["canvas"]
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        for key in &keys {
            assert!(
                ["account", "scopes", "connectedUnix", "holds", "baseUrl"].contains(key),
                "unexpected key {key}"
            );
        }
    }

    #[test]
    fn a_damaged_connections_file_reads_as_none() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let path = write(dir.path(), CONNECTIONS_FILE, "{ broken");
        assert!(read_connections(&path).is_empty());
    }
}
