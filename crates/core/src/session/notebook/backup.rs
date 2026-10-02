//! Scheduled backups of a notebook, and what a sync tool's folder means for it (docs/FEATURES.md, Phase 3).
//!
//! The schedule itself is the shell's. These calls do one backup, say when the last one ran and whether the
//! next is due, and describe the sync tool that manages a notes folder.

use std::path::Path;
use std::time::Duration;

use super::NotebookHandle;
use crate::error::{CoreError, EditError};
use crate::session::core::Core;
use crate::session::page::save::Why;
use crate::store::backup::{self, BackupPolicy, BackupReport};
use crate::store::external::{sync_notice, SyncNotice};
use crate::time::Timestamp;

impl NotebookHandle {
    /// Backs the notebook up into today's set under `dest`, then drops the sets `policy` doesn't keep.
    /// Pages with unsaved changes are saved first, so the set holds what is on screen. A page that can't be
    /// saved now, such as a read-only file, doesn't stop the backup: the set gets its last saved state, and the
    /// report lists it. Only files that changed since the day's last run are copied. `utc_offset_minutes`
    /// places the day in local time.
    pub fn backup_to(
        &self,
        dest: &Path,
        policy: &BackupPolicy,
        utc_offset_minutes: i32,
    ) -> Result<BackupReport, CoreError> {
        let shared = &self.inner;
        shared.check_open()?;
        if dest.starts_with(&shared.root) {
            let detail = "a backup can't go inside the notebook it copies";
            return Err(CoreError::Edit(EditError::Invalid(detail.into())));
        }
        let mut unsaved = Vec::new();
        for session in shared.sessions() {
            if session.save(Why::Now).is_err() {
                unsaved.push(session.id);
            }
        }
        let now = shared.ctx.clock.now();
        let mut report = backup::backup_notebook(
            shared.ctx.fs.as_ref(),
            &shared.root,
            dest,
            now,
            utc_offset_minutes,
            policy,
        )?;
        report.unsaved_pages = unsaved;
        Ok(report)
    }

    /// Backs the notebook up if `every` has passed since the last backup under `dest`, and answers with the
    /// report. `None` means no backup was due.
    pub fn backup_if_due(
        &self,
        dest: &Path,
        every: Duration,
        policy: &BackupPolicy,
        utc_offset_minutes: i32,
    ) -> Result<Option<BackupReport>, CoreError> {
        let fs = self.inner.ctx.fs.as_ref();
        let now = self.inner.ctx.clock.now();
        if !backup::backup_due(backup::last_backup(fs, &self.inner.root, dest), every, now) {
            return Ok(None);
        }
        self.backup_to(dest, policy, utc_offset_minutes).map(Some)
    }

    /// What Settings tells a person whose notebook folder a sync tool manages, or `None`.
    pub fn sync_notice(&self) -> Option<SyncNotice> {
        let volume = self.inner.ctx.fs.volume(&self.inner.root).ok()?;
        sync_notice(&volume)
    }
}

impl Core {
    /// When the newest complete backup of the notebook folder `notebook` under `dest` finished, for "Last
    /// backup" in Settings. Other notebooks' sets in the same folder don't count.
    pub fn last_backup(&self, notebook: &Path, dest: &Path) -> Option<Timestamp> {
        backup::last_backup(self.ctx().fs.as_ref(), notebook, dest)
    }

    /// What Setup tells a person who picks `folder` for their notes, or `None` when no sync tool manages it.
    pub fn sync_notice(&self, folder: &Path) -> Option<SyncNotice> {
        let volume = self.ctx().fs.volume(folder).ok()?;
        sync_notice(&volume)
    }
}
