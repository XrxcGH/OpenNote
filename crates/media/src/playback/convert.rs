//! Converts mono audio at 48 kHz to what a sound device wants: its rate, its channel count, and
//! its sample type.
//!
//! Most devices run at 48 kHz, and then samples pass through untouched. For 44.1 kHz and others, a
//! cubic (Catmull-Rom) interpolation reads the track at the fractional place each output sample falls.
//! That is plain, and plenty for speech.

use crate::audio::TRACK_RATE;

/// Resamples mono audio from the track rate to a device's rate.
#[derive(Clone, Debug)]
pub struct Converter {
    /// Input samples to read for each output sample.
    step: f64,
    fraction: f64,
    window: [f32; 4],
    passthrough: bool,
}

impl Converter {
    pub fn new(device_rate: u32) -> Self {
        Converter {
            step: f64::from(TRACK_RATE) / f64::from(device_rate.max(1)),
            fraction: 0.0,
            window: [0.0; 4],
            passthrough: device_rate == TRACK_RATE,
        }
    }

    /// The next output sample. `input` supplies the next input sample each time it is called.
    pub fn next(&mut self, input: &mut impl FnMut() -> f32) -> f32 {
        if self.passthrough {
            return input();
        }
        while self.fraction >= 1.0 {
            self.window = [self.window[1], self.window[2], self.window[3], input()];
            self.fraction -= 1.0;
        }
        let [a, b, c, d] = self.window;
        let t = self.fraction as f32;
        self.fraction += self.step;
        b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)))
    }
}

/// Writes `value` to every channel of a frame.
pub fn spread(frame: &mut [f32], value: f32) {
    frame.fill(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(rate: u32, input: &[f32], outputs: usize) -> Vec<f32> {
        let mut converter = Converter::new(rate);
        let mut at = 0;
        let mut source = || {
            let value = input.get(at).copied().unwrap_or(0.0);
            at += 1;
            value
        };
        (0..outputs).map(|_| converter.next(&mut source)).collect()
    }

    #[test]
    fn the_track_rate_passes_through() {
        assert_eq!(run(48_000, &[0.1, 0.2, 0.3], 3), vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn a_tone_keeps_its_pitch_at_another_rate() {
        let input: Vec<f32> = (0..48_000)
            .map(|i| (std::f32::consts::TAU * 1_000.0 * i as f32 / 48_000.0).sin())
            .collect();
        let output = run(44_100, &input, 44_100);
        let crossings = output.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert!((crossings as i32 - 1_000).abs() <= 2, "{crossings} cycles in a second");
        let peak = output[100..].iter().fold(0f32, |peak, s| peak.max(s.abs()));
        assert!((0.97..=1.03).contains(&peak), "peak {peak}");
    }

    #[test]
    fn a_higher_rate_reads_the_input_more_slowly() {
        let input = vec![0.5; 100];
        let output = run(96_000, &input, 100);
        assert!(output[10..].iter().all(|s| (s - 0.5).abs() < 1e-3));
    }

    #[test]
    fn spreading_fills_each_channel() {
        let mut frame = [0.0; 2];
        spread(&mut frame, 0.25);
        assert_eq!(frame, [0.25, 0.25]);
    }
}
