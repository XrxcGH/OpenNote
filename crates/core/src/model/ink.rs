//! Ink (spec 8 and 9): segment lists, ink records, and a page's live ink.
//!
//! Point data stays encoded (spec 9.4). It is checked once when read, then shared through `Arc`, so a save
//! snapshot and the undo history never copy points.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use super::{Affine, JsonMap, Stroke, StrokeStyle, Warning};
use crate::id::{BlockId, SegmentId, StrokeId};
use crate::time::Timestamp;

/// A segment in `page.json`'s list (spec 8.3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SegmentRef {
    /// The segment's ID, which names its file.
    pub id: SegmentId,
    /// The file's size.
    pub bytes: u64,
    /// The number of records in the file.
    pub records: u32,
    /// The CRC-32 in the file's footer.
    pub crc32: u32,
    /// Unknown keys.
    pub extra: JsonMap,
}

/// A record of an ink segment (spec 9.2).
#[derive(Clone, Debug, PartialEq)]
pub enum InkRecord {
    /// Adds a stroke, or fully replaces one with the same ID.
    Stroke(Arc<Stroke>),
    /// Changes some properties of a stroke.
    Props(StrokeProps),
    /// Deletes a stroke.
    Remove(StrokeId),
}

impl InkRecord {
    /// The stroke the record is about.
    pub fn stroke_id(&self) -> StrokeId {
        match self {
            InkRecord::Stroke(stroke) => stroke.id,
            InkRecord::Props(props) => props.id,
            InkRecord::Remove(id) => *id,
        }
    }
}

/// A property record (spec 9.5). `None` leaves a property as it is.
#[derive(Clone, Debug, PartialEq)]
pub struct StrokeProps {
    /// The stroke to change.
    pub id: StrokeId,
    /// A new style.
    pub style: Option<StrokeStyle>,
    /// A new transform. `Some(None)` removes the transform.
    pub transform: Option<Option<Affine>>,
    /// A new ink block.
    pub block: Option<BlockId>,
}

/// A page's live strokes, its committed segments, the records not yet saved, and its dead bytes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Ink {
    strokes: BTreeMap<StrokeId, Arc<Stroke>>,
    by_block: HashMap<BlockId, BTreeSet<(Timestamp, StrokeId)>>,
    segments: Vec<SegmentRef>,
    pending: Vec<InkRecord>,
    dead_bytes: u64,
}

impl Ink {
    /// The live stroke with this ID.
    pub fn stroke(&self, id: StrokeId) -> Option<&Arc<Stroke>> {
        self.strokes.get(&id)
    }

    /// Every live stroke, by ID.
    pub fn strokes(&self) -> impl Iterator<Item = &Arc<Stroke>> + '_ {
        self.strokes.values()
    }

    /// The number of live strokes.
    pub fn len(&self) -> usize {
        self.strokes.len()
    }

    /// Whether there are no live strokes.
    pub fn is_empty(&self) -> bool {
        self.strokes.is_empty()
    }

    /// The live strokes of one ink block, in drawing order: by start time, then ID (spec 8.2).
    pub fn in_block(&self, block: BlockId) -> impl Iterator<Item = &Arc<Stroke>> + '_ {
        self.by_block
            .get(&block)
            .into_iter()
            .flatten()
            .filter_map(|(_, id)| self.strokes.get(id))
    }

    /// The number of live strokes in one ink block.
    pub fn count_in_block(&self, block: BlockId) -> u32 {
        self.by_block
            .get(&block)
            .map_or(0, |set| u32::try_from(set.len()).unwrap_or(u32::MAX))
    }

    /// The committed segments, in list order.
    pub fn segments(&self) -> &[SegmentRef] {
        &self.segments
    }

    /// Records applied since the last save, which the next save writes as a new segment.
    pub fn pending(&self) -> &[InkRecord] {
        &self.pending
    }

    /// Bytes of committed stroke records that were removed or replaced since.
    pub fn dead_bytes(&self) -> u64 {
        self.dead_bytes
    }

    /// Adds a stroke, or replaces the one with the same ID, which it returns.
    pub fn insert(&mut self, stroke: Arc<Stroke>) -> Option<Arc<Stroke>> {
        let key = (stroke.start, stroke.id);
        let block = stroke.block;
        let old = self.strokes.insert(stroke.id, stroke);
        // The old entry goes first: it has the same key when the block and start time didn't change.
        if let Some(old) = &old {
            self.unindex(old);
        }
        self.by_block.entry(block).or_default().insert(key);
        old
    }

    /// Removes and returns the stroke with this ID.
    pub fn remove(&mut self, id: StrokeId) -> Option<Arc<Stroke>> {
        let stroke = self.strokes.remove(&id)?;
        self.unindex(&stroke);
        Some(stroke)
    }

    /// Removes a stroke from the index by ink block.
    fn unindex(&mut self, stroke: &Stroke) {
        if let Some(set) = self.by_block.get_mut(&stroke.block) {
            set.remove(&(stroke.start, stroke.id));
            if set.is_empty() {
                self.by_block.remove(&stroke.block);
            }
        }
    }

    /// Applies a property record. Returns the stroke as it was, or `None` if no such stroke is live.
    pub fn apply_props(&mut self, props: &StrokeProps) -> Option<Arc<Stroke>> {
        let old = self.strokes.get(&props.id)?.clone();
        let mut changed = Stroke::clone(&old);
        if let Some(style) = props.style {
            changed.style = style;
        }
        if let Some(transform) = props.transform {
            changed.transform = transform.filter(|t| !t.is_identity());
        }
        if let Some(block) = props.block {
            changed.block = block;
        }
        self.insert(Arc::new(changed));
        Some(old)
    }

    /// Queues a record for the next save.
    pub fn push_pending(&mut self, record: InkRecord) {
        self.pending.push(record);
    }

    /// Records that a save wrote the first `through` pending records, and sets the new segment list.
    pub fn commit(&mut self, through: usize, segments: Vec<SegmentRef>, dead_bytes: u64) {
        self.pending.drain(..through.min(self.pending.len()));
        self.segments = segments;
        self.dead_bytes = dead_bytes;
    }

    /// Applies decoded segment records in list order (spec 8.3) and returns the live ink.
    ///
    /// `records[i]` holds the records of `segments[i]`. A property or removal record for a stroke that isn't
    /// live is skipped with a warning.
    pub fn replay(segments: Vec<SegmentRef>, records: Vec<Vec<InkRecord>>) -> (Ink, Vec<Warning>) {
        let mut ink = Ink::default();
        let mut warnings = Vec::new();
        if records.len() != segments.len() {
            let detail = format!("{} segments listed, {} decoded", segments.len(), records.len());
            warnings.push(Warning::new("ink.segmentCount", detail));
        }
        for record in records.into_iter().flatten() {
            ink.replay_one(record, &mut warnings);
        }
        ink.segments = segments;
        (ink, warnings)
    }

    fn replay_one(&mut self, record: InkRecord, warnings: &mut Vec<Warning>) {
        let dead = match record {
            InkRecord::Stroke(stroke) => self.insert(stroke),
            InkRecord::Props(props) => {
                if self.apply_props(&props).is_none() {
                    warnings.push(Warning::new("ink.propsMissing", props.id.to_string()));
                }
                None
            }
            InkRecord::Remove(id) => {
                let removed = self.remove(id);
                if removed.is_none() {
                    warnings.push(Warning::new("ink.removeMissing", id.to_string()));
                }
                removed
            }
        };
        if let Some(dead) = dead {
            self.dead_bytes = self.dead_bytes.saturating_add(dead.record_len());
        }
    }
}

#[cfg(test)]
mod tests;
