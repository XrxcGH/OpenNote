//! Verification of a downloaded or staged file, in the order of ARCHITECTURE.md section 18.5: size, SHA-256,
//! the minisign signature against a built-in key, and the signed trusted comment's `version` and `file` fields.

use std::path::Path;

use minisign_verify::PublicKey;
use semver::Version;

use crate::UpdateError;

/// What the manifest and this build expect of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expected<'a> {
    /// The manifest's version, which the trusted comment's `version` field must equal.
    pub version: &'a Version,
    /// This platform's release file name, which the trusted comment's `file` field must equal.
    pub file: &'a str,
    pub size: u64,
    pub sha256: &'a str,
    /// The manifest's base64 `.sig` text.
    pub signature: &'a str,
}

/// Checks a file against what's expected, accepting a signature from any of `keys`.
pub fn verify_file(_path: &Path, _expected: &Expected<'_>, _keys: &[PublicKey]) -> Result<(), UpdateError> {
    Err(UpdateError::NotImplemented("verify::verify_file"))
}
