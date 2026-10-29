//! Standard base64 with padding, for the pixels of an image sent as JSON.

use crate::error::IntelError;

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encodes bytes as base64 text.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The value of each base64 symbol, or 255 for a byte that is not one.
const LOOKUP: [u8; 256] = {
    let mut lookup = [255_u8; 256];
    let mut i = 0;
    while i < 64 {
        lookup[ALPHABET[i] as usize] = i as u8;
        i += 1;
    }
    lookup
};

/// Decodes base64 text. Whitespace is ignored, and padding is required when the length needs it.
///
/// The bytes go straight into the output as each group of four symbols completes, so decoding an image
/// holds the text and the pixels and nothing else.
pub fn decode(text: &str) -> Result<Vec<u8>, IntelError> {
    let bad = || IntelError::InvalidInput("the pixel data is not valid base64".to_owned());
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut group = [0_u8; 4];
    let mut filled = 0;
    let mut padded = false;
    for b in text.bytes().filter(|b| !b.is_ascii_whitespace()) {
        // Padding ends the text, so nothing may follow a group that had it.
        if padded {
            return Err(bad());
        }
        group[filled] = b;
        filled += 1;
        if filled < 4 {
            continue;
        }
        filled = 0;
        let padding = group.iter().rev().take_while(|&&b| b == b'=').count();
        if padding > 2 {
            return Err(bad());
        }
        padded = padding > 0;
        let mut n = 0_u32;
        for &b in &group[..4 - padding] {
            let value = LOOKUP[usize::from(b)];
            if value == 255 {
                return Err(bad());
            }
            n = (n << 6) | u32::from(value);
        }
        n <<= 6 * padding as u32;
        out.extend_from_slice(&n.to_be_bytes()[1..4 - padding]);
    }
    if filled != 0 {
        return Err(bad());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_rfc_4648_vectors() {
        for (plain, coded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(encode(plain.as_bytes()), coded);
            assert_eq!(decode(coded).unwrap(), plain.as_bytes());
        }
    }

    #[test]
    fn every_byte_value_round_trips() {
        let bytes: Vec<u8> = (0..=255).collect();
        assert_eq!(decode(&encode(&bytes)).unwrap(), bytes);
        assert_eq!(decode("Zm9v\nYmFy").unwrap(), b"foobar", "whitespace is ignored");
    }

    #[test]
    fn malformed_text_is_refused() {
        for bad in ["Zg=", "Z", "Zm9v!A==", "Zg==Zg==", "=Zg=", "Z===", "Zm9vY"] {
            assert!(decode(bad).is_err(), "{bad:?}");
        }
    }
}
