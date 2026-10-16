//! OpenNote's self-updater. It checks for a new exe, downloads and verifies it, swaps it in, and rolls back a
//! version that fails to start. It knows nothing about Tauri: the app drives it from a scheduler thread in
//! `app/src-tauri/src/updater.rs`. See ARCHITECTURE.md section 18.

mod apply;
pub mod config;
pub mod error;
pub mod fetch;
pub mod guard;
pub mod manifest;
pub mod platform;
pub mod policy;
pub mod schedule;
pub mod stage;
pub mod state;
pub mod swap;
pub mod time;
pub mod verify;

#[cfg(test)]
mod check_tests;
#[cfg(test)]
mod download_tests;
#[cfg(test)]
mod swap_tests;
#[cfg(test)]
mod test_support;

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard, PoisonError},
};

use semver::Version;

pub use config::{Channel, ChannelUrls, Config, Limits, UpdaterDirs};
pub use error::UpdateError;
pub use fetch::{Fetch, FetchError, FetchOutcome, RangeOutcome, RangeSink, RangeStart, Url};
pub use guard::{guard_on_start, GuardDecision};
/// The public key type of `Config::trusted_keys`, so the app needn't depend on `minisign-verify` itself.
pub use minisign_verify::PublicKey;
pub use platform::PlatformKey;
pub use schedule::{Clock, NetworkCost};
pub use swap::Replacer;

use state::UpdaterState;

/// Checks for, downloads, and installs updates for the running copy of the app.
pub struct Updater<F: Fetch, R: Replacer, C: Clock> {
    config: Config,
    fetch: F,
    replacer: R,
    clock: C,
    /// Held while `updates\state.json` is read, changed, and written, so two threads never interleave.
    state_lock: Mutex<()>,
}

/// The newest file the channel's manifests offer this platform.
enum Found {
    Nothing,
    NoFileForPlatform,
    Offer(Offer),
}

/// What a check found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckOutcome {
    /// The running version is the newest this channel offers.
    UpToDate,
    /// A newer version for this platform that isn't skipped or blocked.
    Available(Offer),
    /// The manifest has no file for this platform. It's logged, and no error shows (section 18.3).
    NoUpdateForPlatform,
}

/// A newer version the manifest offers for this platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub version: Version,
    pub notes: String,
    pub url: Url,
    pub size: u64,
    pub sha256: String,
    pub signature: String,
}

/// A downloaded and verified update waiting in `updates\`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Staged {
    pub version: Version,
    pub path: PathBuf,
    pub sha256: String,
    pub notes: String,
}

/// What the app does after a swap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Relaunch {
    /// "Restart to update" or "Go back": start the swapped exe with `--wait-pid`, then exit.
    Now,
    /// Closing under the automatic policy: just exit, and the next launch runs the new version.
    NextLaunch,
}

/// The result of a swap: the versions that changed places, and the exe to start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub from: Version,
    pub to: Version,
    pub exe: PathBuf,
    pub relaunch: Relaunch,
}

/// The copy of the version before the last update, kept in `previous\` for rollback and "Go back".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviousVersion {
    pub version: Version,
    pub path: PathBuf,
    pub sha256: String,
}

impl<F: Fetch, R: Replacer, C: Clock> Updater<F, R, C> {
    pub fn new(config: Config, fetch: F, replacer: R, clock: C) -> Self {
        Self {
            config,
            fetch,
            replacer,
            clock,
            state_lock: Mutex::new(()),
        }
    }

    /// The configuration this updater was built with.
    pub fn config(&self) -> &Config {
        &self.config
    }

    fn lock_state(&self) -> MutexGuard<'_, ()> {
        self.state_lock.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A copy of `updates\state.json` as it is now.
    pub fn state(&self) -> UpdaterState {
        let _held = self.lock_state();
        UpdaterState::load(&self.config.dirs.updates)
    }

    /// Reads `updates\state.json`, changes it, and writes it back, holding the lock throughout.
    pub fn change_state<T>(&self, change: impl FnOnce(&mut UpdaterState) -> T) -> Result<T, UpdateError> {
        let _held = self.lock_state();
        let mut state = UpdaterState::load(&self.config.dirs.updates);
        let result = change(&mut state);
        state.save(&self.config.dirs.updates)?;
        Ok(result)
    }

    /// The versions that rolled back on this device, which are never offered again.
    pub fn blocked_versions(&self) -> Vec<Version> {
        let state = self.state();
        state
            .blocked_versions
            .iter()
            .filter_map(|text| Version::parse(text).ok())
            .collect()
    }

    /// Reads the channel's manifests and decides whether they offer a version this copy may install. The stable
    /// channel reads `latest.json`; beta reads `beta.json` and `latest.json`, and takes the higher version. A
    /// successful check is recorded as the last check.
    pub fn check(&self, skipped: Option<&Version>) -> Result<CheckOutcome, UpdateError> {
        let found = self.newest_offer()?;
        let now = time::format(self.clock.now());
        self.change_state(|state| state.last_check = Some(now))?;
        Ok(match found {
            Found::Offer(offer) => {
                let allowed = policy::check(&offer.version, &self.config.current, skipped, &self.blocked_versions());
                match allowed {
                    Ok(()) => CheckOutcome::Available(offer),
                    Err(refusal) => {
                        log::info!("Not offering {}: {refusal:?}", offer.version);
                        CheckOutcome::UpToDate
                    }
                }
            }
            Found::NoFileForPlatform => CheckOutcome::NoUpdateForPlatform,
            Found::Nothing => CheckOutcome::UpToDate,
        })
    }

    fn newest_offer(&self) -> Result<Found, UpdateError> {
        let urls = &self.config.urls;
        let manifests = match self.config.channel {
            Channel::Stable => vec![&urls.stable],
            Channel::Beta => vec![&urls.beta, &urls.stable],
        };
        let (mut found, mut read_any, mut last_error) = (Found::Nothing, false, None);
        for url in manifests {
            let offer = self.read_manifest(url).and_then(|manifest| {
                manifest::offer_for(&manifest, self.config.platform, self.config.limits.exe_bytes)
            });
            match offer {
                Ok(Some(offer)) if self.config.channel == Channel::Stable && !offer.version.pre.is_empty() => {
                    log::warn!(
                        "The stable manifest offers the prerelease {}; ignored it.",
                        offer.version
                    );
                    read_any = true;
                }
                Ok(Some(offer)) => {
                    read_any = true;
                    if !matches!(&found, Found::Offer(best) if best.version >= offer.version) {
                        found = Found::Offer(offer);
                    }
                }
                Ok(None) => {
                    log::info!("{url} has no file for {}.", self.config.platform.key());
                    read_any = true;
                    if matches!(found, Found::Nothing) {
                        found = Found::NoFileForPlatform;
                    }
                }
                Err(error) => {
                    log::warn!("Couldn't read {url}: {error}");
                    last_error = Some(error);
                }
            }
        }
        match (read_any, last_error) {
            (false, Some(error)) => Err(error),
            _ => Ok(found),
        }
    }

    fn read_manifest(&self, url: &Url) -> Result<manifest::Manifest, UpdateError> {
        let mut bytes = Vec::new();
        self.fetch.get(url, self.config.limits.manifest_bytes, &mut bytes)?;
        manifest::parse(&bytes)
    }

    /// Downloads and verifies an offer, reporting progress as (received, total) bytes. The verified file replaces
    /// any earlier staged update, and `updates\state.json` records it.
    pub fn download(&self, offer: &Offer, progress: &dyn Fn(u64, u64)) -> Result<Staged, UpdateError> {
        let record = stage::download(&self.fetch, &self.config, offer, progress)?;
        let staged = Staged {
            version: offer.version.clone(),
            path: PathBuf::from(&record.path),
            sha256: record.sha256.clone(),
            notes: record.notes.clone(),
        };
        self.change_state(|state| state.staged = Some(record))?;
        Ok(staged)
    }

    /// Like [`Updater::download`], but a download that stopped partway (a dropped connection, a sleeping PC)
    /// leaves its `.part` file, and the next call continues it with an HTTP range request when `resume` is on
    /// (`updates.resume`). The whole file is still checked against the manifest's hash and signature before it
    /// is staged.
    pub fn download_resumable(
        &self,
        offer: &Offer,
        progress: &dyn Fn(u64, u64),
        resume: bool,
    ) -> Result<Staged, UpdateError> {
        let record = if resume {
            stage::download_resumable(&self.fetch, &self.config, offer, progress)?
        } else {
            stage::download(&self.fetch, &self.config, offer, progress)?
        };
        let staged = Staged {
            version: offer.version.clone(),
            path: PathBuf::from(&record.path),
            sha256: record.sha256.clone(),
            notes: record.notes.clone(),
        };
        self.change_state(|state| state.staged = Some(record))?;
        Ok(staged)
    }

    /// The staged update, verified again before it's returned, or `None` when there's none or it no longer
    /// verifies. A staged update that fails, or that `skipped` or a rollback now excludes, is deleted.
    pub fn staged(&self, skipped: Option<&Version>) -> Option<Staged> {
        let record = self.state().staged?;
        match stage::verify_staged(&self.config, &record, skipped, &self.blocked_versions()) {
            Ok((version, path)) => Some(Staged {
                version,
                path,
                sha256: record.sha256,
                notes: record.notes,
            }),
            Err(error) => {
                log::warn!("Deleted the staged update {}: {error}", record.version);
                self.discard_staged();
                None
            }
        }
    }

    /// Deletes any staged update and partial download, and its record.
    pub fn discard_staged(&self) {
        stage::remove_copies(&self.config.dirs.updates);
        if let Err(error) = self.change_state(|state| state.staged = None) {
            log::warn!("Couldn't clear the staged update: {error}");
        }
    }
}
