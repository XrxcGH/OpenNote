//! Voice enhancement: reduces steady background noise and evens out loud and quiet speech.
//!
//! Noise reduction is spectral gating. The audio is cut into overlapping frames of 512 samples, and each
//! frequency of each frame is turned down by an amount that depends on how far its power rises above the
//! noise at that frequency. The noise is the lowest power the frequency reached lately (minimum
//! statistics), so it follows a fan that speeds up and needs no sample of the room. The gain never drops
//! below a floor, and it falls slowly and rises quickly, so speech starts cleanly and noise does not
//! flutter.
//!
//! Leveling is a slow gain that moves the speech toward a target level. It changes only while something
//! louder than the room is being said, and it holds still in pauses, so the room's noise is not pumped up
//! between words. A soft limiter keeps the result from clipping.

use super::fft::Fft;
use super::Processor;

const FRAME: usize = 512;
const HOP: usize = FRAME / 2;
/// How much the noise estimate may rise in each hop when the power stays above it: a doubling in about 4 s.
const NOISE_RISE: f32 = 1.001;
/// The estimate is the lowest power seen, which is below the average noise, so it is scaled up.
const NOISE_BIAS: f32 = 2.0;
const SMOOTHING: f32 = 0.5;
/// How much of the way a frequency's gain moves toward its new value in one hop, rising and falling.
const GAIN_UP: f32 = 0.8;
const GAIN_DOWN: f32 = 0.4;

const TARGET_RMS: f32 = 0.1;
const MIN_LEVEL_GAIN: f32 = 0.25;
const MAX_LEVEL_GAIN: f32 = 4.0;
/// Speech must rise this far above the quietest hop lately before the leveler listens to it.
const ACTIVE_ABOVE_FLOOR: f32 = 3.0;
const ACTIVE_MIN_RMS: f32 = 0.004;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub reduce_noise: bool,
    pub level_voice: bool,
    /// The most that noise is turned down, in decibels.
    pub max_reduction_db: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            reduce_noise: true,
            level_voice: true,
            max_reduction_db: 18.0,
        }
    }
}

/// The enhancer as a [`Processor`]. Each track needs its own, since it learns the noise of its audio.
pub struct Enhancer {
    settings: Settings,
    floor: f32,
    fft: Fft,
    window: Vec<f32>,
    pending: Vec<f32>,
    frame: Vec<f32>,
    overlap: Vec<f32>,
    smooth: Vec<f32>,
    noise: Vec<f32>,
    gains: Vec<f32>,
    leveler: Leveler,
    re: Vec<f32>,
    im: Vec<f32>,
}

impl Enhancer {
    pub fn new(settings: Settings) -> Self {
        let bins = FRAME / 2 + 1;
        Enhancer {
            floor: 10f32.powf(-settings.max_reduction_db / 20.0),
            settings,
            fft: Fft::new(FRAME),
            // A sine window, whose square overlaps to one at half a frame.
            window: (0..FRAME)
                .map(|n| (std::f32::consts::PI * (n as f32 + 0.5) / FRAME as f32).sin())
                .collect(),
            pending: Vec::new(),
            frame: vec![0.0; FRAME],
            overlap: vec![0.0; FRAME],
            smooth: vec![0.0; bins],
            noise: vec![f32::INFINITY; bins],
            gains: vec![1.0; bins],
            leveler: Leveler::default(),
            re: vec![0.0; FRAME],
            im: vec![0.0; FRAME],
        }
    }

    /// Takes one hop of input and gives one hop of output, which lags by `FRAME - HOP` samples.
    fn hop(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.frame.copy_within(HOP.., 0);
        self.frame[FRAME - HOP..].copy_from_slice(input);
        if self.settings.reduce_noise {
            self.gate();
        } else {
            for n in 0..FRAME {
                self.overlap[n] += self.frame[n] * self.window[n] * self.window[n];
            }
        }
        let start = out.len();
        out.extend_from_slice(&self.overlap[..HOP]);
        self.overlap.copy_within(HOP.., 0);
        self.overlap[FRAME - HOP..].fill(0.0);
        if self.settings.level_voice {
            self.leveler.apply(&mut out[start..]);
        }
    }

    /// Turns each frequency of the frame down by its gain and adds the frame to the overlap.
    fn gate(&mut self) {
        for n in 0..FRAME {
            self.re[n] = self.frame[n] * self.window[n];
            self.im[n] = 0.0;
        }
        self.fft.forward(&mut self.re, &mut self.im);
        for bin in 0..=FRAME / 2 {
            let power = self.re[bin] * self.re[bin] + self.im[bin] * self.im[bin];
            self.smooth[bin] = if self.smooth[bin] == 0.0 {
                power
            } else {
                SMOOTHING * self.smooth[bin] + (1.0 - SMOOTHING) * power
            };
            self.noise[bin] = (self.noise[bin] * NOISE_RISE).min(self.smooth[bin]);
        }
        for bin in 0..=FRAME / 2 {
            let noise = NOISE_BIAS * self.noise[bin];
            let wanted = (1.0 - noise / self.smooth[bin].max(1e-20)).max(self.floor);
            let rate = if wanted > self.gains[bin] { GAIN_UP } else { GAIN_DOWN };
            self.gains[bin] += rate * (wanted - self.gains[bin]);
        }
        for bin in 0..=FRAME / 2 {
            // Averaging neighbors takes the sharp holes out of the gain that make noise sound like bubbles.
            let (low, high) = (bin.saturating_sub(1), (bin + 1).min(FRAME / 2));
            let gain = 0.25 * self.gains[low] + 0.5 * self.gains[bin] + 0.25 * self.gains[high];
            self.re[bin] *= gain;
            self.im[bin] *= gain;
            if bin > 0 && bin < FRAME / 2 {
                self.re[FRAME - bin] *= gain;
                self.im[FRAME - bin] *= gain;
            }
        }
        self.fft.inverse(&mut self.re, &mut self.im);
        for n in 0..FRAME {
            self.overlap[n] += self.re[n] * self.window[n];
        }
    }
}

impl Processor for Enhancer {
    fn latency(&self) -> usize {
        FRAME - HOP
    }

    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.pending.extend_from_slice(input);
        let mut used = 0;
        while self.pending.len() - used >= HOP {
            let block = self.pending[used..used + HOP].to_vec();
            self.hop(&block, out);
            used += HOP;
        }
        self.pending.drain(..used);
    }

    fn finish(&mut self, out: &mut Vec<f32>) {
        // Real input stops here. Silence pushes the last real samples out of the frame.
        let rest = vec![0.0; HOP - self.pending.len() % HOP];
        self.process(&rest, out);
        self.process(&vec![0.0; FRAME - HOP], out);
    }
}

/// A slow gain that moves the speech toward a target level.
struct Leveler {
    /// The quietest recent level, which is the room.
    room: f32,
    /// The level of the speech lately.
    speech: f32,
    gain: f32,
}

impl Default for Leveler {
    fn default() -> Self {
        Leveler {
            room: f32::INFINITY,
            speech: 0.0,
            gain: 1.0,
        }
    }
}

impl Leveler {
    fn apply(&mut self, block: &mut [f32]) {
        let rms = (block.iter().map(|s| s * s).sum::<f32>() / block.len() as f32).sqrt();
        self.room = (self.room * NOISE_RISE).min(rms.max(1e-5));
        let before = self.gain;
        if rms > (self.room * ACTIVE_ABOVE_FLOOR).max(ACTIVE_MIN_RMS) {
            self.speech = if self.speech == 0.0 {
                rms
            } else {
                self.speech + 0.05 * (rms - self.speech)
            };
            let wanted = (TARGET_RMS / self.speech).clamp(MIN_LEVEL_GAIN, MAX_LEVEL_GAIN);
            // Loud speech is turned down quickly, and quiet speech is turned up slowly.
            let rate = if wanted < self.gain { 0.25 } else { 0.01 };
            self.gain += rate * (wanted - self.gain);
        }
        let steps = block.len() as f32;
        for (index, sample) in block.iter_mut().enumerate() {
            let gain = before + (self.gain - before) * (index as f32 + 1.0) / steps;
            *sample = soft_limit(*sample * gain);
        }
    }
}

/// Leaves samples below 0.8 alone and bends the rest toward 1.0 without a hard edge.
fn soft_limit(sample: f32) -> f32 {
    const KNEE: f32 = 0.8;
    let size = sample.abs();
    if size <= KNEE {
        sample
    } else {
        sample.signum() * (KNEE + (1.0 - KNEE) * ((size - KNEE) / (1.0 - KNEE)).tanh())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(settings: Settings, input: &[f32]) -> Vec<f32> {
        let mut enhancer = Enhancer::new(settings);
        let mut out = Vec::new();
        for block in input.chunks(960) {
            enhancer.process(block, &mut out);
        }
        enhancer.finish(&mut out);
        let latency = enhancer.latency();
        out.drain(..latency);
        out.truncate(input.len());
        out
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    fn db(ratio: f32) -> f32 {
        20.0 * ratio.log10()
    }

    /// Hiss from a fixed pseudo-random sequence.
    fn hiss(index: usize, amplitude: f32) -> f32 {
        let mixed = (index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(23)
            ^ (index as u64).wrapping_mul(0xC2B2_AE3D);
        ((mixed >> 40) as f32 / 16_777_216.0 - 0.5) * 2.0 * amplitude
    }

    fn voice(index: usize, amplitude: f32) -> f32 {
        let t = index as f32 / 48_000.0;
        amplitude * ((std::f32::consts::TAU * 220.0 * t).sin() + 0.5 * (std::f32::consts::TAU * 660.0 * t).sin())
    }

    /// Hiss all the way through, and voice during the given seconds.
    fn room_with_voice(seconds: usize, speaking: &[(usize, usize, f32)]) -> Vec<f32> {
        (0..seconds * 48_000)
            .map(|index| {
                let second = index / 48_000;
                let amplitude = speaking
                    .iter()
                    .find(|&&(from, to, _)| second >= from && second < to)
                    .map_or(0.0, |&(_, _, amplitude)| amplitude);
                hiss(index, 0.01) + voice(index, amplitude)
            })
            .collect()
    }

    #[test]
    fn steady_noise_is_turned_down_and_speech_is_kept() {
        let input = room_with_voice(8, &[(3, 5, 0.1)]);
        let settings = Settings {
            level_voice: false,
            ..Settings::default()
        };
        let output = run(settings, &input);
        let at = |from: usize, to: usize| from * 48_000..to * 48_000;
        let noise_cut = db(rms(&input[at(6, 8)]) / rms(&output[at(6, 8)]));
        assert!(noise_cut > 10.0, "the noise fell by only {noise_cut:.1} dB");
        let speech_change = db(rms(&output[at(3, 5)]) / rms(&input[at(3, 5)]));
        assert!(speech_change.abs() < 1.5, "the speech changed by {speech_change:.1} dB");
    }

    #[test]
    fn nothing_is_changed_when_both_stages_are_off() {
        let input = room_with_voice(1, &[(0, 1, 0.1)]);
        let settings = Settings {
            reduce_noise: false,
            level_voice: false,
            ..Settings::default()
        };
        let output = run(settings, &input);
        assert_eq!(output.len(), input.len());
        for (got, want) in output.iter().zip(&input) {
            assert!((got - want).abs() < 1e-4, "{got} {want}");
        }
    }

    #[test]
    fn loud_and_quiet_speech_move_toward_each_other() {
        let input = room_with_voice(12, &[(1, 4, 0.015), (6, 9, 0.25)]);
        let settings = Settings {
            reduce_noise: false,
            ..Settings::default()
        };
        let output = run(settings, &input);
        let at = |from: f32, to: f32| (from * 48_000.0) as usize..(to * 48_000.0) as usize;
        let before = db(rms(&input[at(7.5, 9.0)]) / rms(&input[at(2.5, 4.0)]));
        let after = db(rms(&output[at(7.5, 9.0)]) / rms(&output[at(2.5, 4.0)]));
        assert!(before > 20.0, "{before:.1}");
        assert!(
            after < before - 8.0,
            "the gap went from {before:.1} dB to {after:.1} dB"
        );
        assert!(output.iter().all(|s| s.abs() <= 1.0));
    }

    #[test]
    fn the_room_is_not_pumped_up_between_words() {
        let input = room_with_voice(10, &[(1, 3, 0.015)]);
        let output = run(Settings::default(), &input);
        let at = |from: usize, to: usize| from * 48_000..to * 48_000;
        // Even though the gain rose for the quiet speech, the pause after it stays quiet.
        let pause = rms(&output[at(6, 10)]);
        let speech = rms(&output[at(2, 3)]);
        assert!(speech / pause > 8.0, "speech {speech} against pause {pause}");
    }

    #[test]
    fn the_output_is_as_long_as_the_input_whatever_the_block_sizes() {
        let input = room_with_voice(1, &[(0, 1, 0.1)]);
        let whole = run(Settings::default(), &input[..47_999]);
        assert_eq!(whole.len(), 47_999);
        let mut enhancer = Enhancer::new(Settings::default());
        let mut out = Vec::new();
        for block in input.chunks(333) {
            enhancer.process(block, &mut out);
        }
        enhancer.finish(&mut out);
        assert!(out.len() >= input.len() + enhancer.latency());
    }
}
