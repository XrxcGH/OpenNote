//! Saving a page: steps S2 to S9 of spec 17.7.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::{PageStore, SaveError, SaveOutcome, SaveRequest};
use crate::error::{FsError, FsErrorKind, JournalError};
use crate::fail_point;
use crate::id::RevisionId;
use crate::limits::Policy;
use crate::model::{Access, Block, BlockData, Blocks, Ink, JsonMap, Page, ReadOnlyReason, Revision, SegmentRef};
use crate::store::fs::Fs;
use crate::store::layout::{NotebookLayout, ASSETS_DIR};

mod ink;

/// How long a save waits for the journal to flush `SaveBegin`.
const SAVE_BEGIN_TIMEOUT: Duration = Duration::from_secs(5);

/// Runs just before the fingerprint check and the replace, with the new revision and the last journal sequence
/// number the save includes: step S6.
pub type BeforeCommit<'a> = dyn FnMut(RevisionId, u64) -> Result<(), SaveError> + 'a;

impl PageStore {
    pub(super) fn save_page(&self, dir: &Path, req: SaveRequest<'_>) -> Result<SaveOutcome, SaveError> {
        let journal = req.journal;
        let mut save_begin = |revision: RevisionId, through: u64| match journal {
            Some(journal) => match journal.save_begin(revision, through, SAVE_BEGIN_TIMEOUT) {
                // A journal that can't be written can't help either way, and saving is what protects the edits
                // then (spec 20.12).
                Ok(()) | Err(JournalError::Degraded(_)) => Ok(()),
                Err(err) => Err(SaveError::Journal(err)),
            },
            None => Ok(()),
        };
        self.save_hooked(dir, req, &mut save_begin)
    }

    /// Saves with a custom step S6, for recovery, which appends `SaveBegin` to journal files it owns.
    pub(crate) fn save_hooked(
        &self,
        dir: &Path,
        req: SaveRequest<'_>,
        before_commit: &mut BeforeCommit<'_>,
    ) -> Result<SaveOutcome, SaveError> {
        refuse_protected(req.page)?;
        let ink = self.plan_ink(dir, &req)?;
        let (segments, dead_bytes) = (ink.segments.clone(), ink.dead_bytes);
        let prepare = || self.prepare_page(req.page, segments.clone(), dead_bytes);
        // The new page.json needs only the new segment's entry, and making and reading it back touches no file.
        // So it runs on another thread while the segment is written and flushed, and the file system sees the
        // same calls in the same order.
        let (written, prepared) = match &ink.file {
            None => (self.write_planned(dir, &ink), prepare()),
            Some(_) => std::thread::scope(|scope| {
                let thread = std::thread::Builder::new().spawn_scoped(scope, prepare);
                let written = self.write_planned(dir, &ink);
                let prepared = match thread {
                    Ok(thread) => thread.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
                    Err(_) => prepare(),
                };
                (written, prepared)
            }),
        };
        written?;
        self.check_assets(dir, req.page)?;
        let (page, bytes) = prepared?;
        before_commit(page.revision.id, req.through_seq)?;
        fail_point!("save.save_begin.flushed");
        self.check_disk(dir, req.page, req.base_stamp)?;
        let committed = self
            .config
            .fs
            .replace_durable(&NotebookLayout::page_json(dir), &bytes)
            .map_err(SaveError::Fs)?;
        fail_point!("save.page.flushed");
        Ok(SaveOutcome {
            revision: page.revision,
            durability: committed.durability,
            stamp: committed.stamp,
            segments,
            dead_bytes,
            bytes: Arc::from(bytes),
        })
    }

    /// S5: the page as it will be written, and its bytes, which must read back as the page.
    fn prepare_page(&self, page: &Page, segments: Vec<SegmentRef>, dead: u64) -> Result<(Page, Vec<u8>), SaveError> {
        let next = self.next_revision(page, segments, dead);
        let bytes = self.config.codec.write_page(&next);
        self.check_read_back(&next, &bytes)?;
        Ok((next, bytes))
    }

    /// S4: every asset in the table exists with its size.
    fn check_assets(&self, dir: &Path, page: &Page) -> Result<(), SaveError> {
        if page.assets.is_empty() {
            return Ok(());
        }
        let listing: HashMap<String, u64> = match self.config.fs.read_dir(&dir.join(ASSETS_DIR)) {
            Ok(entries) => entries.into_iter().map(|e| (e.name, e.len)).collect(),
            Err(err) if err.kind == FsErrorKind::NotFound => HashMap::new(),
            Err(err) => return Err(SaveError::Fs(err)),
        };
        match page.assets.values().find(|a| listing.get(&a.file) != Some(&a.bytes)) {
            Some(asset) => Err(SaveError::MissingAsset(asset.id)),
            None => Ok(()),
        }
    }

    /// S5, first half: the page as it will be written, with revision `R'` whose parent is `R`. Its ink holds
    /// only the segment list, which is all `page.json` stores: copying the live strokes would cost time on a
    /// large page, and freeing them again as much.
    fn next_revision(&self, page: &Page, segments: Vec<SegmentRef>, dead: u64) -> Page {
        let config = &self.config;
        let mut next = without_strokes(page);
        let mut ancestors = vec![page.revision.id];
        ancestors.extend(
            page.revision
                .ancestors
                .iter()
                .copied()
                .filter(|id| *id != page.revision.id),
        );
        ancestors.truncate(Policy::default().revision_ancestors);
        next.revision = Revision {
            id: RevisionId::generate(&*config.clock),
            parents: vec![page.revision.id],
            ancestors,
            saved_at: config.clock.now(),
            device: config.device.clone(),
            writer: config.writer.clone(),
            extra: JsonMap::new(),
        };
        next.ink.commit(0, segments, dead);
        let blocks: HashSet<_> = next.blocks.iter().map(|b| b.id).collect();
        next.view.reading_order.retain(|id| blocks.contains(id));
        fix_counts(&mut next.blocks, &page.ink);
        next
    }

    /// S5, second half: the bytes must read back as the page.
    fn check_read_back(&self, page: &Page, bytes: &[u8]) -> Result<(), SaveError> {
        let read = self
            .config
            .codec
            .read_page(bytes, &self.config.limits)
            .map_err(|err| SaveError::Serializer(format!("the written page doesn't read: {err}")))?;
        let read = read.page;
        if read.ink.segments() != page.ink.segments() {
            return Err(SaveError::Serializer("the segment list differs".to_owned()));
        }
        match first_difference(page, &read) {
            None => Ok(()),
            Some(field) => Err(SaveError::Serializer(format!("{field} differs after reading back"))),
        }
    }

    /// S7: `page.json` must still be the file this save started from, or hold the same revision.
    fn check_disk(&self, dir: &Path, page: &Page, base: Option<crate::store::fs::FileStamp>) -> Result<(), SaveError> {
        let Some(base) = base else {
            return Ok(());
        };
        let path = NotebookLayout::page_json(dir);
        let fs = &*self.config.fs;
        match fs.metadata(&path) {
            Ok(meta) if meta.stamp == base => Ok(()),
            Ok(_) => {
                let disk = fs
                    .read(&path, self.config.limits.page_json_bytes)
                    .ok()
                    .and_then(|bytes| self.config.codec.read_page(&bytes, &self.config.limits).ok())
                    .map(|read| read.page.revision.id);
                match disk {
                    Some(revision) if revision == page.revision.id => Ok(()),
                    disk => Err(SaveError::External { disk }),
                }
            }
            Err(err) if err.kind == FsErrorKind::NotFound => Err(SaveError::External { disk: None }),
            Err(err) => Err(SaveError::Fs(err)),
        }
    }
}

/// A page from a newer version, or of an encrypted section, is never replaced (spec 5.7 and 15.2).
fn refuse_protected(page: &Page) -> Result<(), SaveError> {
    let reason = match &page.format.access {
        Access::ReadOnly(reason @ (ReadOnlyReason::NewerFormat | ReadOnlyReason::Encrypted)) => Some(reason),
        _ => None,
    };
    if page.encryption.is_some() || reason.is_some() {
        return Err(SaveError::Serializer(format!(
            "refusing to replace a protected page: {reason:?}"
        )));
    }
    Ok(())
}

/// Sets each ink block's `strokeCount` to its live strokes (spec 8.3).
pub(super) fn fix_stroke_counts(page: &mut Page) {
    fix_counts(&mut page.blocks, &page.ink);
}

/// Sets each ink block's `strokeCount` to the number of live strokes of `ink` in it.
fn fix_counts(blocks: &mut Blocks, ink: &Ink) {
    let stale: Vec<Arc<Block>> = blocks
        .iter()
        .filter(|b| matches!(&b.data, BlockData::Ink(data) if data.stroke_count != ink.count_in_block(b.id)))
        .cloned()
        .collect();
    for block in stale {
        let mut fixed = Block::clone(&block);
        if let BlockData::Ink(data) = &mut fixed.data {
            data.stroke_count = ink.count_in_block(block.id);
        }
        // The block exists, so replacing it can't fail.
        let _ = blocks.replace(Arc::new(fixed));
    }
}

/// A copy of the page whose ink is empty: no strokes, segments, or pending records.
pub(crate) fn without_strokes(page: &Page) -> Page {
    Page {
        id: page.id,
        title: page.title.clone(),
        created: page.created,
        modified: page.modified,
        tags: page.tags.clone(),
        view: page.view.clone(),
        blocks: page.blocks.clone(),
        assets: page.assets.clone(),
        ink: Ink::default(),
        recordings: page.recordings.clone(),
        encryption: page.encryption.clone(),
        revision: page.revision.clone(),
        extra: page.extra.clone(),
        format: page.format.clone(),
    }
}

/// The name of the first field in which two pages differ.
fn first_difference(a: &Page, b: &Page) -> Option<&'static str> {
    let fields = [
        ("id", a.id == b.id),
        ("title", a.title == b.title),
        ("created", a.created == b.created),
        ("modified", a.modified == b.modified),
        ("tags", a.tags == b.tags),
        ("view", a.view == b.view),
        ("blocks", a.blocks == b.blocks),
        ("assets", a.assets == b.assets),
        ("recordings", a.recordings == b.recordings),
        ("encryption", a.encryption == b.encryption),
        ("revision", a.revision == b.revision),
        ("unknown keys", a.extra == b.extra),
    ];
    fields.into_iter().find(|(_, same)| !same).map(|(name, _)| name)
}

/// Creates a folder if it is missing.
pub(crate) fn ensure_dir(fs: &dyn Fs, path: &Path) -> Result<(), FsError> {
    match fs.metadata(path) {
        Ok(meta) if meta.is_dir => Ok(()),
        Ok(_) => Err(FsError::new(FsErrorKind::AlreadyExists, path)),
        Err(err) if err.kind == FsErrorKind::NotFound => match fs.create_dir_durable(path) {
            Ok(_) => Ok(()),
            Err(err) if err.kind == FsErrorKind::AlreadyExists => Ok(()),
            Err(err) => Err(err),
        },
        Err(err) => Err(err),
    }
}
