# Inter-process types

These files describe the data that crosses between the Rust shell and the interface: settings, device state, the boot payload, the updater status, and the arguments of the Tauri commands. ARCHITECTURE.md section 6.2 describes them.

For now they are written by hand, in exactly the form that ts-rs 12 generates, with one type per file. Once the Rust structs carry `#[cfg_attr(test, derive(ts_rs::TS))]`, `cargo test` writes these files instead. CI then fails when the committed files differ from the Rust types (`git diff --exit-code app/src/platform/bindings`).

Import them through `app/src/platform/types.ts`, not from this folder. Prettier and CHECKS skip the folder, because the generator decides its format.
