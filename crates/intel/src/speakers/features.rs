//! The sound of each 25 ms of a recording, every 10 ms: loudness, 16 mel cepstral coefficients, and the pitch.

use std::f32::consts::PI;
use std::sync::OnceLock;

/// Cepstral coefficients kept for a frame.
pub const MFCC: usize = 16;
/// Frames in a second of audio.
pub const FRAMES_PER_SECOND: usize = 100;
/// The most frames kept, three hours. A longer recording gets no labels, and the memory stays bounded.
pub const MAX_FRAMES: usize = 3 * 3600 * FRAMES_PER_SECOND;

const WINDOW: usize = 400;
const HOP: usize = 160;
const FFT: usize = 512;
const MELS: usize = 24;
const RATE: f32 = 16_000.0;
const MIN_LAG: usize = 40;
const MAX_LAG: usize = 266;

/// What one frame sounds like.
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    /// The natural log of the mean square of the samples.
    pub energy: f32,
    /// The cepstral coefficients c1 to c16.
    pub mfcc: [f32; MFCC],
    /// The natural log of the pitch in hertz, or zero when the frame is unvoiced or its pitch was not measured.
    pub log_f0: f32,
}

struct Bank {
    window: Vec<f32>,
    twiddle: Vec<(f32, f32)>,
    /// For each mel filter: the first bin and its weights.
    filters: Vec<(usize, Vec<f32>)>,
    dct: Vec<f32>,
}

fn mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn inverse_mel(m: f32) -> f32 {
    700.0 * (10f32.powf(m / 2595.0) - 1.0)
}

fn bank() -> &'static Bank {
    static BANK: OnceLock<Bank> = OnceLock::new();
    BANK.get_or_init(|| {
        let window = (0..WINDOW)
            .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / (WINDOW - 1) as f32).cos())
            .collect();
        let twiddle = (0..FFT / 2)
            .map(|k| {
                let angle = -2.0 * PI * k as f32 / FFT as f32;
                (angle.cos(), angle.sin())
            })
            .collect();
        let (low, high) = (mel(80.0), mel(7600.0));
        let edges: Vec<f32> = (0..MELS + 2)
            .map(|i| inverse_mel(low + (high - low) * i as f32 / (MELS + 1) as f32) * FFT as f32 / RATE)
            .collect();
        let filters = (0..MELS)
            .map(|m| {
                let (left, centre, right) = (edges[m], edges[m + 1], edges[m + 2]);
                let first = left.ceil() as usize;
                let last = (right.floor() as usize).min(FFT / 2);
                let weights = (first..=last)
                    .map(|bin| {
                        let b = bin as f32;
                        let weight = if b <= centre {
                            (b - left) / (centre - left)
                        } else {
                            (right - b) / (right - centre)
                        };
                        weight.max(0.0)
                    })
                    .collect();
                (first, weights)
            })
            .collect();
        let dct = (1..=MFCC)
            .flat_map(|k| (0..MELS).map(move |j| (PI * k as f32 * (j as f32 + 0.5) / MELS as f32).cos()))
            .collect();
        Bank {
            window,
            twiddle,
            filters,
            dct,
        }
    })
}

/// An in-place radix-2 transform of `FFT` points.
fn fft(re: &mut [f32; FFT], im: &mut [f32; FFT], twiddle: &[(f32, f32)]) {
    let mut j = 0;
    for i in 1..FFT {
        let mut bit = FFT >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= FFT {
        let step = FFT / len;
        for start in (0..FFT).step_by(len) {
            for k in 0..len / 2 {
                let (wr, wi) = twiddle[k * step];
                let (a, b) = (start + k, start + k + len / 2);
                let (tr, ti) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

/// The pitch of a window in hertz, or none when it is not clearly periodic.
fn pitch(samples: &[f32]) -> Option<f32> {
    let mean = samples.iter().sum::<f32>() / samples.len() as f32;
    let x: Vec<f32> = samples.iter().map(|s| s - mean).collect();
    let r0: f32 = x.iter().map(|s| s * s).sum();
    if r0 < 1e-6 {
        return None;
    }
    let r: Vec<f32> = (MIN_LAG..=MAX_LAG)
        .map(|lag| {
            x[..x.len() - lag]
                .iter()
                .zip(&x[lag..])
                .map(|(a, b)| a * b)
                .sum::<f32>()
                / r0
        })
        .collect();
    let best = r.iter().copied().fold(f32::MIN, f32::max);
    if best < 0.5 {
        return None;
    }
    // The first lag that is nearly as good as the best one, so a pitch is not taken for its octave below.
    let at = (1..r.len() - 1).find(|&i| r[i] >= 0.9 * best && r[i] >= r[i - 1] && r[i] >= r[i + 1])?;
    Some(RATE / (MIN_LAG + at) as f32)
}

fn frame_of(samples: &[f32], measure_pitch: bool) -> Frame {
    let bank = bank();
    let energy = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32 + 1e-10).ln();
    let mut re = [0.0f32; FFT];
    let mut im = [0.0f32; FFT];
    let mut previous = 0.0;
    for (i, &s) in samples.iter().enumerate() {
        re[i] = (s - 0.97 * previous) * bank.window[i];
        previous = s;
    }
    fft(&mut re, &mut im, &bank.twiddle);
    let logs: Vec<f32> = bank
        .filters
        .iter()
        .map(|(first, weights)| {
            let sum: f32 = weights
                .iter()
                .enumerate()
                .map(|(i, w)| w * (re[first + i] * re[first + i] + im[first + i] * im[first + i]))
                .sum();
            (sum + 1e-10).ln()
        })
        .collect();
    let mut mfcc = [0.0; MFCC];
    for (k, out) in mfcc.iter_mut().enumerate() {
        *out = logs
            .iter()
            .zip(&bank.dct[k * MELS..(k + 1) * MELS])
            .map(|(a, b)| a * b)
            .sum();
    }
    let log_f0 = if measure_pitch {
        pitch(samples).map_or(0.0, f32::ln)
    } else {
        0.0
    };
    Frame { energy, mfcc, log_f0 }
}

/// Turns audio into frames as it arrives.
#[derive(Default)]
pub struct FrameStream {
    carry: Vec<f32>,
    frames: Vec<Frame>,
    overflowed: bool,
}

impl FrameStream {
    /// An empty stream.
    pub fn new() -> FrameStream {
        FrameStream::default()
    }

    /// Adds 16 kHz samples.
    pub fn push(&mut self, samples: &[f32]) {
        if self.overflowed {
            return;
        }
        self.carry.extend_from_slice(samples);
        let mut at = 0;
        while at + WINDOW <= self.carry.len() {
            if self.frames.len() >= MAX_FRAMES {
                self.overflowed = true;
                self.frames = Vec::new();
                self.carry = Vec::new();
                return;
            }
            let measure = self.frames.len().is_multiple_of(2);
            self.frames.push(frame_of(&self.carry[at..at + WINDOW], measure));
            at += HOP;
        }
        self.carry.drain(..at);
    }

    /// Starts again, for audio that is read a second time from the start.
    pub fn reset(&mut self) {
        *self = FrameStream::default();
    }

    /// The frames so far. Empty when the recording was too long to keep.
    pub fn frames(&self) -> &[Frame] {
        &self.frames
    }
}
