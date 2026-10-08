//! Positions: where a moment of the capture clock sits in the audio a person can play.
//!
//! A recording's tracks cover stretches of capture time. A pause leaves a hole, and so does a long
//! stretch of nothing on a loopback track. Nobody wants to wait through a hole, so playback runs
//! over the stretches only. A position is the time into that audio, in nanoseconds from its start.
//! A [`PositionMap`] converts between positions and capture times. It is built from the timelines
//! of all the tracks, so the position of a stroke is the same on every track.

use serde::{Deserialize, Serialize};

use crate::audio::{RecordingSummary, Timeline};

/// Stretches closer than this are one stretch. Tracks switch stretches within a few milliseconds of
/// each other, and a resync overlaps the old stretch by the clock tolerance.
const JOIN_NS: u64 = 40_000_000;

/// A stretch of capture time that has audio, and where it starts in the playable audio.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub capture_start_ns: u64,
    pub capture_end_ns: u64,
    pub position_start_ns: u64,
}

impl Span {
    pub fn len_ns(&self) -> u64 {
        self.capture_end_ns - self.capture_start_ns
    }
}

/// Where a capture time falls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Located {
    pub position_ns: u64,
    /// Whether the time has audio. If not, the position is where the next audio starts, or the end
    /// if none follows, which is where playback should seek.
    pub exact: bool,
}

/// Converts between positions in a recording's audio and capture times.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionMap {
    spans: Vec<Span>,
}

impl PositionMap {
    /// The map for a finished or recovered recording.
    pub fn from_summary(summary: &RecordingSummary) -> Self {
        Self::from_timelines(summary.tracks.iter().map(|track| &track.timeline))
    }

    /// The map for tracks with these timelines.
    pub fn from_timelines<'a>(timelines: impl IntoIterator<Item = &'a Timeline>) -> Self {
        let mut ranges: Vec<(u64, u64)> = timelines
            .into_iter()
            .flat_map(Timeline::segments)
            .map(|segment| (segment.start_ns, segment.end_ns))
            .collect();
        ranges.sort_unstable();
        let mut merged: Vec<(u64, u64)> = Vec::new();
        for (start, end) in ranges {
            match merged.last_mut() {
                Some(last) if start <= last.1 + JOIN_NS => last.1 = last.1.max(end),
                _ => merged.push((start, end)),
            }
        }
        Self::from_ranges(&merged)
    }

    /// A map over these capture-time ranges, which must be sorted and apart.
    pub fn from_ranges(ranges: &[(u64, u64)]) -> Self {
        let mut position = 0;
        let spans = ranges
            .iter()
            .map(|&(start, end)| {
                let span = Span {
                    capture_start_ns: start,
                    capture_end_ns: end,
                    position_start_ns: position,
                };
                position += end - start;
                span
            })
            .collect();
        PositionMap { spans }
    }

    pub fn spans(&self) -> &[Span] {
        &self.spans
    }

    /// The length of the playable audio.
    pub fn duration_ns(&self) -> u64 {
        self.spans
            .last()
            .map_or(0, |span| span.position_start_ns + span.len_ns())
    }

    /// The position of a capture time.
    pub fn locate(&self, capture_ns: u64) -> Located {
        let next = self.spans.partition_point(|span| span.capture_end_ns <= capture_ns);
        match self.spans.get(next) {
            Some(span) if span.capture_start_ns <= capture_ns => Located {
                position_ns: span.position_start_ns + (capture_ns - span.capture_start_ns),
                exact: true,
            },
            Some(span) => Located {
                position_ns: span.position_start_ns,
                exact: false,
            },
            None => Located {
                position_ns: self.duration_ns(),
                exact: false,
            },
        }
    }

    /// The capture time at a position, or `None` past the end.
    pub fn capture_at(&self, position_ns: u64) -> Option<u64> {
        let index = self
            .spans
            .partition_point(|span| span.position_start_ns <= position_ns)
            .checked_sub(1)?;
        let span = self.spans[index];
        let offset = position_ns - span.position_start_ns;
        (offset < span.len_ns()).then_some(span.capture_start_ns + offset)
    }

    /// The span that holds a position, with the span's index.
    pub fn span_at(&self, position_ns: u64) -> Option<(usize, Span)> {
        let index = self
            .spans
            .partition_point(|span| span.position_start_ns <= position_ns)
            .checked_sub(1)?;
        let span = self.spans[index];
        (position_ns - span.position_start_ns < span.len_ns()).then_some((index, span))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::Anchor;

    const S: u64 = 1_000_000_000;

    fn timeline(stretches: &[(u64, u64)]) -> Timeline {
        // Each stretch is (start in seconds, length in seconds).
        let mut timeline = Timeline::default();
        let mut frames = 0;
        for &(start, length) in stretches {
            timeline.push_anchor(Anchor {
                frame: frames,
                time_ns: start * S,
            });
            frames += length * 48_000;
        }
        timeline.frames = frames;
        timeline
    }

    #[test]
    fn a_pause_is_left_out_of_the_positions() {
        let map = PositionMap::from_timelines([&timeline(&[(10, 5), (100, 5)])]);
        assert_eq!(map.duration_ns(), 10 * S);
        assert_eq!(
            map.locate(12 * S),
            Located {
                position_ns: 2 * S,
                exact: true
            }
        );
        assert_eq!(
            map.locate(101 * S),
            Located {
                position_ns: 6 * S,
                exact: true
            }
        );
        assert_eq!(map.capture_at(6 * S), Some(101 * S));
        assert_eq!(map.capture_at(10 * S), None);
    }

    #[test]
    fn a_moment_in_a_gap_lands_where_the_next_audio_starts() {
        let map = PositionMap::from_timelines([&timeline(&[(10, 5), (100, 5)])]);
        assert_eq!(
            map.locate(50 * S),
            Located {
                position_ns: 5 * S,
                exact: false
            }
        );
        assert_eq!(
            map.locate(3 * S),
            Located {
                position_ns: 0,
                exact: false
            }
        );
        assert_eq!(
            map.locate(500 * S),
            Located {
                position_ns: 10 * S,
                exact: false
            }
        );
    }

    #[test]
    fn tracks_that_overlap_make_one_stretch() {
        let mic = timeline(&[(10, 20)]);
        let system = timeline(&[(15, 5), (40, 5)]);
        let map = PositionMap::from_timelines([&mic, &system]);
        assert_eq!(map.spans().len(), 2);
        assert_eq!(map.duration_ns(), 25 * S);
        assert_eq!(map.locate(41 * S).position_ns, 21 * S);
    }

    #[test]
    fn a_resync_overlap_does_not_split_a_stretch() {
        // The second stretch starts 15 ms before the first one ends.
        let mut timeline = Timeline::default();
        timeline.push_anchor(Anchor { frame: 0, time_ns: 0 });
        timeline.push_anchor(Anchor {
            frame: 48_000,
            time_ns: S - 15_000_000,
        });
        timeline.frames = 96_000;
        let map = PositionMap::from_timelines([&timeline]);
        assert_eq!(map.spans().len(), 1);
    }

    #[test]
    fn an_empty_map_has_no_audio() {
        let map = PositionMap::default();
        assert_eq!(map.duration_ns(), 0);
        assert_eq!(
            map.locate(5),
            Located {
                position_ns: 0,
                exact: false
            }
        );
        assert_eq!(map.capture_at(0), None);
    }

    #[test]
    fn span_at_names_the_span_and_its_index() {
        let map = PositionMap::from_ranges(&[(0, S), (5 * S, 7 * S)]);
        assert_eq!(map.span_at(S + 1).map(|(index, _)| index), Some(1));
        assert!(map.span_at(3 * S).is_none());
    }
}
