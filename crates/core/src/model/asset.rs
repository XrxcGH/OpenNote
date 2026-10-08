//! An entry of a page's asset table (spec 10.2).

use std::fmt::Write as _;

use serde::{Serialize, Serializer};

use super::JsonMap;
use crate::id::AssetId;
use crate::time::Timestamp;

/// An image, PDF, audio file, or attachment of a page. Assets never change once written.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    /// The asset's ID, the key of its table entry.
    pub id: AssetId,
    /// The file name in `assets/`, checked before use (spec 10.1).
    pub file: String,
    /// The media type.
    pub mime: String,
    /// The file's size.
    pub bytes: u64,
    /// The SHA-256 hash of the file.
    #[serde(serialize_with = "hex_hash")]
    pub sha256: [u8; 32],
    /// The original file name. Never used as a path.
    pub name: String,
    /// Pixel width, for images.
    pub width: Option<u32>,
    /// Pixel height, for images.
    pub height: Option<u32>,
    /// When the asset was added.
    pub created: Timestamp,
    /// Unknown keys, including the reserved `state`.
    #[serde(skip)]
    pub extra: JsonMap,
}

/// The `state` of an audio file that is still growing (spec 10.2).
pub const STATE_RECORDING: &str = "recording";

impl Asset {
    /// The hash as 64 lowercase hexadecimal digits, as `page.json` writes it.
    pub fn sha256_hex(&self) -> String {
        hex(&self.sha256)
    }

    /// Whether this is an audio file that is still being written, or that a crash cut off before
    /// anyone closed it (spec 10.2 and 10.3). Its file may not exist yet and grows past `bytes`, and
    /// its hash is not the file's, so the checks of size and hash skip it until recording ends.
    pub fn is_recording(&self) -> bool {
        self.extra.get("state").and_then(|state| state.as_str()) == Some(STATE_RECORDING)
    }
}

/// Bytes as lowercase hexadecimal digits.
pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn hex_hash<S: Serializer>(hash: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&hex(hash))
}
