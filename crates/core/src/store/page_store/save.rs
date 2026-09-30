//! Saving a page: steps S2 to S9 of spec 17.7.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::{PageStore, SaveError, SaveOutcome, SaveRequest};
use crate::error::{FsError, FsErrorKind, JournalError};
use crate::fail_point;
use crate::format::{segment_footer_crc, DecodedSegment, SegmentHeader};
use crate::id::{RevisionId, SegmentId};
use crate::limits::Policy;
use crate::model::{Access, Block, BlockData, Ink, InkRecord, JsonMap, Page, ReadOnlyReason, Revision, SegmentRef};
use crate::store::compact::{compact, CompactionPlan};
use crate::store::fs::Fs;
use crate::store::layout::{NotebookLayout, ASSETS_DIR, INK_DIR};

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
        let (segments, dead_bytes) = self.write_ink(dir, &req)?;
        self.check_assets(dir, req.page)?;
        let page = self.next_revision(req.page, req.pending.len(), segments.clone(), dead_bytes);
        let bytes = self.config.codec.write_page(&page);
        self.check_read_back(&page, &bytes)?;
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

    /// S2 and S3: writes the new or compacted segment, and returns the new segment list and dead bytes.
    fn write_ink(&self, dir: &Path, req: &SaveRequest<'_>) -> Result<(Vec<SegmentRef>, u64), SaveError> {
        let ink = &req.page.ink;
        let old = ink.segments().to_vec();
        let plan = match req.compaction {
            CompactionPlan::Minor => match self.decode_all(dir, req.page) {
                Some(decoded) => return self.write_minor(dir, req, &decoded),
                None => CompactionPlan::Major,
            },
            plan => plan,
        };
        if plan == CompactionPlan::Major {
            let records = compact(ink, CompactionPlan::Major, &[]);
            let segments = self.write_segment(dir, req.page, &records)?.into_iter().collect();
            fail_point!("compact.written");
            return Ok((segments, 0));
        }
        let mut segments = old;
        segments.extend(self.write_segment(dir, req.page, req.pending)?);
        let dead = ink.dead_bytes().saturating_add(pending_dead(req.pending));
        Ok((segments, dead))
    }

    fn write_minor(
        &self,
        dir: &Path,
        req: &SaveRequest<'_>,
        decoded: &[DecodedSegment],
    ) -> Result<(Vec<SegmentRef>, u64), SaveError> {
        let working = with_pending(&req.page.ink, req.pending);
        let records = compact(
            working.as_ref().unwrap_or(&req.page.ink),
            CompactionPlan::Minor,
            decoded,
        );
        let mut segments: Vec<SegmentRef> = req.page.ink.segments().iter().take(1).cloned().collect();
        segments.extend(self.write_segment(dir, req.page, &records)?);
        let base = decoded.first().map(|d| d.records.clone()).unwrap_or_default();
        let dead = Ink::replay(Vec::new(), vec![base, records]).0.dead_bytes();
        fail_point!("compact.written");
        Ok((segments, dead))
    }

    /// Every listed segment, decoded without damage, or `None` when any can't be read.
    fn decode_all(&self, dir: &Path, page: &Page) -> Option<Vec<DecodedSegment>> {
        let config = &self.config;
        page.ink
            .segments()
            .iter()
            .map(|segment| {
                let path = NotebookLayout::segment_path(dir, segment.id);
                let bytes = config.fs.read(&path, config.limits.segment_bytes).ok()?;
                let decoded = config
                    .codec
                    .decode_segment(&bytes, segment, page.id, &config.limits)
                    .ok()?;
                (decoded.damaged.is_empty() && decoded.unknown_records == 0).then_some(decoded)
            })
            .collect()
    }

    /// Writes one segment with `create_durable`. No records write nothing.
    fn write_segment(&self, dir: &Path, page: &Page, records: &[InkRecord]) -> Result<Option<SegmentRef>, SaveError> {
        if records.is_empty() {
            return Ok(None);
        }
        let config = &self.config;
        let header = SegmentHeader {
            id: SegmentId::generate(&*config.clock),
            page: page.id,
            created: config.clock.now(),
        };
        let bytes = config.codec.encode_segment(&header, records);
        ensure_dir(&*config.fs, &dir.join(INK_DIR)).map_err(SaveError::Fs)?;
        let path = NotebookLayout::segment_path(dir, header.id);
        config.fs.create_durable(&path, &bytes).map_err(SaveError::Fs)?;
        fail_point!("save.segment.written");
        Ok(Some(SegmentRef {
            id: header.id,
            bytes: bytes.len() as u64,
            records: u32::try_from(records.len()).unwrap_or(u32::MAX),
            crc32: segment_footer_crc(&bytes).unwrap_or_else(|| crc32fast::hash(&bytes)),
            extra: JsonMap::new(),
        }))
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

    /// S5, first half: the page as it will be written, with revision `R'` whose parent is `R`.
    fn next_revision(&self, page: &Page, through: usize, segments: Vec<SegmentRef>, dead: u64) -> Page {
        let config = &self.config;
        let mut next = page.clone();
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
        next.ink.commit(through, segments, dead);
        let blocks: HashSet<_> = next.blocks.iter().map(|b| b.id).collect();
        next.reading_order.retain(|id| blocks.contains(id));
        fix_stroke_counts(&mut next);
        next
    }

    /// S5, second half: the bytes must read back as the page.
    fn check_read_back(&self, page: &Page, bytes: &[u8]) -> Result<(), SaveError> {
        let read = self
            .config
            .codec
            .read_page(bytes, &self.config.limits)
            .map_err(|err| SaveError::Serializer(format!("the written page doesn't read: {err}")))?;
        let mut read = read.page;
        if read.ink.segments() != page.ink.segments() {
            return Err(SaveError::Serializer("the segment list differs".to_owned()));
        }
        read.ink = page.ink.clone();
        read.format = page.format.clone();
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

/// The ink with `pending` as its pending records, when they differ from the snapshot's.
fn with_pending(ink: &Ink, pending: &[InkRecord]) -> Option<Ink> {
    if ink.pending() == pending {
        return None;
    }
    let mut working = ink.clone();
    working.commit(usize::MAX, ink.segments().to_vec(), ink.dead_bytes());
    for record in pending {
        working.push_pending(record.clone());
    }
    Some(working)
}

/// The dead bytes the pending records add, as a replay of the new segment counts them. A committed stroke that
/// the pending records remove is no longer in memory, so its bytes are only counted at the next load.
fn pending_dead(pending: &[InkRecord]) -> u64 {
    let mut shadow = Ink::default();
    let mut dead = 0u64;
    for record in pending {
        let killed = match record {
            InkRecord::Stroke(stroke) => shadow.insert(stroke.clone()),
            InkRecord::Remove(id) => shadow.remove(*id),
            InkRecord::Props(props) => {
                shadow.apply_props(props);
                None
            }
        };
        dead = dead.saturating_add(killed.map_or(0, |stroke| stroke.record_len()));
    }
    dead
}

/// Sets each ink block's `strokeCount` to its live strokes (spec 8.3).
pub(super) fn fix_stroke_counts(page: &mut Page) {
    let stale: Vec<Arc<Block>> = page
        .blocks
        .iter()
        .filter(|b| matches!(&b.data, BlockData::Ink(data) if data.stroke_count != page.ink.count_in_block(b.id)))
        .cloned()
        .collect();
    for block in stale {
        let mut fixed = Block::clone(&block);
        if let BlockData::Ink(data) = &mut fixed.data {
            data.stroke_count = page.ink.count_in_block(block.id);
        }
        // The block exists, so replacing it can't fail.
        let _ = page.blocks.replace(Arc::new(fixed));
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
        ("readingOrder", a.reading_order == b.reading_order),
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
