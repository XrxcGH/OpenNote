//! A tolerant reader of protobuf-style tagged data, the encoding of Goodnotes' `.pb` index files.
//!
//! The wire format is public (Google's protocol buffers encoding guide): each field is a varint key, whose low
//! three bits give the wire type, then a varint, 8 bytes, a length and that many bytes, or 4 bytes. The reader
//! knows no schema. It walks fields, and treats a length-delimited field as text when it is UTF-8 without control
//! characters, or as a nested message when it parses as one. Every length is checked against what is left, the
//! nesting depth is capped, and so is the total number of bytes walked, so nested messages cannot make the work
//! grow past a small multiple of the input.

/// How deep nested messages are followed.
const MAX_DEPTH: usize = 12;
/// The most bytes one walk visits, nested messages included.
const MAX_WALK: usize = 64 << 20;

/// One field's value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Wire<'a> {
    /// Wire type 0.
    Varint(u64),
    /// Wire type 1.
    Fixed64(u64),
    /// Wire type 2.
    Bytes(&'a [u8]),
    /// Wire type 5.
    Fixed32(u32),
}

/// Reads a varint at `at`, returning it and where the next byte is.
pub fn varint(bytes: &[u8], at: usize) -> Option<(u64, usize)> {
    let mut value = 0u64;
    for n in 0..10 {
        let byte = *bytes.get(at.checked_add(n)?)?;
        value |= u64::from(byte & 0x7f).checked_shl(7 * n as u32)?;
        if byte & 0x80 == 0 {
            return Some((value, at + n + 1));
        }
    }
    None
}

/// The fields of a message, or `None` when the bytes are not a well-formed message.
pub fn fields(bytes: &[u8]) -> Option<Vec<(u64, Wire<'_>)>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        let (key, next) = varint(bytes, at)?;
        let number = key >> 3;
        if number == 0 {
            return None;
        }
        let (value, next) = match key & 7 {
            0 => {
                let (v, next) = varint(bytes, next)?;
                (Wire::Varint(v), next)
            }
            1 => {
                let raw = bytes.get(next..next.checked_add(8)?)?;
                (Wire::Fixed64(u64::from_le_bytes(raw.try_into().ok()?)), next + 8)
            }
            2 => {
                let (len, start) = varint(bytes, next)?;
                let end = start.checked_add(usize::try_from(len).ok()?)?;
                (Wire::Bytes(bytes.get(start..end)?), end)
            }
            5 => {
                let raw = bytes.get(next..next.checked_add(4)?)?;
                (Wire::Fixed32(u32::from_le_bytes(raw.try_into().ok()?)), next + 4)
            }
            _ => return None,
        };
        out.push((number, value));
        at = next;
    }
    Some(out)
}

/// Whether bytes read as text: UTF-8 with no control characters other than tabs and line breaks.
fn as_text(bytes: &[u8]) -> Option<&str> {
    let text = std::str::from_utf8(bytes).ok()?;
    let ok = !text.is_empty() && text.chars().all(|c| !c.is_control() || matches!(c, '\t' | '\n' | '\r'));
    ok.then_some(text)
}

/// Every text field of a message and of the messages inside it, in the order they appear, up to `max` of them.
pub fn strings(bytes: &[u8], max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut walked = 0usize;
    walk(bytes, 0, max, &mut walked, &mut out);
    out
}

fn walk(bytes: &[u8], depth: usize, max: usize, walked: &mut usize, out: &mut Vec<String>) {
    *walked = walked.saturating_add(bytes.len());
    if depth > MAX_DEPTH || *walked > MAX_WALK {
        return;
    }
    let Some(list) = fields(bytes) else {
        return;
    };
    for (_, value) in list {
        if out.len() >= max {
            return;
        }
        if let Wire::Bytes(inner) = value {
            // Short printable text is more likely a string than a message that happens to parse.
            match as_text(inner) {
                Some(text) => out.push(text.to_owned()),
                None => walk(inner, depth + 1, max, walked, out),
            }
        }
    }
}

/// Encodes fields, for the synthetic fixtures of the tests and the fuzz seeds.
#[cfg(any(test, feature = "testing", feature = "fuzzing"))]
pub mod write {
    fn put_varint(out: &mut Vec<u8>, mut v: u64) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    /// A length-delimited field.
    pub fn bytes_field(out: &mut Vec<u8>, number: u64, bytes: &[u8]) {
        put_varint(out, (number << 3) | 2);
        put_varint(out, bytes.len() as u64);
        out.extend_from_slice(bytes);
    }

    /// A varint field.
    pub fn varint_field(out: &mut Vec<u8>, number: u64, value: u64) {
        put_varint(out, number << 3);
        put_varint(out, value);
    }
}
