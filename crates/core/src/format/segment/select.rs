//! Which records of a segment a decode parses, and parsing them once their frames are known to be whole.
//!
//! The records of a large segment parse on several threads (`crate::par`), in order, so the result is the same
//! as one thread's.

use std::collections::HashSet;

use super::records::{id_at, is_known_stroke, parse_record, Parsed};
use super::Frame;
use crate::id::{Id, StrokeId};
use crate::limits::Limits;
use crate::model::InkRecord;
use crate::par;

/// The fewest records worth a thread of their own. Checking a stroke's points takes about a microsecond, and
/// starting a thread costs far less than this many.
const MIN_RECORDS_PER_THREAD: usize = 512;

/// The records a decode wants.
pub(super) enum Want<'a> {
    /// Every record, fully checked.
    All,
    /// The records [`decode_segment_for`](super::decode_segment_for) keeps.
    Touched(&'a (dyn Fn(StrokeId) -> bool + Sync)),
}

impl Want<'_> {
    /// Whether to check the points of a record's stroke. Every record kind starts with its stroke's ID.
    pub(super) fn checks_points(&self, body: &[u8]) -> bool {
        match self {
            Want::All => true,
            Want::Touched(touched) => id_at(body, 0).is_none_or(|id| touched(StrokeId(id))),
        }
    }
}

/// Which frames [`decode_segment_for`](super::decode_segment_for) leaves out: known `Stroke` records of strokes
/// outside `touched` that have no other record in the segment. Nothing for [`Want::All`].
pub(super) fn left_out(bytes: &[u8], frames: &[Frame], want: &Want<'_>) -> Vec<bool> {
    let Want::Touched(touched) = want else {
        return Vec::new();
    };
    let ids: Vec<Option<Id>> = frames
        .iter()
        .map(|frame| bytes.get(frame.body.clone()).and_then(|body| id_at(body, 0)))
        .collect();
    let mut sorted: Vec<Id> = ids.iter().flatten().copied().collect();
    sorted.sort_unstable();
    let repeated: HashSet<Id> = sorted
        .windows(2)
        .filter_map(|pair| match pair {
            [a, b] if a == b => Some(*a),
            _ => None,
        })
        .collect();
    frames
        .iter()
        .zip(&ids)
        .map(|(frame, id)| {
            let body = bytes.get(frame.body.clone()).unwrap_or_default();
            id.is_some_and(|id| !repeated.contains(&id) && !touched(StrokeId(id)))
                && is_known_stroke(frame.kind, frame.flags, body)
        })
        .collect()
}

/// Parses the records of whole frames, except those `left_out` marks. Returns the records in order and the
/// count of unknown ones, or `None` when any record is damaged.
pub(super) fn parse_frames(
    bytes: &[u8],
    frames: &[Frame],
    left_out: &[bool],
    limits: &Limits,
    want: &Want<'_>,
) -> Option<(Vec<InkRecord>, u32)> {
    let kept: Vec<&Frame> = frames
        .iter()
        .enumerate()
        .filter(|(index, _)| !left_out.get(*index).copied().unwrap_or(false))
        .map(|(_, frame)| frame)
        .collect();
    let parts = par::chunked(&kept, MIN_RECORDS_PER_THREAD, |chunk| {
        let mut records = Vec::with_capacity(chunk.len());
        let mut unknown = 0u32;
        for frame in chunk {
            let body = bytes.get(frame.body.clone())?;
            match parse_record(frame.kind, frame.flags, body, limits, want.checks_points(body)) {
                Parsed::Record(record) => records.push(record),
                Parsed::Unknown => unknown = unknown.saturating_add(1),
                Parsed::Bad(_) => return None,
            }
        }
        Some((records, unknown))
    });
    let mut records = Vec::with_capacity(kept.len());
    let mut unknown = 0u32;
    for part in parts {
        let (part, count) = part?;
        records.extend(part);
        unknown = unknown.saturating_add(count);
    }
    Some((records, unknown))
}
