//! Compaction policy (spec 8.4). Owned by WP4.
//!
//! A save normally writes one small segment with the records since the last save. When a page has more than
//! 8 segments, minor compaction merges every segment except the base into one that holds their net effect.
//! When more than half of the ink bytes are dead, or more than 16 segments remain, major compaction writes a
//! new base with only the live strokes.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use crate::format::DecodedSegment;
use crate::id::StrokeId;
use crate::limits::Policy;
use crate::model::{Ink, InkRecord, Stroke, StrokeProps};

/// How a save groups ink records into segments.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionPlan {
    /// A new segment with only the records since the last save.
    None,
    /// Merge every segment except the base into one.
    Minor,
    /// Write a new base with only the live strokes.
    Major,
}

/// The compaction the next save should run.
pub fn plan_compaction(ink: &Ink) -> CompactionPlan {
    plan_with(ink, &Policy::default())
}

/// [`plan_compaction`] with another policy.
pub fn plan_with(ink: &Ink, policy: &Policy) -> CompactionPlan {
    let segments = ink.segments();
    let count = segments.len().saturating_add(usize::from(!ink.pending().is_empty()));
    let total: u64 = segments.iter().map(|s| s.bytes).fold(0, u64::saturating_add);
    let dead_share_passed = total > 0 && ink.dead_bytes() as f64 > policy.major_compaction_dead_share * total as f64;
    if count > policy.major_compaction_segments as usize || dead_share_passed {
        return CompactionPlan::Major;
    }
    if count <= policy.minor_compaction_segments as usize || segments.len() < 2 {
        return CompactionPlan::None;
    }
    // The base must come first, so the merged segment can follow it without changing the replay order.
    let largest = segments.iter().map(|s| s.bytes).max().unwrap_or(0);
    match segments.first() {
        Some(first) if first.bytes == largest => CompactionPlan::Minor,
        _ => CompactionPlan::Major,
    }
}

/// The records of the compacted segment.
///
/// For `None`, the pending records. For `Major`, a `Stroke` record for each live stroke, sorted by ink block,
/// start time, and ID. For `Minor`, the net effect of every segment after the base and of the pending records.
/// `decoded` must then hold every segment of the list, in order, with the base first.
pub fn compact(ink: &Ink, plan: CompactionPlan, decoded: &[DecodedSegment]) -> Vec<InkRecord> {
    match plan {
        CompactionPlan::None => ink.pending().to_vec(),
        CompactionPlan::Major => major(ink),
        CompactionPlan::Minor => minor(ink, decoded),
    }
}

fn major(ink: &Ink) -> Vec<InkRecord> {
    let mut strokes: Vec<&Arc<Stroke>> = ink.strokes().collect();
    strokes.sort_by_key(|s| (s.block, s.start, s.id));
    strokes.into_iter().cloned().map(InkRecord::Stroke).collect()
}

fn minor(ink: &Ink, decoded: &[DecodedSegment]) -> Vec<InkRecord> {
    let (base, merged) = match decoded.split_first() {
        Some((base, rest)) => (base.records.as_slice(), rest),
        None => (&[][..], &[][..]),
    };
    let later = merged
        .iter()
        .flat_map(|segment| segment.records.iter())
        .chain(ink.pending());
    let mut touched = BTreeSet::new();
    let mut rewritten = BTreeSet::new();
    for record in later {
        touched.insert(record.stroke_id());
        if matches!(record, InkRecord::Stroke(_)) {
            rewritten.insert(record.stroke_id());
        }
    }
    // Strokes replay independently of each other, so the base records of the touched strokes are enough.
    let base: Vec<InkRecord> = base
        .iter()
        .filter(|record| touched.contains(&record.stroke_id()))
        .cloned()
        .collect();
    let base_ink = Ink::replay(Vec::new(), vec![base]).0;
    let base_strokes: HashMap<StrokeId, &Arc<Stroke>> = base_ink.strokes().map(|s| (s.id, s)).collect();
    touched
        .into_iter()
        .filter_map(|id| {
            let base = base_strokes.get(&id).copied();
            match (ink.stroke(id), base) {
                (Some(live), Some(base)) if !rewritten.contains(&id) => props_between(base, live),
                (Some(live), _) => Some(InkRecord::Stroke(live.clone())),
                (None, Some(_)) => Some(InkRecord::Remove(id)),
                (None, None) => None,
            }
        })
        .collect()
}

/// The dead bytes of the base segment followed by the merged one, as [`Ink::replay`] counts them.
///
/// Strokes replay independently of each other. Take a stroke whose only record in both segments is one `Stroke`
/// record in the base. Nothing replaces or removes it, so it adds no dead bytes. Only the other records replay,
/// and on a large base, the strokes left out are nearly all of it.
pub fn merged_dead_bytes(base: &[InkRecord], merged: &[InkRecord]) -> u64 {
    let mut counts: HashMap<StrokeId, u32> = HashMap::new();
    for record in base.iter().chain(merged) {
        let count = counts.entry(record.stroke_id()).or_default();
        *count = count.saturating_add(1);
    }
    let alone =
        |record: &InkRecord| matches!(record, InkRecord::Stroke(_)) && counts.get(&record.stroke_id()) == Some(&1);
    let base: Vec<InkRecord> = base.iter().filter(|record| !alone(record)).cloned().collect();
    Ink::replay(Vec::new(), vec![base, merged.to_vec()]).0.dead_bytes()
}

/// One property record that turns `base` into `live`, or `None` when nothing changed.
fn props_between(base: &Stroke, live: &Arc<Stroke>) -> Option<InkRecord> {
    let props = StrokeProps {
        id: live.id,
        style: (base.style != live.style).then_some(live.style),
        transform: (base.transform != live.transform).then_some(live.transform),
        block: (base.block != live.block).then_some(live.block),
    };
    let changed = props.style.is_some() || props.transform.is_some() || props.block.is_some();
    changed.then_some(InkRecord::Props(props))
}

#[cfg(test)]
mod tests;
