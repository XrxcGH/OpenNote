//! Settings schema version 1 (ARCHITECTURE.md section 16.3), serialized in camelCase to match the interface's
//! `Settings` type. Missing fields take their defaults. Adding a field with a default keeps the schema version;
//! the `editing` group (Phase 4) and the `ink` group (Phase 5) were added that way.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    editing::EditingSettings,
    ink::InkSettings,
    validate::{self, Check},
};
use crate::ipc::IpcResult;

/// The schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;

/// The text sizes the Appearance section offers, in percent.
pub const TEXT_SIZES: [u16; 8] = [80, 90, 100, 110, 125, 150, 175, 200];

/// The smallest and largest interface size, in percent.
pub const UI_SCALE_RANGE: (u16, u16) = (90, 150);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct Settings {
    pub schema_version: u32,
    /// The oldest schema version that may still write this file (section 16.6).
    pub min_writer_schema: u32,
    #[cfg_attr(test, ts(inline))]
    pub appearance: Appearance,
    #[cfg_attr(test, ts(inline))]
    pub storage: Storage,
    #[cfg_attr(test, ts(inline))]
    pub startup: Startup,
    /// Command id to its chords, for overridden shortcuts only. An empty list unbinds the command.
    pub shortcuts: BTreeMap<String, Vec<String>>,
    #[cfg_attr(test, ts(inline))]
    pub keymap: Keymap,
    #[cfg_attr(test, ts(inline))]
    pub updates: Updates,
    #[cfg_attr(test, ts(inline))]
    pub setup: SetupRecord,
    #[cfg_attr(test, ts(inline))]
    pub experimental: Experimental,
    pub editing: EditingSettings,
    pub ink: InkSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            min_writer_schema: SCHEMA_VERSION,
            appearance: Appearance::default(),
            storage: Storage::default(),
            startup: Startup::default(),
            shortcuts: BTreeMap::new(),
            keymap: Keymap::default(),
            updates: Updates::default(),
            setup: SetupRecord::default(),
            experimental: Experimental::default(),
            editing: EditingSettings::default(),
            ink: InkSettings::default(),
        }
    }
}

impl Settings {
    /// Checks what serde can't, such as ranges, absolute paths, and chords. The error names the field's path.
    pub fn validate(&self) -> IpcResult<()> {
        let mut check = Check::default();
        let (min, max) = UI_SCALE_RANGE;
        check.that(
            "appearance.uiScale",
            (min..=max).contains(&self.appearance.ui_scale),
            "The interface size is outside 90% to 150%.",
        );
        if let Some(folder) = &self.storage.notes_folder {
            check.that(
                "storage.notesFolder",
                crate::paths::is_local_path(std::path::Path::new(folder)),
                "The notes folder isn't a full path to a folder on this PC.",
            );
        }
        for (command, chords) in &self.shortcuts {
            let valid = validate::command_id(command) && chords.len() <= 4 && chords.iter().all(|c| validate::chord(c));
            check.that("shortcuts", valid, "A shortcut isn't a chord that can be assigned.");
        }
        if let Some(version) = &self.updates.skipped_version {
            check.that(
                "updates.skippedVersion",
                semver::Version::parse(version).is_ok(),
                "The skipped version isn't a version number.",
            );
        }
        self.editing.check(&mut check);
        self.ink.check(&mut check);
        check.finish()
    }
}

/// A text size in percent, one of [`TEXT_SIZES`]. Anything else fails to parse, so it falls back to 100%.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u16", into = "u16")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct TextSize(#[cfg_attr(test, ts(type = "80 | 90 | 100 | 110 | 125 | 150 | 175 | 200"))] u16);

impl TextSize {
    /// The size in percent.
    pub fn percent(self) -> u16 {
        self.0
    }
}

impl Default for TextSize {
    fn default() -> Self {
        Self(100)
    }
}

impl TryFrom<u16> for TextSize {
    type Error = String;

    fn try_from(percent: u16) -> Result<Self, Self::Error> {
        if TEXT_SIZES.contains(&percent) {
            Ok(Self(percent))
        } else {
            Err(format!("{percent}% isn't one of the offered text sizes"))
        }
    }
}

impl From<TextSize> for u16 {
    fn from(size: TextSize) -> u16 {
        size.0
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Appearance {
    pub theme: ThemePreference,
    #[cfg_attr(test, ts(inline))]
    pub page_color: PageColor,
    /// The whole interface's zoom, as WebView2 zoom (section 10.4).
    pub text_size: TextSize,
    /// The size of sidebars, toolbars, and menus, as a percentage in [`UI_SCALE_RANGE`].
    pub ui_scale: u16,
    #[cfg_attr(test, ts(inline))]
    pub motion: Motion,
    #[cfg_attr(test, ts(inline))]
    pub density: Density,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: ThemePreference::System,
            page_color: PageColor::MatchTheme,
            text_size: TextSize::default(),
            ui_scale: 100,
            motion: Motion::System,
            density: Density::Auto,
        }
    }
}

/// Light, Dark, or Match Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum ThemePreference {
    Light,
    Dark,
    #[default]
    System,
}

/// The page color in dark mode: follow the theme, or always paper white.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum PageColor {
    #[default]
    MatchTheme,
    Paper,
}

/// Follow Windows' animation setting, or always reduce motion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Motion {
    #[default]
    System,
    Reduce,
}

/// The size of buttons and rows: automatic, standard (mouse), or large (touch).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Density {
    #[default]
    Auto,
    Mouse,
    Touch,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Storage {
    /// An absolute path, or `None` until setup chooses one.
    pub notes_folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Startup {
    pub open_last_page: bool,
}

impl Default for Startup {
    fn default() -> Self {
        Self { open_last_page: true }
    }
}

/// The shortcut set that the `shortcuts` overrides apply on top of.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Keymap {
    pub preset: KeymapPreset,
}

/// OpenNote's own shortcuts, or the optional set that follows OneNote's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum KeymapPreset {
    #[default]
    Default,
    #[serde(rename = "onenote")]
    OneNote,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Updates {
    #[cfg_attr(test, ts(inline))]
    pub install: InstallPolicy,
    #[cfg_attr(test, ts(inline))]
    pub channel: UpdateChannel,
    pub skipped_version: Option<String>,
}

/// Install automatically, ask first, or only check when asked (section 18.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum InstallPolicy {
    #[default]
    Auto,
    Ask,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

/// Which person-scoped setup steps are done. Device-scoped steps live in the device state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct SetupRecord {
    pub completed_steps: Vec<String>,
}

/// Feature flag overrides. Only development and nightly builds read them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Experimental {
    pub flags: BTreeMap<String, bool>,
}

/// A top-level settings section that `settings_reset` can put back to its defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum SettingsSectionKey {
    Appearance,
    Storage,
    Startup,
    Shortcuts,
    Keymap,
    Updates,
    Setup,
    Experimental,
    Editing,
    Ink,
}

impl SettingsSectionKey {
    /// Every section, in the order of `settings.json`.
    pub const ALL: [SettingsSectionKey; 10] = [
        Self::Appearance,
        Self::Storage,
        Self::Startup,
        Self::Shortcuts,
        Self::Keymap,
        Self::Updates,
        Self::Setup,
        Self::Experimental,
        Self::Editing,
        Self::Ink,
    ];

    /// The section's key in `settings.json`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Appearance => "appearance",
            Self::Storage => "storage",
            Self::Startup => "startup",
            Self::Shortcuts => "shortcuts",
            Self::Keymap => "keymap",
            Self::Updates => "updates",
            Self::Setup => "setup",
            Self::Experimental => "experimental",
            Self::Editing => "editing",
            Self::Ink => "ink",
        }
    }
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
