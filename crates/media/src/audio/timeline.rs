//! Timelines: how a track's frame counts map to times on the capture clock.
//!
//! The capture clock is the Windows performance counter (QPC), in nanoseconds. Strokes and text
//! changes use the same clock, so finding the audio for a stroke is a lookup in the timeline.
//!
//! A timeline is a list of anchors. Each anchor starts a stretch where frames follow one another at
//! the track's sample rate. A new stretch begins at the first packet and after a pause. It also begins
//! after a gap too long to fill with silence, and when the device clock drifts too far from the capture
//! clock. A loopback track can start long after the recording does, and its timeline places it.

use serde::{Deserialize, Serialize};

use super::TRACK_RATE;

const NS_PER_SECOND: u128 = 1_000_000_000;

/// Converts a frame count to nanoseconds at the track rate.
pub fn frames_to_ns(frames: u64) -> u64 {
    (u128::from(frames) * NS_PER_SECOND / u128::from(TRACK_RATE)) as u64
}

/// Converts nanoseconds to a frame count at the track rate, rounding down.
pub fn ns_to_frames(ns: u64) -> u64 {
    (u128::from(ns) * u128::from(TRACK_RATE) / NS_PER_SECOND) as u64
}

/// The capture time of one frame, which starts a stretch of the timeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    pub frame: u64,
    pub time_ns: u64,
}

/// A stretch of a track where frames follow one another without a break.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment {
    pub start_frame: u64,
    pub end_frame: u64,
    pub start_ns: u64,
    pub end_ns: u64,
}

/// Maps a track's frames to capture times, and back.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Timeline {
    pub anchors: Vec<Anchor>,
    /// The number of frames in the track, including any silence added for gaps.
    pub frames: u64,
}

impl Timeline {
    /// Starts a new stretch. An anchor at the same frame as the last one replaces it.
    pub fn push_anchor(&mut self, anchor: Anchor) {
        if self.anchors.last().is_some_and(|last| last.frame == anchor.frame) {
            self.anchors.pop();
        }
        self.anchors.push(anchor);
    }

    /// The stretches, in frame order. Stretches with no frames are left out.
    pub fn segments(&self) -> impl Iterator<Item = Segment> + '_ {
        (0..self.anchors.len()).filter_map(|index| {
            let anchor = self.anchors[index];
            let end_frame = self
                .anchors
                .get(index + 1)
                .map_or(self.frames, |next| next.frame.min(self.frames));
            (end_frame > anchor.frame).then(|| Segment {
                start_frame: anchor.frame,
                end_frame,
                start_ns: anchor.time_ns,
                end_ns: anchor.time_ns + frames_to_ns(end_frame - anchor.frame),
            })
        })
    }

    /// When the first frame was captured.
    pub fn start_ns(&self) -> Option<u64> {
        self.segments().next().map(|segment| segment.start_ns)
    }

    /// When the last frame ended.
    pub fn end_ns(&self) -> Option<u64> {
        self.segments().last().map(|segment| segment.end_ns)
    }

    /// The capture time of `frame`, or `None` past the end of the track.
    pub fn time_at(&self, frame: u64) -> Option<u64> {
        if frame >= self.frames {
            return None;
        }
        let index = self
            .anchors
            .partition_point(|anchor| anchor.frame <= frame)
            .checked_sub(1)?;
        let anchor = self.anchors[index];
        Some(anchor.time_ns + frames_to_ns(frame - anchor.frame))
    }

    /// The frame captured at `time_ns`, or `None` if the track has no audio then, for example during
    /// a pause. Where a resync made two stretches overlap, the later one wins.
    pub fn frame_at(&self, time_ns: u64) -> Option<u64> {
        let segments: Vec<Segment> = self.segments().collect();
        segments
            .iter()
            .rev()
            .find(|segment| (segment.start_ns..segment.end_ns).contains(&time_ns))
            .map(|segment| segment.start_frame + ns_to_frames(time_ns - segment.start_ns))
    }

    /// Like [`Timeline::frame_at`], but for a time with no audio it picks the start of the next stretch,
    /// or the last frame if nothing follows. Tapping a stroke made during a pause seeks there.
    pub fn nearest_frame(&self, time_ns: u64) -> Option<u64> {
        if let Some(frame) = self.frame_at(time_ns) {
            return Some(frame);
        }
        let next = self
            .segments()
            .filter(|segment| segment.start_ns > time_ns)
            .min_by_key(|segment| segment.start_ns);
        next.map(|segment| segment.start_frame)
            .or_else(|| self.frames.checked_sub(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_pause() -> Timeline {
        // Two seconds at time 10 s, a pause, then one second at 20 s.
        let mut timeline = Timeline::default();
        timeline.push_anchor(Anchor {
            frame: 0,
            time_ns: 10_000_000_000,
        });
        timeline.push_anchor(Anchor {
            frame: 96_000,
            time_ns: 20_000_000_000,
        });
        timeline.frames = 144_000;
        timeline
    }

    #[test]
    fn frames_and_times_convert_both_ways() {
        let timeline = with_pause();
        assert_eq!(timeline.time_at(0), Some(10_000_000_000));
        assert_eq!(timeline.time_at(48_000), Some(11_000_000_000));
        assert_eq!(timeline.time_at(96_000), Some(20_000_000_000));
        assert_eq!(timeline.time_at(144_000), None);
        assert_eq!(timeline.frame_at(11_500_000_000), Some(72_000));
        assert_eq!(timeline.frame_at(20_500_000_000), Some(120_000));
    }

    #[test]
    fn a_pause_has_no_frame_and_seeks_to_the_next_stretch() {
        let timeline = with_pause();
        assert_eq!(timeline.frame_at(15_000_000_000), None);
        assert_eq!(timeline.nearest_frame(15_000_000_000), Some(96_000));
        assert_eq!(timeline.nearest_frame(9_000_000_000), Some(0));
        assert_eq!(timeline.nearest_frame(99_000_000_000), Some(143_999));
        assert_eq!(timeline.start_ns(), Some(10_000_000_000));
        assert_eq!(timeline.end_ns(), Some(21_000_000_000));
    }

    #[test]
    fn overlapping_stretches_prefer_the_later_one() {
        let mut timeline = Timeline::default();
        timeline.push_anchor(Anchor { frame: 0, time_ns: 0 });
        timeline.push_anchor(Anchor {
            frame: 48_000,
            time_ns: 990_000_000,
        });
        timeline.frames = 96_000;
        assert_eq!(timeline.frame_at(995_000_000), Some(48_240));
        assert_eq!(timeline.frame_at(500_000_000), Some(24_000));
    }

    #[test]
    fn an_anchor_at_the_same_frame_replaces_the_last() {
        let mut timeline = Timeline::default();
        timeline.push_anchor(Anchor { frame: 0, time_ns: 5 });
        timeline.push_anchor(Anchor { frame: 0, time_ns: 9 });
        assert_eq!(timeline.anchors, vec![Anchor { frame: 0, time_ns: 9 }]);
    }

    #[test]
    fn a_timeline_survives_a_json_round_trip() {
        let timeline = with_pause();
        let json = serde_json::to_string(&timeline).unwrap();
        assert_eq!(serde_json::from_str::<Timeline>(&json).unwrap(), timeline);
    }
}
