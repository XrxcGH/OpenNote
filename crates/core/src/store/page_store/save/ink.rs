//! Steps S2 and S3 of a save: the new or compacted segment, planned and then written.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::ensure_dir;
use crate::fail_point;
use crate::format::{segment_footer_crc, DecodedSegment, SegmentHeader};
use crate::id::{SegmentId, StrokeId};
use crate::model::{Ink, InkRecord, JsonMap, Page, SegmentRef};
use crate::store::compact::{compact, merged_dead_bytes, CompactionPlan};
use crate::store::layout::{NotebookLayout, INK_DIR};
use crate::store::page_store::{PageStore, SaveError, SaveRequest};

impl PageStore {
    /// S2 and S3, first half: the new or compacted segment, encoded, and the segment list and dead bytes after it.
    pub(super) fn plan_ink(&self, dir: &Path, req: &SaveRequest<'_>) -> Result<InkPlan, SaveError> {
        let ink = &req.page.ink;
        let plan = match req.compaction {
            CompactionPlan::Minor => match self.decode_all(dir, req.page, req.pending) {
                Some(decoded) => return Ok(self.plan_minor(req, &decoded)),
                None => CompactionPlan::Major,
            },
            plan => plan,
        };
        if plan == CompactionPlan::Major {
            let records = compact(ink, CompactionPlan::Major, &[]);
            let file = self.encode_segment(req.page, &records, false);
            let segments = file.iter().map(|file| file.entry.clone()).collect();
            return Ok(InkPlan {
                segments,
                dead_bytes: 0,
                file,
                compacted: true,
            });
        }
        let file = self.encode_segment(req.page, req.pending, true);
        let mut segments = ink.segments().to_vec();
        segments.extend(file.iter().map(|file| file.entry.clone()));
        Ok(InkPlan {
            segments,
            dead_bytes: ink.dead_bytes().saturating_add(pending_dead(req.pending)),
            file,
            compacted: false,
        })
    }

    fn plan_minor(&self, req: &SaveRequest<'_>, decoded: &[DecodedSegment]) -> InkPlan {
        let working = with_pending(&req.page.ink, req.pending);
        let records = compact(
            working.as_ref().unwrap_or(&req.page.ink),
            CompactionPlan::Minor,
            decoded,
        );
        let file = self.encode_segment(req.page, &records, true);
        let mut segments: Vec<SegmentRef> = req.page.ink.segments().iter().take(1).cloned().collect();
        segments.extend(file.iter().map(|file| file.entry.clone()));
        let base = decoded.first().map(|d| d.records.as_slice()).unwrap_or_default();
        InkPlan {
            segments,
            dead_bytes: merged_dead_bytes(base, &records),
            file,
            compacted: true,
        }
    }

    /// S2 and S3, second half: writes the planned segment with `create_durable`.
    pub(super) fn write_planned(&self, dir: &Path, plan: &InkPlan) -> Result<(), SaveError> {
        if let Some(file) = &plan.file {
            let fs = &*self.config.fs;
            ensure_dir(fs, &dir.join(INK_DIR)).map_err(SaveError::Fs)?;
            let path = NotebookLayout::segment_path(dir, file.entry.id);
            fs.create_durable(&path, &file.bytes).map_err(SaveError::Fs)?;
            fail_point!("save.segment.written");
            if let Some(decoded) = &file.decoded {
                self.remember(&file.entry, decoded.clone());
            }
        }
        if plan.compacted {
            fail_point!("compact.written");
        }
        Ok(())
    }

    /// Removes the segment a save wrote before it failed, so the retries of a save that can't succeed don't
    /// leave an orphan file behind each time. `page.json` never named the segment, so nothing refers to it.
    pub(super) fn discard_planned(&self, dir: &Path, plan: &InkPlan) {
        if let Some(file) = &plan.file {
            let path = NotebookLayout::segment_path(dir, file.entry.id);
            let _ = self.config.fs.remove_file(&path);
            self.forget(&file.entry);
        }
    }

    /// Every listed segment, decoded without damage, or `None` when any can't be read.
    ///
    /// The later segments are decoded first. The base then skips the strokes they don't touch, which stay in it
    /// unchanged and were checked when the page opened. Their points go unchecked, and a stroke whose only record
    /// is a `Stroke` record is left out, since it adds no dead bytes. The footer CRC-32 still covers every byte.
    fn decode_all(&self, dir: &Path, page: &Page, pending: &[InkRecord]) -> Option<Vec<DecodedSegment>> {
        let Some((base, later)) = page.ink.segments().split_first() else {
            return Some(Vec::new());
        };
        // A segment this store wrote since the base is taken from memory: reading a file just written can wait
        // for a virus scanner, and it holds what was written.
        let later: Vec<DecodedSegment> = later
            .iter()
            .map(|segment| {
                self.remembered(segment)
                    .or_else(|| self.decode_intact(dir, page, segment, &|_| true))
            })
            .collect::<Option<_>>()?;
        let touched: HashSet<StrokeId> = later
            .iter()
            .flat_map(|segment| segment.records.iter())
            .chain(pending)
            .map(InkRecord::stroke_id)
            .collect();
        let base = self.decode_intact(dir, page, base, &|id| touched.contains(&id))?;
        Some(std::iter::once(base).chain(later).collect())
    }

    /// One segment, decoded without damage, or `None`.
    fn decode_intact(
        &self,
        dir: &Path,
        page: &Page,
        segment: &SegmentRef,
        touched: &(dyn Fn(StrokeId) -> bool + Sync),
    ) -> Option<DecodedSegment> {
        let config = &self.config;
        let path = NotebookLayout::segment_path(dir, segment.id);
        let bytes = config.fs.read(&path, config.limits.segment_bytes).ok()?;
        let decoded = config
            .codec
            .decode_segment_for(&bytes, segment, page.id, &config.limits, touched)
            .ok()?;
        (decoded.damaged.is_empty() && decoded.unknown_records == 0).then_some(decoded)
    }

    /// One segment, encoded, with its entry, and its records when `remember` is set. No records make no
    /// segment.
    fn encode_segment(&self, page: &Page, records: &[InkRecord], remember: bool) -> Option<SegmentFile> {
        if records.is_empty() {
            return None;
        }
        let config = &self.config;
        let header = SegmentHeader {
            id: SegmentId::generate(&*config.clock),
            page: page.id,
            created: config.clock.now(),
        };
        let bytes = config.codec.encode_segment(&header, records);
        let decoded = remember.then(|| DecodedSegment {
            header,
            records: records.to_vec(),
            damaged: Vec::new(),
            unknown_records: 0,
            footer_ok: true,
        });
        let entry = SegmentRef {
            id: header.id,
            bytes: bytes.len() as u64,
            records: u32::try_from(records.len()).unwrap_or(u32::MAX),
            crc32: segment_footer_crc(&bytes).unwrap_or_else(|| crc32fast::hash(&bytes)),
            extra: JsonMap::new(),
        };
        Some(SegmentFile { entry, bytes, decoded })
    }
}

/// The ink a save writes: the segment list after it, its dead bytes, and the one new segment, if any.
pub(super) struct InkPlan {
    pub segments: Vec<SegmentRef>,
    pub dead_bytes: u64,
    pub file: Option<SegmentFile>,
    /// Whether the new segment comes from a compaction.
    pub compacted: bool,
}

/// A new segment file and its entry in `page.json`.
pub(super) struct SegmentFile {
    entry: SegmentRef,
    bytes: Vec<u8>,
    /// The records, for a segment that a later minor compaction may merge. A major compaction's new base is
    /// left out: it can be large, and a minor compaction reads little of it.
    decoded: Option<DecodedSegment>,
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
    if pending.iter().all(|record| matches!(record, InkRecord::Stroke(_))) {
        replaced_bytes(pending)
    } else {
        shadow_dead(pending)
    }
}

/// [`pending_dead`] for records that only add strokes: they kill only the strokes they add again. Counting
/// those needs no shadow ink, whose indexes cost milliseconds for the thousands of strokes a recovered journal
/// saves.
fn replaced_bytes(pending: &[InkRecord]) -> u64 {
    let mut sizes: HashMap<StrokeId, u64> = HashMap::with_capacity(pending.len());
    pending
        .iter()
        .filter_map(|record| match record {
            InkRecord::Stroke(stroke) => sizes.insert(stroke.id, stroke.record_len()),
            _ => None,
        })
        .fold(0u64, u64::saturating_add)
}

/// [`pending_dead`] for any records: replays them on a shadow ink.
fn shadow_dead(pending: &[InkRecord]) -> u64 {
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use std::sync::Arc;

    use super::*;
    use crate::id::Id;
    use crate::model::Affine;
    use crate::testing::sample::sample_stroke;

    #[test]
    fn strokes_added_again_count_as_dead_without_a_shadow_ink() {
        let first = Arc::new(sample_stroke());
        let mut other = sample_stroke();
        other.id = StrokeId(Id::from_parts(9, 9));
        let mut again = sample_stroke();
        again.transform = Some(Affine([2.0, 0.0, 0.0, 2.0, 0.0, 0.0]));
        let pending: Vec<InkRecord> = [first.clone(), Arc::new(other), Arc::new(again)]
            .into_iter()
            .map(InkRecord::Stroke)
            .collect();
        assert_eq!(pending_dead(&pending), first.record_len());
        assert_eq!(replaced_bytes(&pending), shadow_dead(&pending));
        assert_eq!(replaced_bytes(&pending[..2]), 0);
    }
}
