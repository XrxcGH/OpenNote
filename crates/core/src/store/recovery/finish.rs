//! Saving a recovered page, and closing its journal generations as spec 20.9 describes.

use std::path::{Path, PathBuf};

use super::RecoverCtx;
use crate::error::{CoreError, FormatError, FormatErrorKind, FsErrorKind};
use crate::fail_point;
use crate::id::RevisionId;
use crate::model::{Page, VersionReason};
use crate::store::compact::CompactionPlan;
use crate::store::fs::{Durability, FileStamp};
use crate::store::history::write_version;
use crate::store::journal::encode;
use crate::store::journal::reader::JournalRecord;
use crate::store::page_store::{SaveError, SaveRequest};
use crate::store::PageFiles;

/// The generations being recovered, and the highest sequence number in them.
pub struct Journals {
    /// Every readable generation, oldest first.
    pub paths: Vec<PathBuf>,
    /// The highest sequence number in any of them.
    pub last_seq: u64,
}

impl Journals {
    /// Appends a record to the newest generation, and flushes it. Best effort: a journal that can't be written
    /// only costs a spurious conflict if the power fails before the save is on disk.
    fn append(&mut self, ctx: &RecoverCtx<'_>, record: impl FnOnce(u64) -> JournalRecord) {
        let Some(path) = self.paths.last() else {
            return;
        };
        let seq = self.last_seq.saturating_add(1);
        let bytes = encode(&record(seq), ctx.codec);
        let written = ctx.fs.open_append(path, false).and_then(|mut file| {
            file.append(&bytes)?;
            file.sync()
        });
        if written.is_ok() {
            self.last_seq = seq;
        }
    }

    /// Deletes every generation.
    pub fn delete(&self, ctx: &RecoverCtx<'_>) -> Result<(), CoreError> {
        for path in &self.paths {
            match ctx.fs.remove_file(path) {
                Ok(()) => {}
                Err(err) if err.kind == FsErrorKind::NotFound => {}
                Err(err) => return Err(err.into()),
            }
        }
        Ok(())
    }
}

/// How a recovered page is saved.
pub struct SavePlan<'a> {
    /// Its folder.
    pub dir: &'a Path,
    /// The fingerprint of the `page.json` it replaces, if any.
    pub base_stamp: Option<FileStamp>,
    /// Major compaction when some of its ink is gone.
    pub compaction: CompactionPlan,
}

/// Saves the page with `SaveBegin` in the journal first, keeps it as a `recovered` version, and closes the
/// generations: deleted after a confirmed save, kept with a `Closed` record after an unconfirmed one.
pub fn save_recovered(
    ctx: &RecoverCtx<'_>,
    page: &Page,
    plan: &SavePlan<'_>,
    journals: &mut Journals,
) -> Result<RevisionId, CoreError> {
    let request = SaveRequest {
        page,
        pending: page.ink.pending(),
        through_seq: journals.last_seq,
        base_stamp: plan.base_stamp,
        journal: None,
        compaction: plan.compaction,
    };
    let mut save_begin = |revision: RevisionId, through_seq: u64| {
        journals.append(ctx, |seq| JournalRecord::SaveBegin {
            seq,
            revision,
            through_seq,
        });
        Ok(())
    };
    let outcome = ctx
        .store
        .save_hooked(plan.dir, request, &mut save_begin)
        .map_err(core_error)?;
    fail_point!("recovery.saved");
    let mut saved = page.clone();
    saved.revision = outcome.revision.clone();
    let files = PageFiles {
        fs: ctx.fs,
        codec: ctx.codec,
        dir: plan.dir,
    };
    // History is best effort: losing a version never loses the page's content.
    let _ = write_version(&files, &outcome.bytes, &saved, VersionReason::Recovered, None);
    match outcome.durability {
        Durability::Confirmed => journals.delete(ctx)?,
        Durability::Unconfirmed => journals.append(ctx, |seq| JournalRecord::Closed {
            seq,
            revision: outcome.revision.id,
            boot: ctx.boot.to_owned(),
        }),
    }
    Ok(outcome.revision.id)
}

/// A save error as a core error.
pub fn core_error(err: SaveError) -> CoreError {
    match err {
        SaveError::Fs(err) => CoreError::Fs(err),
        SaveError::External { disk } => CoreError::Conflict(format!("page.json changed on disk: {disk:?}")),
        SaveError::Serializer(detail) => CoreError::Format(FormatError::new(FormatErrorKind::Validation, detail)),
        SaveError::MissingAsset(asset) => CoreError::NotFound(format!("asset {asset}")),
        SaveError::Journal(err) => CoreError::Journal(err),
    }
}
