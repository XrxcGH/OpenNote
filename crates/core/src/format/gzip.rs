//! Gzip for history snapshots and journal base snapshots (spec 13.1 and 20.5).
//!
//! Writing sets the time field to zero and leaves out the file name, so the same bytes always give the same file.

use std::io::{self, Read, Write};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::{Compression, GzBuilder};

use crate::error::{FormatError, FormatErrorKind};

/// A 10-byte header, the smallest deflate block, and an 8-byte trailer.
const MIN_GZIP_BYTES: usize = 20;

/// Compresses `bytes` into one gzip member with a zero time field and no file name.
pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    let encoder: GzEncoder<Vec<u8>> = GzBuilder::new().mtime(0).write(Vec::new(), Compression::default());
    // Writing into a `Vec` can't fail, so an error here is impossible. An empty result would fail to read back.
    compress(encoder, bytes).unwrap_or_default()
}

fn compress(mut encoder: GzEncoder<Vec<u8>>, bytes: &[u8]) -> io::Result<Vec<u8>> {
    encoder.write_all(bytes)?;
    encoder.finish()
}

/// Decompresses one gzip member, failing once the output would pass `max_bytes`.
///
/// Bytes after the first member are ignored. A stream that ends early, fails its checksum, or is not gzip at all
/// is an error, never a panic.
pub fn gunzip(bytes: &[u8], max_bytes: u64) -> Result<Vec<u8>, FormatError> {
    if bytes.len() < MIN_GZIP_BYTES {
        return Err(FormatError::new(
            FormatErrorKind::Truncated,
            "gzip: shorter than the smallest stream",
        ));
    }
    let mut out = Vec::new();
    let mut limited = GzDecoder::new(bytes).take(max_bytes.saturating_add(1));
    limited.read_to_end(&mut out).map_err(|err| {
        let kind = match err.kind() {
            io::ErrorKind::UnexpectedEof => FormatErrorKind::Truncated,
            _ => FormatErrorKind::Encoding,
        };
        FormatError::new(kind, format!("gzip: {err}"))
    })?;
    if u64::try_from(out.len()).unwrap_or(u64::MAX) > max_bytes {
        return Err(FormatError::new(
            FormatErrorKind::Limit,
            format!("gzip output passes {max_bytes} bytes"),
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

    use proptest::prelude::*;

    use super::*;

    #[test]
    fn writes_a_fixed_header_without_time_or_name() {
        let packed = gzip(b"{\"formatVersion\": 1}\n");
        assert_eq!(&packed[..4], &[0x1f, 0x8b, 8, 0], "magic, deflate, no flags");
        assert_eq!(&packed[4..8], &[0, 0, 0, 0], "time field");
        assert_eq!(gzip(b"{\"formatVersion\": 1}\n"), packed, "deterministic");
    }

    #[test]
    fn round_trips() {
        let text = "page ".repeat(10_000);
        let packed = gzip(text.as_bytes());
        assert!(packed.len() < text.len() / 10);
        assert_eq!(gunzip(&packed, 1 << 20).unwrap(), text.as_bytes());
        assert_eq!(gunzip(&gzip(b""), 0).unwrap(), b"");
    }

    #[test]
    fn caps_the_output() {
        let packed = gzip(&[0u8; 100_000]);
        assert_eq!(gunzip(&packed, 100_000).unwrap().len(), 100_000);
        let err = gunzip(&packed, 99_999).unwrap_err();
        assert_eq!(err.kind, FormatErrorKind::Limit);
    }

    #[test]
    fn reports_damage() {
        let packed = gzip(b"a page that will be cut short, repeated, repeated, repeated");
        let cut = gunzip(&packed[..packed.len() / 2], 1 << 20).unwrap_err();
        assert_eq!(cut.kind, FormatErrorKind::Truncated);
        let mut flipped = packed.clone();
        let at = flipped.len() - 6;
        flipped[at] ^= 0xff;
        assert!(gunzip(&flipped, 1 << 20).is_err());
        assert!(gunzip(b"not gzip at all", 1 << 20).is_err());
        assert!(gunzip(b"", 1 << 20).is_err());
    }

    proptest! {
        #[test]
        fn never_panics_on_garbage(bytes in proptest::collection::vec(any::<u8>(), 0..512)) {
            let _ = gunzip(&bytes, 4_096);
        }

        #[test]
        fn round_trips_any_bytes(bytes in proptest::collection::vec(any::<u8>(), 0..4_096)) {
            prop_assert_eq!(gunzip(&gzip(&bytes), 4_096).unwrap(), bytes);
        }
    }
}
