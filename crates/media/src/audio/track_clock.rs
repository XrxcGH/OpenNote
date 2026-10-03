//! Decides where each captured packet goes on a track's timeline.
//!
//! Every packet carries the capture time of its first frame. Those times, not the frame counts, are
//! the truth. When a packet starts later than the frames so far predict, the clock asks for silence.
//! When it starts much later, earlier than predicted, or after a pause, it starts a new stretch.
//! Loopback delivers nothing while nothing plays, so its long gaps become stretches of the timeline
//! instead of silence to encode.

use super::timeline::{frames_to_ns, ns_to_frames, Anchor};

/// How the clock reacts to gaps and drift.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockConfig {
    /// Differences below this are timing scatter, and are ignored. Capture times scatter by about
    /// 1.4 ms on the spike laptop.
    pub tolerance_ns: u64,
    /// Gaps up to this long are filled with silence. Longer gaps start a new stretch.
    pub max_fill_ns: u64,
    /// The encoder's frame size in samples. Stretches start on a frame boundary.
    pub frame_samples: u64,
}

/// What to do with a packet before its frames are written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Admission {
    /// The packet follows the previous one. Write its frames.
    Contiguous,
    /// Write this many frames of silence, and then the packet.
    Fill(u64),
    /// Pad the encoder's partial frame with `pad` zeros and end the page, record `anchor`, and then
    /// write the packet.
    Segment { pad: u64, anchor: Anchor },
}

/// Tracks the frames written to one track against the capture times of its packets.
#[derive(Debug)]
pub struct TrackClock {
    config: ClockConfig,
    open: bool,
    segment_start_ns: u64,
    segment_frames: u64,
    total_frames: u64,
}

impl TrackClock {
    pub fn new(config: ClockConfig) -> Self {
        TrackClock {
            config,
            open: false,
            segment_start_ns: 0,
            segment_frames: 0,
            total_frames: 0,
        }
    }

    /// Frames written so far, including silence and padding.
    pub fn total_frames(&self) -> u64 {
        self.total_frames
    }

    /// Admits a packet of `frames` frames whose first frame was captured at `capture_ns`.
    pub fn admit(&mut self, capture_ns: u64, frames: u64) -> Admission {
        let admission = if self.open {
            self.place(capture_ns)
        } else {
            self.start_segment(capture_ns)
        };
        self.segment_frames += frames;
        self.total_frames += frames;
        admission
    }

    fn place(&mut self, capture_ns: u64) -> Admission {
        let expected_ns = self.segment_start_ns + frames_to_ns(self.segment_frames);
        let tolerance = self.config.tolerance_ns;
        if capture_ns > expected_ns + tolerance {
            let gap_ns = capture_ns - expected_ns;
            if gap_ns > self.config.max_fill_ns {
                return self.start_segment(capture_ns);
            }
            let fill = ns_to_frames(gap_ns);
            self.segment_frames += fill;
            self.total_frames += fill;
            Admission::Fill(fill)
        } else if capture_ns + tolerance < expected_ns {
            self.start_segment(capture_ns)
        } else {
            Admission::Contiguous
        }
    }

    fn start_segment(&mut self, capture_ns: u64) -> Admission {
        let pad = self.pad_to_frame();
        self.open = true;
        self.segment_start_ns = capture_ns;
        self.segment_frames = 0;
        Admission::Segment {
            pad,
            anchor: Anchor {
                frame: self.total_frames,
                time_ns: capture_ns,
            },
        }
    }

    /// Ends the current stretch at a pause. Returns the zeros that complete the encoder's last frame.
    /// The next packet starts a new stretch.
    pub fn pause(&mut self) -> u64 {
        self.open = false;
        self.pad_to_frame()
    }

    /// Counts the zeros that complete the encoder's partial frame, and returns them.
    fn pad_to_frame(&mut self) -> u64 {
        let frame = self.config.frame_samples;
        let pad = (frame - self.total_frames % frame) % frame;
        self.total_frames += pad;
        pad
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: u64 = 1_000_000;

    fn clock() -> TrackClock {
        TrackClock::new(ClockConfig {
            tolerance_ns: 15 * MS,
            max_fill_ns: 10_000 * MS,
            frame_samples: 960,
        })
    }

    /// A packet of 10 ms.
    const PACKET: u64 = 480;

    #[test]
    fn the_first_packet_opens_the_first_stretch() {
        let mut clock = clock();
        let admission = clock.admit(7_000 * MS, PACKET);
        assert_eq!(
            admission,
            Admission::Segment {
                pad: 0,
                anchor: Anchor {
                    frame: 0,
                    time_ns: 7_000 * MS
                }
            }
        );
        assert_eq!(clock.total_frames(), PACKET);
    }

    #[test]
    fn packets_with_a_little_scatter_stay_contiguous() {
        let mut clock = clock();
        clock.admit(0, PACKET);
        assert_eq!(clock.admit(11 * MS, PACKET), Admission::Contiguous);
        assert_eq!(clock.admit(19 * MS, PACKET), Admission::Contiguous);
    }

    #[test]
    fn a_short_gap_is_filled_with_silence() {
        let mut clock = clock();
        clock.admit(0, PACKET);
        // The next packet should start at 10 ms but starts at 5,010 ms.
        assert_eq!(clock.admit(5_010 * MS, PACKET), Admission::Fill(240_000));
        assert_eq!(clock.total_frames(), 2 * PACKET + 240_000);
        assert_eq!(clock.admit(5_020 * MS, PACKET), Admission::Contiguous);
    }

    #[test]
    fn a_long_gap_starts_a_new_stretch_on_a_frame_boundary() {
        let mut clock = clock();
        clock.admit(0, PACKET);
        let admission = clock.admit(60_000 * MS, PACKET);
        // 480 frames so far, so 480 more complete the first 960-frame encoder frame.
        let anchor = Anchor {
            frame: 960,
            time_ns: 60_000 * MS,
        };
        assert_eq!(admission, Admission::Segment { pad: 480, anchor });
    }

    #[test]
    fn a_device_clock_that_runs_fast_starts_a_new_stretch() {
        let mut clock = clock();
        clock.admit(0, 48_000);
        // One second of frames is written, but the capture time says only 0.97 s passed.
        assert!(matches!(clock.admit(970 * MS, PACKET), Admission::Segment { .. }));
    }

    #[test]
    fn a_pause_pads_the_frame_and_the_next_packet_starts_over() {
        let mut clock = clock();
        clock.admit(0, 1_000);
        assert_eq!(clock.pause(), 920);
        assert_eq!(clock.total_frames(), 1_920);
        let admission = clock.admit(3_000 * MS, PACKET);
        assert_eq!(
            admission,
            Admission::Segment {
                pad: 0,
                anchor: Anchor {
                    frame: 1_920,
                    time_ns: 3_000 * MS
                }
            }
        );
    }
}
