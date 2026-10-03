//! The signature format fixture, described in tests/fixtures/tauri-signer/README.md. A file signed by the pinned
//! Tauri CLI verifies. Its trusted comment has the layout the updater reads, and its mode matches `ALLOW_LEGACY`.

use std::{fs, path::PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::PublicKey;
use opennote_updater::verify::{self, check_comment, decode_signature, verify_file, Expected, ALLOW_LEGACY};
use semver::Version;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/tauri-signer")
        .join(name)
}

fn decoded(name: &str) -> String {
    let text = fs::read_to_string(fixture(name)).expect("the fixture exists");
    String::from_utf8(STANDARD.decode(text.trim()).expect("base64")).expect("text")
}

fn key() -> PublicKey {
    PublicKey::decode(&decoded("fixture.pub")).expect("a minisign public key")
}

fn signature_field() -> String {
    fs::read_to_string(fixture("payload.txt.sig"))
        .expect("exists")
        .trim()
        .to_owned()
}

#[test]
fn the_cli_signature_verifies_with_its_comment() {
    let payload = fs::read(fixture("payload.txt")).expect("exists");
    let version = Version::parse("0.0.2-fixture").expect("valid");
    let sha256 = verify::sha256_of(&payload[..]).expect("hashes");
    let signature = signature_field();
    let expected = Expected {
        version: &version,
        file: "payload.txt",
        size: payload.len() as u64,
        sha256: &sha256,
        signature: &signature,
    };
    verify_file(&fixture("payload.txt"), &expected, &[key()]).expect("the fixture verifies");
    let other_file = Expected {
        file: "OpenNote_Windows64.exe",
        ..expected
    };
    assert!(verify_file(&fixture("payload.txt"), &other_file, &[key()]).is_err());
}

#[test]
fn the_trusted_comment_has_timestamp_file_and_version_fields() {
    let signature = decode_signature(&signature_field()).expect("decodes");
    let comment = signature.trusted_comment();
    let fields: Vec<&str> = comment
        .split('\t')
        .map(|field| field.split(':').next().unwrap_or(""))
        .collect();
    assert_eq!(fields, ["timestamp", "file", "version"]);
    let timestamp = comment
        .split('\t')
        .next()
        .and_then(|field| field.strip_prefix("timestamp:"));
    assert!(
        timestamp.is_some_and(|seconds| seconds.parse::<u64>().is_ok()),
        "the timestamp field isn't a whole number of seconds"
    );
    check_comment(comment, &Version::parse("0.0.2-fixture").expect("valid"), "payload.txt").expect("layout");
}

#[test]
fn allow_legacy_matches_the_signature_mode_the_cli_uses() {
    let text = decoded("payload.txt.sig");
    let line = text.lines().nth(1).expect("a signature line");
    let algorithm = STANDARD.decode(line).expect("base64");
    let prehashed = &algorithm[..2] == b"ED";
    assert!(prehashed || &algorithm[..2] == b"Ed", "an unknown algorithm");
    assert_eq!(
        ALLOW_LEGACY, !prehashed,
        "set ALLOW_LEGACY in src/verify.rs from the fixture"
    );
}
