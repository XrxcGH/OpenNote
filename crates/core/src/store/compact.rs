//! Compaction policy (spec 8.4). Owned by WP4.

use crate::format::DecodedSegment;
use crate::model::{Ink, InkRecord};

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
pub fn plan_compaction(_ink: &Ink) -> CompactionPlan {
    unimplemented!("WP4: plan_compaction")
}

/// The records of the compacted segment.
pub fn compact(_ink: &Ink, _plan: CompactionPlan, _decoded: &[DecodedSegment]) -> Vec<InkRecord> {
    unimplemented!("WP4: compact")
}
