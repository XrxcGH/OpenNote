//! The apps that may use the API, what each may do, and their tokens.
//!
//! Each app gets its own token when the person approves it. The token goes to the app once and is never stored by
//! OpenNote: only its SHA-256 lives in the secret store (Windows Credential Manager, as
//! `OpenNote/api/<app id>`), and a request's token is hashed and compared in constant time. The rest of a grant
//! (name, kind, access, notebooks) is not secret and lives in `api.json` with the settings, so App permissions can
//! list it. Revoking deletes both, so the token stops working at once.
//!
//! A grant starts read-only on the notebooks the person picked, and asks before every change. Locked sections are
//! never in any grant.

use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::webhooks::Webhook;

/// What kind of program a grant is for. It decides only the name and icon App permissions shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppKind {
    /// A script or another app.
    App,
    /// The `opennote` command-line tool.
    Cli,
    /// An AI assistant through the MCP server.
    Assistant,
    /// The browser web clipper.
    Clipper,
    /// The Outlook add-in or the Gmail action.
    Mail,
}

impl AppKind {
    pub fn parse(text: &str) -> Option<AppKind> {
        match text {
            "app" => Some(AppKind::App),
            "cli" => Some(AppKind::Cli),
            "assistant" => Some(AppKind::Assistant),
            "clipper" => Some(AppKind::Clipper),
            "mail" => Some(AppKind::Mail),
            _ => None,
        }
    }
}

/// What a grant may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    /// List and read pages.
    Read,
    /// Read, add pages, and add to pages.
    ReadWrite,
    /// See notebook and section names, to pick where to save, and add new pages. No reading. For the clipper and
    /// the mail add-ins.
    AddPages,
}

impl Access {
    pub fn can_read(self) -> bool {
        matches!(self, Access::Read | Access::ReadWrite)
    }

    pub fn can_add_pages(self) -> bool {
        matches!(self, Access::ReadWrite | Access::AddPages)
    }

    pub fn can_change_pages(self) -> bool {
        matches!(self, Access::ReadWrite)
    }
}

/// Which notebooks a grant covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "ids")]
pub enum Scope {
    All,
    Notebooks(Vec<String>),
}

impl Scope {
    pub fn covers(&self, notebook: &str) -> bool {
        match self {
            Scope::All => true,
            Scope::Notebooks(ids) => ids.iter().any(|id| id == notebook),
        }
    }
}

/// One app's grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppGrant {
    pub id: String,
    pub name: String,
    pub kind: AppKind,
    /// Unix seconds.
    pub created: u64,
    #[serde(default)]
    pub last_used: Option<u64>,
    pub access: Access,
    /// Ask in the app before each change. On for every new grant.
    pub ask_before_writes: bool,
    pub notebooks: Scope,
    /// The web origin a mail add-in was paired from. Requests from any other web origin are refused.
    #[serde(default)]
    pub origin: Option<String>,
}

/// What `api.json` holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiConfig {
    pub version: u32,
    /// "Let apps on this PC connect". Off means no listener, as the flag being off does.
    pub enabled: bool,
    /// The port the listener tries first, so a paired browser extension finds it again after a restart.
    pub port: u16,
    pub apps: Vec<AppGrant>,
    pub webhooks: Vec<Webhook>,
}

impl Default for ApiConfig {
    fn default() -> ApiConfig {
        ApiConfig {
            version: 1,
            enabled: true,
            port: 0,
            apps: Vec::new(),
            webhooks: Vec::new(),
        }
    }
}

/// Where secrets go: Windows Credential Manager in the app, memory in tests.
#[allow(clippy::result_unit_err)] // a store has one failure: the credential vault said no
pub trait SecretStore: Send + Sync {
    fn put(&self, target: &str, secret: &str) -> Result<(), ()>;
    fn get(&self, target: &str) -> Result<Option<String>, ()>;
    fn delete(&self, target: &str) -> Result<(), ()>;
}

/// A secret store in memory.
#[derive(Default)]
pub struct MemorySecrets {
    secrets: Mutex<HashMap<String, String>>,
}

impl MemorySecrets {
    pub fn len(&self) -> usize {
        lock(&self.secrets).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl SecretStore for MemorySecrets {
    fn put(&self, target: &str, secret: &str) -> Result<(), ()> {
        lock(&self.secrets).insert(target.to_owned(), secret.to_owned());
        Ok(())
    }

    fn get(&self, target: &str) -> Result<Option<String>, ()> {
        Ok(lock(&self.secrets).get(target).cloned())
    }

    fn delete(&self, target: &str) -> Result<(), ()> {
        lock(&self.secrets).remove(target);
        Ok(())
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The credential name of an app's token hash.
pub fn token_target(app: &str) -> String {
    format!("OpenNote/api/{app}")
}

/// What every token starts with, so a leaked one is easy to recognize in a log or a paste.
pub const TOKEN_PREFIX: &str = "onapi";

/// `count` random bytes from the operating system.
pub fn random_bytes(count: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; count];
    getrandom::fill(&mut bytes).expect("the operating system's random generator works");
    bytes
}

/// Random lowercase hex.
pub fn random_hex(bytes: usize) -> String {
    random_bytes(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A new token for an app: `onapi_<app id>_<64 hex characters of randomness>`.
fn new_token(app: &str) -> String {
    format!("{TOKEN_PREFIX}_{app}_{}", random_hex(32))
}

fn hash_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Compares two strings in time that doesn't depend on where they differ.
pub fn same(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

/// The app ID inside a token, when the token has the right shape.
fn app_of(token: &str) -> Option<&str> {
    let rest = token.strip_prefix(TOKEN_PREFIX)?.strip_prefix('_')?;
    let (app, secret) = rest.split_once('_')?;
    let shaped = app.len() == 16
        && app.bytes().all(|b| b.is_ascii_hexdigit())
        && secret.len() == 64
        && secret.bytes().all(|b| b.is_ascii_hexdigit());
    shaped.then_some(app)
}

/// `api.json`, written whole through a temporary file.
pub struct ConfigFile {
    path: Option<PathBuf>,
}

impl ConfigFile {
    pub fn at(path: &Path) -> ConfigFile {
        ConfigFile {
            path: Some(path.to_path_buf()),
        }
    }

    /// A file that is never written, for tests.
    pub fn memory() -> ConfigFile {
        ConfigFile { path: None }
    }

    pub fn load(&self) -> ApiConfig {
        let Some(path) = &self.path else {
            return ApiConfig::default();
        };
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                log::warn!("api.json can't be read, so app permissions start empty: {error}");
                ApiConfig::default()
            }),
            Err(_) => ApiConfig::default(),
        }
    }

    pub fn save(&self, config: &ApiConfig) -> io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder)?;
        }
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, serde_json::to_vec_pretty(config).map_err(io::Error::other)?)?;
        fs::rename(&temp, path)
    }
}

/// The grants, their tokens' hashes, and the rest of `api.json`.
pub struct Grants {
    config: Mutex<ApiConfig>,
    file: ConfigFile,
    secrets: Arc<dyn SecretStore>,
    /// Token hashes by app, read from the secret store once.
    hashes: Mutex<HashMap<String, String>>,
}

/// What a new grant gets.
#[derive(Debug, Clone)]
pub struct NewGrant {
    pub name: String,
    pub kind: AppKind,
    pub access: Access,
    pub notebooks: Scope,
    pub ask_before_writes: bool,
    pub origin: Option<String>,
}

impl Grants {
    pub fn new(file: ConfigFile, secrets: Arc<dyn SecretStore>) -> Grants {
        let config = file.load();
        Grants {
            config: Mutex::new(config),
            file,
            secrets,
            hashes: Mutex::default(),
        }
    }

    /// A copy of `api.json` as it is now.
    pub fn config(&self) -> ApiConfig {
        lock(&self.config).clone()
    }

    /// Changes `api.json` and saves it.
    pub fn change<T>(&self, change: impl FnOnce(&mut ApiConfig) -> T) -> io::Result<T> {
        let mut config = lock(&self.config);
        let answer = change(&mut config);
        self.file.save(&config)?;
        Ok(answer)
    }

    pub fn apps(&self) -> Vec<AppGrant> {
        lock(&self.config).apps.clone()
    }

    pub fn app(&self, id: &str) -> Option<AppGrant> {
        lock(&self.config).apps.iter().find(|app| app.id == id).cloned()
    }

    /// Makes a grant and its token. The token is returned once and kept nowhere.
    pub fn issue(&self, grant: NewGrant, now: u64) -> io::Result<(AppGrant, String)> {
        let id = random_hex(8);
        let token = new_token(&id);
        let hash = hash_hex(&token);
        self.secrets
            .put(&token_target(&id), &hash)
            .map_err(|()| io::Error::other("the credential store refused the token"))?;
        let app = AppGrant {
            id: id.clone(),
            name: clean_name(&grant.name),
            kind: grant.kind,
            created: now,
            last_used: None,
            access: grant.access,
            ask_before_writes: grant.ask_before_writes,
            notebooks: grant.notebooks,
            origin: grant.origin,
        };
        lock(&self.hashes).insert(id, hash);
        self.change(|config| config.apps.push(app.clone()))?;
        Ok((app, token))
    }

    /// The grant a token belongs to, or `None` for a token that is malformed, unknown, or revoked.
    pub fn authenticate(&self, token: &str) -> Option<AppGrant> {
        let app = app_of(token.trim())?;
        let grant = self.app(app)?;
        let stored = {
            let mut hashes = lock(&self.hashes);
            match hashes.get(app) {
                Some(hash) => hash.clone(),
                None => {
                    let hash = self.secrets.get(&token_target(app)).ok()??;
                    hashes.insert(app.to_owned(), hash.clone());
                    hash
                }
            }
        };
        same(&hash_hex(token.trim()), &stored).then_some(grant)
    }

    /// Removes a grant and its token hash. Returns whether there was one.
    pub fn revoke(&self, id: &str) -> io::Result<bool> {
        lock(&self.hashes).remove(id);
        let _ = self.secrets.delete(&token_target(id));
        self.change(|config| {
            let before = config.apps.len();
            config.apps.retain(|app| app.id != id);
            before != config.apps.len()
        })
    }

    /// Changes what a grant may do.
    pub fn update(&self, id: &str, access: Access, notebooks: Scope, ask_before_writes: bool) -> io::Result<bool> {
        self.change(|config| match config.apps.iter_mut().find(|app| app.id == id) {
            Some(app) => {
                app.access = access;
                app.notebooks = notebooks;
                app.ask_before_writes = ask_before_writes;
                true
            }
            None => false,
        })
    }

    /// Notes when an app last used its grant. Saved at most once a minute per app.
    pub fn touch(&self, id: &str, now: u64) {
        let stale = lock(&self.config)
            .apps
            .iter()
            .any(|app| app.id == id && app.last_used.is_none_or(|last| now >= last + 60));
        if stale {
            let _ = self.change(|config| {
                if let Some(app) = config.apps.iter_mut().find(|app| app.id == id) {
                    app.last_used = Some(now);
                }
            });
        }
    }
}

/// An app's name as App permissions shows it: one line, at most 60 characters, never empty.
pub fn clean_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control())
        .take(60)
        .collect::<String>()
        .trim()
        .to_owned();
    if name.is_empty() {
        "An app".to_owned()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants() -> (Grants, Arc<MemorySecrets>) {
        let secrets = Arc::new(MemorySecrets::default());
        (Grants::new(ConfigFile::memory(), secrets.clone()), secrets)
    }

    fn new(name: &str) -> NewGrant {
        NewGrant {
            name: name.into(),
            kind: AppKind::Cli,
            access: Access::Read,
            notebooks: Scope::Notebooks(vec!["nb1".into()]),
            ask_before_writes: true,
            origin: None,
        }
    }

    #[test]
    fn a_token_works_until_it_is_revoked_and_only_its_hash_is_kept() {
        let (grants, secrets) = grants();
        let (app, token) = grants.issue(new("opennote"), 10).expect("issued");
        assert!(token.starts_with("onapi_"));
        assert_eq!(grants.authenticate(&token).map(|grant| grant.id), Some(app.id.clone()));
        let stored = secrets.get(&token_target(&app.id)).expect("store").expect("a hash");
        assert_ne!(stored, token);
        assert_eq!(stored.len(), 64);
        assert!(!serde_json::to_string(&grants.config()).expect("json").contains(&token));

        assert!(grants.revoke(&app.id).expect("revoked"));
        assert_eq!(grants.authenticate(&token), None);
        assert!(secrets.is_empty());
    }

    #[test]
    fn refuses_tokens_that_are_wrong_in_any_way() {
        let (grants, _) = grants();
        let (app, token) = grants.issue(new("opennote"), 10).expect("issued");
        let mut flipped = token.clone().into_bytes();
        let last = flipped.len() - 1;
        flipped[last] = if flipped[last] == b'0' { b'1' } else { b'0' };
        let other = format!("{TOKEN_PREFIX}_{}_{}", random_hex(8), random_hex(32));
        for bad in [
            String::new(),
            "Bearer x".into(),
            String::from_utf8(flipped).expect("ascii"),
            other,
            format!("{TOKEN_PREFIX}_{}_short", app.id),
        ] {
            assert_eq!(grants.authenticate(&bad), None, "{bad}");
        }
    }

    #[test]
    fn a_token_is_read_back_from_the_store_after_a_restart() {
        let dir = tempfile::tempdir().expect("a folder");
        let secrets: Arc<dyn SecretStore> = Arc::new(MemorySecrets::default());
        let file = dir.path().join("api.json");
        let (_, token) = Grants::new(ConfigFile::at(&file), secrets.clone())
            .issue(new("opennote"), 10)
            .expect("issued");
        let again = Grants::new(ConfigFile::at(&file), secrets);
        assert_eq!(again.authenticate(&token).map(|app| app.name), Some("opennote".into()));
    }

    #[test]
    fn scopes_and_access_mean_what_they_say() {
        assert!(Scope::All.covers("x"));
        assert!(!Scope::Notebooks(vec!["a".into()]).covers("b"));
        assert!(Access::Read.can_read() && !Access::Read.can_add_pages());
        assert!(Access::AddPages.can_add_pages() && !Access::AddPages.can_read());
        assert!(!Access::AddPages.can_change_pages());
        assert!(Access::ReadWrite.can_change_pages());
        assert_eq!(clean_name("  \u{7}Zapier\n "), "Zapier");
        assert_eq!(clean_name(""), "An app");
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }
}
