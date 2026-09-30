//! OpenNote's self-updater. It checks for a new exe, downloads and verifies it, swaps it in, and rolls back a
//! version that fails to start. It knows nothing about Tauri: the app drives it from a scheduler thread in
//! `app/src-tauri/src/updater.rs`. See ARCHITECTURE.md section 18.
//!
//! The public types and signatures here are the contract the app codes against. Until the updater work package
//! fills in the bodies, the methods that do real work return [`UpdateError::NotImplemented`].

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
pub mod verify;

use std::path::PathBuf;

use semver::Version;

pub use config::{Channel, ChannelUrls, Config, Limits, UpdaterDirs};
pub use error::UpdateError;
pub use fetch::{Fetch, FetchError, FetchOutcome, Url};
pub use guard::{guard_on_start, GuardDecision};
pub use platform::PlatformKey;
pub use schedule::{Clock, NetworkCost};
pub use swap::Replacer;

/// Checks for, downloads, and installs updates for the running copy of the app.
pub struct Updater<F: Fetch, R: Replacer, C: Clock> {
    config: Config,
    // Read by check, download, and apply once the updater work package fills them in.
    #[allow(dead_code)]
    fetch: F,
    #[allow(dead_code)]
    replacer: R,
    #[allow(dead_code)]
    clock: C,
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
        }
    }

    /// The configuration this updater was built with.
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Reads the channel's manifest and decides whether it offers a version this copy may install.
    pub fn check(&self, _skipped: Option<&Version>) -> Result<CheckOutcome, UpdateError> {
        Err(UpdateError::NotImplemented("check"))
    }

    /// Downloads and verifies an offer, reporting progress as (received, total) bytes.
    pub fn download(&self, _offer: &Offer, _progress: &dyn Fn(u64, u64)) -> Result<Staged, UpdateError> {
        Err(UpdateError::NotImplemented("download"))
    }

    /// The staged update, re-verified before it's returned, or `None` when there's none or it no longer verifies.
    pub fn staged(&self) -> Option<Staged> {
        None
    }

    /// Swaps the staged update into place (section 18.7).
    pub fn apply(&self, _relaunch: Relaunch) -> Result<Applied, UpdateError> {
        Err(UpdateError::NotImplemented("apply"))
    }

    /// Clears the pending start count once the new version is healthy (section 18.8).
    pub fn mark_healthy(&self) -> Result<(), UpdateError> {
        Ok(())
    }

    /// Swaps the previous copy back into place and skips the current version (section 18.10).
    pub fn go_back(&self) -> Result<Applied, UpdateError> {
        Err(UpdateError::NotImplemented("go_back"))
    }

    /// The previous copy, when one exists and its hash still matches.
    pub fn previous(&self) -> Option<PreviousVersion> {
        None
    }
}
