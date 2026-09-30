//! The updater service: one `Updater` for this copy of the app, the status the interface shows, and the worker
//! thread that the commands and lifecycle hooks talk to (ARCHITECTURE.md section 18). Checks and downloads run
//! on the worker in `worker.rs`; swaps run on the exit path in `exit.rs`.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex, MutexGuard, OnceLock, PoisonError,
    },
    thread,
    time::Duration,
};

use opennote_updater::{fetch::UreqFetch, schedule::SystemClock, swap::SelfReplace, Offer, Updater};
use serde_json::json;
use tauri::{AppHandle, Emitter, Listener, Manager};

use super::{config, worker, DisabledReason, PreviousInfo, UpdaterPhase, UpdaterStatus};
use crate::{
    events,
    ipc::{codes, IpcError, IpcResult},
    lifecycle::{self, ExitReason},
    paths::Paths,
    settings::{schema::Settings, SettingsChanged, SettingsStore},
};

pub type AppUpdater = Updater<UreqFetch, SelfReplace, SystemClock>;

/// How long the app stays up after `app_ready` before its start counts as healthy (section 18.8).
pub const HEALTHY_AFTER: Duration = Duration::from_secs(5);

/// The window label `updater_skip` and "Go back" write settings as.
const ORIGIN: &str = "updater";

/// Work for the worker thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Message {
    /// The first `app_ready`: automatic checks start.
    Start,
    /// "Check for updates".
    Check,
    /// Download the offered version.
    Download,
    /// The settings changed, maybe the install choice, channel, or skipped version.
    SettingsChanged,
}

/// What the status shows, beyond what's on disk.
#[derive(Debug, Default)]
pub struct Shared {
    /// `None` while nothing is happening, which shows as the resting phase.
    pub phase: Option<UpdaterPhase>,
    /// The version the last check offered, until it's downloaded.
    pub offer: Option<Offer>,
    pub previous: Option<PreviousInfo>,
    pub last_check: Option<String>,
}

pub struct Service {
    paths: Paths,
    /// Why this copy never updates itself, if it doesn't.
    pub blocked: Option<DisabledReason>,
    updater: Mutex<Option<Arc<AppUpdater>>>,
    shared: Mutex<Shared>,
    app: OnceLock<AppHandle>,
    worker: OnceLock<Sender<Message>>,
    ready: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Service {
    pub fn new(paths: Paths) -> Self {
        let blocked = config::this_build_blocked();
        let shared = Shared {
            last_check: super::state_of(&paths).last_check,
            previous: super::unchecked_previous(&paths),
            ..Shared::default()
        };
        Self {
            paths,
            blocked,
            updater: Mutex::new(None),
            shared: Mutex::new(shared),
            app: OnceLock::new(),
            worker: OnceLock::new(),
            ready: AtomicBool::new(false),
        }
    }

    pub fn shared(&self) -> MutexGuard<'_, Shared> {
        lock(&self.shared)
    }

    /// The settings as they are now, or the defaults before the app runs.
    pub fn settings(&self) -> Settings {
        self.app
            .get()
            .and_then(|app| app.try_state::<SettingsStore>().map(|store| store.get()))
            .unwrap_or_default()
    }

    /// The updater for the current channel, built again when the channel changes. `None` in development builds
    /// and on platforms OpenNote doesn't update on.
    pub fn updater(&self) -> Option<Arc<AppUpdater>> {
        if config::is_dev_build() {
            return None;
        }
        let channel = self.settings().updates.channel;
        let mut slot = lock(&self.updater);
        let current = slot
            .as_ref()
            .filter(|updater| updater.config().channel == config::channel(channel));
        if let Some(updater) = current {
            return Some(Arc::clone(updater));
        }
        let config = config::updater_config(&self.paths, channel, config::trusted_keys())?;
        let updater = Arc::new(Updater::new(config, UreqFetch::default(), SelfReplace, SystemClock));
        *slot = Some(Arc::clone(&updater));
        Some(updater)
    }

    pub fn status(&self, settings: &Settings) -> UpdaterStatus {
        let shared = self.shared();
        let resting = || config::resting_phase(self.blocked, settings.updates.install);
        UpdaterStatus {
            phase: shared.phase.clone().unwrap_or_else(resting),
            last_check: shared.last_check.clone(),
            skipped_version: settings.updates.skipped_version.clone(),
            previous: shared.previous.clone(),
        }
    }

    /// Sends the status to the interface as `updater://status`.
    pub fn publish(&self) {
        let Some(app) = self.app.get() else {
            return;
        };
        let status = self.status(&self.settings());
        if let Err(error) = app.emit(events::UPDATER_STATUS, status) {
            log::warn!("Couldn't send {}: {error}", events::UPDATER_STATUS);
        }
    }

    pub fn set_phase(&self, phase: Option<UpdaterPhase>) {
        self.shared().phase = phase;
        self.publish();
    }

    /// Keeps the app handle and starts the worker, unless this copy never updates itself.
    pub fn attach(self: &Arc<Self>, app: &AppHandle) -> Option<&Sender<Message>> {
        let _ = self.app.set(app.clone());
        if self.blocked.is_some() {
            return None;
        }
        Some(self.worker.get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            let service = Arc::clone(self);
            let spawned = thread::Builder::new()
                .name("updater".into())
                .spawn(move || worker::run(&service, &receiver));
            if let Err(error) = spawned {
                log::error!("Couldn't start the updater thread: {error}");
            }
            let wake = sender.clone();
            app.listen_any(events::SETTINGS_CHANGED, move |_| {
                let _ = wake.send(Message::SettingsChanged);
            });
            sender
        }))
    }

    pub fn send(self: &Arc<Self>, app: &AppHandle, message: Message) -> IpcResult<()> {
        let sender = self
            .attach(app)
            .ok_or_else(|| IpcError::invalid("updater", "updates are off"))?;
        sender
            .send(message)
            .map_err(|_| IpcError::new(codes::INTERNAL, "the updater thread stopped"))
    }

    /// The first `app_ready`: the start counts as healthy after 5 s, and automatic checks start.
    pub fn on_ready(self: &Arc<Self>, app: &AppHandle) {
        let first = !self.ready.swap(true, Ordering::SeqCst);
        if let Some(sender) = self.attach(app) {
            if first {
                let _ = sender.send(Message::Start);
            }
        }
        if first {
            let service = Arc::clone(self);
            thread::spawn(move || {
                thread::sleep(HEALTHY_AFTER);
                service.mark_healthy();
            });
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub fn mark_healthy(&self) {
        if let Some(updater) = self.updater() {
            if let Err(error) = updater.mark_healthy() {
                log::error!("Couldn't mark this start healthy: {error}");
            }
        }
    }

    /// Writes a settings change for the updater and tells every window, as `settings_update` does.
    pub fn update_settings(&self, patch: serde_json::Value) -> IpcResult<Settings> {
        let app = self
            .app
            .get()
            .ok_or_else(|| IpcError::new(codes::INTERNAL, "the app isn't running"))?;
        let store = app.state::<SettingsStore>();
        let settings = store.update(patch, ORIGIN)?;
        let payload = SettingsChanged {
            settings: settings.clone(),
            origin: ORIGIN.to_owned(),
        };
        if let Err(error) = app.emit(events::SETTINGS_CHANGED, payload) {
            log::warn!("Couldn't send {}: {error}", events::SETTINGS_CHANGED);
        }
        Ok(settings)
    }

    /// "Skip this version": it isn't offered again, and a staged copy of it is deleted.
    pub fn skip(self: &Arc<Self>, app: &AppHandle, version: &str) -> IpcResult<()> {
        let _ = self.app.set(app.clone());
        let version = semver::Version::parse(version).map_err(|_| IpcError::invalid("version", "not a version"))?;
        self.update_settings(json!({ "updates": { "skippedVersion": version.to_string() } }))?;
        if let Some(updater) = self.updater() {
            if updater
                .state()
                .staged
                .is_some_and(|staged| staged.version == version.to_string())
            {
                updater.discard_staged();
            }
        }
        let mut shared = self.shared();
        if shared.offer.as_ref().is_some_and(|offer| offer.version == version) {
            shared.offer = None;
        }
        if super::phase_version(shared.phase.as_ref()) == Some(version.to_string()) {
            shared.phase = Some(UpdaterPhase::UpToDate);
        }
        drop(shared);
        self.publish();
        Ok(())
    }

    /// "Install it": the skipped version is offered again, and a check runs now.
    pub fn unskip(self: &Arc<Self>, app: &AppHandle) -> IpcResult<()> {
        let _ = self.app.set(app.clone());
        self.update_settings(json!({ "updates": { "skippedVersion": null } }))?;
        self.send(app, Message::Check)
    }

    /// "Restart to update" runs the exit handshake, which installs the update if nothing blocks it.
    pub fn restart_to_update(&self, app: &AppHandle) -> IpcResult<()> {
        let ready = matches!(self.shared().phase, Some(UpdaterPhase::Ready { .. }));
        if !ready {
            return Err(IpcError::invalid("updater", "no update is ready"));
        }
        lifecycle::request_exit(app, ExitReason::RestartToUpdate);
        Ok(())
    }

    /// "Go back to version X" runs the exit handshake, which swaps the previous copy in.
    pub fn go_back(&self, app: &AppHandle) -> IpcResult<()> {
        let available = self
            .shared()
            .previous
            .as_ref()
            .is_some_and(|previous| previous.available);
        if !available {
            return Err(IpcError::invalid("updater", "the previous version isn't available"));
        }
        lifecycle::request_exit(app, ExitReason::GoBack);
        Ok(())
    }
}
