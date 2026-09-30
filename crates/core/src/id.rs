//! IDs (spec 2.4): 128-bit values in the ULID layout, written as 26 lowercase Crockford base32 characters.
//!
//! The first 48 bits are the Unix time in milliseconds when the ID was made, and the other 80 bits are random.
//! Typed wrappers such as [`PageId`] keep IDs of different things apart at compile time.

use std::fmt;
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

use crate::time::Clock;

/// The Crockford base32 alphabet in lowercase, without `i`, `l`, `o`, and `u`.
const ALPHABET: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

/// The largest time a 48-bit prefix can hold.
const MAX_TIME_MS: u64 = (1 << 48) - 1;

/// An ID that failed to parse.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum IdError {
    /// An ID must be exactly 26 characters long.
    #[error("an ID has 26 characters, not {0}")]
    Length(usize),
    /// A character outside the Crockford base32 alphabet.
    #[error("character {index} of the ID is not in the Crockford base32 alphabet")]
    Character {
        /// The position of the bad character.
        index: usize,
    },
    /// The first character is above `7`, so the value doesn't fit in 128 bits.
    #[error("the ID's first character must be 0 to 7")]
    Overflow,
    /// A client ID is 1 to 32 characters from `a` to `z`, `0` to `9`, and `-`.
    #[error("a client ID is 1 to 32 characters from a-z, 0-9, and -")]
    Client,
}

/// A 128-bit ID. Its text form sorts in the same order as its bytes.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct Id([u8; 16]);

impl Id {
    /// The all-zero ID, used where the spec asks for zero, such as the page ID of a tree journal.
    pub const ZERO: Id = Id([0; 16]);

    /// The length of an ID's text form.
    pub const TEXT_LEN: usize = 26;

    /// A new ID from the clock's wall time and the operating system's secure random generator.
    pub fn generate(clock: &dyn Clock) -> Id {
        let mut random = [0u8; 10];
        fill_random(&mut random);
        let mut value = 0u128;
        for byte in random {
            value = (value << 8) | u128::from(byte);
        }
        let ms = u64::try_from(clock.now().unix_ms()).unwrap_or(0).min(MAX_TIME_MS);
        Id::from_parts(ms, value)
    }

    /// An ID from a time in milliseconds and random bits. Only the low 80 bits of `random` are used.
    ///
    /// For generators and tests that need IDs from a seed. Real IDs come from [`Id::generate`].
    pub fn from_parts(time_ms: u64, random: u128) -> Id {
        let time = u128::from(time_ms.min(MAX_TIME_MS));
        let random = random & ((1u128 << 80) - 1);
        Id(((time << 80) | random).to_be_bytes())
    }

    /// Parses the text form. Uppercase letters are accepted and stored as lowercase.
    pub fn parse(text: &str) -> Result<Id, IdError> {
        let bytes = text.as_bytes();
        if bytes.len() != Id::TEXT_LEN {
            return Err(IdError::Length(bytes.len()));
        }
        let mut value = 0u128;
        for (index, &byte) in bytes.iter().enumerate() {
            let digit = decode_digit(byte).ok_or(IdError::Character { index })?;
            if index == 0 && digit > 7 {
                return Err(IdError::Overflow);
            }
            value = (value << 5) | u128::from(digit);
        }
        Ok(Id(value.to_be_bytes()))
    }

    /// An ID from its 16 bytes, most significant byte first.
    pub const fn from_bytes(bytes: [u8; 16]) -> Id {
        Id(bytes)
    }

    /// The ID's 16 bytes, most significant byte first.
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// The Unix time in milliseconds when the ID was made.
    pub fn time_ms(&self) -> u64 {
        let value = u128::from_be_bytes(self.0) >> 80;
        u64::try_from(value).unwrap_or(MAX_TIME_MS)
    }

    /// Whether this is [`Id::ZERO`].
    pub fn is_zero(&self) -> bool {
        *self == Id::ZERO
    }

    /// The 26 ASCII characters of the text form.
    fn text(&self) -> [u8; 26] {
        let mut value = u128::from_be_bytes(self.0);
        let mut out = [b'0'; 26];
        for slot in out.iter_mut().rev() {
            *slot = ALPHABET[(value & 31) as usize];
            value >>= 5;
        }
        out
    }
}

fn decode_digit(byte: u8) -> Option<u8> {
    let lower = byte.to_ascii_lowercase();
    ALPHABET
        .iter()
        .position(|&a| a == lower)
        .and_then(|p| u8::try_from(p).ok())
}

/// Fills `buf` from the operating system's secure random generator.
fn fill_random(buf: &mut [u8]) {
    // The generator fails only on systems OpenNote doesn't support. IDs must never repeat, so there is no fallback.
    getrandom::fill(buf).expect("the operating system's random generator failed");
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = self.text();
        f.write_str(std::str::from_utf8(&text).map_err(|_| fmt::Error)?)
    }
}

impl fmt::Debug for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl FromStr for Id {
    type Err = IdError;
    fn from_str(text: &str) -> Result<Id, IdError> {
        Id::parse(text)
    }
}

impl Serialize for Id {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let text = self.text();
        serializer.serialize_str(std::str::from_utf8(&text).map_err(serde::ser::Error::custom)?)
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Id, D::Error> {
        struct IdVisitor;
        impl Visitor<'_> for IdVisitor {
            type Value = Id;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a 26-character ID")
            }
            fn visit_str<E: de::Error>(self, text: &str) -> Result<Id, E> {
                Id::parse(text).map_err(E::custom)
            }
        }
        deserializer.deserialize_str(IdVisitor)
    }
}

/// Declares a typed ID: a copyable wrapper around [`Id`] that serializes as the ID's text.
macro_rules! typed_id {
    ($($(#[$doc:meta])* $name:ident;)+) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub Id);

        impl $name {
            /// The all-zero ID.
            pub const ZERO: $name = $name(Id::ZERO);

            /// A new ID (see [`Id::generate`]).
            pub fn generate(clock: &dyn Clock) -> $name {
                $name(Id::generate(clock))
            }

            /// Parses the text form (see [`Id::parse`]).
            pub fn parse(text: &str) -> Result<$name, IdError> {
                Id::parse(text).map($name)
            }

            /// The untyped ID.
            pub fn id(self) -> Id {
                self.0
            }
        }

        typed_id_traits!($name);
    )+};
}

/// The conversion and formatting traits of a typed ID.
macro_rules! typed_id_traits {
    ($name:ident) => {
        impl From<Id> for $name {
            fn from(id: Id) -> $name {
                $name(id)
            }
        }

        impl From<$name> for Id {
            fn from(id: $name) -> Id {
                id.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0, f)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }

        impl FromStr for $name {
            type Err = IdError;
            fn from_str(text: &str) -> Result<$name, IdError> {
                $name::parse(text)
            }
        }
    };
}

typed_id! {
    /// A notebook. Unique everywhere.
    NotebookId;
    /// A section group, in `notebook.json`.
    GroupId;
    /// A section. Unique everywhere, and the name of its folder.
    SectionId;
    /// A page. Unique everywhere, and the name of its folder.
    PageId;
    /// A block. Unique within its page.
    BlockId;
    /// A text element: a paragraph, heading, or list item inside a text block (spec 6.6).
    ElementId;
    /// A stroke. Unique within its page.
    StrokeId;
    /// An asset. Unique within its page.
    AssetId;
    /// An ink segment. Unique within its page, and the name of its file.
    SegmentId;
    /// A saved revision of a page.
    RevisionId;
    /// A transaction of operations.
    TxnId;
    /// A Trash item, and the name of its folder.
    TrashItemId;
    /// A device, from `device.json`.
    DeviceId;
    /// A tree intent in the journal.
    IntentId;
    /// A table column.
    ColumnId;
    /// A table row.
    RowId;
}

/// A window or editor instance, such as `main-1`. 1 to 32 characters from `a` to `z`, `0` to `9`, and `-`.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ClientId(Box<str>);

impl ClientId {
    /// Parses and checks a client ID.
    pub fn parse(text: &str) -> Result<ClientId, IdError> {
        let valid_char = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';
        if text.is_empty() || text.len() > 32 || !text.chars().all(valid_char) {
            return Err(IdError::Client);
        }
        Ok(ClientId(text.into()))
    }

    /// The client ID's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ClientId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for ClientId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for ClientId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<ClientId, D::Error> {
        let text = String::deserialize(deserializer)?;
        ClientId::parse(&text).map_err(de::Error::custom)
    }
}

#[cfg(test)]
mod tests;
