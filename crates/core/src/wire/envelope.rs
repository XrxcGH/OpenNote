//! The page envelope `page_open` answers with (plan 11.3). Owned by WP5.

/// The envelope's magic bytes.
pub const MAGIC: &[u8; 4] = b"ONPE";

/// The envelope version.
pub const VERSION: u16 = 1;

/// A page envelope: session JSON, the page's `page.json` bytes, and live strokes, in one buffer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Envelope {
    /// The encoded envelope.
    pub bytes: Vec<u8>,
    /// More ink follows on the page's channel.
    pub more_ink: bool,
}
