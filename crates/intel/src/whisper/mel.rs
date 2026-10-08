//! The log-mel spectrogram the speech model reads: 25 ms Hann windows every 10 ms, a power spectrum, the model's
//! own mel filters, then a log scale clamped to 8 below the loudest value and shifted into roughly -1 to 1.

use std::f32::consts::PI;
use std::thread;

use super::math::threads;

/// Samples in one analysis window, at 16 kHz.
pub(crate) const N_FFT: usize = 400;
/// Samples between windows.
pub(crate) const HOP: usize = 160;
/// Frames in one 30-second window of the model.
pub(crate) const N_FRAMES: usize = 3000;
/// Samples in 30 seconds.
pub(crate) const N_SAMPLES: usize = N_FRAMES * HOP;

type Complex = (f32, f32);

/// A discrete Fourier transform for odd lengths, where the halving below can't go on.
fn dft(input: &[Complex]) -> Vec<Complex> {
    let n = input.len();
    (0..n)
        .map(|k| {
            input.iter().enumerate().fold((0.0, 0.0), |(re, im), (t, &(xr, xi))| {
                let angle = -2.0 * PI * (k * t % n) as f32 / n as f32;
                let (s, c) = angle.sin_cos();
                (re + xr * c - xi * s, im + xr * s + xi * c)
            })
        })
        .collect()
}

/// A fast Fourier transform that halves even lengths and finishes odd ones with the plain transform.
fn fft(input: &[Complex]) -> Vec<Complex> {
    let n = input.len();
    if n <= 1 || n % 2 == 1 {
        return dft(input);
    }
    let even: Vec<Complex> = input.iter().step_by(2).copied().collect();
    let odd: Vec<Complex> = input.iter().skip(1).step_by(2).copied().collect();
    let (e, o) = (fft(&even), fft(&odd));
    let mut out = vec![(0.0, 0.0); n];
    for k in 0..n / 2 {
        let angle = -2.0 * PI * k as f32 / n as f32;
        let (s, c) = angle.sin_cos();
        let (or, oi) = o[k];
        let t = (or * c - oi * s, or * s + oi * c);
        out[k] = (e[k].0 + t.0, e[k].1 + t.1);
        out[k + n / 2] = (e[k].0 - t.0, e[k].1 - t.1);
    }
    out
}

/// The spectrogram of up to 30 seconds of 16 kHz audio, as `n_mels` rows of [`N_FRAMES`] values. Shorter audio is
/// padded with silence, as the model was trained.
pub(crate) fn log_mel(samples: &[f32], filters: &[f32], n_mels: usize, n_bins: usize) -> Vec<f32> {
    let used = &samples[..samples.len().min(N_SAMPLES)];
    // Reflect the first half window at the start, and pad the end with silence.
    let pad = N_FFT / 2;
    let mut padded = vec![0.0_f32; N_SAMPLES + N_FFT];
    padded[pad..pad + used.len()].copy_from_slice(used);
    for i in 0..pad.min(used.len().saturating_sub(1)) {
        padded[pad - 1 - i] = used[i + 1];
    }
    let hann: Vec<f32> = (0..N_FFT)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / N_FFT as f32).cos()))
        .collect();
    let bins = (N_FFT / 2 + 1).min(n_bins);
    let mut mel = vec![0.0_f32; n_mels * N_FRAMES];
    // Frames are independent, so the threads take a run of them each and write their own columns afterwards.
    let workers = threads();
    let per = N_FRAMES.div_ceil(workers);
    let columns: Vec<Vec<f32>> = thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|w| {
                let (padded, hann, filters) = (&padded, &hann, filters);
                scope.spawn(move || {
                    let first = w * per;
                    let last = ((w + 1) * per).min(N_FRAMES);
                    let mut out = Vec::with_capacity((last.saturating_sub(first)) * n_mels);
                    let mut frame = vec![(0.0_f32, 0.0_f32); N_FFT];
                    let mut power = vec![0.0_f32; bins];
                    for f in first..last {
                        let start = f * HOP;
                        for (i, slot) in frame.iter_mut().enumerate() {
                            *slot = (padded[start + i] * hann[i], 0.0);
                        }
                        let spectrum = fft(&frame);
                        for (k, p) in power.iter_mut().enumerate() {
                            let (re, im) = spectrum[k];
                            *p = re * re + im * im;
                        }
                        for m in 0..n_mels {
                            let row = &filters[m * n_bins..m * n_bins + bins];
                            let sum: f32 = row.iter().zip(&power).map(|(a, b)| a * b).sum();
                            out.push(sum.max(1e-10).log10());
                        }
                    }
                    out
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
    });
    for (w, column) in columns.iter().enumerate() {
        for (i, chunk) in column.chunks_exact(n_mels).enumerate() {
            let f = w * per + i;
            for (m, value) in chunk.iter().enumerate() {
                mel[m * N_FRAMES + f] = *value;
            }
        }
    }
    let max = mel.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    for v in &mut mel {
        *v = (v.max(max - 8.0) + 4.0) / 4.0;
    }
    mel
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fast_transform_matches_the_plain_one_for_the_window_length() {
        let input: Vec<Complex> = (0..N_FFT).map(|i| ((i as f32 * 0.37).sin(), 0.0)).collect();
        let fast = fft(&input);
        let plain = dft(&input);
        for (a, b) in fast.iter().zip(&plain) {
            assert!((a.0 - b.0).abs() < 1e-2 && (a.1 - b.1).abs() < 1e-2, "{a:?} vs {b:?}");
        }
    }

    #[test]
    fn a_tone_lights_the_band_that_holds_its_frequency() {
        // One filter per frequency bin, so the band number is the bin number: 1 kHz is bin 25 at 40 Hz a bin.
        let bins = N_FFT / 2 + 1;
        let mut filters = vec![0.0; bins * bins];
        for b in 0..bins {
            filters[b * bins + b] = 1.0;
        }
        let tone: Vec<f32> = (0..16_000)
            .map(|i| (2.0 * PI * 1000.0 * i as f32 / 16_000.0).sin())
            .collect();
        let mel = log_mel(&tone, &filters, bins, bins);
        let frame = 50;
        let loudest = (0..bins)
            .max_by(|&a, &b| mel[a * N_FRAMES + frame].total_cmp(&mel[b * N_FRAMES + frame]))
            .unwrap();
        assert_eq!(loudest, 25);
        // After the tone ends, the frames sit at the floor.
        assert!(mel[25 * N_FRAMES + 2000] < mel[25 * N_FRAMES + frame] - 1.0);
    }
}
