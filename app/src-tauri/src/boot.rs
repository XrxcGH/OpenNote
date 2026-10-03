//! The boot payload (ARCHITECTURE.md section 6.3). Rust injects it as `window.__OPENNOTE_BOOT__` with an
//! initialization script before any page script runs, so the first frame already has the right theme, zoom,
//! settings, and location. It also holds the resolved theme and the window color for all 12 combinations of
//! preference, Windows setting, and contrast.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    appearance::{self, OsAppearance, ThemeName},
    args::Args,
    install::InstallStatus,
    settings::schema::{Settings, ThemePreference},
    state::DeviceState,
    theme_tokens::{Rgb, SURFACE_APP},
    updater::{GuardOutcome, UpdaterStatus},
};

/// The boot payload, matching the interface's `BootData`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct BootData {
    #[cfg_attr(test, ts(type = "1"))]
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
    #[cfg_attr(test, ts(inline))]
    pub perf: BootPerf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum Channel {
    Dev,
    Nightly,
    Beta,
    Stable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
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
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
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
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct BootPerf {
    pub process_start_epoch_ms: f64,
}

/// The release channel this exe was built for. Development builds are `dev`; release builds read it from the
/// version's pre-release label (`0.5.0-nightly.3`, `0.5.0-beta.1`), and a plain version is stable.
pub fn channel_for(version: &str, debug: bool) -> Channel {
    if debug {
        return Channel::Dev;
    }
    match semver::Version::parse(version) {
        Ok(version) if version.pre.as_str().starts_with("nightly") => Channel::Nightly,
        Ok(version) if version.pre.as_str().starts_with("beta") => Channel::Beta,
        _ => Channel::Stable,
    }
}

/// What the early steps found that the boot payload reports: the relaunch arguments and the guard's decision,
/// which become notices.
pub struct Launch {
    pub args: Args,
    pub guard: GuardOutcome,
}

impl Launch {
    /// The notices a relaunch owes the person: an update, a rollback, or a move.
    pub fn notices(&self, version: &str) -> Vec<Notice> {
        let mut notices = Vec::new();
        if let Some(from) = &self.args.after_update {
            notices.push(Notice::Updated {
                from: from.clone(),
                to: version.to_owned(),
            });
        }
        if let Some(from) = &self.args.rolled_back_from {
            notices.push(Notice::RolledBack {
                from: from.clone(),
                to: version.to_owned(),
            });
        }
        if let GuardOutcome::RollbackUnavailable { from, previous } = &self.guard {
            notices.push(Notice::RollbackUnavailable {
                from: from.clone(),
                previous: previous.clone(),
            });
        }
        if self.args.moved_from.is_some() {
            notices.push(Notice::Moved { ok: true });
        }
        notices
    }
}

/// What start-up learned that doesn't depend on the window: the boot payload's other half.
pub struct Startup {
    pub first_run: bool,
    pub settings_read_only: bool,
    pub notices: Vec<Notice>,
    pub webview2_version: String,
    pub process_start_epoch_ms: f64,
    pub updater: UpdaterStatus,
    pub flag_overrides: BTreeMap<String, bool>,
}

/// Builds the payload. `os` carries the effective zoom Rust is about to apply.
pub fn payload(
    startup: &Startup,
    settings: &Settings,
    state: &DeviceState,
    os: &OsAppearance,
    install: InstallStatus,
) -> BootData {
    let version = env!("CARGO_PKG_VERSION");
    // A build with `test-endpoints` is CI's end-to-end build. It runs as the dev channel, so it has the sample
    // library, the test flags, and flag overrides, as the specs expect, though it is an optimized exe.
    let channel = channel_for(version, cfg!(debug_assertions) || cfg!(feature = "test-endpoints"));
    // Overrides are for development and nightly builds only; the interface ignores them elsewhere, and so does this.
    let overrides_allowed = matches!(channel, Channel::Dev | Channel::Nightly);
    BootData {
        boot_version: 1,
        version: version.to_owned(),
        channel,
        architecture: Architecture::current(),
        first_run: startup.first_run,
        settings: settings.clone(),
        settings_read_only: startup.settings_read_only,
        state: state.clone(),
        os: *os,
        resolved_theme: appearance::resolve_theme(settings.appearance.theme, os),
        webview2_version: startup.webview2_version.clone(),
        install,
        updater: startup.updater.clone(),
        flag_overrides: if overrides_allowed {
            startup.flag_overrides.clone()
        } else {
            BTreeMap::new()
        },
        notices: startup.notices.clone(),
        perf: BootPerf {
            process_start_epoch_ms: startup.process_start_epoch_ms,
        },
    }
}

/// The feature flag overrides in `OPENNOTE_FLAGS`, such as `notes.memorySnapshot=1,page.canvas=0`.
pub fn flag_overrides(text: &str) -> BTreeMap<String, bool> {
    text.split(',')
        .filter_map(|pair| {
            let (id, value) = pair.split_once('=')?;
            let value = match value.trim() {
                "1" | "true" | "on" => true,
                "0" | "false" | "off" => false,
                _ => return None,
            };
            let id = id.trim();
            (!id.is_empty()).then(|| (id.to_owned(), value))
        })
        .collect()
}

/// The window's background before the page paints: the resolved theme's `surface.app`, or the system window
/// color under a contrast theme, so no white or wrong-theme frame shows.
pub fn window_color(preference: ThemePreference, os: &OsAppearance, system_window: Rgb) -> Rgb {
    if os.contrast {
        return system_window;
    }
    match appearance::resolve_theme(preference, os) {
        ThemeName::Light => SURFACE_APP.light,
        ThemeName::Dark => SURFACE_APP.dark,
    }
}

/// Windows' `COLOR_WINDOW`, which a contrast theme sets to its background.
#[cfg(windows)]
pub fn system_window_color() -> Rgb {
    use windows::Win32::Graphics::Gdi::{GetSysColor, COLOR_WINDOW};

    // SAFETY: GetSysColor reads a system color and has no other effect.
    let color = unsafe { GetSysColor(COLOR_WINDOW) };
    // A COLORREF is 0x00BBGGRR.
    Rgb(
        (color & 0xFF) as u8,
        ((color >> 8) & 0xFF) as u8,
        ((color >> 16) & 0xFF) as u8,
    )
}

#[cfg(not(windows))]
pub fn system_window_color() -> Rgb {
    Rgb(0xFF, 0xFF, 0xFF)
}

/// The initialization script: `window.__OPENNOTE_BOOT__ = {...};`. The JSON is escaped for a script context, so a
/// hostile string in a setting or a path can't close the script or break a line.
pub fn initialization_script(data: &BootData) -> String {
    let json = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_owned());
    format!("window.__OPENNOTE_BOOT__ = {};", escape_for_script(&json))
}

/// Replaces the characters that could end a script or a line with JSON escapes. They appear only inside JSON
/// strings, where an escape means the same character.
pub fn escape_for_script(json: &str) -> String {
    let mut out = String::with_capacity(json.len());
    for c in json.chars() {
        match c {
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            other => out.push(other),
        }
    }
    out
}

/// When this process was created, as epoch milliseconds, for the `processCreated` mark.
#[cfg(windows)]
pub fn process_start_epoch_ms() -> f64 {
    use windows::Win32::{
        Foundation::FILETIME,
        System::Threading::{GetCurrentProcess, GetProcessTimes},
    };

    const EPOCH_DIFFERENCE_100NS: u64 = 116_444_736_000_000_000;
    let mut times = [FILETIME::default(); 4];
    let [created, exited, kernel, user] = &mut times;
    // SAFETY: the current process handle is a pseudo handle, and each out parameter is a distinct local.
    let read = unsafe { GetProcessTimes(GetCurrentProcess(), created, exited, kernel, user) };
    if read.is_err() {
        return now_epoch_ms();
    }
    let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
    ticks.saturating_sub(EPOCH_DIFFERENCE_100NS) as f64 / 10_000.0
}

#[cfg(not(windows))]
pub fn process_start_epoch_ms() -> f64 {
    now_epoch_ms()
}

/// The current time as epoch milliseconds.
pub fn now_epoch_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests;
