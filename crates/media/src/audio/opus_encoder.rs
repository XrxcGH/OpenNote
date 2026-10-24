//! The libopus encoder: 48 kHz mono, 32 kbps, 20 ms frames, in voice mode (ADR 0007).

use super::encoder::FrameEncoder;
use super::{AudioError, Result, FRAME_SAMPLES, TRACK_RATE};

/// The longest packet Opus can produce.
const MAX_PACKET: usize = 1_275;

pub struct OpusEncoder {
    encoder: opus::Encoder,
    pre_skip: u16,
}

fn failed(error: opus::Error) -> AudioError {
    AudioError::Encoder(error.to_string())
}

impl OpusEncoder {
    /// An encoder at `bitrate` bits per second.
    pub fn with_bitrate(bitrate: i32) -> Result<Self> {
        let mut encoder =
            opus::Encoder::new(TRACK_RATE, opus::Channels::Mono, opus::Application::Voip).map_err(failed)?;
        encoder.set_bitrate(opus::Bitrate::Bits(bitrate)).map_err(failed)?;
        let pre_skip = encoder.get_lookahead().map_err(failed)?.clamp(0, i32::from(u16::MAX)) as u16;
        Ok(OpusEncoder { encoder, pre_skip })
    }
}

impl FrameEncoder for OpusEncoder {
    fn pre_skip(&self) -> u16 {
        self.pre_skip
    }

    fn encode(&mut self, pcm: &[f32], out: &mut Vec<u8>) -> Result<()> {
        debug_assert_eq!(pcm.len(), FRAME_SAMPLES);
        out.resize(MAX_PACKET, 0);
        let size = self.encoder.encode_float(pcm, out).map_err(failed)?;
        out.truncate(size);
        Ok(())
    }

    fn delays_output(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::super::encoder::BITRATE;
    use super::*;

    #[test]
    fn a_sine_encodes_near_the_target_bitrate() {
        let mut encoder = OpusEncoder::with_bitrate(BITRATE).unwrap();
        assert!(encoder.pre_skip() > 0);
        let (mut packet, mut bytes) = (Vec::new(), 0);
        for frame in 0..50 {
            let pcm: Vec<f32> = (0..FRAME_SAMPLES)
                .map(|index| {
                    let t = (frame * FRAME_SAMPLES + index) as f32 / TRACK_RATE as f32;
                    0.1 * (std::f32::consts::TAU * 440.0 * t).sin()
                })
                .collect();
            encoder.encode(&pcm, &mut packet).unwrap();
            bytes += packet.len();
        }
        let kbps = bytes as f64 * 8.0 / 1_000.0;
        assert!(kbps > 4.0 && kbps < 40.0, "{kbps} kbps");
    }
}
