//! Step 7 of spec 20.10: rebuilding this device's version from the oldest base snapshot and every record after
//! it, and deciding what happens to the page on disk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::{defer, finish, located_outcome, Read, RecoverCtx, Stop};
use crate::error::FsErrorKind;
use crate::id::{AssetId, PageId};
use crate::model::{BlockData, Page};
use crate::session::events::{DeferReason, RecoveryOutcome};
use crate::store::compact::CompactionPlan;
use crate::store::layout::{ASSETS_DIR, PAGE_JSON};
use crate::store::page_store::{load_ink, LoadedPage};

use super::finish::SavePlan;
use super::replay::{after_anchor, replay};

/// What is on disk where the page should be.
pub enum Disk<'a> {
    /// A version without an anchor in the journal, in this folder.
    Other {
        /// The page folder.
        dir: PathBuf,
        /// The version on disk.
        loaded: &'a LoadedPage,
    },
    /// A `page.json` that doesn't read, in this folder.
    Damaged(Option<PathBuf>),
    /// No `page.json`, in this folder if one was found.
    Missing(Option<PathBuf>),
}

/// Rebuilds the page from the oldest readable base snapshot, and saves it.
pub fn rebuild(ctx: &RecoverCtx<'_>, read: &Read, page: PageId, disk: Disk<'_>) -> Result<RecoveryOutcome, Stop> {
    let Some((from, mut rebuilt)) = base_of(ctx, read, page) else {
        return Err(defer(DeferReason::PageUnavailable));
    };
    let anchor = read
        .generations
        .get(from)
        .map_or(0, |(_, generation)| generation.header.anchor);
    let (dir, outcome, base_stamp) = place(ctx, read, page, &rebuilt, disk)?;
    let limits = &ctx.store.config.limits;
    let ink = load_ink(ctx.fs, ctx.codec, &dir, &mut rebuilt, limits);
    let lost_ink = !ink.missing.is_empty() || !ink.damaged.is_empty();
    drop_missing_assets(ctx, &dir, &mut rebuilt);
    let records = after_anchor(&read.records(from), anchor);
    let done = replay(ctx, &mut rebuilt, &records);
    crate::fail_point!("recovery.replayed");
    let plan = SavePlan {
        dir: &dir,
        base_stamp,
        compaction: if lost_ink {
            CompactionPlan::Major
        } else {
            CompactionPlan::None
        },
    };
    finish(ctx, read, &rebuilt, &plan, done, outcome)
}

/// The oldest base snapshot that reads as this page, and its generation's index.
fn base_of(ctx: &RecoverCtx<'_>, read: &Read, page: PageId) -> Option<(usize, Page)> {
    let limits = &ctx.store.config.limits;
    read.generations
        .iter()
        .enumerate()
        .find_map(|(index, (_, generation))| {
            let bytes = generation.base.as_deref()?;
            let base = ctx.codec.read_page(bytes, limits).ok()?.page;
            (base.id == page).then_some((index, base))
        })
}

type Placed = (PathBuf, RecoveryOutcome, Option<crate::store::fs::FileStamp>);

/// Where the rebuilt page goes, what happens to the file on disk, and the outcome.
fn place(ctx: &RecoverCtx<'_>, read: &Read, page: PageId, rebuilt: &Page, disk: Disk<'_>) -> Result<Placed, Stop> {
    match disk {
        Disk::Other { dir, loaded } => {
            let revision = loaded.page.revision.id;
            let ancestor = revision == rebuilt.revision.id || rebuilt.revision.ancestors.contains(&revision);
            if ancestor {
                return Ok((dir, RecoveryOutcome::FastForward, Some(loaded.stamp)));
            }
            let conflict = ctx.store.keep_conflict(&dir, &loaded.bytes)?;
            Ok((dir, RecoveryOutcome::KeptBoth { conflict }, Some(loaded.stamp)))
        }
        Disk::Damaged(Some(dir)) => {
            ctx.store.move_damaged(&dir, PAGE_JSON)?;
            Ok((dir, RecoveryOutcome::ReplacedDamaged, None))
        }
        Disk::Missing(Some(dir)) => {
            let outcome = located_outcome(ctx, read, page, &dir, RecoveryOutcome::Recreated);
            Ok((dir, outcome, None))
        }
        Disk::Damaged(None) | Disk::Missing(None) => {
            let dir = read
                .section_dir(ctx.layout, page)
                .ok_or_else(|| defer(DeferReason::PageUnavailable))?;
            create_page_dir(ctx, &dir)?;
            Ok((dir, RecoveryOutcome::Recreated, None))
        }
    }
}

/// Creates the folder of a page that is gone everywhere, inside its section, which must still exist.
fn create_page_dir(ctx: &RecoverCtx<'_>, dir: &Path) -> Result<(), Stop> {
    match ctx.fs.create_dir_durable(dir) {
        Ok(_) => Ok(()),
        Err(err) if err.kind == FsErrorKind::AlreadyExists => Ok(()),
        Err(err) if err.kind == FsErrorKind::NotFound => Err(defer(DeferReason::PageUnavailable)),
        Err(err) => Err(err.into()),
    }
}

/// Assets whose files went with a lost folder can't come back. Their entries go, with the image and file
/// blocks that show them, so the recovered page refers only to files that exist (invariant I1).
fn drop_missing_assets(ctx: &RecoverCtx<'_>, dir: &Path, page: &mut Page) {
    if page.assets.is_empty() {
        return;
    }
    let listing: HashMap<String, u64> = ctx
        .fs
        .read_dir(&dir.join(ASSETS_DIR))
        .unwrap_or_default()
        .into_iter()
        .map(|entry| (entry.name, entry.len))
        .collect();
    let gone: Vec<AssetId> = page
        .assets
        .values()
        .filter(|asset| listing.get(&asset.file) != Some(&asset.bytes))
        .map(|asset| asset.id)
        .collect();
    for id in &gone {
        page.assets.remove(id);
    }
    let blocks: Vec<_> = page
        .blocks
        .iter()
        .filter(|block| match &block.data {
            BlockData::Image(image) => gone.contains(&image.asset),
            BlockData::File(file) => gone.contains(&file.asset),
            _ => false,
        })
        .map(|block| block.id)
        .collect();
    for block in blocks {
        page.blocks.remove(block);
    }
}
