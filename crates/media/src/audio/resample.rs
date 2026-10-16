//! Converts a device's sample rate to the track rate.
//!
//! Most devices run at 48 kHz, and then samples pass through untouched. Some run at 44.1 kHz or
//! 96 kHz, and cpal in shared mode can't ask Windows to convert. This resampler uses cubic
//! interpolation, with a moving average in front when it reduces the rate. It is plain, meant for
//! speech, and can be swapped for a polyphase filter later without changing the interface.

use super::TRACK_RATE;

/// Converts mono audio from one rate to [`TRACK_RATE`].
#[derive(Debug)]
pub struct Resampler {
    passthrough: bool,
    /// Input frames for each output frame.
    step: f64,
    /// Width of the moving average that runs before the interpolation when the rate drops.
    width: usize,
    history: Vec<f32>,
    buffer: Vec<f32>,
    position: f64,
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        let step = f64::from(input_rate.max(1)) / f64::from(TRACK_RATE);
        let mut resampler = Resampler {
            passthrough: input_rate == TRACK_RATE,
            step,
            width: step.ceil().max(1.0) as usize,
            history: Vec::new(),
            buffer: Vec::new(),
            position: 0.0,
        };
        resampler.reset();
        resampler
    }

    /// Forgets the samples so far, after a break in the audio.
    pub fn reset(&mut self) {
        self.history = vec![0.0; self.width - 1];
        // One zero sample of history, and the first output at the first input sample.
        self.buffer = vec![0.0];
        self.position = 1.0;
    }

    /// Converts `input` and replaces the contents of `out` with the result.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        out.clear();
        if self.passthrough {
            out.extend_from_slice(input);
            return;
        }
        let filtered = self.prefilter(input);
        self.buffer.extend_from_slice(&filtered);
        while self.position as usize + 2 < self.buffer.len() {
            let index = self.position as usize;
            let t = (self.position - index as f64) as f32;
            let [y0, y1, y2, y3] = [-1, 0, 1, 2].map(|offset| self.buffer[(index as isize + offset) as usize]);
            let (c1, c2) = (0.5 * (y2 - y0), y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3);
            let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            out.push(((c3 * t + c2) * t + c1) * t + y1);
            self.position += self.step;
        }
        // Above 192 kHz a step skips more than four samples, so the position can pass the end of the
        // buffer. Only what is there is dropped, and the position keeps the rest.
        let consumed = (self.position as usize).saturating_sub(1).min(self.buffer.len());
        self.buffer.drain(..consumed);
        self.position -= consumed as f64;
    }

    /// A moving average over `width` samples, which takes the edge off frequencies that would fold
    /// back into the band when the rate drops.
    fn prefilter(&mut self, input: &[f32]) -> Vec<f32> {
        if self.width == 1 {
            return input.to_vec();
        }
        let keep = self.width - 1;
        let mut joined = std::mem::take(&mut self.history);
        joined.extend_from_slice(input);
        let averaged = joined
            .windows(self.width)
            .map(|w| w.iter().sum::<f32>() / self.width as f32)
            .collect();
        self.history = joined[joined.len() - keep..].to_vec();
        averaged
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, hz: f64, seconds: f64) -> Vec<f32> {
        let frames = (f64::from(rate) * seconds) as usize;
        (0..frames)
            .map(|i| (0.5 * (std::f64::consts::TAU * hz * i as f64 / f64::from(rate)).sin()) as f32)
            .collect()
    }

    /// Frequency from the zero crossings, and the peak.
    fn measure(samples: &[f32]) -> (f64, f32) {
        let crossings = samples.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        let peak = samples.iter().fold(0f32, |peak, s| peak.max(s.abs()));
        (crossings as f64 * f64::from(TRACK_RATE) / samples.len() as f64, peak)
    }

    fn resample_in_packets(rate: u32, input: &[f32]) -> Vec<f32> {
        let mut resampler = Resampler::new(rate);
        let (mut all, mut out) = (Vec::new(), Vec::new());
        for packet in input.chunks(rate as usize / 100) {
            resampler.process(packet, &mut out);
            all.extend_from_slice(&out);
        }
        all
    }

    #[test]
    fn audio_at_the_track_rate_passes_through() {
        let mut resampler = Resampler::new(48_000);
        let mut out = Vec::new();
        resampler.process(&[0.25, -0.5, 1.0], &mut out);
        assert_eq!(out, vec![0.25, -0.5, 1.0]);
    }

    #[test]
    fn a_44_1_khz_tone_keeps_its_pitch_and_level() {
        let out = resample_in_packets(44_100, &sine(44_100, 1_000.0, 2.0));
        assert!((out.len() as i64 - 96_000).abs() <= 4, "{} frames", out.len());
        let (hz, peak) = measure(&out[480..]);
        assert!((hz - 1_000.0).abs() < 5.0, "{hz} Hz");
        assert!(peak > 0.49 && peak < 0.51, "peak {peak}");
    }

    #[test]
    fn a_96_khz_tone_is_halved_in_length() {
        let out = resample_in_packets(96_000, &sine(96_000, 500.0, 2.0));
        assert!((out.len() as i64 - 96_000).abs() <= 4, "{} frames", out.len());
        let (hz, _) = measure(&out[480..]);
        assert!((hz - 500.0).abs() < 5.0, "{hz} Hz");
    }

    #[test]
    fn rates_far_above_the_track_rate_take_packets_of_any_size() {
        for rate in [352_800, 384_000, 768_000] {
            let input = sine(rate, 440.0, 1.0);
            let mut resampler = Resampler::new(rate);
            let (mut all, mut out) = (Vec::new(), Vec::new());
            let mut rest = &input[..];
            for size in [100, 101, 37, 1, 7, 960].into_iter().cycle() {
                if rest.is_empty() {
                    break;
                }
                let (packet, after) = rest.split_at(size.min(rest.len()));
                resampler.process(packet, &mut out);
                all.extend_from_slice(&out);
                rest = after;
            }
            assert!(
                (all.len() as i64 - 48_000).abs() <= 4,
                "{rate} Hz: {} frames",
                all.len()
            );
            let (hz, _) = measure(&all[480..]);
            assert!((hz - 440.0).abs() < 5.0, "{rate} Hz: {hz} Hz");
        }
    }

    #[test]
    fn packet_boundaries_do_not_change_the_result() {
        let input = sine(44_100, 700.0, 0.5);
        let mut whole = Resampler::new(44_100);
        let mut expected = Vec::new();
        whole.process(&input, &mut expected);
        let pieces = resample_in_packets(44_100, &input);
        let common = expected.len().min(pieces.len());
        assert!(common > 20_000);
        assert!(expected[..common]
            .iter()
            .zip(&pieces)
            .all(|(a, b)| (a - b).abs() < 1e-4));
    }
}
