//! Optional end-to-end-encrypted sync (ADR 0049) in the shell: the setup and join flows, the background rounds,
//! and the status the title bar shows. The engine is `opennote-sync`; this module only decides when it runs and
//! keeps its secrets.
//!
//! Nothing runs until the person sets sync up. The device's own secret, and a WebDAV password, live in Windows
//! Credential Manager (`OpenNote/sync/device` and `OpenNote/sync/webdav`), never in a file, a log, or the
//! interface. The passphrase and the recovery key are used once, in memory, and never kept. Work offline and Pause
//! stop every round. The interface calls one command, `sync_call`, with an operation name.

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
    fn begin(&self, args: &Value, create: bool) -> IpcResult<Value> {
        if self.config().is_some() {
            return Err(bad(
                "Sync is already set up on this device. Turn it off first to choose another place.",
            ));
        }
        let backend: BackendConfig = serde_json::from_value(args.get("backend").cloned().unwrap_or(Value::Null))
            .map_err(|_| bad("Choose where to sync."))?;
        let password = Zeroizing::new(arg(args, "password").to_owned());
        let store = self.open_backend(&backend, Some(password.clone()))?;
        let mut recovery = None;
        let keys = if create {
            let (keys, key) = vault::create(store.as_ref(), arg(args, "passphrase")).map_err(fail)?;
            recovery = Some(key.text().to_owned());
            keys
        } else if !arg(args, "code").is_empty() {
            vault::join_with_code(store.as_ref(), arg(args, "code"), now_ms()).map_err(fail)?
        } else if !arg(args, "recoveryKey").is_empty() {
            vault::unlock_recovery(store.as_ref(), arg(args, "recoveryKey")).map_err(fail)?
        } else {
            vault::unlock_passphrase(store.as_ref(), arg(args, "passphrase")).map_err(fail)?
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
            paused: false,
            fingerprint: keys.fingerprint(),
        })?;
        self.set_status(|s| {
            *s = Status {
                state: "waiting",
                ..Status::default()
            }
        });
        let mut view = self.view();
        if let Some(key) = recovery {
            view["recoveryKey"] = Value::String(key);
        }
        Ok(view)
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
                engine
                    .sync()
                    .map(|report| json!({ "summary": report.summary, "deferred": report.deferred }))
                    .map_err(fail)
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

    fn call(&self, notes: Option<PathBuf>, name: &str, args: &Value) -> IpcResult<Value> {
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
                Ok(self.view())
            }
            _ => Err(bad("That sync operation isn't known.")),
        }
    }

    /// The device list, removing a device, and a pairing code: each unlocks with this device's own slot.
    fn devices_call(&self, name: &str, args: &Value) -> IpcResult<Value> {
        let config = self.config().ok_or_else(|| fail(SyncError::NoVault))?;
        let backend = self.open_backend(&config.backend, None)?;
        let store = backend.as_ref();
        let keys = vault::unlock_device(store, &config.device, &self.device_secret()?).map_err(fail)?;
        match name {
            "devices" => {
                let rows: Vec<Value> = vault::list_devices(store, &keys)
                    .map_err(fail)?
                    .into_iter()
                    .map(|d| {
                        let this = d.tag == config.device;
                        json!({ "tag": d.tag, "name": d.name, "added": d.added, "thisDevice": this })
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
    let mut out = [0u8; 32];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

/// Registers the service and starts the background rounds. They run only while sync is set up, not paused, and Work offline is off.
pub fn start(app: &AppHandle) {
    if app.try_state::<SyncService>().is_none() {
        app.manage(SyncService::new(&app.state::<Paths>()));
    }
    let service = app.state::<SyncService>().inner().clone();
    *service.inner.app.lock().unwrap_or_else(PoisonError::into_inner) = Some(app.clone());
    if service.inner.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("opennote-sync".into()).spawn(move || {
        std::thread::sleep(FIRST);
        loop {
            if crate::hardening::safe_mode() {
                return;
            }
            if service.config().is_some_and(|c| !c.paused) && !crate::hardening::offline() {
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
pub async fn sync_call(app: AppHandle, service: State<'_, SyncService>, name: String, args: Value) -> IpcResult<Value> {
    let service = service.inner().clone();
    let notes = crate::core_bridge::notes_folder(&app);
    match spawn_blocking(move || service.call(notes, &name, &args)).await {
        Ok(result) => result,
        Err(_) => Err(IpcError::new(codes::INTERNAL, "The sync call stopped.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::MemoryStore;

    fn service(dir: &Path) -> SyncService {
        SyncService::with_store(dir.join("sync"), Arc::new(MemoryStore::default()))
    }

    fn ok(service: &SyncService, notes: Option<&Path>, name: &str, args: Value) -> Value {
        service.call(notes.map(Path::to_path_buf), name, &args).expect(name)
    }

    fn code(service: &SyncService, notes: Option<&Path>, name: &str, args: Value) -> String {
        service
            .call(notes.map(Path::to_path_buf), name, &args)
            .unwrap_err()
            .code
    }

    /// A laptop that set sync up in a folder and synced a file, and a desktop that joined with a pairing code.
    struct Pair {
        dir: tempfile::TempDir,
        laptop: SyncService,
        desktop: SyncService,
        made: Value,
    }

    impl Pair {
        fn notes(&self, which: &str) -> PathBuf {
            self.dir.path().join(which)
        }
    }

    fn pair() -> Pair {
        let dir = tempfile::tempdir().expect("temp");
        let backend = json!({ "kind": "folder", "path": dir.path().join("storage").to_string_lossy() });
        let laptop = service(&dir.path().join("laptop"));
        fs::create_dir_all(dir.path().join("notes-a/Bio")).expect("dirs");
        fs::write(dir.path().join("notes-a/Bio/todo.txt"), b"from the laptop").expect("write");
        let off = ok(&laptop, None, "status", Value::Null);
        assert_eq!(
            (off["configured"].clone(), off["status"]["state"].clone()),
            (json!(false), json!("off"))
        );
        let weak = json!({ "backend": backend, "passphrase": "short" });
        assert_eq!(code(&laptop, None, "setUp", weak), "weakPassphrase");
        let setup = json!({ "backend": backend, "passphrase": "correct horse battery", "deviceName": "Laptop" });
        let made = ok(&laptop, None, "setUp", setup);
        assert_eq!(made["recoveryKey"].as_str().expect("key").split('-').count(), 13);
        let synced = ok(&laptop, Some(&dir.path().join("notes-a")), "syncNow", Value::Null);
        assert_eq!(synced["view"]["status"]["state"], "synced");
        let pairing = ok(&laptop, None, "pairingCode", Value::Null);
        assert!(!pairing["rows"].as_array().expect("rows").is_empty());
        let desktop = service(&dir.path().join("desktop"));
        let join = json!({ "backend": backend, "code": pairing["code"], "deviceName": "Desktop" });
        let joined = ok(&desktop, None, "join", join);
        assert_eq!(joined["fingerprint"], made["fingerprint"]);
        assert!(
            joined.get("recoveryKey").is_none(),
            "only a new sync shows a recovery key"
        );
        Pair {
            dir,
            laptop,
            desktop,
            made,
        }
    }

    #[test]
    fn a_joined_device_previews_then_syncs_through_the_one_command() {
        let p = pair();
        let notes_b = p.notes("notes-b");
        let preview = ok(&p.desktop, Some(&notes_b), "preview", Value::Null);
        assert_eq!(preview["summary"]["download"][0], "Bio/todo.txt");
        assert!(!notes_b.join("Bio/todo.txt").exists(), "a preview changes nothing");
        ok(&p.desktop, Some(&notes_b), "syncNow", Value::Null);
        assert_eq!(
            fs::read(notes_b.join("Bio/todo.txt")).expect("read"),
            b"from the laptop"
        );
        assert!(p.made["fingerprint"].is_string());
        assert_eq!(code(&p.desktop, None, "nonsense", Value::Null), codes::INVALID);
    }

    #[test]
    fn devices_are_listed_and_removed_and_pause_and_turn_off_keep_the_notes() {
        let p = pair();
        let notes_b = p.notes("notes-b");
        ok(&p.desktop, Some(&notes_b), "syncNow", Value::Null);
        let devices = ok(&p.desktop, None, "devices", Value::Null);
        let list = devices.as_array().expect("list");
        let mut names: Vec<_> = list
            .iter()
            .map(|d| d["name"].as_str().unwrap_or("").to_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["Desktop", "Laptop"]);
        let row = list.iter().find(|d| d["name"] == "Laptop").expect("laptop");
        assert_eq!(row["thisDevice"], false);
        ok(&p.desktop, None, "removeDevice", json!({ "tag": row["tag"] }));
        assert_eq!(
            code(&p.laptop, Some(&p.notes("notes-a")), "syncNow", Value::Null),
            "removed"
        );
        assert_eq!(ok(&p.laptop, None, "status", Value::Null)["status"]["state"], "error");

        ok(&p.desktop, None, "setPaused", json!({ "paused": true }));
        assert_eq!(code(&p.desktop, Some(&notes_b), "syncNow", Value::Null), "paused");
        assert_eq!(ok(&p.desktop, None, "status", Value::Null)["status"]["state"], "paused");
        ok(&p.desktop, None, "turnOff", Value::Null);
        assert_eq!(ok(&p.desktop, None, "status", Value::Null)["configured"], false);
        assert!(
            fs::read(notes_b.join("Bio/todo.txt")).is_ok(),
            "turning off keeps the notes"
        );
    }
}
