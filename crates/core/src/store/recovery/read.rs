//! Steps 1 to 4 of recovery: locking and reading the journal generations, and loading the page.

use std::path::{Path, PathBuf};

use super::{defer, Read, RecoverCtx, Stop};
use crate::error::FsErrorKind;
use crate::id::PageId;
use crate::model::asset::hex;
use crate::session::events::DeferReason;
use crate::store::fs::FsLock;
use crate::store::journal::format::HeaderMeta;
use crate::store::journal::reader::read_generation;
use crate::store::page_store::{LoadError, LoadedPage};

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
pub(super) fn lock_and_read(
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
pub(super) fn still_current(
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
