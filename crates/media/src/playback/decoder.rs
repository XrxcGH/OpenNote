//! The decoder interface. Like the encoder, the real one sits behind the `opus` feature, since
//! libopus builds from source with CMake.

use std::sync::Arc;

use crate::audio::Result;

/// Turns packets back into 20 ms frames of mono audio at 48 kHz.
pub trait FrameDecoder: Send {
    /// Decodes one packet into `out`, which holds at least [`crate::audio::FRAME_SAMPLES`] samples.
    /// It returns how many samples it wrote.
    fn decode(&mut self, packet: &[u8], out: &mut [f32]) -> Result<usize>;

    /// Forgets the state left by earlier packets. Decoding then needs a few packets of lead-in, which
    /// the reader discards, before its output is right.
    fn reset(&mut self);
}

/// Makes a fresh decoder for each track.
pub type DecoderFactory = Arc<dyn Fn() -> Result<Box<dyn FrameDecoder>> + Send + Sync>;

/// The Opus decoder, or an error that says this build left it out.
pub fn opus_decoder_factory() -> DecoderFactory {
    #[cfg(feature = "opus")]
    {
        Arc::new(|| Ok(Box::new(super::opus_decoder::OpusDecoder::new()?) as Box<dyn FrameDecoder>))
    }
    #[cfg(not(feature = "opus"))]
    {
        Arc::new(|| {
            Err(crate::audio::AudioError::Encoder(
                "This build left out the opus feature. Build with --features opus, which needs CMake.".into(),
            ))
        })
    }
}

#[cfg(all(test, not(feature = "opus")))]
mod tests {
    use super::*;

    #[test]
    fn without_the_feature_the_factory_explains_itself() {
        let error = opus_decoder_factory()().err().expect("no decoder without the feature");
        assert!(error.to_string().contains("--features opus"));
    }
}
