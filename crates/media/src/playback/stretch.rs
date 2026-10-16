//! Changes the speed of speech without changing its pitch.
//!
//! This is waveform similarity overlap-add (WSOLA). The audio is cut into windows of 40 ms that
//! overlap by half. Output windows are laid down at a steady pace. Each is taken from the input near
//! where its pace says, at the offset (within 10 ms) that continues the previous window most
//! smoothly. Playing faster takes windows from further apart, and playing slower takes them closer.
//! Pitch stays, because no window is resampled.
//!
//! The stretcher pulls input through a function, so the player can feed it from the mixer and skip
//! silence on the way. It works on mono audio at 48 kHz.

use std::collections::VecDeque;
use std::f32::consts::TAU;

/// The window length: 40 ms.
const WINDOW: usize = 1_920;
/// The distance between output windows, half the window.
const HOP: usize = WINDOW / 2;
/// How far from the nominal place a window may start: 10 ms either way.
const SEARCH: usize = 480;
/// How much input to ask the source for at a time.
const CHUNK: usize = 4_096;
/// The coarse search looks at every fourth start, and at every second sample of each.
const COARSE_STEP: usize = 4;
const COARSE_STRIDE: usize = 2;

/// The slowest and fastest speeds.
pub const MIN_SPEED: f32 = 0.5;
pub const MAX_SPEED: f32 = 3.0;

pub struct Stretcher {
    speed: f64,
    hann: Vec<f32>,
    input: Vec<f32>,
    input_start: u64,
    real_end: Option<u64>,
    nominal: f64,
    previous: Option<u64>,
    overlap: Vec<f32>,
    ready: VecDeque<f32>,
    center: u64,
    finished: bool,
    chunk: Vec<f32>,
}

impl Default for Stretcher {
    fn default() -> Self {
        Self::new()
    }
}

impl Stretcher {
    pub fn new() -> Self {
        // A periodic Hann window, so two windows that overlap by half add up to exactly one.
        let hann = (0..WINDOW)
            .map(|i| 0.5 - 0.5 * (TAU * i as f32 / WINDOW as f32).cos())
            .collect();
        Stretcher {
            speed: 1.0,
            hann,
            input: Vec::new(),
            input_start: 0,
            real_end: None,
            nominal: 0.0,
            previous: None,
            overlap: vec![0.0; HOP],
            ready: VecDeque::new(),
            center: 0,
            finished: false,
            chunk: vec![0.0; CHUNK],
        }
    }

    /// Sets the speed, where 1 is normal. Values outside the range are clamped to it.
    pub fn set_speed(&mut self, speed: f32) {
        self.speed = f64::from(speed.clamp(MIN_SPEED, MAX_SPEED));
    }

    pub fn speed(&self) -> f32 {
        self.speed as f32
    }

    /// Starts over, for a seek. Input is numbered from zero again.
    pub fn reset(&mut self) {
        self.input.clear();
        self.input_start = 0;
        self.real_end = None;
        self.nominal = 0.0;
        self.previous = None;
        self.overlap.fill(0.0);
        self.ready.clear();
        self.center = 0;
        self.finished = false;
    }

    /// The input sample that the output being produced now comes from, counted from the last reset.
    pub fn input_position(&self) -> u64 {
        let queued = (self.ready.len() as f64 * self.speed) as u64;
        self.center.saturating_sub(queued)
    }

    /// Fills `out` with stretched audio, pulling input from `source`. The source returns how many
    /// samples it wrote, and zero only when the audio has ended. The result is shorter than `out`
    /// only at the end.
    pub fn process(&mut self, out: &mut [f32], source: &mut dyn FnMut(&mut [f32]) -> usize) -> usize {
        let mut written = 0;
        while written < out.len() {
            while self.ready.is_empty() && !self.finished {
                self.step(source);
            }
            if self.ready.is_empty() {
                break;
            }
            let take = (out.len() - written).min(self.ready.len());
            for slot in &mut out[written..written + take] {
                *slot = self.ready.pop_front().unwrap_or(0.0);
            }
            written += take;
        }
        written
    }

    /// Makes one window's worth of output, which is `HOP` samples.
    fn step(&mut self, source: &mut dyn FnMut(&mut [f32]) -> usize) {
        let nominal = self.nominal.round().max(0.0) as u64;
        let template_end = self.previous.map_or(0, |previous| previous + WINDOW as u64);
        self.fill(source, (nominal + (SEARCH + WINDOW) as u64).max(template_end));
        if self.real_end.is_some_and(|end| nominal >= end) {
            self.ready.extend(self.overlap.iter().copied());
            self.overlap.fill(0.0);
            self.finished = true;
            return;
        }
        let pick = match self.previous {
            None => {
                // The first window has nothing before it, so it plays unfaded: its first half is the
                // second half of an imagined window before it.
                for i in 0..HOP {
                    self.overlap[i] = self.hann[HOP + i] * self.at(nominal + i as u64);
                }
                nominal
            }
            Some(previous) => self.best_match(previous, nominal),
        };
        for i in 0..HOP {
            let first = self.hann[i] * self.at(pick + i as u64);
            self.ready.push_back(self.overlap[i] + first);
            self.overlap[i] = self.hann[HOP + i] * self.at(pick + (HOP + i) as u64);
        }
        self.center = pick + (HOP / 2) as u64;
        self.previous = Some(pick);
        self.nominal += self.speed * HOP as f64;
        self.trim(pick);
    }

    /// The input sample at an absolute index. Anything before the kept input or past its end is silent.
    fn at(&self, index: u64) -> f32 {
        index
            .checked_sub(self.input_start)
            .and_then(|offset| self.input.get(offset as usize))
            .copied()
            .unwrap_or(0.0)
    }

    /// Reads input until it reaches `upto`, padding with silence once the source has ended.
    fn fill(&mut self, source: &mut dyn FnMut(&mut [f32]) -> usize, upto: u64) {
        while self.input_start + (self.input.len() as u64) < upto {
            if self.real_end.is_none() {
                let count = source(&mut self.chunk).min(CHUNK);
                if count == 0 {
                    self.real_end = Some(self.input_start + self.input.len() as u64);
                } else {
                    self.input.extend_from_slice(&self.chunk[..count]);
                    continue;
                }
            }
            let missing = (upto - self.input_start) as usize - self.input.len();
            self.input.resize(self.input.len() + missing, 0.0);
        }
    }

    /// The start near `nominal` whose first half best continues the second half of the previous
    /// window. A coarse pass looks at every fourth start with every second sample, and a fine pass
    /// then looks at every start near the best of those. Ties go to the start nearest the nominal
    /// place.
    fn best_match(&self, previous: u64, nominal: u64) -> u64 {
        let template_start = (previous + HOP as u64).saturating_sub(self.input_start) as usize;
        let template = &self.input[template_start..template_start + HOP];
        let lowest = nominal.saturating_sub(SEARCH as u64).max(self.input_start);
        let highest = nominal + SEARCH as u64;
        let score_at = |candidate: u64, stride: usize| {
            let start = (candidate - self.input_start) as usize;
            similarity(template, &self.input[start..start + HOP], stride)
        };
        let mut best = (nominal, score_at(nominal, COARSE_STRIDE));
        for distance in (COARSE_STEP..=SEARCH).step_by(COARSE_STEP) {
            for candidate in [nominal + distance as u64, nominal.wrapping_sub(distance as u64)] {
                if candidate >= lowest && candidate <= highest {
                    let score = score_at(candidate, COARSE_STRIDE);
                    if score > best.1 + 1e-6 {
                        best = (candidate, score);
                    }
                }
            }
        }
        let (center, mut fine) = (best.0, (best.0, f32::MIN));
        for candidate in center.saturating_sub(COARSE_STEP as u64 - 1)..=center + COARSE_STEP as u64 - 1 {
            if candidate >= lowest && candidate <= highest {
                let score = score_at(candidate, 1);
                if score > fine.1 + 1e-6
                    || (score > fine.1 - 1e-6 && candidate.abs_diff(nominal) < fine.0.abs_diff(nominal))
                {
                    fine = (candidate, score);
                }
            }
        }
        fine.0
    }

    /// Drops input that no later window can use.
    fn trim(&mut self, pick: u64) {
        let next_search = (self.nominal.round().max(0.0) as u64).saturating_sub(SEARCH as u64);
        let keep_from = (pick + HOP as u64).min(next_search);
        let drop = keep_from.saturating_sub(self.input_start) as usize;
        if drop >= CHUNK {
            self.input.drain(..drop);
            self.input_start += drop as u64;
        }
    }
}

/// How well `candidate` matches `template`: their correlation, scaled by the candidate's level so
/// that a loud candidate doesn't win just for being loud. Only every `stride`th sample is used.
fn similarity(template: &[f32], candidate: &[f32], stride: usize) -> f32 {
    let (mut dot, mut energy) = (0f32, 0f32);
    for (a, b) in template.iter().step_by(stride).zip(candidate.iter().step_by(stride)) {
        dot += a * b;
        energy += b * b;
    }
    dot / (energy + 1e-9).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// A source that plays a 220 Hz tone with a 3 Hz wobble in its level, like speech, for `seconds`.
    fn tone(seconds: usize) -> impl FnMut(&mut [f32]) -> usize {
        let total = seconds * 48_000;
        let mut at = 0;
        move |buffer: &mut [f32]| {
            let count = buffer.len().min(total - at);
            for (i, slot) in buffer[..count].iter_mut().enumerate() {
                let t = (at + i) as f32 / RATE;
                *slot = 0.3 * (TAU * 220.0 * t).sin() * (0.7 + 0.3 * (TAU * 3.0 * t).sin());
            }
            at += count;
            count
        }
    }

    fn render_all(speed: f32, seconds: usize) -> Vec<f32> {
        let mut stretcher = Stretcher::new();
        stretcher.set_speed(speed);
        let mut source = tone(seconds);
        let (mut output, mut buffer) = (Vec::new(), vec![0f32; 1_000]);
        loop {
            let count = stretcher.process(&mut buffer, &mut source);
            output.extend_from_slice(&buffer[..count]);
            if count < buffer.len() {
                return output;
            }
        }
    }

    /// Estimates the frequency from rising zero crossings in the middle of the output.
    fn frequency(samples: &[f32]) -> f32 {
        let middle = &samples[samples.len() / 4..samples.len() * 3 / 4];
        let crossings = middle.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        crossings as f32 / (middle.len() as f32 / RATE)
    }

    #[test]
    fn faster_playback_is_shorter_and_keeps_the_pitch() {
        for speed in [1.5f32, 2.0, 3.0] {
            let output = render_all(speed, 3);
            let expected = 3.0 * RATE / speed;
            assert!(
                (output.len() as f32 - expected).abs() < 3.0 * HOP as f32,
                "{speed}x: {} samples, expected about {expected}",
                output.len()
            );
            let pitch = frequency(&output);
            assert!((pitch - 220.0).abs() < 6.0, "{speed}x gives {pitch} Hz");
        }
    }

    #[test]
    fn slower_playback_is_longer_and_keeps_the_pitch() {
        let output = render_all(0.5, 2);
        assert!(
            (output.len() as f32 - 4.0 * RATE).abs() < 3.0 * HOP as f32,
            "{}",
            output.len()
        );
        let pitch = frequency(&output);
        assert!((pitch - 220.0).abs() < 6.0, "{pitch} Hz");
    }

    #[test]
    fn the_level_stays_about_the_same() {
        let rms = |samples: &[f32]| (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        let normal = render_all(1.0, 2);
        let fast = render_all(2.5, 2);
        let ratio = rms(&fast[4_800..fast.len() - 4_800]) / rms(&normal[4_800..normal.len() - 4_800]);
        assert!((0.85..1.15).contains(&ratio), "level ratio {ratio}");
    }

    #[test]
    fn normal_speed_reproduces_the_input() {
        let output = render_all(1.0, 1);
        let mut reference = vec![0f32; 48_000];
        tone(1)(&mut reference);
        let error: f32 = output[2_000..44_000]
            .iter()
            .zip(&reference[2_000..44_000])
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f32::max);
        assert!(error < 0.05, "largest difference {error}");
    }

    #[test]
    fn a_reset_starts_over_without_a_fade() {
        let mut stretcher = Stretcher::new();
        stretcher.set_speed(2.0);
        let mut buffer = vec![0f32; 4_000];
        stretcher.process(&mut buffer, &mut tone(3));
        stretcher.reset();
        let count = stretcher.process(&mut buffer, &mut tone(3));
        assert_eq!(count, 4_000);
        // The first window is not faded in, so the first 5 ms already carry the tone at its level.
        let early = buffer[..240].iter().fold(0f32, |peak, s| peak.max(s.abs()));
        assert!(early > 0.1, "peak {early}");
    }

    #[test]
    fn out_of_range_speeds_are_clamped() {
        let mut stretcher = Stretcher::new();
        stretcher.set_speed(10.0);
        assert_eq!(stretcher.speed(), MAX_SPEED);
        stretcher.set_speed(0.1);
        assert_eq!(stretcher.speed(), MIN_SPEED);
    }
}
