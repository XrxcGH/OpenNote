//! Optional end-to-end-encrypted sync (ADR 0049) in the shell: the setup and join flows, the background rounds,
//! and the status the title bar shows. The engine is `opennote-sync`; this module only decides when it runs and
//! keeps its secrets.
//!
//! Nothing runs until the person sets sync up. The device's own secret, and a WebDAV password, live in Windows
//! Credential Manager (`OpenNote/sync/device` and `OpenNote/sync/webdav`), never in a file, a log, or the
//! interface. The passphrase, the recovery key, and a pairing code are taken out of the call's arguments into
//! `Zeroizing` buffers before anything else runs, used once, and never kept. A new vault's recovery key is not in
//! the setup reply: the interface asks for it once, with `recoveryKey`, and the reply's buffer is cleared after it
//! is serialized. Work offline and Pause stop every round. The interface calls one command, `sync_call`, with an
//! operation name.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opennote_sync::vault::{self, DeviceSecret};
use opennote_sync::{Backend, Engine, FolderBackend, SyncError, WebDavBackend, WebDavConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::connectors::{platform_store, Secret, SecretStore};
use crate::ipc::{codes, IpcError, IpcResult};
use crate::paths::Paths;

const DEVICE_SECRET: &str = "OpenNote/sync/device";
const WEBDAV_PASSWORD: &str = "OpenNote/sync/webdav";
/// How often a round runs in the background.
const EVERY: Duration = Duration::from_secs(5 * 60);
/// How long after start the first background round waits, so start-up stays quick.
const FIRST: Duration = Duration::from_secs(45);
/// How often a finished round also cleans up storage: once a day.
const COLLECT_EVERY_MS: i64 = 24 * 60 * 60 * 1000;

/// Where sync keeps its data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BackendConfig {
    /// A folder: a USB drive, a network share, or a folder a sync tool already syncs.
    Folder { path: String },
    /// A WebDAV server. The password is in the credential store.
    Webdav { url: String, username: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    backend: BackendConfig,
    device: String,
    device_name: String,
    paused: bool,
    fingerprint: String,
    /// Set up here, and the recovery key not checked yet: sync waits, paused, until it is (`finishSetUp`), and
    /// `cancelSetUp` takes the new vault away again.
    #[serde(default)]
    unfinished: bool,
}

/// What the title bar and Settings show.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `off`, `synced`, `syncing`, `paused`, `offline`, `waiting`, or `error`.
    pub state: &'static str,
    /// When the last round finished, in Unix milliseconds.
    pub last_sync: Option<i64>,
    /// The error code of the last round, such as `tampered`.
    pub error_code: Option<&'static str>,
    /// What happened and what to do, for the person.
    pub error: Option<String>,
    /// How many conflicts the last round kept side by side.
    pub conflicts: usize,
}

struct Inner {
    dir: PathBuf,
    secrets: Arc<dyn SecretStore>,
    running: Mutex<()>,
    status: Mutex<Status>,
    app: Mutex<Option<AppHandle>>,
    started: AtomicBool,
    /// When a round last ran garbage collection, in Unix milliseconds.
    collected: Mutex<i64>,
    /// A new vault's recovery key, until the interface takes it once.
    recovery: Mutex<Option<Zeroizing<String>>>,
}

/// The shell's sync state.
#[derive(Clone)]
pub struct SyncService {
    inner: Arc<Inner>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fail(error: SyncError) -> IpcError {
    IpcError::new(error.code(), error.to_string())
}

fn bad(message: &str) -> IpcError {
    IpcError::new(codes::INVALID, message)
}

fn arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Moves a secret out of the call's arguments into a buffer that is cleared when dropped, so no copy stays in the
/// `Value`. A missing or non-text field is empty.
fn take_secret(args: &mut Value, key: &str) -> Zeroizing<String> {
    match args.get_mut(key).map(Value::take) {
        Some(Value::String(text)) => Zeroizing::new(text),
        _ => Zeroizing::new(String::new()),
    }
}

/// A secret for the interface, cleared once the reply is serialized and dropped.
pub struct SecretText(Zeroizing<String>);

impl Serialize for SecretText {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// What `sync_call` returns: a view or result, or the one-time recovery key.
#[derive(Serialize)]
#[serde(untagged)]
pub enum Reply {
    Value(Value),
    Secret(SecretText),
}

impl SyncService {
    /// The service for this profile. Nothing is read until the first call.
    pub fn new(paths: &Paths) -> SyncService {
        SyncService::with_store(paths.local.join("sync"), platform_store())
    }

    fn with_store(dir: PathBuf, secrets: Arc<dyn SecretStore>) -> SyncService {
        SyncService {
            inner: Arc::new(Inner {
                dir,
                secrets,
                running: Mutex::new(()),
                status: Mutex::new(Status {
                    state: "off",
                    ..Status::default()
                }),
                app: Mutex::new(None),
                started: AtomicBool::new(false),
                collected: Mutex::new(0),
                recovery: Mutex::new(None),
            }),
        }
    }

    fn config_path(&self) -> PathBuf {
        self.inner.dir.join("config.json")
    }

    fn state_path(&self) -> PathBuf {
        self.inner.dir.join("state.json")
    }

    fn config(&self) -> Option<Config> {
        serde_json::from_slice(&fs::read(self.config_path()).ok()?).ok()
    }

    fn save_config(&self, config: &Config) -> IpcResult<()> {
        fs::create_dir_all(&self.inner.dir).map_err(|_| bad("The sync settings couldn't be saved."))?;
        let bytes = serde_json::to_vec_pretty(config).map_err(|_| bad("The sync settings couldn't be saved."))?;
        opennote_sync::local::write_atomic(&self.config_path(), &bytes).map_err(fail)
    }

    fn set_status(&self, change: impl FnOnce(&mut Status)) {
        change(&mut self.inner.status.lock().unwrap_or_else(PoisonError::into_inner));
    }

    fn status(&self) -> Status {
        let mut status = self.inner.status.lock().unwrap_or_else(PoisonError::into_inner).clone();
        match self.config() {
            None => status.state = "off",
            Some(config) if config.paused => status.state = "paused",
            Some(_) if crate::hardening::offline() && status.state != "syncing" => status.state = "offline",
            Some(_) if status.state == "off" || status.state == "paused" || status.state == "offline" => {
                status.state = if status.last_sync.is_some() {
                    "synced"
                } else {
                    "waiting"
                };
            }
            Some(_) => {}
        }
        status
    }

    fn view(&self) -> Value {
        let config = self.config();
        json!({
            "configured": config.is_some(),
            "status": self.status(),
            "backend": config.as_ref().map(|c| &c.backend),
            "deviceName": config.as_ref().map(|c| c.device_name.clone()),
            "fingerprint": config.as_ref().map(|c| c.fingerprint.clone()),
            "unfinished": config.as_ref().is_some_and(|c| c.unfinished),
        })
    }

    fn open_backend(
        &self,
        backend: &BackendConfig,
        password: Option<Zeroizing<String>>,
    ) -> IpcResult<Arc<dyn Backend>> {
        match backend {
            BackendConfig::Folder { path } => {
                if path.trim().is_empty() {
                    return Err(bad("Choose a folder for sync."));
                }
                Ok(Arc::new(FolderBackend::new(PathBuf::from(path)).map_err(fail)?))
            }
            BackendConfig::Webdav { url, username } => {
                if crate::hardening::offline() {
                    return Err(fail(SyncError::Storage("Work offline is on".into())));
                }
                let password = match password {
                    Some(password) => password,
                    None => Zeroizing::new(
                        self.inner
                            .secrets
                            .get(WEBDAV_PASSWORD)
                            .ok()
                            .flatten()
                            .map(|s| s.expose().to_owned())
                            .unwrap_or_default(),
                    ),
                };
                let config = WebDavConfig {
                    url: url.clone(),
                    username: username.clone(),
                    password,
                };
                Ok(Arc::new(WebDavBackend::new(&config).map_err(fail)?))
            }
        }
    }

    fn device_secret(&self) -> IpcResult<DeviceSecret> {
        let secret = self
            .inner
            .secrets
            .get(DEVICE_SECRET)
            .ok()
            .flatten()
            .ok_or_else(|| fail(SyncError::Removed))?;
        let bytes = unhex(secret.expose()).ok_or_else(|| fail(SyncError::Removed))?;
        Ok(DeviceSecret(Zeroizing::new(bytes)))
    }

    fn engine(&self, notes: &Path) -> IpcResult<Engine> {
        let config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
        let backend = self.open_backend(&config.backend, None)?;
        let keys = vault::unlock_device(backend.as_ref(), &config.device, &self.device_secret()?).map_err(fail)?;
        Ok(Engine::new(notes, backend, keys, config.device, self.state_path()))
    }

    /// Sets up a new sync, or joins one, and saves this device's slot and settings.
    fn begin(&self, args: &mut Value, create: bool) -> IpcResult<Value> {
        let password = take_secret(args, "password");
        let passphrase = take_secret(args, "passphrase");
        let code = take_secret(args, "code");
        let recovery_key = take_secret(args, "recoveryKey");
        if self.config().is_some() {
            return Err(bad(
                "Sync is already set up on this device. Turn it off first to choose another place.",
            ));
        }
        let backend: BackendConfig = serde_json::from_value(args.get("backend").cloned().unwrap_or(Value::Null))
            .map_err(|_| bad("Choose where to sync."))?;
        let store = self.open_backend(&backend, Some(password.clone()))?;
        let mut recovery = None;
        let keys = if create {
            let (keys, key) = vault::create(store.as_ref(), &passphrase).map_err(fail)?;
            recovery = Some(Zeroizing::new(key.text().to_owned()));
            keys
        } else if !code.is_empty() {
            vault::join_with_code(store.as_ref(), &code, now_ms()).map_err(fail)?
        } else if !recovery_key.is_empty() {
            vault::unlock_recovery(store.as_ref(), &recovery_key).map_err(fail)?
        } else {
            vault::unlock_passphrase(store.as_ref(), &passphrase).map_err(fail)?
        };
        let (tag, secret) = vault::new_device().map_err(fail)?;
        let name = arg(args, "deviceName").trim();
        let name = if name.is_empty() { "This PC" } else { name };
        vault::add_device(store.as_ref(), &keys, &tag, &secret, name, now_ms()).map_err(fail)?;
        let stored = self.inner.secrets.put(
            DEVICE_SECRET,
            &Secret::new(opennote_sync::crypto::hex(secret.0.as_ref())),
        );
        if stored.is_err() {
            let _ = vault::remove_device(store.as_ref(), &keys, &tag, now_ms());
            return Err(bad(
                "Windows Credential Manager didn't keep this device's key, so sync wasn't set up.",
            ));
        }
        if matches!(backend, BackendConfig::Webdav { .. })
            && self
                .inner
                .secrets
                .put(WEBDAV_PASSWORD, &Secret::new(password.as_str()))
                .is_err()
        {
            return Err(bad(
                "Windows Credential Manager didn't keep the server password, so sync wasn't set up.",
            ));
        }
        let _ = fs::remove_file(self.state_path());
        self.save_config(&Config {
            backend,
            device: tag,
            device_name: name.to_owned(),
            paused: create,
            fingerprint: keys.fingerprint(),
            unfinished: create,
        })?;
        self.set_status(|s| {
            *s = Status {
                state: "waiting",
                ..Status::default()
            }
        });
        *self.inner.recovery.lock().unwrap_or_else(PoisonError::into_inner) = recovery;
        Ok(self.view())
    }

    /// The new vault's recovery key, once: a second call, or one after setup ended, is refused.
    fn take_recovery(&self) -> IpcResult<SecretText> {
        let key = self
            .inner
            .recovery
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        key.map(SecretText)
            .ok_or_else(|| bad("The recovery key was already shown. To see a new one, set sync up again."))
    }

    /// One round, unless one is running, sync is paused, or Work offline is on.
    fn round(&self, notes: Option<PathBuf>, preview: bool) -> IpcResult<Value> {
        let config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
        if config.paused {
            return Err(IpcError::new("paused", "Sync is paused. Choose Resume to sync again."));
        }
        if crate::hardening::offline() {
            return Err(IpcError::new(
                "offline",
                "Work offline is on, so sync waits. Turn it off to sync.",
            ));
        }
        let notes = notes.ok_or_else(|| bad("Choose a notes folder in setup first."))?;
        let _guard = self.inner.running.lock().unwrap_or_else(PoisonError::into_inner);
        if !preview {
            self.set_status(|s| s.state = "syncing");
        }
        let result = self.engine(&notes).and_then(|engine| {
            if preview {
                engine
                    .plan()
                    .map(|plan| json!({ "summary": plan.summary }))
                    .map_err(fail)
            } else {
                let report = engine.sync().map_err(fail)?;
                self.collect_daily(&engine);
                Ok(json!({ "summary": report.summary, "deferred": report.deferred }))
            }
        });
        if !preview {
            match &result {
                Ok(value) => self.set_status(|s| {
                    let conflicts = value["summary"]["conflicts"].as_array().map(Vec::len).unwrap_or(0);
                    *s = Status {
                        state: "synced",
                        last_sync: Some(now_ms()),
                        conflicts,
                        ..Status::default()
                    };
                }),
                Err(error) => {
                    let code = known_code(&error.code);
                    self.set_status(|s| {
                        s.state = if code == Some("incomplete") { "waiting" } else { "error" };
                        s.error_code = code;
                        s.error = Some(error.message.clone());
                    });
                }
            }
        }
        result.map(|mut value| {
            value["view"] = self.view();
            value
        })
    }

    /// Removes chunks nothing uses any more, at most once a day and only after a round that finished: otherwise
    /// storage keeps every old chunk of every edited file. The engine waits out its own grace period.
    fn collect_daily(&self, engine: &Engine) {
        let now = now_ms();
        {
            let mut last = self.inner.collected.lock().unwrap_or_else(PoisonError::into_inner);
            if now - *last < COLLECT_EVERY_MS {
                return;
            }
            *last = now;
        }
        match engine.collect_garbage(now) {
            Ok(removed) => ::log::info!("Sync cleanup removed {removed} unused pieces from storage."),
            Err(error) => ::log::info!("Sync cleanup stopped: {}", error.code()),
        }
    }

    /// A new passphrase, checked against the recovery key so a typo can't leave the vault without one. The other
    /// devices keep syncing with their own keys; a device that joins later uses the new passphrase.
    fn change_passphrase(&self, args: &mut Value) -> IpcResult<Value> {
        let recovery_key = take_secret(args, "recoveryKey");
        let passphrase = take_secret(args, "passphrase");
        let config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
        let backend = self.open_backend(&config.backend, None)?;
        let store = backend.as_ref();
        let keys = vault::unlock_device(store, &config.device, &self.device_secret()?).map_err(fail)?;
        vault::change_passphrase(store, &keys, &recovery_key, &passphrase).map_err(fail)?;
        Ok(self.view())
    }

    fn call(&self, notes: Option<PathBuf>, name: &str, args: &mut Value) -> IpcResult<Value> {
        match name {
            "status" => Ok(self.view()),
            "setUp" => self.begin(args, true),
            "join" => self.begin(args, false),
            "syncNow" => self.round(notes, false),
            "preview" => self.round(notes, true),
            "setPaused" => {
                let mut config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
                config.paused = args.get("paused").and_then(Value::as_bool).unwrap_or(false);
                self.save_config(&config)?;
                Ok(self.view())
            }
            "devices" | "removeDevice" | "pairingCode" => self.devices_call(name, args),
            "changePassphrase" => {
                let _guard = self.inner.running.lock().unwrap_or_else(PoisonError::into_inner);
                self.change_passphrase(args)
            }
            "trustStorage" => {
                let notes = notes.ok_or_else(|| bad("Choose a notes folder in setup first."))?;
                let _guard = self.inner.running.lock().unwrap_or_else(PoisonError::into_inner);
                self.engine(&notes)?.trust_storage().map_err(fail)?;
                self.set_status(|s| {
                    *s = Status {
                        state: "waiting",
                        ..Status::default()
                    }
                });
                Ok(self.view())
            }
            "turnOff" => {
                let _guard = self.inner.running.lock().unwrap_or_else(PoisonError::into_inner);
                // Best effort: take this device's slot out of the vault, so the other devices stop waiting for its
                // heads before they clean up. Storage that can't be reached now doesn't stop turning off; the
                // device then stays in the list, where another device can remove it.
                if let Err(error) = self.remove_own_slot(false) {
                    ::log::info!("Turning off sync left this device's slot: {}", error.code);
                }
                Ok(self.forget_here())
            }
            "finishSetUp" => {
                self.inner
                    .recovery
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .take();
                let mut config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
                config.unfinished = false;
                config.paused = false;
                self.save_config(&config)?;
                Ok(self.view())
            }
            "cancelSetUp" => {
                let _guard = self.inner.running.lock().unwrap_or_else(PoisonError::into_inner);
                if !self.config().is_some_and(|c| c.unfinished) {
                    return Err(bad("Setup is already finished. To stop syncing, choose Turn off sync."));
                }
                if let Err(error) = self.remove_own_slot(true) {
                    ::log::info!("Canceling setup left the vault: {}", error.code);
                }
                Ok(self.forget_here())
            }
            _ => Err(bad("That sync operation isn't known.")),
        }
    }

    /// Takes this device's slot out of the vault. With `whole`, a vault that nothing else uses yet (no other
    /// device and no head, as right after setting up here) goes too, so setting up again starts clean.
    fn remove_own_slot(&self, whole: bool) -> IpcResult<()> {
        let config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
        let backend = self.open_backend(&config.backend, None)?;
        let store = backend.as_ref();
        let keys = vault::unlock_device(store, &config.device, &self.device_secret()?).map_err(fail)?;
        if whole {
            let others = vault::list_devices(store, &keys)
                .map_err(fail)?
                .iter()
                .any(|d| d.tag != config.device);
            let heads = !store.list("h/").map_err(fail)?.is_empty();
            if !others && !heads {
                store.delete(&format!("k/{}", config.device)).map_err(fail)?;
                return store.delete("vault").map_err(fail);
            }
        }
        vault::remove_device(store, &keys, &config.device, now_ms()).map_err(fail)
    }

    /// Forgets sync on this device: its key, the server password, the settings, and the state. Notes stay.
    fn forget_here(&self) -> Value {
        self.inner
            .recovery
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        let _ = self.inner.secrets.delete(DEVICE_SECRET);
        let _ = self.inner.secrets.delete(WEBDAV_PASSWORD);
        let _ = fs::remove_file(self.config_path());
        let _ = fs::remove_file(self.state_path());
        self.set_status(|s| {
            *s = Status {
                state: "off",
                ..Status::default()
            }
        });
        self.view()
    }

    /// The device list, removing a device, and a pairing code: each unlocks with this device's own slot.
    fn devices_call(&self, name: &str, args: &Value) -> IpcResult<Value> {
        let config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
        let backend = self.open_backend(&config.backend, None)?;
        let store = backend.as_ref();
        let keys = vault::unlock_device(store, &config.device, &self.device_secret()?).map_err(fail)?;
        match name {
            "devices" => {
                // When each device last synced, so a device that stopped (a lost laptop, a dead disk) shows, and
                // can be removed: until it is, the others keep every chunk it might still need.
                let last = opennote_sync::last_published(store, &keys).unwrap_or_default();
                let rows: Vec<Value> = vault::list_devices(store, &keys)
                    .map_err(fail)?
                    .into_iter()
                    .map(|d| {
                        let this = d.tag == config.device;
                        let synced = last.get(&d.tag).copied().filter(|at| *at > 0);
                        json!({ "tag": d.tag, "name": d.name, "added": d.added, "lastSync": synced, "thisDevice": this })
                    })
                    .collect();
                Ok(Value::Array(rows))
            }
            "removeDevice" => {
                let tag = arg(args, "tag");
                if tag == config.device {
                    return Err(bad("To stop syncing this device, choose Turn off sync instead."));
                }
                vault::remove_device(store, &keys, tag, now_ms()).map_err(fail)?;
                Ok(self.view())
            }
            _ => {
                let code = vault::create_pairing(store, &keys, now_ms()).map_err(fail)?;
                let expires = now_ms() + vault::PAIRING_MS;
                Ok(json!({ "code": code.text(), "rows": code.qr_rows(), "expires": expires }))
            }
        }
    }

    fn notes(&self) -> Option<PathBuf> {
        let app = self.inner.app.lock().unwrap_or_else(PoisonError::into_inner).clone()?;
        crate::core_bridge::notes_folder(&app)
    }
}

/// The error codes of `opennote-sync`, as static strings for the status.
fn known_code(code: &str) -> Option<&'static str> {
    [
        "wrongSecret",
        "noVault",
        "vaultExists",
        "tampered",
        "rollback",
        "incomplete",
        "removed",
        "pairingExpired",
        "storage",
        "local",
        "weakPassphrase",
        "newer",
        "interrupted",
        "paused",
        "offline",
    ]
    .into_iter()
    .find(|known| *known == code)
}

fn unhex(text: &str) -> Option<[u8; 32]> {
    if text.len() != 64 {
        return None;
    }
    let bytes: Option<Vec<u8>> = (0..32)
        .map(|i| u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok())
        .collect();
    let bytes = zeroize::Zeroizing::new(bytes?);
    <[u8; 32]>::try_from(bytes.as_slice()).ok()
}

/// Registers the service and starts the background rounds. They run only while the `sync.e2ee` flag is on, sync is
/// set up and not paused, and Work offline is off.
pub fn start(app: &AppHandle) {
    if app.try_state::<SyncService>().is_none() {
        app.manage(SyncService::new(&app.state::<Paths>()));
    }
    let service = app.state::<SyncService>().inner().clone();
    *service.inner.app.lock().unwrap_or_else(PoisonError::into_inner) = Some(app.clone());
    if service.inner.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("opennote-sync".into()).spawn(move || {
        std::thread::sleep(FIRST);
        loop {
            if crate::hardening::safe_mode() {
                return;
            }
            // A build with the flag off (Stable) shows no Sync page, so a sync set up in a Beta build waits too.
            let enabled = crate::platform_flags::is_on_for(&app, crate::platform_flags::SYNC_E2EE);
            if enabled && service.config().is_some_and(|c| !c.paused) && !crate::hardening::offline() {
                let notes = service.notes();
                if let Err(error) = service.round(notes, false) {
                    ::log::info!("A background sync round stopped: {}", error.code);
                }
            }
            std::thread::sleep(EVERY);
        }
    });
}

/// The interface's one sync command.
#[tauri::command]
pub async fn sync_call(app: AppHandle, service: State<'_, SyncService>, name: String, args: Value) -> IpcResult<Reply> {
    let service = service.inner().clone();
    let notes = crate::core_bridge::notes_folder(&app);
    let mut args = args;
    let run = move || {
        if name == "recoveryKey" {
            return service.take_recovery().map(Reply::Secret);
        }
        let reply = service.call(notes, &name, &mut args).map(Reply::Value);
        drop(args);
        reply
    };
    match spawn_blocking(run).await {
        Ok(result) => result,
        Err(_) => Err(IpcError::new(codes::INTERNAL, "The sync call stopped.")),
    }
}

#[cfg(test)]
mod tests;
