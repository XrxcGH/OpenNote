//! The connectors service: the registry, the connections file, the credential store, and the sign-ins in progress.
//! The pieces that touch the outside (the network, the browser, the clock, Work offline) are passed in, so the tests
//! run the whole sign-in against a mock server and a fake browser.
//!
//! `connect.rs` signs in, and `session.rs` renews, uses, and ends a connection. Features of OpenNote call
//! [`Connectors::is_connected`], [`Connectors::access_token`], and [`Connectors::request`].

use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex, MutexGuard, PoisonError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use super::{
    error::{ConnectorError, Failure, Result},
    files::{self, Connection},
    http::{HostPolicy, Http, UreqHttp},
    loopback,
    registry::{self, Auth, ConnectorDef},
    secret::Secret,
    store::{platform_store, SecretStore},
    view::{view_of, ConnectorView},
};
use crate::paths::Paths;

/// Opens the sign-in address in the person's default browser. Never an embedded web view (RFC 8252 section 8.12).
pub trait Opener: Send + Sync {
    fn open(&self, url: &str) -> bool;
}

struct DefaultBrowser;

impl Opener for DefaultBrowser {
    fn open(&self, url: &str) -> bool {
        crate::shell::open(url).is_ok()
    }
}

/// An access token kept in memory until it nears its end. It is never written anywhere.
pub(super) struct Cached {
    pub token: Secret,
    pub expires_unix: Option<u64>,
}

#[derive(Default)]
pub(super) struct State {
    pub connections: BTreeMap<String, Connection>,
    pub access: HashMap<String, Cached>,
    /// The cancel flag of each sign-in that is waiting for the browser.
    pub pending: HashMap<String, Arc<AtomicBool>>,
}

pub(super) struct Inner {
    pub config_file: PathBuf,
    pub connections_file: PathBuf,
    pub registry: &'static [ConnectorDef],
    pub store: Arc<dyn SecretStore>,
    pub http: Arc<dyn Http>,
    pub opener: Arc<dyn Opener>,
    pub offline: Arc<dyn Fn() -> bool + Send + Sync>,
    pub now: Arc<dyn Fn() -> u64 + Send + Sync>,
    pub wait: Duration,
    pub state: Mutex<State>,
    /// One refresh at a time, so two features asking together don't both spend a rotating refresh token.
    pub refreshing: Mutex<()>,
}

/// Everything a [`Connectors`] needs from outside. `Parts::real` is what the app uses.
pub struct Parts {
    pub config_file: PathBuf,
    pub connections_file: PathBuf,
    pub registry: &'static [ConnectorDef],
    pub store: Arc<dyn SecretStore>,
    pub http: Arc<dyn Http>,
    pub opener: Arc<dyn Opener>,
    pub offline: Arc<dyn Fn() -> bool + Send + Sync>,
    pub now: Arc<dyn Fn() -> u64 + Send + Sync>,
    pub wait: Duration,
}

impl Parts {
    pub fn real(paths: &Paths) -> Parts {
        Parts {
            config_file: paths.local.join(files::CONFIG_FILE),
            connections_file: paths.local.join(files::CONNECTIONS_FILE),
            registry: registry::CONNECTORS,
            store: platform_store(),
            http: Arc::new(UreqHttp::default()),
            opener: Arc::new(DefaultBrowser),
            offline: Arc::new(crate::hardening::offline),
            now: Arc::new(unix_now),
            wait: loopback::WAIT,
        }
    }
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// The app's connectors. Cheap to clone: the copies share one state.
#[derive(Clone)]
pub struct Connectors(pub(super) Arc<Inner>);

impl Connectors {
    pub fn new(paths: &Paths) -> Connectors {
        Connectors::with(Parts::real(paths))
    }

    pub fn with(parts: Parts) -> Connectors {
        let connections = files::read_connections(&parts.connections_file);
        Connectors(Arc::new(Inner {
            config_file: parts.config_file,
            connections_file: parts.connections_file,
            registry: parts.registry,
            store: parts.store,
            http: parts.http,
            opener: parts.opener,
            offline: parts.offline,
            now: parts.now,
            wait: parts.wait,
            state: Mutex::new(State {
                connections,
                ..State::default()
            }),
            refreshing: Mutex::default(),
        }))
    }

    pub(super) fn lock(&self) -> MutexGuard<'_, State> {
        self.0.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn now(&self) -> u64 {
        (self.0.now)()
    }

    pub(super) fn offline(&self) -> bool {
        (self.0.offline)()
    }

    pub(super) fn def(&self, id: &str) -> Result<&'static ConnectorDef> {
        self.0
            .registry
            .iter()
            .find(|def| def.id == id)
            .ok_or_else(|| ConnectorError::new(Failure::Unknown, id))
    }

    /// Writes the connections file from the state that is passed in.
    pub(super) fn save(&self, state: &State, id: &str) -> Result<()> {
        files::write_connections(&self.0.connections_file, &state.connections).map_err(|error| {
            ::log::warn!("Couldn't save the connections file: {error}");
            ConnectorError::new(Failure::Storage, id)
        })
    }

    /// The hosts the connector may use: its own, and the host of the school address it was connected with.
    pub(super) fn policy(&self, def: &ConnectorDef, base_url: Option<&str>) -> HostPolicy {
        let school = base_url
            .and_then(|base| url::Url::parse(base).ok())
            .and_then(|base| base.host_str().map(str::to_owned));
        HostPolicy::new(def.hosts.iter().map(|host| (*host).to_owned()).chain(school))
    }

    pub fn list(&self) -> Vec<ConnectorView> {
        let state = self.lock();
        self.0
            .registry
            .iter()
            .map(|def| {
                let connection = state.connections.get(def.id);
                let pending = state.pending.contains_key(def.id);
                view_of(def, connection, self.needs_setup(def), pending)
            })
            .collect()
    }

    pub fn view(&self, id: &str) -> Result<ConnectorView> {
        let def = self.def(id)?;
        let state = self.lock();
        Ok(view_of(
            def,
            state.connections.get(id),
            self.needs_setup(def),
            state.pending.contains_key(id),
        ))
    }

    /// An OAuth connector with no usable app registration.
    pub(super) fn needs_setup(&self, def: &ConnectorDef) -> bool {
        let Auth::OAuth(oauth) = def.auth else { return false };
        match files::load_client(&self.0.config_file, def.id) {
            None => true,
            Some(client) => oauth.secret == registry::SecretUse::Required && client.secret.is_none(),
        }
    }

    /// Whether the person has connected it and the sign-in still works. A feature checks this before it offers
    /// anything that needs the account.
    pub fn is_connected(&self, id: &str) -> bool {
        self.lock()
            .connections
            .get(id)
            .is_some_and(|connection| !connection.expired)
    }

    /// Stops a sign-in that is waiting for the browser.
    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.lock().pending.get(id) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
}
