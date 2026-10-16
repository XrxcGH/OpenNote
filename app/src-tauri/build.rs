//! The build script. It declares every app command in Tauri's app manifest, so each one gets an `allow-<command>`
//! permission that capabilities/default.json grants by name, instead of allowing every command. It also writes
//! `OUT_DIR/update_keys.rs` with the update public keys from `keys/*.pub`, which `src/updater.rs` includes. A
//! `release` build without a key stops (`src/build_rules.rs`).

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

include!("src/command_list.rs");
include!("src/build_rules.rs");

/// The folder of update public keys, each as `tauri signer generate` writes it.
const KEYS_DIR: &str = "keys";

/// Compiled into builds with the `test-endpoints` feature. The release build job fails for an exe that has it.
const TEST_ENDPOINTS_MARKER: &str = "OPENNOTE-TEST-ENDPOINTS-BUILD";

fn main() {
    println!("cargo:rerun-if-changed=src/command_list.rs");
    println!("cargo:rerun-if-changed={KEYS_DIR}");
    println!("cargo:rerun-if-env-changed=OPENNOTE_DRY_RUN");
    let test_endpoints = env::var_os("CARGO_FEATURE_TEST_ENDPOINTS").is_some();
    let keys = public_keys(Path::new(KEYS_DIR));
    let source = update_keys_source(&keys, test_endpoints);
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let profile = profile_from_out_dir(&out_dir).unwrap_or_default();
    let dry_run = env::var("OPENNOTE_DRY_RUN").is_ok_and(|value| value == "1");
    if let Some(problem) = release_key_problem(&profile, keys.len(), test_endpoints, dry_run) {
        panic!("{problem}");
    }
    write_if_changed(&out_dir.join("update_keys.rs"), &source);
    embed_cli(&out_dir);

    connector_clients();

    let manifest = tauri_build::AppManifest::new().commands(APP_COMMANDS);
    let windows = embed_windows_manifest(&out_dir);
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(manifest)
            .windows_attributes(windows),
    )
    .expect("the Tauri build step failed");
}

/// Copies the `opennote` command-line tool that the release job built (`OPENNOTE_CLI_EXE`) to
/// `OUT_DIR/opennote-cli.bin`, which `src/install/cli.rs` includes, so the one exe can install the tool. Without the
/// variable the file is empty, and the app says the tool isn't installed.
fn embed_cli(out_dir: &Path) {
    println!("cargo:rerun-if-env-changed=OPENNOTE_CLI_EXE");
    let bytes = match env::var_os("OPENNOTE_CLI_EXE").filter(|path| !path.is_empty()) {
        Some(path) => {
            let path = PathBuf::from(path);
            println!("cargo:rerun-if-changed={}", path.display());
            fs::read(&path).unwrap_or_else(|error| panic!("OPENNOTE_CLI_EXE {} can't be read: {error}", path.display()))
        }
        None => Vec::new(),
    };
    let target = out_dir.join("opennote-cli.bin");
    if fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
        fs::write(&target, bytes).expect("OUT_DIR is writable");
    }
}

/// Links the Windows manifest into every executable this crate makes, the unit-test runner included, rather than
/// only into the app as Tauri's resource would. The test runner reaches window code that needs Common Controls 6,
/// and without the manifest it doesn't start (STATUS_ENTRYPOINT_NOT_FOUND).
fn embed_windows_manifest(out_dir: &Path) -> tauri_build::WindowsAttributes {
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    let msvc = env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows")
        && env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|target| target == "msvc");
    if !msvc {
        return windows.app_manifest(windows_manifest());
    }
    let path = out_dir.join("windows-app.manifest");
    write_if_changed(&path, &windows_manifest());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", path.display());
    windows
}

/// The exe's Windows manifest, with the sparse package's publisher for "Share to OpenNote" (packaging/msix): the
/// certificate subject in `OPENNOTE_MSIX_PUBLISHER`, or the development publisher `register-dev.ps1` uses.
fn windows_manifest() -> String {
    println!("cargo:rerun-if-changed=windows-app.manifest");
    println!("cargo:rerun-if-env-changed=OPENNOTE_MSIX_PUBLISHER");
    let publisher = env::var("OPENNOTE_MSIX_PUBLISHER")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "CN=OpenNote Development".to_owned());
    assert!(
        publisher.starts_with("CN=") && !publisher.contains(['"', '<', '>', '&']),
        "OPENNOTE_MSIX_PUBLISHER must look like CN=Name"
    );
    let template = fs::read_to_string("windows-app.manifest").expect("windows-app.manifest is readable");
    template.replace("publisher=\"PUBLISHER\"", &format!("publisher=\"{publisher}\""))
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
