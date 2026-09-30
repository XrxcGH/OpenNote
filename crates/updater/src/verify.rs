//! Verification of a downloaded or staged file, in the order of ARCHITECTURE.md section 18.5: size, SHA-256,
//! the minisign signature against a built-in key, and the signed trusted comment's `version` and `file` fields.
//! One pass over the file feeds both the hash and the signature check.

use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use sha2::{Digest, Sha256};

use crate::UpdateError;

/// Whether signatures in minisign's legacy mode, which signs the whole file instead of its hash, are accepted.
/// `tauri signer sign` 2.12 makes prehashed signatures, as the format fixture in tests/fixtures/tauri-signer
/// shows. So legacy signatures are refused. A test fails if the fixture and this constant disagree.
pub const ALLOW_LEGACY: bool = false;

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

fn failed(reason: impl Into<String>) -> UpdateError {
    UpdateError::Verify(reason.into())
}

/// Checks a file against what's expected, accepting a signature from any of `keys`.
pub fn verify_file(path: &Path, expected: &Expected<'_>, keys: &[PublicKey]) -> Result<(), UpdateError> {
    verify_reader(File::open(path)?, expected, keys)
}

/// Checks the bytes a reader gives against what's expected, accepting a signature from any of `keys`.
pub fn verify_reader(mut reader: impl Read, expected: &Expected<'_>, keys: &[PublicKey]) -> Result<(), UpdateError> {
    let signature = decode_signature(expected.signature)?;
    let key = trusted_key(&signature, keys)?;
    let mut verifier = key
        .verify_stream(&signature)
        .map_err(|error| failed(format!("the signature can't be checked: {error}")))?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > expected.size {
            return Err(failed(format!("the file is larger than {} bytes", expected.size)));
        }
        hasher.update(&buffer[..read]);
        verifier.update(&buffer[..read]);
    }
    if total != expected.size {
        return Err(failed(format!("the file has {total} bytes, not {}", expected.size)));
    }
    if hex(&hasher.finalize()) != expected.sha256 {
        return Err(failed("the file's SHA-256 doesn't match"));
    }
    verifier
        .finalize()
        .map_err(|error| failed(format!("the signature doesn't match the file: {error}")))?;
    check_comment(signature.trusted_comment(), expected.version, expected.file)
}

/// Decodes the manifest's base64 `signature` field into a minisign signature.
pub fn decode_signature(field: &str) -> Result<Signature, UpdateError> {
    let bytes = STANDARD
        .decode(field.trim())
        .map_err(|_| failed("the signature isn't base64 text"))?;
    let text = String::from_utf8(bytes).map_err(|_| failed("the signature isn't text"))?;
    Signature::decode(&text).map_err(|error| failed(format!("the signature can't be read: {error}")))
}

/// The key a signature was made with, among the trusted ones. Legacy signatures are refused unless
/// [`ALLOW_LEGACY`] is set; streaming verification only supports prehashed ones anyway.
fn trusted_key<'a>(signature: &Signature, keys: &'a [PublicKey]) -> Result<&'a PublicKey, UpdateError> {
    let mut legacy = false;
    for key in keys {
        match key.verify_stream(signature) {
            Ok(_) => return Ok(key),
            Err(minisign_verify::Error::UnsupportedLegacyMode) => legacy = true,
            Err(_) => {}
        }
    }
    if legacy && !ALLOW_LEGACY {
        Err(failed("the signature uses minisign's legacy mode"))
    } else {
        Err(failed("the file isn't signed with a key this build trusts"))
    }
}

/// Checks the signed trusted comment: exactly one `version` field equal to `version`, and exactly one `file` field
/// equal to `file`.
pub fn check_comment(comment: &str, version: &Version, file: &str) -> Result<(), UpdateError> {
    let fields: Vec<(&str, &str)> = comment.split('\t').filter_map(|field| field.split_once(':')).collect();
    let only = |name: &str| {
        let mut values = fields
            .iter()
            .filter(|(key, _)| *key == name)
            .map(|(_, value)| value.trim());
        match (values.next(), values.next()) {
            (Some(value), None) => Some(value),
            _ => None,
        }
    };
    let signed_version = only("version").and_then(|text| Version::parse(text).ok());
    if signed_version.as_ref() != Some(version) {
        return Err(failed(format!("the signature doesn't name version {version}")));
    }
    if only("file") != Some(file) {
        return Err(failed(format!("the signature doesn't name the file {file}")));
    }
    Ok(())
}

/// Lowercase hexadecimal.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The SHA-256 of everything a reader gives, in lowercase hexadecimal.
pub fn sha256_of(mut reader: impl Read) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(hex(&hasher.finalize()));
        }
        hasher.update(&buffer[..read]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{comment, sign, Signer};

    const FILE: &str = "OpenNote_Windows64.exe";

    struct Case {
        data: Vec<u8>,
        signature: String,
        sha256: String,
        version: Version,
    }

    fn case(signer: &Signer, comment_version: &str, comment_file: &str) -> Case {
        let data = b"MZ the new exe".repeat(1000);
        Case {
            signature: sign(signer, &data, &comment(comment_version, comment_file)),
            sha256: sha256_of(&data[..]).expect("reads"),
            data,
            version: Version::parse("0.5.0").expect("valid"),
        }
    }

    fn check(case: &Case, data: &[u8], keys: &[PublicKey]) -> Result<(), UpdateError> {
        let expected = Expected {
            version: &case.version,
            file: FILE,
            size: case.data.len() as u64,
            sha256: &case.sha256,
            signature: &case.signature,
        };
        verify_reader(data, &expected, keys)
    }

    fn reason(result: Result<(), UpdateError>) -> String {
        match result {
            Err(UpdateError::Verify(reason)) => reason,
            other => panic!("expected a verification failure, got {other:?}"),
        }
    }

    #[test]
    fn accepts_a_file_signed_for_its_version_and_name() {
        let signer = Signer::new();
        let good = case(&signer, "0.5.0", FILE);
        check(&good, &good.data, &[signer.public()]).expect("verifies");
        let other = Signer::new();
        check(&good, &good.data, &[other.public(), signer.public()]).expect("any trusted key");
    }

    #[test]
    fn refuses_a_changed_or_cut_file() {
        let signer = Signer::new();
        let good = case(&signer, "0.5.0", FILE);
        let mut changed = good.data.clone();
        changed[100] ^= 1;
        assert!(reason(check(&good, &changed, &[signer.public()])).contains("SHA-256"));
        assert!(reason(check(&good, &good.data[1..], &[signer.public()])).contains("bytes, not"));
        let mut longer = good.data.clone();
        longer.push(0);
        assert!(reason(check(&good, &longer, &[signer.public()])).contains("larger than"));
    }

    #[test]
    fn refuses_a_changed_file_even_when_the_manifest_has_its_hash() {
        let signer = Signer::new();
        let good = case(&signer, "0.5.0", FILE);
        let mut changed = good.data.clone();
        changed[0] = b'X';
        let forged = Case {
            sha256: sha256_of(&changed[..]).expect("reads"),
            ..good
        };
        assert!(reason(check(&forged, &changed, &[signer.public()])).contains("signature doesn't match"));
    }

    #[test]
    fn refuses_the_wrong_version_or_file_in_the_trusted_comment() {
        let signer = Signer::new();
        for (version, file) in [
            ("0.4.0", FILE),
            ("0.5.0", "OpenNote_WindowsARM64.exe"),
            ("0.5.0", "opennote.exe"),
        ] {
            let bad = case(&signer, version, file);
            assert!(
                reason(check(&bad, &bad.data, &[signer.public()])).contains("doesn't name"),
                "{version} {file}"
            );
        }
        let comment = format!("timestamp:1\tfile:{FILE}\tversion:0.5.0\tversion:0.4.0");
        assert!(check_comment(&comment, &Version::new(0, 5, 0), FILE).is_err());
        assert!(check_comment(&format!("file:{FILE}"), &Version::new(0, 5, 0), FILE).is_err());
    }

    #[test]
    fn refuses_another_key_and_no_key() {
        let signer = Signer::new();
        let good = case(&signer, "0.5.0", FILE);
        let stranger = Signer::new();
        assert!(reason(check(&good, &good.data, &[stranger.public()])).contains("key this build trusts"));
        assert!(reason(check(&good, &good.data, &[])).contains("key this build trusts"));
    }

    #[test]
    fn refuses_signature_text_that_isnt_a_signature() {
        for field in ["", "!!!", "bm90IGEgc2lnbmF0dXJl", "//79"] {
            assert!(decode_signature(field).is_err(), "{field}");
        }
    }
}
