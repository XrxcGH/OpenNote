//! Manifest v2: the Tauri updater's multi-platform format, with our size and SHA-256 per file
//! (ARCHITECTURE.md section 18.3). Unknown fields are ignored, so the format can grow.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::UpdateError;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    pub platforms: BTreeMap<String, PlatformEntry>,
}

/// One platform's file: where it is, its base64 `.sig`, its size in bytes, and its lowercase hex SHA-256.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlatformEntry {
    pub url: String,
    pub signature: String,
    pub size: u64,
    pub sha256: String,
}

/// Parses and validates a manifest: valid semver, an HTTPS URL, a size, and a 64-digit hash for each entry.
pub fn parse(_bytes: &[u8]) -> Result<Manifest, UpdateError> {
    Err(UpdateError::NotImplemented("manifest::parse"))
}
