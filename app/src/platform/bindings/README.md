# Inter-process types

These files describe the data that crosses between the Rust shell and the interface: settings, device state, the boot payload, the updater status, and the arguments of the Tauri commands. ARCHITECTURE.md section 6.2 describes them.

ts-rs 12 generates them, one type per file, from the Rust structs that carry `#[cfg_attr(test, derive(ts_rs::TS))]`. `cargo test` writes them, along with `settings-default.json` and `device-state-default.json`, Rust's default values, which a Vitest test compares with the interface's defaults. Don't edit them by hand: change the Rust type and run `cargo test`. CI fails when the committed files differ from what the Rust types generate.

Import them through `app/src/platform/types.ts`, not from this folder. Prettier and CHECKS skip the folder, because the generator decides its format.
