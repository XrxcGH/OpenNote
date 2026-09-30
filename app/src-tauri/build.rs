//! The build script. It declares every app command in Tauri's app manifest, so each one gets an `allow-<command>`
//! permission that capabilities/default.json grants by name, instead of allowing every command.

include!("src/command_list.rs");

fn main() {
    println!("cargo:rerun-if-changed=src/command_list.rs");
    let manifest = tauri_build::AppManifest::new().commands(APP_COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("the Tauri build step failed");
}
