//! Installing: the swap to a staged update, healthy starts, going back by choice, and the previous copy
//! (ARCHITECTURE.md sections 18.7, 18.8, and 18.10). The app calls these only through its exit handshake, never
//! with unsaved changes, a recording, or during Windows shutdown.

use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

use semver::Version;

use crate::{
    guard, policy,
    stage::{self, copy_name},
    state::PendingRecord,
    swap,
    verify::{self, Expected},
    Applied, Clock, Fetch, PreviousVersion, Relaunch, Replacer, UpdateError, Updater,
};

/// Opens a file for reading while refusing writers, so it can't change between its check and its use.
fn open_without_write_sharing(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ only.
        options.share_mode(0x1);
    }
    options.open(path)
}

impl<F: Fetch, R: Replacer, C: Clock> Updater<F, R, C> {
    /// Swaps the staged update into place (section 18.7). The staged file stays open without write sharing from
    /// its last check until the swap is done. A failure leaves a working exe at the path and clears `pending`.
    pub fn apply(&self, relaunch: Relaunch) -> Result<Applied, UpdateError> {
        let exe = self.replacer.current_exe()?;
        let record = self
            .state()
            .staged
            .ok_or_else(|| UpdateError::Swap("no update is staged".into()))?;
        let (version, path) = stage::staged_path(&self.config, &record)
            .ok_or_else(|| UpdateError::Swap("the staged update is for another build".into()))?;
        policy::check(&version, &self.config.current, None, &self.blocked_versions())
            .map_err(|refusal| UpdateError::Swap(format!("{version} may not be installed: {refusal:?}")))?;
        let held = open_without_write_sharing(&path)?;
        let expected = Expected {
            version: &version,
            file: self.config.platform.file(),
            size: record.size,
            sha256: &record.sha256,
            signature: &record.signature,
        };
        if let Err(error) = verify::verify_reader(&held, &expected, &self.config.trusted_keys) {
            drop(held);
            self.discard_staged();
            return Err(error);
        }
        let previous = swap::keep_previous(&self.config, &exe)?;
        self.change_state(|state| state.previous = Some(previous.clone()))?;
        let new = swap::place_next_to_exe(&exe, &path, &record.sha256)?;
        let pending = PendingRecord {
            version: version.to_string(),
            from: self.config.current.to_string(),
            attempts: 0,
            unknown: Default::default(),
        };
        self.change_state(|state| state.pending = Some(pending))?;
        if let Err(error) = swap::replace_or_restore(&self.replacer, &exe, &new, Path::new(&previous.path)) {
            self.change_state(|state| state.pending = None)?;
            return Err(error);
        }
        drop(held);
        self.discard_staged();
        Ok(Applied {
            from: self.config.current.clone(),
            to: version,
            exe,
            relaunch,
        })
    }

    /// Clears the pending start count once this version is healthy (section 18.8): the last page was ready, and
    /// the app stayed up for 5 s or closed normally.
    pub fn mark_healthy(&self) -> Result<(), UpdateError> {
        let current = self.config.current.clone();
        if self.state().pending.is_some() {
            self.change_state(|state| guard::mark_healthy(state, &current))?;
        }
        Ok(())
    }

    /// Swaps the previous copy back into place (section 18.10), then deletes it, because there is no "go
    /// forward". Any staged update goes too. The app skips the version it leaves.
    pub fn go_back(&self) -> Result<Applied, UpdateError> {
        let exe = self.replacer.current_exe()?;
        let previous = self
            .previous()
            .ok_or_else(|| UpdateError::Swap("the previous copy is missing or damaged".into()))?;
        let new = swap::place_next_to_exe(&exe, &previous.path, &previous.sha256)?;
        swap::replace_or_restore(&self.replacer, &exe, &new, &previous.path)?;
        if let Err(error) = fs::remove_file(&previous.path) {
            log::warn!("Couldn't delete the previous copy: {error}");
        }
        self.discard_staged();
        self.change_state(|state| {
            state.previous = None;
            state.pending = None;
        })?;
        Ok(Applied {
            from: self.config.current.clone(),
            to: previous.version,
            exe,
            relaunch: Relaunch::Now,
        })
    }

    /// The previous copy, when one exists for another version than this one and its hash still matches.
    pub fn previous(&self) -> Option<PreviousVersion> {
        let record = self.state().previous?;
        let version = Version::parse(&record.version).ok()?;
        if version == self.config.current {
            return None;
        }
        let path = swap::checked_previous(&self.config.dirs.previous, &record)?;
        (path
            == self
                .config
                .dirs
                .previous
                .join(copy_name(&version, self.config.platform)))
        .then_some(PreviousVersion {
            version,
            path,
            sha256: record.sha256,
        })
    }

    /// The previous copy's version, without checking the copy's hash. For the boot payload, which must not wait
    /// for hashing; the scheduler checks the copy right after start.
    pub fn previous_version_unchecked(&self) -> Option<Version> {
        let record = self.state().previous?;
        let version = Version::parse(&record.version).ok()?;
        let path = self
            .config
            .dirs
            .previous
            .join(copy_name(&version, self.config.platform));
        (version != self.config.current && path.is_file()).then_some(version)
    }
}
