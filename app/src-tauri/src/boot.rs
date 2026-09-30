//! The boot payload (ARCHITECTURE.md section 6.3). Rust injects it as `window.__OPENNOTE_BOOT__` with an
//! initialization script before any page script runs, so the first frame already has the right theme, zoom,
//! settings, and location. It also holds the resolved theme and the window color for all 12 combinations of
//! preference, Windows setting, and contrast.
//!
//! The types here are final. The shell work package builds the payload, the safely escaped script, and the
//! window color. Until then the page falls back to its web defaults.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    appearance::{OsAppearance, ThemeName},
    args::Args,
    install::InstallStatus,
    settings::schema::Settings,
    state::DeviceState,
    updater::{GuardOutcome, UpdaterStatus},
};

/// The boot payload, matching the interface's `BootData`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootData {
    pub boot_version: u32,
    pub version: String,
    pub channel: Channel,
    pub architecture: Architecture,
    /// `settings.json` didn't exist.
    pub first_run: bool,
    pub settings: Settings,
    /// A newer schema's `minWriterSchema` forbids writing the settings file.
    pub settings_read_only: bool,
    pub state: DeviceState,
    pub os: OsAppearance,
    /// The theme Rust used for the window color.
    pub resolved_theme: ThemeName,
    pub webview2_version: String,
    pub install: InstallStatus,
    pub updater: UpdaterStatus,
    /// Feature flag overrides, in development and nightly builds only.
    pub flag_overrides: BTreeMap<String, bool>,
    pub notices: Vec<Notice>,
    pub perf: BootPerf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Channel {
    Dev,
    Nightly,
    Beta,
    Stable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Architecture {
    X64,
    X86,
    Arm64,
}

impl Architecture {
    /// The architecture this exe was built for.
    pub const fn current() -> Architecture {
        if cfg!(target_arch = "x86") {
            Self::X86
        } else if cfg!(target_arch = "aarch64") {
            Self::Arm64
        } else {
            Self::X64
        }
    }
}

/// Something the interface tells the person once at start, such as a rollback or reset settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Notice {
    SettingsReset { saved_as: String },
    SettingsReadOnly,
    StateReset,
    Updated { from: String, to: String },
    RolledBack { from: String, to: String },
    RollbackUnavailable { from: String, previous: Option<String> },
    Moved { ok: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootPerf {
    pub process_start_epoch_ms: f64,
}

/// What the early steps found that the boot payload reports: the relaunch arguments and the guard's decision,
/// which become notices.
pub struct Launch {
    pub args: Args,
    pub guard: GuardOutcome,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn serializes_notices_by_kind() {
        let notice = Notice::SettingsReset {
            saved_as: "settings.corrupt-20261001-0905.json".into(),
        };
        assert_eq!(
            serde_json::to_value(notice).expect("serializes"),
            json!({ "kind": "settingsReset", "savedAs": "settings.corrupt-20261001-0905.json" })
        );
        let notice = Notice::RollbackUnavailable {
            from: "0.5.0".into(),
            previous: None,
        };
        assert_eq!(
            serde_json::to_value(notice).expect("serializes"),
            json!({ "kind": "rollbackUnavailable", "from": "0.5.0", "previous": null })
        );
    }

    #[test]
    fn names_the_architecture_as_the_interface_does() {
        let names = [Architecture::X64, Architecture::X86, Architecture::Arm64].map(|a| serde_json::to_value(a).ok());
        assert_eq!(names, [Some(json!("x64")), Some(json!("x86")), Some(json!("arm64"))]);
        let expected = match std::env::consts::ARCH {
            "x86" => Architecture::X86,
            "aarch64" => Architecture::Arm64,
            _ => Architecture::X64,
        };
        assert_eq!(Architecture::current(), expected);
    }
}
