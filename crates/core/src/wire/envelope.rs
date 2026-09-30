//! The page envelope `page_open` answers with (plan 11.3). Owned by WP5.
//!
//! One buffer holds everything a page needs to open in one round trip. A 24-byte header comes first: the
//! magic `ONPE`, the version `1` in 2 bytes, and 2 bytes of flags. Flag bit 0 marks a read-only page, and
//! bit 1 says more ink follows on the page's channel. Four 4-byte counts follow: the lengths of the session
//! JSON, the page JSON, and the ink, and the number of strokes in this envelope.
//!
//! Then come the session JSON and the page's `page.json` bytes, each padded with zeros to a multiple of 8.
//! The live strokes follow in the segment record format, strokes that meet the viewport first. Numbers are
//! little-endian, as in every binary format of the spec.

use serde::Serialize;

use super::WireError;
use crate::id::{PageId, RevisionId};
use crate::model::ReadOnlyReason;

/// The envelope's magic bytes.
pub const MAGIC: &[u8; 4] = b"ONPE";

/// The envelope version.
pub const VERSION: u16 = 1;

/// The flag of a read-only page.
pub const FLAG_READ_ONLY: u16 = 1;

/// The flag of an envelope whose remaining ink follows on the page's channel.
pub const FLAG_MORE_INK: u16 = 2;

/// The fixed header's length.
pub const HEADER_LEN: usize = 24;

/// A page envelope: session JSON, the page's `page.json` bytes, and live strokes, in one buffer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Envelope {
    /// The encoded envelope.
    pub bytes: Vec<u8>,
    /// More ink follows on the page's channel.
    pub more_ink: bool,
}

/// The session part of an envelope: what the interface needs besides the page itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// The page.
    pub page: PageId,
    /// The revision the page is based on.
    pub revision: RevisionId,
    /// The last client sequence number the core accepted from this client. The next edit sends one more.
    pub client_seq: u64,
    /// Why the page is read-only, if it is.
    pub read_only: Option<ReadOnlyReason>,
    /// Whether this client can undo.
    pub can_undo: bool,
    /// Whether this client can redo.
    pub can_redo: bool,
    /// Whether every change is saved.
    pub saved: bool,
    /// Open conflicts, by the other version's revision (spec 14.1).
    pub conflicts: Vec<RevisionId>,
    /// Strokes that are damaged and can't be shown (spec 9.6).
    pub damaged_strokes: u32,
    /// Segments and assets that haven't arrived (spec 14.5).
    pub missing_files: u32,
    /// Live strokes on the page, in this envelope and after it.
    pub strokes_total: u32,
}

/// What goes into an envelope.
pub struct EnvelopeParts<'a> {
    /// The session JSON.
    pub session: &'a [u8],
    /// The page's `page.json` bytes.
    pub page_json: &'a [u8],
    /// Stroke records.
    pub ink: &'a [u8],
    /// How many strokes `ink` holds.
    pub strokes: u32,
    /// Whether the page is read-only.
    pub read_only: bool,
    /// Whether more ink follows on the channel.
    pub more_ink: bool,
}

/// Encodes an envelope. Fails when a part is larger than 4 GiB.
pub fn encode(parts: &EnvelopeParts<'_>) -> Result<Envelope, WireError> {
    let session_len = len32(parts.session)?;
    let page_len = len32(parts.page_json)?;
    let ink_len = len32(parts.ink)?;
    let mut flags = 0u16;
    if parts.read_only {
        flags |= FLAG_READ_ONLY;
    }
    if parts.more_ink {
        flags |= FLAG_MORE_INK;
    }
    let total = HEADER_LEN
        .saturating_add(padded(parts.session.len()))
        .saturating_add(padded(parts.page_json.len()))
        .saturating_add(parts.ink.len());
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&VERSION.to_le_bytes());
    bytes.extend_from_slice(&flags.to_le_bytes());
    for value in [session_len, page_len, ink_len, parts.strokes] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    push_padded(&mut bytes, parts.session);
    push_padded(&mut bytes, parts.page_json);
    bytes.extend_from_slice(parts.ink);
    Ok(Envelope {
        bytes,
        more_ink: parts.more_ink,
    })
}

/// An envelope read back, borrowing from its bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DecodedEnvelope<'a> {
    /// The flags.
    pub flags: u16,
    /// The session JSON.
    pub session: &'a [u8],
    /// The page's `page.json` bytes.
    pub page_json: &'a [u8],
    /// The stroke records.
    pub ink: &'a [u8],
    /// How many strokes `ink` holds.
    pub strokes: u32,
}

/// Reads an envelope, as the interface does. Checks the magic, the version, and every length.
pub fn decode(bytes: &[u8]) -> Result<DecodedEnvelope<'_>, WireError> {
    let header = bytes.get(..HEADER_LEN).ok_or(WireError::Truncated)?;
    if header.get(..4) != Some(MAGIC.as_slice()) {
        return Err(WireError::Magic);
    }
    let version = u16_at(header, 4)?;
    if version != VERSION {
        return Err(WireError::Version(version));
    }
    let flags = u16_at(header, 6)?;
    let (session_len, page_len) = (usize_at(header, 8)?, usize_at(header, 12)?);
    let (ink_len, strokes) = (usize_at(header, 16)?, u32_at(header, 20)?);
    let mut rest = bytes.get(HEADER_LEN..).ok_or(WireError::Truncated)?;
    let session = take_padded(&mut rest, session_len)?;
    let page_json = take_padded(&mut rest, page_len)?;
    let ink = rest.get(..ink_len).ok_or(WireError::Truncated)?;
    if rest.len() != ink_len {
        return Err(WireError::TrailingBytes);
    }
    Ok(DecodedEnvelope {
        flags,
        session,
        page_json,
        ink,
        strokes,
    })
}

fn len32(part: &[u8]) -> Result<u32, WireError> {
    u32::try_from(part.len()).map_err(|_| WireError::TooLarge)
}

/// A length rounded up to a multiple of 8.
fn padded(len: usize) -> usize {
    len.checked_next_multiple_of(8).unwrap_or(usize::MAX)
}

fn push_padded(out: &mut Vec<u8>, part: &[u8]) {
    out.extend_from_slice(part);
    let zeros = padded(part.len()).saturating_sub(part.len());
    out.resize(out.len().saturating_add(zeros), 0);
}

fn take_padded<'a>(rest: &mut &'a [u8], len: usize) -> Result<&'a [u8], WireError> {
    let part = rest.get(..len).ok_or(WireError::Truncated)?;
    *rest = rest.get(padded(len)..).ok_or(WireError::Truncated)?;
    Ok(part)
}

fn u16_at(bytes: &[u8], at: usize) -> Result<u16, WireError> {
    let slice = bytes.get(at..at.saturating_add(2)).ok_or(WireError::Truncated)?;
    Ok(u16::from_le_bytes(slice.try_into().map_err(|_| WireError::Truncated)?))
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32, WireError> {
    let slice = bytes.get(at..at.saturating_add(4)).ok_or(WireError::Truncated)?;
    Ok(u32::from_le_bytes(slice.try_into().map_err(|_| WireError::Truncated)?))
}

fn usize_at(bytes: &[u8], at: usize) -> Result<usize, WireError> {
    usize::try_from(u32_at(bytes, at)?).map_err(|_| WireError::TooLarge)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    fn parts<'a>(session: &'a [u8], page: &'a [u8], ink: &'a [u8]) -> EnvelopeParts<'a> {
        EnvelopeParts {
            session,
            page_json: page,
            ink,
            strokes: 3,
            read_only: true,
            more_ink: false,
        }
    }

    #[test]
    fn round_trips_with_padding() {
        let envelope = encode(&parts(b"{\"a\":1}", b"{\"page\":true}", b"inkinkink")).unwrap();
        assert_eq!(&envelope.bytes[..4], b"ONPE");
        assert_eq!(envelope.bytes.len(), 24 + 8 + 16 + 9);
        let decoded = decode(&envelope.bytes).unwrap();
        assert_eq!(decoded.session, b"{\"a\":1}");
        assert_eq!(decoded.page_json, b"{\"page\":true}");
        assert_eq!(decoded.ink, b"inkinkink");
        assert_eq!((decoded.strokes, decoded.flags), (3, FLAG_READ_ONLY));
    }

    #[test]
    fn rejects_bad_envelopes() {
        let good = encode(&parts(b"{}", b"{}", b"x")).unwrap().bytes;
        assert_eq!(decode(&good[..10]), Err(WireError::Truncated));
        let mut bad = good.clone();
        bad[0] = b'X';
        assert_eq!(decode(&bad), Err(WireError::Magic));
        let mut newer = good.clone();
        newer[4] = 2;
        assert_eq!(decode(&newer), Err(WireError::Version(2)));
        let mut long = good.clone();
        long.push(0);
        assert_eq!(decode(&long), Err(WireError::TrailingBytes));
        let mut lying = good;
        lying[8] = 200;
        assert_eq!(decode(&lying), Err(WireError::Truncated));
    }

    #[test]
    fn decoding_never_panics_on_any_prefix() {
        let good = encode(&parts(b"{\"x\":[1,2,3]}", b"{}", b"records")).unwrap().bytes;
        for end in 0..good.len() {
            let _ = decode(&good[..end]);
        }
    }
}
