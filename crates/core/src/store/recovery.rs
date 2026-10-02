//! Crash recovery of one page from its journal generations (spec 20.10 and 20.11). Owned by WP4.
//!
//! Recovery reads every generation up to its end rule and loads `page.json`. Then it finds the anchor: the
//! latest generation whose base is the revision on disk, or the latest `SaveBegin` or `Closed` record for it.
//! With an anchor it replays the records after it. Without one it rebuilds this device's version from the oldest base
//! snapshot and keeps whatever is on disk as well. Generations are deleted only after a confirmed save, so a
//! crash during recovery simply repeats it.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, FsError, FsErrorKind};
use crate::fail_point;
use crate::id::PageId;
use crate::model::asset::hex;
use crate::model::{Access, ReadOnlyReason};
use crate::seams::{Applier, Codec};
use crate::session::events::{DeferReason, RecoveryOutcome};
use crate::store::fs::{FolderIdentity, Fs, FsLock};
use crate::store::journal::format::HeaderMeta;
use crate::store::journal::reader::{read_generation, JournalGen, JournalRecord};
use crate::store::layout::NotebookLayout;
use crate::store::page_store::{ensure_dir, LoadError, LoadedPage, PageStore};
use crate::time::Clock;

mod finish;
mod rebuild;
mod replay;

use finish::{save_recovered, Journals, SavePlan};
use replay::{after_anchor, replay, write_recovery_file, Replayed};

/// What recovery needs.
pub struct RecoverCtx<'a> {
    /// The file system.
    pub fs: &'a dyn Fs,
    /// The codec.
    pub codec: &'a dyn Codec,
    /// The applier for replayed transactions.
    pub applier: &'a dyn Applier,
    /// The page store that saves the recovered page.
    pub store: &'a PageStore,
    /// The notebook's layout.
    pub layout: &'a NotebookLayout,
    /// The notebook folder's identity, which the journal must match.
    pub identity: &'a FolderIdentity,
    /// The current boot identifier.
    pub boot: &'a str,
    /// The clock.
    pub clock: &'a dyn Clock,
    /// Finds a page folder by ID, in any section or in Trash.
    pub locate: &'a dyn Fn(PageId) -> Option<PathBuf>,
    /// Where changes that couldn't be applied go.
    pub recovery_dir: &'a Path,
}

/// Why recovery stopped early.
enum Stop {
    /// With this outcome.
    Outcome(RecoveryOutcome),
    /// With an error.
    Error(CoreError),
}

impl From<CoreError> for Stop {
    fn from(err: CoreError) -> Stop {
        Stop::Error(err)
    }
}

impl From<FsError> for Stop {
    fn from(err: FsError) -> Stop {
        Stop::Error(err.into())
    }
}

fn defer(reason: DeferReason) -> Stop {
    Stop::Outcome(RecoveryOutcome::Deferred { reason })
}

/// The generations of the page as read, oldest first.
struct Read {
    generations: Vec<(PathBuf, JournalGen)>,
    /// Files and damaged tails to keep in `recovery/`: the file, the bytes, and whether the file moves there.
    quarantine: Vec<(PathBuf, Vec<u8>, bool)>,
}

impl Read {
    fn records(&self, from: usize) -> Vec<&[JournalRecord]> {
        self.generations
            .iter()
            .skip(from)
            .map(|(_, g)| g.records.as_slice())
            .collect()
    }

    fn journals(&self) -> Journals {
        Journals {
            paths: self.generations.iter().map(|(path, _)| path.clone()).collect(),
            last_seq: self.generations.iter().map(|(_, g)| g.last_seq()).max().unwrap_or(0),
            torn: self
                .generations
                .last()
                .filter(|(_, g)| g.stop.offset().is_some())
                .map(|(_, g)| g.header.clone()),
        }
    }

    /// Where the journal says the page was.
    fn section_dir(&self, layout: &NotebookLayout, page: PageId) -> Option<PathBuf> {
        let (_, newest) = self.generations.last()?;
        let section = HeaderMeta::from_value(&newest.header.meta)?.section?;
        Some(layout.page_dir(section, page))
    }
}

/// Recovers one page from its journal generations.
pub fn recover_page(ctx: &RecoverCtx, page: PageId, generations: &[PathBuf]) -> Result<RecoveryOutcome, CoreError> {
    match recover(ctx, page, generations) {
        Ok(outcome) | Err(Stop::Outcome(outcome)) => Ok(outcome),
        Err(Stop::Error(err)) => Err(err),
    }
}

fn recover(ctx: &RecoverCtx<'_>, page: PageId, generations: &[PathBuf]) -> Result<RecoveryOutcome, Stop> {
    let early = (ctx.locate)(page);
    let Some((locks, read, loaded)) = lock_and_read(ctx, page, generations, early.as_deref())? else {
        return Ok(RecoveryOutcome::OwnerAlive);
    };
    let (located, loaded) = still_current(ctx, page, early, loaded);
    let read = read?;
    drop(locks);
    for (path, bytes, move_file) in &read.quarantine {
        quarantine(ctx, path, bytes, *move_file)?;
    }
    if read.generations.is_empty() {
        return Ok(RecoveryOutcome::Nothing);
    }
    let outcome = match &loaded {
        Ok(loaded) if is_damaged(loaded) => rebuild::rebuild(ctx, &read, page, rebuild::Disk::Damaged(located))?,
        Ok(loaded) => {
            check_writable(loaded)?;
            let dir = located.unwrap_or_default();
            match anchored(ctx, &read, loaded, &dir)? {
                Some(outcome) => outcome,
                None => rebuild::rebuild(ctx, &read, page, rebuild::Disk::Other { dir, loaded })?,
            }
        }
        Err(LoadError::Missing) => rebuild::rebuild(ctx, &read, page, rebuild::Disk::Missing(located))?,
        Err(LoadError::Damaged(_)) => rebuild::rebuild(ctx, &read, page, rebuild::Disk::Damaged(located))?,
        Err(LoadError::NewerFormat(_)) => return Err(defer(DeferReason::NewerPage)),
        Err(LoadError::Unavailable(_)) => return Err(defer(DeferReason::PageUnavailable)),
    };
    free_later((read, loaded));
    Ok(outcome)
}

/// The generations' locks, the generations as read, and the page as loaded from `located`, or `None` when
/// another process holds a generation.
type Locked = Option<(
    Vec<Box<dyn FsLock>>,
    Result<Read, Stop>,
    Option<Result<LoadedPage, LoadError>>,
)>;

/// Locks and reads every generation, while the page loads from `located` on another thread. Loading only reads
/// files, so it starts before the locks: a virus scanner may hold a journal file that was just written for many
/// milliseconds. [`still_current`] then checks what it loaded.
fn lock_and_read(
    ctx: &RecoverCtx<'_>,
    page: PageId,
    generations: &[PathBuf],
    located: Option<&Path>,
) -> Result<Locked, Stop> {
    let store = ctx.store;
    std::thread::scope(|scope| {
        let load = located.map(|dir| std::thread::Builder::new().spawn_scoped(scope, move || store.load(dir)));
        let mut locks = Vec::new();
        for path in generations {
            match ctx.fs.try_lock(path)? {
                Some(lock) => locks.push(lock),
                None => return Ok(None),
            }
        }
        let read = read_all(ctx, page, generations);
        let loaded = match load {
            Some(Ok(handle)) => Some(handle.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic))),
            Some(Err(_)) | None => None,
        };
        Ok(Some((locks, read, loaded)))
    })
}

/// Where the page is now, and the page as loaded before the locks if it is still the one on disk: in the same
/// folder, with the same `page.json` fingerprint. Otherwise the page loads again. The process that held the
/// journal until a moment before may have saved or moved the page meanwhile.
fn still_current(
    ctx: &RecoverCtx<'_>,
    page: PageId,
    early: Option<PathBuf>,
    loaded: Option<Result<LoadedPage, LoadError>>,
) -> (Option<PathBuf>, Result<LoadedPage, LoadError>) {
    let located = (ctx.locate)(page);
    let Some(dir) = located.as_deref() else {
        return (located, Err(LoadError::Missing));
    };
    let loaded = match (loaded, early.as_deref() == Some(dir)) {
        (Some(Ok(loaded)), true) if ctx.store.fingerprint(dir).ok().flatten() == Some(loaded.stamp) => Ok(loaded),
        _ => ctx.store.load(dir),
    };
    (located, loaded)
}

/// Reads every generation. A newer journal or another folder's journal stops recovery. A generation whose
/// header is damaged moves to `recovery/`, and the damaged tail of a generation is copied there.
fn read_all(ctx: &RecoverCtx<'_>, page: PageId, paths: &[PathBuf]) -> Result<Read, Stop> {
    let limits = &ctx.store.config.limits;
    let identity = hex(&ctx.identity.0);
    let mut generations = Vec::new();
    let mut kept = Vec::new();
    for path in paths {
        let bytes = match ctx.fs.read(path, u64::MAX) {
            Ok(bytes) => bytes,
            Err(err) if err.kind == FsErrorKind::NotFound => continue,
            Err(err) => return Err(err.into()),
        };
        let generation = match read_generation(&bytes, ctx.codec, limits) {
            Ok(generation) => generation,
            Err(err) if matches!(err.kind, crate::error::FormatErrorKind::NewerVersion(_)) => {
                return Err(defer(DeferReason::NewerJournal));
            }
            Err(_) => {
                kept.push((path.clone(), bytes, true));
                continue;
            }
        };
        if generation.header.page != page {
            continue;
        }
        let meta = HeaderMeta::from_value(&generation.header.meta);
        if meta.is_none_or(|meta| meta.notebook_identity != identity) {
            return Err(defer(DeferReason::IdentityMismatch));
        }
        if let Some(offset) = generation.stop.offset().filter(|_| !generation.stop.is_clean()) {
            let tail = bytes
                .get(usize::try_from(offset).unwrap_or(usize::MAX)..)
                .unwrap_or_default();
            kept.push((path.clone(), tail.to_vec(), false));
        }
        generations.push((path.clone(), generation));
    }
    generations.sort_by_key(|(_, g)| g.header.generation);
    Ok(Read {
        generations,
        quarantine: kept,
    })
}

/// Frees the generations or pages on another thread. Freeing thousands of decoded records or strokes takes a
/// few milliseconds that recovery needn't wait for. Without a thread, they are freed here.
fn free_later<T: Send + 'static>(value: T) {
    let _ = std::thread::Builder::new().spawn(move || drop(value));
}

/// Keeps bytes in `recovery/` for diagnosis. With `move_file`, the generation itself goes there.
fn quarantine(ctx: &RecoverCtx<'_>, path: &Path, bytes: &[u8], move_file: bool) -> Result<(), CoreError> {
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let suffix = if move_file { "" } else { ".tail" };
    ensure_dir(ctx.fs, ctx.recovery_dir)?;
    match ctx
        .fs
        .create_durable(&ctx.recovery_dir.join(format!("{name}{suffix}")), bytes)
    {
        Ok(_) => {}
        Err(err) if err.kind == FsErrorKind::AlreadyExists => {}
        Err(err) => return Err(err.into()),
    }
    if move_file {
        ctx.fs.remove_file(path)?;
    }
    Ok(())
}

fn is_damaged(loaded: &LoadedPage) -> bool {
    loaded.page.format.access == Access::ReadOnly(ReadOnlyReason::Damaged)
}

/// A page that is still arriving, has damaged ink, or came from a newer version waits (spec 14.5 and 9.6).
fn check_writable(loaded: &LoadedPage) -> Result<(), Stop> {
    match &loaded.page.format.access {
        Access::ReadWrite => Ok(()),
        Access::ReadOnly(ReadOnlyReason::NewerFormat | ReadOnlyReason::UnknownInkData) => {
            Err(defer(DeferReason::NewerPage))
        }
        Access::ReadOnly(_) => Err(defer(DeferReason::PageUnavailable)),
    }
}

/// Step 6: with an anchor for the revision on disk, replays the records after it. `None` without an anchor.
fn anchored(
    ctx: &RecoverCtx<'_>,
    read: &Read,
    loaded: &LoadedPage,
    dir: &Path,
) -> Result<Option<RecoveryOutcome>, Stop> {
    let Some((from, anchor)) = anchor_for(read, loaded) else {
        return Ok(None);
    };
    let records = after_anchor(&read.records(from), anchor);
    if !records.iter().any(|record| record.is_edit()) {
        return forget(ctx, read).map(Some);
    }
    let mut page = loaded.page.clone();
    let done = replay(ctx, &mut page, &records);
    fail_point!("recovery.replayed");
    let plan = SavePlan {
        dir,
        base_stamp: Some(loaded.stamp),
        compaction: crate::store::compact::CompactionPlan::None,
    };
    let default = RecoveryOutcome::Replayed {
        txns: done.txns,
        strokes: done.strokes,
    };
    let outcome = finish(
        ctx,
        read,
        &page,
        &plan,
        done,
        located_outcome(ctx, read, page.id, dir, default),
    );
    free_later(page);
    outcome.map(Some)
}

/// The latest anchor for the revision on disk, and the generation to collect records from.
fn anchor_for(read: &Read, loaded: &LoadedPage) -> Option<(usize, u64)> {
    let revision = loaded.page.revision.id;
    let mut best: Option<(u64, usize)> = None;
    for (index, (_, generation)) in read.generations.iter().enumerate() {
        let mut consider = |anchor: u64| {
            if best.is_none_or(|b| (anchor, index) > b) {
                best = Some((anchor, index));
            }
        };
        if generation.header.base == revision {
            consider(generation.header.anchor);
        }
        for record in &generation.records {
            match record {
                JournalRecord::SaveBegin {
                    revision: saved,
                    through_seq,
                    ..
                } if *saved == revision => consider(*through_seq),
                JournalRecord::Closed {
                    revision: saved, seq, ..
                } if *saved == revision => consider(*seq),
                _ => {}
            }
        }
    }
    best.map(|(anchor, index)| (index, anchor))
}

/// Nothing to replay: the generations go only if the newest boot they record is not this one (spec 20.9).
fn forget(ctx: &RecoverCtx<'_>, read: &Read) -> Result<RecoveryOutcome, Stop> {
    let closed = read
        .generations
        .iter()
        .flat_map(|(_, g)| g.records.iter())
        .filter_map(|record| match record {
            JournalRecord::Closed { seq, boot, .. } => Some((*seq, boot.clone())),
            _ => None,
        })
        .max_by_key(|(seq, _)| *seq)
        .map(|(_, boot)| boot);
    let header = read
        .generations
        .last()
        .and_then(|(_, g)| HeaderMeta::from_value(&g.header.meta))
        .map(|meta| meta.boot);
    if closed.or(header).as_deref() != Some(ctx.boot) {
        read.journals().delete(ctx)?;
    }
    Ok(RecoveryOutcome::Nothing)
}

/// Saves the page, or what applied of it, and reports the outcome.
fn finish(
    ctx: &RecoverCtx<'_>,
    read: &Read,
    page: &crate::model::Page,
    plan: &SavePlan<'_>,
    done: Replayed,
    outcome: RecoveryOutcome,
) -> Result<RecoveryOutcome, Stop> {
    let partly = match &done.failed {
        Some((err, txns)) => Some(write_recovery_file(ctx, page.id, err, txns)?),
        None => None,
    };
    let mut journals = read.journals();
    save_recovered(ctx, page, plan, &mut journals)?;
    Ok(match partly {
        Some(recovery_file) => RecoveryOutcome::PartlyApplied { recovery_file },
        None => outcome,
    })
}

/// `Relocated` when the page was found somewhere other than where its journal started.
fn located_outcome(
    ctx: &RecoverCtx<'_>,
    read: &Read,
    page: PageId,
    dir: &Path,
    default: RecoveryOutcome,
) -> RecoveryOutcome {
    match read.section_dir(ctx.layout, page) {
        Some(expected) if expected != dir => RecoveryOutcome::Relocated,
        _ => default,
    }
}

#[cfg(test)]
mod tests;
