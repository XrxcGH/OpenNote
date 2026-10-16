//! A small, stable hash that names an input in a recording.

use std::fmt;

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

/// A 64-bit FNV-1a hash. It is not secure, and it does not need to be: it only tells inputs apart, and
/// it gives the same value on every platform, which `DefaultHasher` does not promise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fingerprint(u64);

impl Default for Fingerprint {
    fn default() -> Self {
        Fingerprint(OFFSET)
    }
}

impl Fingerprint {
    /// Mixes in bytes.
    pub fn bytes(mut self, bytes: &[u8]) -> Fingerprint {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(PRIME);
        }
        self
    }

    /// Mixes in a number, in little-endian order.
    pub fn u32(self, value: u32) -> Fingerprint {
        self.bytes(&value.to_le_bytes())
    }

    /// Mixes in the exact bits of a float.
    pub fn f32(self, value: f32) -> Fingerprint {
        self.u32(value.to_bits())
    }

    /// Mixes in text, with its length so that "ab" then "c" differs from "a" then "bc".
    pub fn text(self, text: &str) -> Fingerprint {
        self.u32(text.len() as u32).bytes(text.as_bytes())
    }

    /// The 16 hexadecimal digits, which is how recordings store it (a JSON number loses bits past 2^53).
    pub fn to_hex(self) -> String {
        self.to_string()
    }
}

impl fmt::Display for Fingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:016x}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_published_fnv_vectors() {
        assert_eq!(Fingerprint::default().to_hex(), "cbf29ce484222325");
        assert_eq!(Fingerprint::default().bytes(b"a").to_hex(), "af63dc4c8601ec8c");
        assert_eq!(Fingerprint::default().bytes(b"foobar").to_hex(), "85944171f73967e8");
    }

    #[test]
    fn text_is_length_prefixed() {
        let a = Fingerprint::default().text("ab").text("c");
        let b = Fingerprint::default().text("a").text("bc");
        assert_ne!(a, b);
    }
}
