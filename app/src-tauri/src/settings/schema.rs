//! Settings schema version 1 (ARCHITECTURE.md section 16.3), serialized in camelCase to match the interface's
//! `Settings` type. Missing fields take their defaults.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::ipc::{IpcError, IpcResult};

/// The schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;

/// The text sizes the Appearance section offers, in percent.
pub const TEXT_SIZES: [u16; 8] = [80, 90, 100, 110, 125, 150, 175, 200];

/// The smallest and largest interface size, in percent.
pub const UI_SCALE_RANGE: (u16, u16) = (90, 150);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    /// The oldest schema version that may still write this file (section 16.6).
    pub min_writer_schema: u32,
    pub appearance: Appearance,
    pub storage: Storage,
    pub startup: Startup,
    /// Command id to its chords, for overridden shortcuts only.
    pub shortcuts: BTreeMap<String, Vec<String>>,
    pub keymap: Keymap,
    pub updates: Updates,
    pub setup: SetupRecord,
    pub experimental: Experimental,
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
        }
    }
}

impl Settings {
    /// Checks what serde can't: that the text size and interface size are ones the interface offers.
    pub fn validate(&self) -> IpcResult<()> {
        let (min, max) = UI_SCALE_RANGE;
        if !(min..=max).contains(&self.appearance.ui_scale) {
            return Err(IpcError::invalid(
                "appearance.uiScale",
                "The interface size is outside 90% to 150%.",
            ));
        }
        if !TEXT_SIZES.contains(&self.appearance.text_size) {
            return Err(IpcError::invalid(
                "appearance.textSize",
                "The text size isn't one of the offered sizes.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    pub theme: ThemePreference,
    pub page_color: PageColor,
    /// Page zoom, as a percentage from [`TEXT_SIZES`].
    pub text_size: u16,
    /// The size of sidebars, toolbars, and menus, as a percentage in [`UI_SCALE_RANGE`]. The page zoom stays.
    pub ui_scale: u16,
    pub motion: Motion,
    pub density: Density,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: ThemePreference::System,
            page_color: PageColor::MatchTheme,
            text_size: 100,
            ui_scale: 100,
            motion: Motion::System,
            density: Density::Auto,
        }
    }
}

/// Light, Dark, or Match Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    Light,
    Dark,
    #[default]
    System,
}

/// The page color in dark mode: follow the theme, or always paper white.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageColor {
    #[default]
    MatchTheme,
    Paper,
}

/// Follow Windows' animation setting, or always reduce motion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Motion {
    #[default]
    System,
    Reduce,
}

/// The size of buttons and rows: automatic, standard (mouse), or large (touch).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    #[default]
    Auto,
    Mouse,
    Touch,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Storage {
    /// An absolute path, or `None` until setup chooses one.
    pub notes_folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
pub struct Keymap {
    pub preset: KeymapPreset,
}

/// OpenNote's own shortcuts, or the optional set that follows OneNote's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeymapPreset {
    #[default]
    Default,
    #[serde(rename = "onenote")]
    OneNote,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Updates {
    pub install: InstallPolicy,
    pub channel: UpdateChannel,
    pub skipped_version: Option<String>,
}

/// Install automatically, ask first, or only check when asked (section 18.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallPolicy {
    #[default]
    Auto,
    Ask,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

/// Which person-scoped setup steps are done. Device-scoped steps live in the device state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SetupRecord {
    pub completed_steps: Vec<String>,
}

/// Feature flag overrides. Only development and nightly builds read them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Experimental {
    pub flags: BTreeMap<String, bool>,
}

/// A top-level settings section that `settings_reset` can put back to its defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsSectionKey {
    Appearance,
    Storage,
    Startup,
    Shortcuts,
    Keymap,
    Updates,
    Setup,
    Experimental,
}

impl SettingsSectionKey {
    /// Every section, in the order of `settings.json`.
    pub const ALL: [SettingsSectionKey; 8] = [
        Self::Appearance,
        Self::Storage,
        Self::Startup,
        Self::Shortcuts,
        Self::Keymap,
        Self::Updates,
        Self::Setup,
        Self::Experimental,
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
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn defaults_match_schema_version_1() {
        let expected = json!({
            "schemaVersion": 1,
            "minWriterSchema": 1,
            "appearance": {
                "theme": "system", "pageColor": "matchTheme", "textSize": 100, "uiScale": 100, "motion": "system",
                "density": "auto"
            },
            "storage": { "notesFolder": null },
            "startup": { "openLastPage": true },
            "shortcuts": {},
            "keymap": { "preset": "default" },
            "updates": { "install": "auto", "channel": "stable", "skippedVersion": null },
            "setup": { "completedSteps": [] },
            "experimental": { "flags": {} }
        });
        assert_eq!(serde_json::to_value(Settings::default()).expect("serializes"), expected);
        assert_eq!(
            serde_json::from_value::<Settings>(json!({})).expect("parses"),
            Settings::default()
        );
    }

    #[test]
    fn section_keys_match_their_serialized_names() {
        let defaults = serde_json::to_value(Settings::default()).expect("serializes");
        for section in SettingsSectionKey::ALL {
            assert_eq!(serde_json::to_value(section).expect("serializes"), json!(section.key()));
            assert!(defaults.get(section.key()).is_some(), "{}", section.key());
        }
    }

    #[test]
    fn refuses_text_sizes_the_interface_doesnt_offer() {
        let mut settings = Settings::default();
        settings.appearance.text_size = 175;
        assert_eq!(settings.validate(), Ok(()));
        settings.appearance.text_size = 120;
        assert_eq!(
            settings.validate().map_err(|e| e.field),
            Err(Some("appearance.textSize".to_owned()))
        );
    }

    #[test]
    fn accepts_interface_sizes_from_90_to_150_percent() {
        let mut settings = Settings::default();
        for (ui_scale, valid) in [(90, true), (125, true), (150, true), (85, false), (175, false)] {
            settings.appearance.ui_scale = ui_scale;
            assert_eq!(settings.validate().is_ok(), valid, "{ui_scale}");
        }
    }

    #[test]
    fn names_the_onenote_shortcut_set() {
        let keymap = Keymap {
            preset: KeymapPreset::OneNote,
        };
        assert_eq!(
            serde_json::to_value(keymap).expect("serializes"),
            json!({ "preset": "onenote" })
        );
    }
}
