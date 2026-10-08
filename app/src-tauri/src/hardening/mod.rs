//! Hardening and the beta (Phase 13): the host side of crash reports, the self-check, the feedback file, safe start,
//! and Work offline. The rules live in `crates/crashreport` and `crates/diagnostics`; this module gives them their
//! place on disk, their commands, and their network transport. See docs/HARDENING.md.
//!
//! - **Crash reports.** The panic hook and the exception handler are installed first thing in [`crate::run`], and
//!   save nothing until the person said yes to the current wording. The decision is in `privacy.json` in the local
//!   data folder, with the address a report may be sent to (empty by default, so nothing can be sent).
//! - **Safe start.** The session record says how the last sessions ended. After two crashes in a row the interface
//!   offers safe mode, and [`safe_mode`] is the one value every feature that safe mode turns off should read.
//! - **Work offline.** [`offline`] is the one value every network use should read. Update checks and downloads, web
//!   images on paste, and sending a crash report all read it.

mod commands;
mod transport;

pub use commands::*;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, PoisonError,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use opennote_crashreport::{Config, Consent, CrashStore, Scrubber, Settings as CrashSettings};
use opennote_diagnostics::{Review, SessionLog, StartReport};
use serde::{Deserialize, Serialize};

use crate::{paths::Paths, settings::file::write_atomic};

static OFFLINE: AtomicBool = AtomicBool::new(false);
static SAFE_MODE: AtomicBool = AtomicBool::new(false);

/// Whether the person turned on Work offline. While it is on, the app makes no network request.
pub fn offline() -> bool {
    OFFLINE.load(Ordering::Relaxed)
}

/// Whether this session runs in safe mode: no background work, embeds, or on-device models.
pub fn safe_mode() -> bool {
    SAFE_MODE.load(Ordering::Relaxed)
}

/// The file name of the privacy choices, in the local data folder.
pub const PRIVACY_FILE: &str = "privacy.json";

/// What the person chose about crash reports and the network, and when a report last went out.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrivacyFile {
    pub crash_reports: CrashSettings,
    pub work_offline: bool,
    /// When a crash report was last sent, in seconds since 1970. For the Privacy panel.
    pub report_sent_unix: Option<u64>,
}

impl PrivacyFile {
    /// Reads the file. A missing or damaged file reads as the defaults: no consent and online.
    pub fn read(path: &std::path::Path) -> PrivacyFile {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// The managed state behind the diagnostics and privacy commands.
pub struct Hardening {
    file: PathBuf,
    pub(crate) store: CrashStore,
    pub(crate) scrubber: Mutex<Scrubber>,
    privacy: Mutex<PrivacyFile>,
    session: SessionLog,
    start: StartReport,
    /// The feedback file that was built last, kept until it is saved or replaced.
    pub(crate) review: Mutex<Option<Review>>,
}

impl Hardening {
    /// Installs the crash hooks, records that a session began, and reads the privacy choices. Call it once, as
    /// early as the folders are known and this copy holds the instance lock.
    pub fn start(paths: &Paths) -> Hardening {
        let hardening = Hardening::open(paths);
        opennote_crashreport::install(Config {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            store: hardening.store.clone(),
            settings: hardening.privacy().crash_reports,
        });
        hardening.store.sweep();
        hardening
    }

    /// Reads the privacy choices and records that a session began, without installing any hook.
    fn open(paths: &Paths) -> Hardening {
        let file = paths.local.join(PRIVACY_FILE);
        let privacy = PrivacyFile::read(&file);
        OFFLINE.store(privacy.work_offline, Ordering::Relaxed);
        let session = SessionLog::new(&paths.local);
        let start = session.begin(now_unix());
        Hardening {
            file,
            store: CrashStore::new(paths.local.join("crashes")),
            scrubber: Mutex::new(Scrubber::detect()),
            privacy: Mutex::new(privacy),
            session,
            start,
            review: Mutex::new(None),
        }
    }

    pub(crate) fn privacy(&self) -> PrivacyFile {
        self.privacy.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Changes the privacy choices and saves them. The hooks and the offline switch follow at once.
    pub(crate) fn update(&self, change: impl FnOnce(&mut PrivacyFile)) -> std::io::Result<PrivacyFile> {
        let mut privacy = self.privacy.lock().unwrap_or_else(PoisonError::into_inner);
        change(&mut privacy);
        // A yes counts only while the switch is on, and a no turns it off.
        privacy.crash_reports.enabled = privacy.crash_reports.consent.saving_allowed();
        opennote_crashreport::apply(&privacy.crash_reports);
        OFFLINE.store(privacy.work_offline, Ordering::Relaxed);
        let json = serde_json::to_vec_pretty(&*privacy).map_err(std::io::Error::other)?;
        write_atomic(&self.file, &json)?;
        Ok(privacy.clone())
    }

    pub(crate) fn consent(&self) -> Consent {
        self.privacy().crash_reports.consent
    }

    pub(crate) fn start_report(&self) -> StartReport {
        self.start
    }

    pub(crate) fn enter_safe_mode(&self) {
        SAFE_MODE.store(true, Ordering::Relaxed);
        if let Err(error) = self.session.enter_safe_mode() {
            ::log::warn!("Couldn't record safe mode: {error}");
        }
    }

    pub(crate) fn stats(&self) -> opennote_diagnostics::SessionStats {
        self.session.stats()
    }

    /// Records that the person quit. Call it on the way out; calling it twice is harmless.
    pub fn end_clean(&self) {
        if let Err(error) = self.session.end_clean() {
            ::log::warn!("Couldn't record the end of the session: {error}");
        }
    }
}

#[cfg(test)]
mod tests;
