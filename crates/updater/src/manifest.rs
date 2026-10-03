//! Manifest v2: the Tauri updater's multi-platform format, with our size and SHA-256 per file
//! (ARCHITECTURE.md section 18.3). Unknown fields are ignored, so the format can grow. The manifest comes from the
//! network, so every field is checked before it's used, and nothing in it can skip the signature check.

use std::collections::BTreeMap;

use semver::Version;
use serde::Deserialize;

use crate::{config::MAX_MANIFEST_BYTES, fetch::Url, platform::PlatformKey, Offer, UpdateError};

/// The most release notes the interface gets, in bytes. It shows at most 8 lines of them.
pub const MAX_NOTES_BYTES: usize = 4096;

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

fn invalid(reason: impl Into<String>) -> UpdateError {
    UpdateError::Manifest(reason.into())
}

/// Parses a manifest: at most 64 KB of JSON with the v2 fields and types, and a valid semver `version`.
pub fn parse(bytes: &[u8]) -> Result<Manifest, UpdateError> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid(format!("it's larger than {MAX_MANIFEST_BYTES} bytes")));
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|error| invalid(error.to_string()))?;
    Version::parse(&manifest.version).map_err(|error| invalid(format!("its version isn't semver: {error}")))?;
    Ok(manifest)
}

/// This platform's file in a manifest, or `None` when the manifest has no file for this platform. The entry must
/// have an HTTPS URL on GitHub, a size from 1 byte to `max_exe_bytes`, a 64-digit lowercase SHA-256, and a signature.
pub fn offer_for(manifest: &Manifest, platform: PlatformKey, max_exe_bytes: u64) -> Result<Option<Offer>, UpdateError> {
    let version = Version::parse(&manifest.version).map_err(|error| invalid(error.to_string()))?;
    let Some(entry) = manifest.platforms.get(platform.key()) else {
        return Ok(None);
    };
    let url = Url::parse(&entry.url).map_err(|error| invalid(error.to_string()))?;
    if !url.is_release_host() {
        return Err(invalid("the file isn't on a server the updater downloads from"));
    }
    if entry.size == 0 || entry.size > max_exe_bytes {
        return Err(invalid(format!(
            "the file's size, {}, is outside 1 to {max_exe_bytes}",
            entry.size
        )));
    }
    if !is_sha256_hex(&entry.sha256) {
        return Err(invalid("the file's sha256 isn't 64 lowercase hex digits"));
    }
    let signature = entry.signature.trim();
    if signature.is_empty() {
        return Err(invalid("the file has no signature"));
    }
    Ok(Some(Offer {
        version,
        notes: clamp_notes(&manifest.notes),
        url,
        size: entry.size,
        sha256: entry.sha256.clone(),
        signature: signature.to_owned(),
    }))
}

/// True for exactly 64 lowercase hexadecimal digits.
pub fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// The notes, cut at a character boundary to at most [`MAX_NOTES_BYTES`].
fn clamp_notes(notes: &str) -> String {
    let mut end = notes.len().min(MAX_NOTES_BYTES);
    while !notes.is_char_boundary(end) {
        end -= 1;
    }
    notes[..end].trim().to_owned()
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;
    use serde_json::{json, Value};

    use super::*;
    use crate::config::MAX_EXE_BYTES;

    const HASH: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn entry(file: &str) -> Value {
        json!({
            "url": format!("https://github.com/XrxcGH/OpenNote/releases/download/v0.5.0/{file}"),
            "signature": "c2lnbmF0dXJl", "size": 21_876_543, "sha256": HASH
        })
    }

    fn sample() -> Value {
        json!({
            "version": "0.5.0", "notes": "OpenNote v0.5.0", "pub_date": "2026-10-14T18:02:11Z", "channel": "stable",
            "platforms": {
                "windows-x86_64": entry("OpenNote_Windows64.exe"),
                "windows-i686": entry("OpenNote_Windows32.exe"),
                "windows-aarch64": entry("OpenNote_WindowsARM64.exe"),
            }
        })
    }

    fn offer(manifest: &Value) -> Result<Option<Offer>, UpdateError> {
        let parsed = parse(manifest.to_string().as_bytes())?;
        offer_for(&parsed, PlatformKey::WindowsX86_64, MAX_EXE_BYTES)
    }

    #[test]
    fn reads_this_platforms_file() {
        let offer = offer(&sample()).expect("valid").expect("has x64");
        assert_eq!(offer.version, Version::new(0, 5, 0));
        assert_eq!(offer.notes, "OpenNote v0.5.0");
        assert!(offer.url.as_str().ends_with("/OpenNote_Windows64.exe"));
        assert_eq!(
            (offer.size, offer.sha256.as_str(), offer.signature.as_str()),
            (21_876_543, HASH, "c2lnbmF0dXJl")
        );
        let arm = parse(sample().to_string().as_bytes()).expect("valid");
        let arm = offer_for(&arm, PlatformKey::WindowsAarch64, MAX_EXE_BYTES)
            .expect("valid")
            .expect("has arm");
        assert!(arm.url.as_str().ends_with("/OpenNote_WindowsARM64.exe"));
    }

    #[test]
    fn a_missing_platform_is_no_update_for_this_device() {
        let mut manifest = sample();
        manifest["platforms"]
            .as_object_mut()
            .expect("object")
            .remove("windows-x86_64");
        assert!(offer(&manifest).expect("valid").is_none());
    }

    #[test]
    fn ignores_fields_it_doesnt_know() {
        let mut manifest = sample();
        manifest["future"] = json!({ "a": [1, 2] });
        manifest["platforms"]["windows-x86_64"]["delta"] = json!("https://example.org/d");
        manifest["platforms"]["linux-x86_64"] = json!({ "anything": true, "url": 5 });
        assert!(
            parse(manifest.to_string().as_bytes()).is_err(),
            "every entry must have the v2 types"
        );
        manifest["platforms"]
            .as_object_mut()
            .expect("object")
            .remove("linux-x86_64");
        assert!(offer(&manifest).expect("valid").is_some());
    }

    #[test]
    fn refuses_wrong_types_and_missing_fields() {
        let cases = [
            ("version", json!(5)),
            ("version", json!("five")),
            ("platforms", json!([])),
            ("notes", json!(["a"])),
        ];
        for (field, value) in cases {
            let mut manifest = sample();
            manifest[field] = value;
            assert!(matches!(offer(&manifest), Err(UpdateError::Manifest(_))), "{field}");
        }
        for field in ["url", "signature", "size", "sha256"] {
            let mut manifest = sample();
            manifest["platforms"]["windows-x86_64"]
                .as_object_mut()
                .expect("object")
                .remove(field);
            assert!(matches!(offer(&manifest), Err(UpdateError::Manifest(_))), "{field}");
        }
        assert!(parse(b"not json").is_err());
        assert!(parse(b"{}").is_err());
    }

    #[test]
    fn refuses_bad_entries_for_this_platform() {
        let cases = [
            ("url", json!("http://github.com/x.exe")),
            ("url", json!("file:///C:/x.exe")),
            ("url", json!("https://evil.example/big.bin")),
            ("url", json!("https://github.com@evil.example/x.exe")),
            ("size", json!(0)),
            ("size", json!(MAX_EXE_BYTES + 1)),
            ("size", json!(-1)),
            ("sha256", json!(HASH.to_uppercase())),
            ("sha256", json!(&HASH[1..])),
            ("signature", json!("  ")),
        ];
        for (field, value) in cases {
            let mut manifest = sample();
            manifest["platforms"]["windows-x86_64"][field] = value.clone();
            assert!(
                matches!(offer(&manifest), Err(UpdateError::Manifest(_))),
                "{field} {value}"
            );
        }
    }

    #[test]
    fn refuses_a_manifest_over_64_kb() {
        let mut manifest = sample();
        manifest["notes"] = json!("x".repeat(70_000));
        assert!(matches!(
            parse(manifest.to_string().as_bytes()),
            Err(UpdateError::Manifest(_))
        ));
    }

    #[test]
    fn keeps_at_most_4_kb_of_notes_on_a_character_boundary() {
        let mut manifest = sample();
        manifest["notes"] = json!(format!("{}é", "a".repeat(MAX_NOTES_BYTES - 1)));
        let notes = offer(&manifest).expect("valid").expect("offer").notes;
        assert_eq!(notes.len(), MAX_NOTES_BYTES - 1);
    }

    proptest! {
        #[test]
        fn never_panics_on_any_bytes(bytes in proptest::collection::vec(any::<u8>(), 0..512)) {
            if let Ok(manifest) = parse(&bytes) {
                let _ = offer_for(&manifest, PlatformKey::WindowsX86_64, MAX_EXE_BYTES);
            }
        }

        #[test]
        fn never_panics_on_any_entry(url in "\\PC{0,40}", size in any::<u64>(), sha in "[0-9a-fA-F]{0,70}") {
            let mut manifest = sample();
            let entry = json!({ "url": url, "signature": "s", "size": size, "sha256": sha });
            manifest["platforms"]["windows-x86_64"] = entry;
            let _ = offer(&manifest);
        }
    }
}
