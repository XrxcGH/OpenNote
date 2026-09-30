//! The OpenNote exe. It runs the early start-up steps (arguments, `--wait-pid`, the instance lock, the update
//! start guard, and the WebView2 check), then starts the app. See ARCHITECTURE.md section 8.2.

// Hides the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use opennote_lib::early::{self, EarlyOutcome};

fn main() {
    match early::run() {
        EarlyOutcome::Continue(context) => opennote_lib::run(context),
        EarlyOutcome::Exit(code) => std::process::exit(code),
    }
}
