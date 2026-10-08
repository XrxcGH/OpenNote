//! The encoder interface, and the Opus headers that start every recording file.
//!
//! libopus builds from source with CMake, so the real encoder sits behind the `opus` feature. Tests
//! that don't need real Opus use the stand-in encoder from [`super::synthetic`].

use std::sync::Arc;

use super::{Result, TRACK_RATE};

/// The encoder's bitrate in bits per second, the value ADR 0007 chose for voice.
pub const BITRATE: i32 = 32_000;

/// Turns 20 ms frames of mono audio into packets.
pub trait FrameEncoder: Send {
    /// Samples at the start of the stream that a decoder skips. They go in the file header.
    fn pre_skip(&self) -> u16;

    /// Encodes exactly [`super::FRAME_SAMPLES`] samples into `out`, replacing its contents.
    fn encode(&mut self, pcm: &[f32], out: &mut Vec<u8>) -> Result<()>;

    /// Whether the last `pre_skip` samples of input come out only with the next frame. The writer then
    /// ends a stream with one more frame of silence, so the file holds every recorded sample.
    fn delays_output(&self) -> bool {
        false
    }
}

/// Makes a fresh encoder for each track.
pub type EncoderFactory = Arc<dyn Fn() -> Result<Box<dyn FrameEncoder>> + Send + Sync>;

/// The Opus encoder, or an error that says this build left it out.
pub fn opus_factory() -> EncoderFactory {
    opus_factory_at(BITRATE)
}

/// The Opus encoder at another bitrate, in bits per second, such as the smaller one that compressing uses.
pub fn opus_factory_at(bitrate: i32) -> EncoderFactory {
    #[cfg(feature = "opus")]
    {
        Arc::new(
            move || Ok(Box::new(super::opus_encoder::OpusEncoder::with_bitrate(bitrate)?) as Box<dyn FrameEncoder>),
        )
    }
    #[cfg(not(feature = "opus"))]
    {
        let _ = bitrate;
        Arc::new(|| {
            Err(super::AudioError::Encoder(
                "This build left out the opus feature. Build with --features opus, which needs CMake.".into(),
            ))
        })
    }
}

/// The identification header, the first packet of an Opus stream (RFC 7845, section 5.1).
pub fn opus_head(pre_skip: u16) -> Vec<u8> {
    let mut head = Vec::with_capacity(19);
    head.extend_from_slice(b"OpusHead");
    head.push(1); // version
    head.push(1); // one channel
    head.extend_from_slice(&pre_skip.to_le_bytes());
    head.extend_from_slice(&TRACK_RATE.to_le_bytes());
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // channel mapping family 0
    head
}

/// The comment header, the second packet of an Opus stream (RFC 7845, section 5.2).
pub fn opus_tags() -> Vec<u8> {
    let vendor = b"OpenNote";
    let mut tags = Vec::new();
    tags.extend_from_slice(b"OpusTags");
    tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    tags.extend_from_slice(vendor);
    tags.extend_from_slice(&0u32.to_le_bytes()); // no comments
    tags
}

/// The pre-skip stored in an identification header, or `None` if the packet is not one.
pub fn parse_pre_skip(head: &[u8]) -> Option<u16> {
    (head.len() >= 19 && head.starts_with(b"OpusHead")).then(|| u16::from_le_bytes([head[10], head[11]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_identification_header_follows_the_spec() {
        let head = opus_head(312);
        assert_eq!(head.len(), 19);
        assert_eq!(&head[..8], b"OpusHead");
        assert_eq!(parse_pre_skip(&head), Some(312));
        assert_eq!(u32::from_le_bytes(head[12..16].try_into().unwrap()), 48_000);
        assert_eq!(parse_pre_skip(b"OpusTags......................"), None);
    }

    #[test]
    fn the_comment_header_names_the_vendor() {
        let tags = opus_tags();
        assert_eq!(&tags[..8], b"OpusTags");
        assert_eq!(u32::from_le_bytes(tags[8..12].try_into().unwrap()), 8);
        assert_eq!(&tags[12..20], b"OpenNote");
    }

    #[cfg(not(feature = "opus"))]
    #[test]
    fn without_the_feature_the_factory_explains_itself() {
        let error = opus_factory()().err().expect("no encoder without the feature");
        assert!(error.to_string().contains("--features opus"));
    }
}
