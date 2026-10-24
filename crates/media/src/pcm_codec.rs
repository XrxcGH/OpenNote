//! A stand-in codec for tests that need to hear what they recorded without building libopus.
//!
//! Each 20 ms frame becomes a packet of 16-bit samples, so the round trip is exact to 16 bits.
//! The encoder holds its output back by the same 312 samples that libopus does at 48 kHz. A file
//! then has the same pre-skip, granule positions, and end padding as a real Opus file. A reader that
//! gets the offsets wrong fails with this codec just as it would with Opus.

use std::collections::VecDeque;
use std::sync::Arc;

use crate::audio::encoder::{EncoderFactory, FrameEncoder};
use crate::audio::{AudioError, Result, FRAME_SAMPLES};
use crate::playback::decoder::{DecoderFactory, FrameDecoder};

/// The samples the encoder holds back, the lookahead of libopus for 48 kHz voice.
pub const PCM_PRE_SKIP: u16 = 312;

/// Encodes frames as 16-bit samples, delayed by [`PCM_PRE_SKIP`].
#[derive(Debug)]
pub struct PcmEncoder {
    delay: VecDeque<f32>,
}

impl Default for PcmEncoder {
    fn default() -> Self {
        PcmEncoder {
            delay: std::iter::repeat_n(0.0, usize::from(PCM_PRE_SKIP)).collect(),
        }
    }
}

impl FrameEncoder for PcmEncoder {
    fn pre_skip(&self) -> u16 {
        PCM_PRE_SKIP
    }

    fn encode(&mut self, pcm: &[f32], out: &mut Vec<u8>) -> Result<()> {
        debug_assert_eq!(pcm.len(), FRAME_SAMPLES);
        self.delay.extend(pcm.iter().copied());
        out.clear();
        for _ in 0..FRAME_SAMPLES {
            let sample = self.delay.pop_front().unwrap_or(0.0);
            let value = (sample.clamp(-1.0, 1.0) * 32_767.0).round() as i16;
            out.extend_from_slice(&value.to_le_bytes());
        }
        Ok(())
    }

    fn delays_output(&self) -> bool {
        true
    }
}

/// Decodes the packets of [`PcmEncoder`].
#[derive(Debug, Default)]
pub struct PcmDecoder;

impl FrameDecoder for PcmDecoder {
    fn decode(&mut self, packet: &[u8], out: &mut [f32]) -> Result<usize> {
        if packet.len() != FRAME_SAMPLES * 2 {
            return Err(AudioError::Corrupt(format!(
                "A packet of {} bytes is not a frame.",
                packet.len()
            )));
        }
        for (slot, bytes) in out.iter_mut().zip(packet.as_chunks::<2>().0) {
            *slot = f32::from(i16::from_le_bytes(*bytes)) / 32_767.0;
        }
        Ok(FRAME_SAMPLES)
    }

    fn reset(&mut self) {}
}

/// Makes stand-in encoders.
pub fn pcm_encoder_factory() -> EncoderFactory {
    Arc::new(|| Ok(Box::new(PcmEncoder::default()) as Box<dyn FrameEncoder>))
}

/// Makes stand-in decoders.
pub fn pcm_decoder_factory() -> DecoderFactory {
    Arc::new(|| Ok(Box::new(PcmDecoder) as Box<dyn FrameDecoder>))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_come_back_after_the_pre_skip() {
        let mut encoder = PcmEncoder::default();
        let mut decoder = PcmDecoder;
        let mut packet = Vec::new();
        let mut decoded = Vec::new();
        let mut frame = vec![0f32; FRAME_SAMPLES];
        let input: Vec<f32> = (0..FRAME_SAMPLES * 3).map(|i| (i % 100) as f32 / 200.0).collect();
        for chunk in input.chunks(FRAME_SAMPLES) {
            encoder.encode(chunk, &mut packet).unwrap();
            decoder.decode(&packet, &mut frame).unwrap();
            decoded.extend_from_slice(&frame);
        }
        let skip = usize::from(PCM_PRE_SKIP);
        assert!(decoded[..skip].iter().all(|s| *s == 0.0));
        for (index, sample) in input.iter().enumerate().take(FRAME_SAMPLES * 3 - skip) {
            assert!((decoded[index + skip] - sample).abs() < 1e-4, "sample {index}");
        }
    }

    #[test]
    fn a_packet_of_the_wrong_size_is_corrupt() {
        let mut frame = vec![0f32; FRAME_SAMPLES];
        assert!(PcmDecoder.decode(&[0; 10], &mut frame).is_err());
    }
}
