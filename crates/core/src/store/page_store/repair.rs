//! Repairing damaged ink from other segments and the journal (spec 9.6).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use super::save::fix_stroke_counts;
use super::PageStore;
use crate::error::CoreError;
use crate::format::{segment_footer_crc, DamagedRecord};
use crate::id::{SegmentId, StrokeId};
use crate::model::{Access, Ink, InkRecord, JsonMap, Page, SegmentRef, Stroke, VersionReason};
use crate::store::history::write_version;
use crate::store::layout::{NotebookLayout, INK_DIR};
use crate::store::PageFiles;
use crate::time::Timestamp;

/// One segment's records, with the records that failed their checks.
struct Walked {
    records: Vec<InkRecord>,
    damaged: Vec<DamagedRecord>,
}

impl PageStore {
    pub(super) fn repair(&self, dir: &Path, page: &Page, from_journal: &[Arc<Stroke>]) -> Result<Page, CoreError> {
        let config = &self.config;
        let listed = page.ink.segments().to_vec();
        let walked: Vec<Walked> = listed.iter().map(|segment| self.walk(dir, page, segment)).collect();
        let wanted: HashSet<StrokeId> = walked
            .iter()
            .flat_map(|w| w.damaged.iter().filter_map(|d| d.stroke))
            .collect();
        let copies = self.intact_copies(dir, page, &wanted, from_journal);
        let rebuilt = walked.into_iter().map(|w| splice_copies(w, &copies)).collect();
        let (ink, warnings) = Ink::replay(listed, rebuilt);
        let path = NotebookLayout::page_json(dir);
        let bytes = config.fs.read(&path, config.limits.page_json_bytes)?;
        let files = PageFiles {
            fs: &*config.fs,
            codec: &*config.codec,
            dir,
        };
        write_version(&files, &bytes, page, VersionReason::BeforeRepair, None)?;
        let mut repaired = page.clone();
        repaired.ink = ink;
        repaired.format.access = Access::ReadWrite;
        repaired.format.warnings = warnings;
        fix_stroke_counts(&mut repaired);
        Ok(repaired)
    }

    /// Decodes one listed segment, keeping its damage. A segment that can't be read at all yields nothing.
    fn walk(&self, dir: &Path, page: &Page, segment: &SegmentRef) -> Walked {
        let config = &self.config;
        let path = NotebookLayout::segment_path(dir, segment.id);
        let decoded = config
            .fs
            .read(&path, config.limits.segment_bytes)
            .ok()
            .and_then(|bytes| {
                config
                    .codec
                    .decode_segment(&bytes, segment, page.id, &config.limits)
                    .ok()
            });
        match decoded {
            Some(decoded) => Walked {
                records: decoded.records,
                damaged: decoded.damaged,
            },
            None => Walked {
                records: Vec::new(),
                damaged: Vec::new(),
            },
        }
    }

    /// The newest intact `Stroke` record of each wanted stroke: from the journal first, then from every
    /// segment file in `ink/`, newest segment first.
    fn intact_copies(
        &self,
        dir: &Path,
        page: &Page,
        wanted: &HashSet<StrokeId>,
        from_journal: &[Arc<Stroke>],
    ) -> HashMap<StrokeId, Arc<Stroke>> {
        let mut found: HashMap<StrokeId, (Timestamp, Arc<Stroke>)> = HashMap::new();
        for (created, stroke) in self.segment_strokes(dir, page) {
            if !wanted.contains(&stroke.id) {
                continue;
            }
            let newer = found.get(&stroke.id).is_none_or(|(seen, _)| created >= *seen);
            if newer {
                found.insert(stroke.id, (created, stroke));
            }
        }
        let mut copies: HashMap<StrokeId, Arc<Stroke>> = found.into_iter().map(|(id, (_, s))| (id, s)).collect();
        for stroke in from_journal.iter().filter(|s| wanted.contains(&s.id)) {
            copies.insert(stroke.id, stroke.clone());
        }
        copies
    }

    /// Every intact stroke record in every segment file of the folder, with its segment's time.
    fn segment_strokes(&self, dir: &Path, page: &Page) -> Vec<(Timestamp, Arc<Stroke>)> {
        let config = &self.config;
        let entries = config.fs.read_dir(&dir.join(INK_DIR)).unwrap_or_default();
        let mut strokes = Vec::new();
        for entry in entries.into_iter().filter(|e| !e.is_dir) {
            let Some(id) = entry.name.strip_suffix(".onk").and_then(|s| SegmentId::parse(s).ok()) else {
                continue;
            };
            let path = NotebookLayout::segment_path(dir, id);
            let Ok(bytes) = config.fs.read(&path, config.limits.segment_bytes) else {
                continue;
            };
            let expect = segment_ref_of(id, &bytes);
            let Ok(decoded) = config.codec.decode_segment(&bytes, &expect, page.id, &config.limits) else {
                continue;
            };
            let created = decoded.header.created;
            strokes.extend(decoded.records.into_iter().filter_map(|record| match record {
                InkRecord::Stroke(stroke) => Some((created, stroke)),
                _ => None,
            }));
        }
        strokes
    }
}

/// The list entry a segment file would have, from its own bytes (spec 9.1).
fn segment_ref_of(id: SegmentId, bytes: &[u8]) -> SegmentRef {
    let records = bytes
        .get(12..16)
        .and_then(|b| b.try_into().ok())
        .map_or(0, u32::from_le_bytes);
    SegmentRef {
        id,
        bytes: bytes.len() as u64,
        records,
        crc32: segment_footer_crc(bytes).unwrap_or(0),
        extra: JsonMap::new(),
    }
}

/// Puts an intact copy where each damaged stroke record was. Damaged records without a copy are left out.
fn splice_copies(walked: Walked, copies: &HashMap<StrokeId, Arc<Stroke>>) -> Vec<InkRecord> {
    let total = walked.records.len().saturating_add(walked.damaged.len());
    let mut damaged: HashMap<u32, Option<StrokeId>> = walked.damaged.iter().map(|d| (d.index, d.stroke)).collect();
    let mut records = walked.records.into_iter();
    let mut out = Vec::with_capacity(total);
    for position in 0..total {
        let position = u32::try_from(position).unwrap_or(u32::MAX);
        match damaged.remove(&position) {
            Some(stroke) => {
                if let Some(copy) = stroke.and_then(|id| copies.get(&id)) {
                    out.push(InkRecord::Stroke(copy.clone()));
                }
            }
            None => out.extend(records.next()),
        }
    }
    out.extend(records);
    out
}
