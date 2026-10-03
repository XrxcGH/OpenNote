//! The libopus decoder: 48 kHz mono, 20 ms frames.

use super::decoder::FrameDecoder;
use crate::audio::{AudioError, Result, FRAME_SAMPLES, TRACK_RATE};

fn failed(error: opus::Error) -> AudioError {
    AudioError::Encoder(error.to_string())
}

pub struct OpusDecoder {
    decoder: opus::Decoder,
}

impl OpusDecoder {
    pub fn new() -> Result<Self> {
        let decoder = opus::Decoder::new(TRACK_RATE, opus::Channels::Mono).map_err(failed)?;
        Ok(OpusDecoder { decoder })
    }
}

impl FrameDecoder for OpusDecoder {
    fn decode(&mut self, packet: &[u8], out: &mut [f32]) -> Result<usize> {
        debug_assert!(out.len() >= FRAME_SAMPLES);
        self.decoder.decode_float(packet, out, false).map_err(failed)
    }

    fn reset(&mut self) {
        // Resetting only fails for an invalid decoder, and then the next decode reports it.
        let _ = self.decoder.reset_state();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::encoder::FrameEncoder;
    use crate::audio::opus_encoder::OpusEncoder;

    #[test]
    fn a_tone_survives_encoding_and_decoding() {
        let mut encoder = OpusEncoder::with_bitrate(crate::audio::encoder::BITRATE).unwrap();
        let mut decoder = OpusDecoder::new().unwrap();
        let (mut packet, mut frame, mut energy) = (Vec::new(), vec![0f32; FRAME_SAMPLES], 0f64);
        for index in 0..30 {
            let pcm: Vec<f32> = (0..FRAME_SAMPLES)
                .map(|i| {
                    let t = (index * FRAME_SAMPLES + i) as f32 / TRACK_RATE as f32;
                    0.1 * (std::f32::consts::TAU * 440.0 * t).sin()
                })
                .collect();
            encoder.encode(&pcm, &mut packet).unwrap();
            assert_eq!(decoder.decode(&packet, &mut frame).unwrap(), FRAME_SAMPLES);
            if index >= 10 {
                energy += frame.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>();
            }
        }
        let rms = (energy / (20 * FRAME_SAMPLES) as f64).sqrt();
        assert!((rms - 0.0707).abs() < 0.01, "RMS {rms}");
        decoder.reset();
    }
}
