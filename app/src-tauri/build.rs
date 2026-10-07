//! The build script. It declares every app command in Tauri's app manifest, so each one gets an `allow-<command>`
//! permission that capabilities/default.json grants by name, instead of allowing every command. It also writes
//! `OUT_DIR/update_keys.rs` with the update public keys from `keys/*.pub`, which `src/updater.rs` includes.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

include!("src/command_list.rs");

/// The folder of update public keys, each as `tauri signer generate` writes it.
const KEYS_DIR: &str = "keys";

/// Compiled into builds with the `test-endpoints` feature. The release build job fails for an exe that has it.
const TEST_ENDPOINTS_MARKER: &str = "OPENNOTE-TEST-ENDPOINTS-BUILD";

fn main() {
    println!("cargo:rerun-if-changed=src/command_list.rs");
    println!("cargo:rerun-if-changed={KEYS_DIR}");
    let test_endpoints = env::var_os("CARGO_FEATURE_TEST_ENDPOINTS").is_some();
    let source = update_keys_source(&public_keys(Path::new(KEYS_DIR)), test_endpoints);
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    write_if_changed(&out_dir.join("update_keys.rs"), &source);

    connector_clients();

    let manifest = tauri_build::AppManifest::new().commands(APP_COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("the Tauri build step failed");
}

/// The file at the repository root where the owner of a build keeps the app registrations of the connectors. It is
/// not in the repository. Its shape is the one of `connectors.config.example.json`.
const CONNECTORS_CONFIG: &str = "../../connectors.config.json";

/// The services whose client IDs can be built in. Each has `OPENNOTE_<NAME>_CLIENT_ID` and `..._CLIENT_SECRET`.
const CONNECTOR_NAMES: [&str; 6] = ["microsoft", "google", "slack", "dropbox", "box", "vimeo"];

/// Hands the client IDs of `connectors.config.json` to the compiler as the same variables a build can set by hand
/// (`src/connectors/files.rs` reads them with `option_env!`). A variable that is already set wins over the file.
fn connector_clients() {
    println!("cargo:rerun-if-changed={CONNECTORS_CONFIG}");
    let file = fs::read_to_string(CONNECTORS_CONFIG)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    for name in CONNECTOR_NAMES {
        let upper = name.to_ascii_uppercase();
        for (field, suffix) in [("clientId", "CLIENT_ID"), ("clientSecret", "CLIENT_SECRET")] {
            let variable = format!("OPENNOTE_{upper}_{suffix}");
            println!("cargo:rerun-if-env-changed={variable}");
            if env::var_os(&variable).is_some() {
                continue;
            }
            let value = file
                .as_ref()
                .and_then(|root| root.pointer(&format!("/clients/{name}/{field}")))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty());
            if let Some(value) = value {
                println!("cargo:rustc-env={variable}={value}");
            }
        }
    }
}

/// The decoded text of every `*.pub` file in `dir`, sorted by file name. A missing folder has no keys.
fn public_keys(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "pub"))
        .collect();
    files.sort();
    files.iter().map(|path| decode_public_key(path)).collect()
}

/// Decodes a `.pub` file into minisign public key text, and fails the build for anything else.
fn decode_public_key(path: &Path) -> String {
    let encoded = fs::read_to_string(path).unwrap_or_else(|error| bad_key(path, &format!("can't be read: {error}")));
    let bytes = STANDARD
        .decode(encoded.trim())
        .unwrap_or_else(|_| bad_key(path, "isn't base64 text"));
    let text = String::from_utf8(bytes).unwrap_or_else(|_| bad_key(path, "doesn't decode to text"));
    let mut lines = text.lines();
    let comment = lines.next().is_some_and(|line| line.starts_with("untrusted comment:"));
    let key = lines
        .next()
        .is_some_and(|line| line.len() == 56 && line.starts_with("RW"));
    if !(comment && key) {
        bad_key(path, "doesn't hold a minisign public key");
    }
    text
}

fn bad_key(path: &Path, problem: &str) -> ! {
    panic!("{} {problem}", path.display())
}

/// The Rust source of `update_keys.rs`.
fn update_keys_source(keys: &[String], test_endpoints: bool) -> String {
    let keys: String = keys.iter().map(|key| format!("    {key:?},\n")).collect();
    let (test_key, marker) = if test_endpoints {
        (
            r#"option_env!("OPENNOTE_TEST_UPDATE_PUBKEY")"#.to_owned(),
            format!("Some({TEST_ENDPOINTS_MARKER:?})"),
        )
    } else {
        ("None".to_owned(), "None".to_owned())
    };
    format!(
        "// Generated by build.rs from app/src-tauri/keys/*.pub. Do not edit.\n\n\
         /// The decoded minisign public keys an update signature may verify against.\n\
         pub const UPDATE_PUBLIC_KEYS: &[&str] = &[\n{keys}];\n\n\
         /// The test key compiled in from `OPENNOTE_TEST_UPDATE_PUBKEY`, in `test-endpoints` builds only.\n\
         pub const TEST_UPDATE_PUBLIC_KEY: Option<&str> = {test_key};\n\n\
         /// A marker string in `test-endpoints` builds, which the release build job rejects.\n\
         pub const TEST_ENDPOINTS_MARKER: Option<&str> = {marker};\n"
    )
}

/// Writes `contents` only when the file differs, so an unchanged key list doesn't rebuild the app.
fn write_if_changed(path: &Path, contents: &str) {
    if fs::read_to_string(path).is_ok_and(|current| current == contents) {
        return;
    }
    fs::write(path, contents).unwrap_or_else(|error| panic!("can't write {}: {error}", path.display()));
}
