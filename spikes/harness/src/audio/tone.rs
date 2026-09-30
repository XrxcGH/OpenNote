//! The test tone and the filter that finds it. The tone is quiet, high, and short, so a sleeping
//! person nearby won't hear it. It plays in bursts at 19 kHz and -50 dBFS (decibels relative to full
//! scale), with gentle ramps so the edges don't click. A Goertzel filter measures its level in short blocks, and the
//! burst edges are timed where that level crosses half its plateau.

use serde::Serialize;

/// The tone frequency. Most adults can't hear above about 17 kHz, and laptop speakers barely play it.
pub const FREQUENCY_HZ: u32 = 19_000;
/// Peak level: -50 dBFS, 10 dB under the spike's limit, because the speaker processing on the test
/// laptop boosts 19 kHz.
pub const AMPLITUDE: f32 = 0.003_162_3;
/// Burst length, repeat period, and ramp length in milliseconds.
const ON_MS: u64 = 150;
const PERIOD_MS: u64 = 500;
const RAMP_MS: u64 = 2;
/// The most tone the spike may play in total, in seconds.
pub const MAX_TOTAL_SECONDS: f64 = 10.0;

/// Tone bursts for one output stream, scheduled in frames from the stream's first frame.
#[derive(Clone, Debug, Serialize)]
pub struct Tone {
    pub sample_rate: u32,
    pub frequency_hz: u32,
    pub amplitude: f32,
    pub start_frame: u64,
    pub on_frames: u64,
    pub period_frames: u64,
    pub ramp_frames: u64,
    pub bursts: u64,
}

/// A burst edge: the frame (fractional) where the envelope crosses one half.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Edge {
    pub frame: f64,
    pub rising: bool,
}

impl Tone {
    /// `bursts` bursts starting `start_ms` after the stream starts.
    pub fn new(sample_rate: u32, start_ms: u64, bursts: u64) -> Tone {
        let frames = |ms: u64| ms * u64::from(sample_rate) / 1000;
        Tone {
            sample_rate,
            frequency_hz: FREQUENCY_HZ,
            amplitude: AMPLITUDE,
            start_frame: frames(start_ms),
            on_frames: frames(ON_MS),
            period_frames: frames(PERIOD_MS),
            ramp_frames: frames(RAMP_MS).max(1),
            bursts,
        }
    }

    /// How many bursts fit in `seconds` of output, leaving room after the last one.
    pub fn bursts_that_fit(seconds: f64, start_ms: u64, most: u64) -> u64 {
        let room_ms = seconds * 1000.0 - start_ms as f64 - 1000.0;
        ((room_ms / PERIOD_MS as f64).floor().max(0.0) as u64).min(most)
    }

    /// Total time the tone is on, in seconds.
    pub fn total_seconds(&self) -> f64 {
        (self.bursts * self.on_frames) as f64 / f64::from(self.sample_rate)
    }

    /// The envelope from 0 to 1 at `frame`: raised-cosine ramps at both ends of each burst.
    pub fn envelope(&self, frame: u64) -> f32 {
        let Some(offset) = frame.checked_sub(self.start_frame) else {
            return 0.0;
        };
        if offset / self.period_frames >= self.bursts {
            return 0.0;
        }
        let local = offset % self.period_frames;
        if local >= self.on_frames {
            return 0.0;
        }
        let from_edge = local.min(self.on_frames - local);
        if from_edge >= self.ramp_frames {
            return 1.0;
        }
        let phase = std::f64::consts::PI * from_edge as f64 / self.ramp_frames as f64;
        (0.5 - 0.5 * phase.cos()) as f32
    }

    /// The tone sample at `frame`. The phase comes from integer arithmetic, so it never drifts.
    pub fn sample(&self, frame: u64) -> f32 {
        let envelope = self.envelope(frame);
        if envelope == 0.0 {
            return 0.0;
        }
        let rate = u64::from(self.sample_rate);
        let cycle = (frame % rate) * u64::from(self.frequency_hz) % rate;
        let angle = std::f64::consts::TAU * cycle as f64 / rate as f64;
        self.amplitude * envelope * angle.sin() as f32
    }

    /// Every burst edge, in order.
    pub fn edges(&self) -> Vec<Edge> {
        let half_ramp = self.ramp_frames as f64 / 2.0;
        (0..self.bursts)
            .flat_map(|burst| {
                let start = (self.start_frame + burst * self.period_frames) as f64;
                let rise = Edge {
                    frame: start + half_ramp,
                    rising: true,
                };
                let fall = Edge {
                    frame: start + self.on_frames as f64 - half_ramp,
                    rising: false,
                };
                [rise, fall]
            })
            .collect()
    }
}

/// A Goertzel filter: the level of one frequency over blocks of `length` samples.
#[derive(Clone, Debug)]
pub struct Goertzel {
    coefficient: f64,
    length: usize,
    count: usize,
    s1: f64,
    s2: f64,
}

impl Goertzel {
    pub fn new(frequency_hz: f64, sample_rate: f64, length: usize) -> Goertzel {
        let omega = std::f64::consts::TAU * frequency_hz / sample_rate;
        Goertzel {
            coefficient: 2.0 * omega.cos(),
            length: length.max(1),
            count: 0,
            s1: 0.0,
            s2: 0.0,
        }
    }

    /// True when the next sample starts a new block.
    pub fn at_block_start(&self) -> bool {
        self.count == 0
    }

    /// Adds a sample. At the end of each block, returns the amplitude of the frequency in that block.
    pub fn push(&mut self, sample: f32) -> Option<f32> {
        let s0 = f64::from(sample) + self.coefficient * self.s1 - self.s2;
        self.s2 = self.s1;
        self.s1 = s0;
        self.count += 1;
        if self.count < self.length {
            return None;
        }
        let power = self.s1 * self.s1 + self.s2 * self.s2 - self.coefficient * self.s1 * self.s2;
        self.count = 0;
        self.s1 = 0.0;
        self.s2 = 0.0;
        Some((2.0 * power.max(0.0).sqrt() / self.length as f64) as f32)
    }
}

/// The tone level in one block of captured audio, and the capture time of its first sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Block {
    pub start_ns: u64,
    pub amplitude: f32,
}

/// A detected edge: the time the level crossed the threshold, in nanoseconds on the QPC clock.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crossing {
    pub time_ns: f64,
    pub rising: bool,
}

/// Finds where the block level crosses `threshold`, alternating rising and falling edges. Times are
/// interpolated between the centers of neighboring blocks. Blocks that aren't neighbors in time (a gap
/// in the stream) never form an edge.
pub fn crossings(blocks: &[Block], threshold: f32, block_ns: f64) -> Vec<Crossing> {
    let center = block_ns / 2.0;
    let mut high = blocks.first().is_some_and(|block| block.amplitude >= threshold);
    let mut found = Vec::new();
    for pair in blocks.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let step = b.start_ns as f64 - a.start_ns as f64;
        let adjacent = (step - block_ns).abs() <= block_ns * 0.25;
        let crossed = if high {
            b.amplitude < threshold
        } else {
            b.amplitude >= threshold
        };
        if !crossed {
            continue;
        }
        high = !high;
        if !adjacent {
            continue;
        }
        let fraction = f64::from((threshold - a.amplitude) / (b.amplitude - a.amplitude));
        let time_ns = a.start_ns as f64 + center + fraction.clamp(0.0, 1.0) * step;
        found.push(Crossing { time_ns, rising: high });
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;
    const BLOCK: usize = 96;

    #[test]
    fn schedules_quiet_short_bursts() {
        let tone = Tone::new(RATE, 200, 15);
        assert_eq!(tone.on_frames, 7_200);
        assert!((tone.total_seconds() - 2.25).abs() < 1e-9);
        assert_eq!(tone.envelope(0), 0.0);
        assert_eq!(tone.envelope(tone.start_frame + 3_000), 1.0);
        assert_eq!(tone.envelope(tone.start_frame + 8_000), 0.0);
        assert_eq!(tone.envelope(tone.start_frame + 15 * tone.period_frames), 0.0);
        let loudest = (0..RATE as u64 * 8)
            .map(|frame| tone.sample(frame).abs())
            .fold(0.0, f32::max);
        assert!(loudest <= AMPLITUDE && loudest > AMPLITUDE * 0.95);
        assert_eq!(tone.edges().len(), 30);
        assert_eq!(Tone::bursts_that_fit(20.0, 200, 15), 15);
        assert_eq!(Tone::bursts_that_fit(5.0, 200, 15), 7);
        assert_eq!(Tone::bursts_that_fit(1.0, 200, 15), 0);
    }

    #[test]
    fn goertzel_measures_the_level_of_one_frequency() {
        let sine = |frequency: f64, amplitude: f32| {
            let mut filter = Goertzel::new(19_000.0, f64::from(RATE), BLOCK);
            (0..BLOCK)
                .filter_map(|n| {
                    let angle = std::f64::consts::TAU * frequency * n as f64 / f64::from(RATE);
                    filter.push(amplitude * angle.sin() as f32)
                })
                .last()
                .unwrap()
        };
        assert!((sine(19_000.0, 0.01) - 0.01).abs() < 1e-5);
        assert!(sine(1_000.0, 0.5) < 0.005);
    }

    #[test]
    fn finds_burst_edges_within_a_tenth_of_a_millisecond() {
        let tone = Tone::new(RATE, 100, 4);
        let frame_ns = 1e9 / f64::from(RATE);
        let mut filter = Goertzel::new(f64::from(FREQUENCY_HZ), f64::from(RATE), BLOCK);
        let mut blocks = Vec::new();
        let mut start = 0;
        for frame in 0..RATE as u64 * 3 {
            if filter.at_block_start() {
                start = (frame as f64 * frame_ns) as u64;
            }
            if let Some(amplitude) = filter.push(tone.sample(frame)) {
                blocks.push(Block {
                    start_ns: start,
                    amplitude,
                });
            }
        }
        let found = crossings(&blocks, AMPLITUDE / 2.0, BLOCK as f64 * frame_ns);
        let expected = tone.edges();
        assert_eq!(found.len(), expected.len());
        for (crossing, edge) in found.iter().zip(&expected) {
            assert_eq!(crossing.rising, edge.rising);
            let error_ms = (crossing.time_ns - edge.frame * frame_ns).abs() / 1e6;
            assert!(error_ms < 0.1, "edge off by {error_ms} ms");
        }
    }

    #[test]
    fn ignores_level_changes_across_a_gap() {
        let blocks = [
            Block {
                start_ns: 0,
                amplitude: 0.0,
            },
            Block {
                start_ns: 50_000_000,
                amplitude: 1.0,
            },
            Block {
                start_ns: 52_000_000,
                amplitude: 0.0,
            },
        ];
        let found = crossings(&blocks, 0.5, 2_000_000.0);
        assert_eq!(found.len(), 1);
        assert!(!found[0].rising);
    }
}
