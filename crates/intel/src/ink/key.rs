//! The caller's name for a stroke, and its text form.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::IntelError;

/// Crockford's base 32 without I, L, O, and U, as the note format writes IDs.
const ALPHABET: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

/// The caller's name for a stroke, returned with each recognized word.
///
/// The 16 bytes match the bytes of a note stroke's ID, so the wiring layer converts without a lookup.
/// In JSON the key is the ID's 26-character text, the same text the interface uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StrokeKey(pub [u8; 16]);

impl StrokeKey {
    /// The 26-character text of the ID: the 128 bits behind two zero bits, in groups of five.
    pub fn to_text(&self) -> String {
        let value = u128::from_be_bytes(self.0);
        (0..26)
            .map(|i| char::from(ALPHABET[((value >> ((25 - i) * 5)) & 31) as usize]))
            .collect()
    }

    /// Reads the text form. Uppercase letters are accepted, and the first character must be 0 to 7.
    pub fn from_text(text: &str) -> Result<StrokeKey, IntelError> {
        let bad = || IntelError::InvalidInput(format!("\"{text}\" is not a stroke ID"));
        if text.len() != 26 {
            return Err(bad());
        }
        let mut value: u128 = 0;
        for (i, byte) in text.bytes().enumerate() {
            let digit = ALPHABET
                .iter()
                .position(|&c| c == byte.to_ascii_lowercase())
                .ok_or_else(bad)?;
            if i == 0 && digit > 7 {
                return Err(bad());
            }
            value = (value << 5) | digit as u128;
        }
        Ok(StrokeKey(value.to_be_bytes()))
    }
}

impl Serialize for StrokeKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_text())
    }
}

impl<'de> Deserialize<'de> for StrokeKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<StrokeKey, D::Error> {
        let text = String::deserialize(deserializer)?;
        StrokeKey::from_text(&text).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_round_trips_and_matches_the_notes_encoding() {
        let key = StrokeKey(std::array::from_fn(|i| i as u8));
        // The same bytes through idText in app/src/core/ink/bytes.ts.
        assert_eq!(key.to_text(), "00041061050r3gg28a1c60t3gf");
        assert_eq!(StrokeKey::from_text("00041061050R3GG28A1C60T3GF").unwrap(), key);
        let all_ones = StrokeKey([0xff; 16]);
        assert_eq!(all_ones.to_text(), "7zzzzzzzzzzzzzzzzzzzzzzzzz");
        assert_eq!(StrokeKey::from_text(&all_ones.to_text()).unwrap(), all_ones);
    }

    #[test]
    fn bad_text_is_refused() {
        for text in [
            "",
            "short",
            "8zzzzzzzzzzzzzzzzzzzzzzzzz",
            "0000000000000000000000000u",
            "0000000000000000000000000é",
        ] {
            assert!(StrokeKey::from_text(text).is_err(), "{text:?}");
        }
    }
}
