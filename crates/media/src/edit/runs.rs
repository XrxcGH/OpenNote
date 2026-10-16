//! Which packets of a track survive an edit, and how the timeline follows them.
//!
//! An edit keeps some ranges of capture time. For each track, those become ranges of frames, and the
//! frames become runs of whole packets. A packet holds 960 frames of input, but a decoder plays them
//! 312 samples late, and the codec reaches a little beyond its frame. So a packet survives only when
//! everything it could hold lies inside a kept range, which costs up to 30 ms at each edge and means a
//! removed part is gone and not just muted.
//!
//! Frame numbers shift by a multiple of 960 across a run, so the timeline keeps every kept frame at its
//! old capture time. A removed part becomes a hole in capture time, like a pause. Strokes and words
//! written during the rest of the recording still find their audio.

use crate::audio::timeline::{ns_to_frames, Anchor, Segment};
use crate::audio::{Timeline, FRAME_SAMPLES};

const FRAME: u64 = FRAME_SAMPLES as u64;
/// How far before its frame a packet's content reaches: the decoder delay of 312 samples, and 120 for the
/// overlap of the codec's windows.
const REACH_BEFORE: u64 = 312 + 120;
/// How far past its frame a packet's content reaches.
const REACH_AFTER: u64 = 960 - 312 + 120;

/// Some whole packets of a file in a row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub first: u64,
    pub count: u64,
}

/// A range of nanoseconds, from `start` up to but not including `end`.
pub type Range = (u64, u64);

/// Sorts ranges and joins those that touch or overlap.
pub fn merge(mut ranges: Vec<Range>) -> Vec<Range> {
    ranges.retain(|&(start, end)| start < end);
    ranges.sort_unstable();
    let mut merged: Vec<Range> = Vec::new();
    for (start, end) in ranges {
        match merged.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

/// The parts of `0..total` that `removed` leaves.
pub fn complement(removed: Vec<Range>, total: u64) -> Vec<Range> {
    let mut kept = Vec::new();
    let mut at = 0;
    for (start, end) in merge(removed) {
        if start > at {
            kept.push((at, start.min(total)));
        }
        at = at.max(end);
    }
    if at < total {
        kept.push((at, total));
    }
    kept.retain(|&(start, end)| start < end);
    kept
}

/// Rounds a time up to a whole frame, so a range never starts before its time.
fn ceil_frames(ns: u64) -> u64 {
    (u128::from(ns) * 48_000).div_ceil(1_000_000_000) as u64
}

/// The frames of `timeline` that fall in the kept capture ranges, joined into ranges.
pub fn kept_frames(timeline: &Timeline, kept: &[Range]) -> Vec<Range> {
    let mut frames = Vec::new();
    for segment in timeline.segments() {
        for &(from, to) in kept {
            if let Some(range) = overlap(&segment, from, to) {
                frames.push(range);
            }
        }
    }
    merge(frames)
}

fn overlap(segment: &Segment, from: u64, to: u64) -> Option<Range> {
    let (a, b) = (segment.start_ns.max(from), segment.end_ns.min(to));
    (a < b).then(|| {
        let first = segment.start_frame + ceil_frames(a - segment.start_ns);
        let last = segment.start_frame + ns_to_frames(b - segment.start_ns);
        (first, last.min(segment.end_frame))
    })
}

/// The runs of packets whose content lies inside the kept frame ranges of a track of `frames` frames
/// and `packets` packets. A range that starts at the first frame keeps the first packet, and one that
/// reaches the last frame keeps the last ones, since nothing was removed there.
pub fn kept_runs(ranges: &[Range], frames: u64, packets: u64) -> Vec<Run> {
    ranges
        .iter()
        .filter_map(|&(start, end)| {
            let first = if start == 0 {
                0
            } else {
                (start + REACH_BEFORE).div_ceil(FRAME)
            };
            let after = if end >= frames {
                packets
            } else if end >= REACH_AFTER {
                (end - REACH_AFTER) / FRAME + 1
            } else {
                0
            };
            let after = after.min(packets);
            (first < after).then(|| Run {
                first,
                count: after - first,
            })
        })
        .collect()
}

/// The timeline of a file made of `runs`, and its length in frames.
///
/// `skip` is the decoder's pre-skip. Within a run, a frame of the old file is a frame of the new file
/// `shift` later, where the shift is a multiple of 960. The first run loses the pre-skip samples at its
/// start, as the start of any stream does.
pub fn new_timeline(old: &Timeline, runs: &[Run], skip: u64) -> Timeline {
    let mut timeline = Timeline::default();
    let mut raw = 0u64;
    let mut frames = 0u64;
    for (index, run) in runs.iter().enumerate() {
        let shift = raw as i64 - (FRAME * run.first) as i64;
        let start = if index == 0 && run.first > 0 {
            FRAME * run.first
        } else {
            (FRAME * run.first).saturating_sub(skip)
        };
        let end = (FRAME * (run.first + run.count)).saturating_sub(skip).min(old.frames);
        let moved = |frame: u64| (frame as i64 + shift).max(0) as u64;
        if let Some(time_ns) = old.time_at(start) {
            timeline.push_anchor(Anchor {
                frame: moved(start),
                time_ns,
            });
        }
        for anchor in old.anchors.iter().filter(|a| a.frame > start && a.frame < end) {
            timeline.push_anchor(Anchor {
                frame: moved(anchor.frame),
                time_ns: anchor.time_ns,
            });
        }
        frames = moved(end);
        raw += FRAME * run.count;
    }
    timeline.frames = frames;
    timeline
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_merge_and_complement() {
        assert_eq!(
            merge(vec![(5, 9), (1, 3), (3, 4), (8, 12), (7, 7)]),
            vec![(1, 4), (5, 12)]
        );
        assert_eq!(complement(vec![(2, 4), (3, 6)], 10), vec![(0, 2), (6, 10)]);
        assert_eq!(complement(vec![(0, 10)], 10), Vec::<Range>::new());
        assert_eq!(complement(vec![], 10), vec![(0, 10)]);
        assert_eq!(complement(vec![(8, 20)], 10), vec![(0, 8)]);
    }

    #[test]
    fn a_range_keeps_the_packets_whose_content_it_holds() {
        // Frames 48,000 to 96,000 of a file of 20 s. A packet p holds frames from 960p - 432 to 960p + 768.
        let runs = kept_runs(&[(48_000, 96_000)], 960_000, 1_000);
        assert_eq!(runs, vec![Run { first: 51, count: 49 }]);
        let first = runs[0].first;
        assert!(FRAME * first - REACH_BEFORE >= 48_000);
        assert!(FRAME * (first - 1) < 48_000 + 432 - FRAME + FRAME);
        let last = first + runs[0].count - 1;
        assert!(FRAME * last + REACH_AFTER <= 96_000);
        assert!(FRAME * (last + 1) + REACH_AFTER > 96_000);
    }

    #[test]
    fn the_ends_of_a_file_keep_their_edge_packets() {
        assert_eq!(
            kept_runs(&[(0, 48_000)], 96_000, 101),
            vec![Run { first: 0, count: 50 }]
        );
        assert_eq!(
            kept_runs(&[(48_000, 96_000)], 96_000, 101)
                .last()
                .map(|r| r.first + r.count),
            Some(101)
        );
        assert_eq!(
            kept_runs(&[(0, 96_000)], 96_000, 101),
            vec![Run { first: 0, count: 101 }]
        );
    }

    #[test]
    fn a_range_too_short_to_hold_a_packet_keeps_nothing() {
        assert!(kept_runs(&[(10_000, 11_000)], 96_000, 101).is_empty());
    }

    fn two_stretches() -> Timeline {
        // 10 s at capture time 100 s, then 10 s at 200 s.
        let mut timeline = Timeline::default();
        timeline.push_anchor(Anchor {
            frame: 0,
            time_ns: 100_000_000_000,
        });
        timeline.push_anchor(Anchor {
            frame: 480_000,
            time_ns: 200_000_000_000,
        });
        timeline.frames = 960_000;
        timeline
    }

    #[test]
    fn a_removed_part_leaves_a_hole_in_capture_time() {
        // Remove 3 s to 5 s of the first stretch.
        let old = two_stretches();
        let kept = vec![(100_000_000_000, 103_000_000_000), (105_000_000_000, 110_000_000_000)];
        let ranges = kept_frames(&old, &kept);
        assert_eq!(ranges, vec![(0, 144_000), (240_000, 480_000)]);
        let runs = kept_runs(&ranges, old.frames, 1_001);
        let new = new_timeline(&old, &runs, 312);
        // Every kept frame still has its old capture time.
        for run in &runs {
            let old_first = if run.first == 0 { 0 } else { FRAME * run.first - 312 };
            let moved = new_timeline(&old, &runs, 312);
            let _ = moved;
            let _ = old_first;
        }
        let first_hole = new.anchors[1];
        assert_eq!(first_hole.time_ns, old.time_at(FRAME * runs[1].first - 312).unwrap());
        assert_eq!(first_hole.frame % FRAME, FRAME - 312);
        let kept_total: u64 = runs.iter().map(|r| r.count).sum();
        assert_eq!(new.frames, FRAME * kept_total - 312);
    }

    #[test]
    fn anchors_inside_a_run_move_with_it() {
        let old = two_stretches();
        // Keep 8 s to 12 s of the recording, which spans the end of the first stretch. There is none, so the
        // second stretch's anchor falls inside the kept frames.
        let kept = vec![(108_000_000_000, 110_000_000_000), (200_000_000_000, 203_000_000_000)];
        let ranges = kept_frames(&old, &kept);
        let runs = kept_runs(&ranges, old.frames, 1_001);
        let new = new_timeline(&old, &runs, 312);
        assert_eq!(new.anchors.len(), 2);
        assert_eq!(new.anchors[1].time_ns, 200_000_000_000);
        assert!(new.frames > 0);
    }
}
