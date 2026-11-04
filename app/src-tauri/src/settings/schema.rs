//! Settings schema version 2 (ARCHITECTURE.md section 16.3), serialized in camelCase to match the interface's
//! `Settings` type. Missing fields take their defaults. Adding a field with a default keeps the schema version;
//! the `editing` group (Phase 4) and the `ink` group (Phase 5) were added that way. Version 2 (Beta 9) adds the
//! `text`, `tables`, and `code` groups in one raise, with every key the formatting, tables, and code programs
//! know of at its default. The step from version 1 changes nothing else, so Beta 8 may still write the file.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    editing::EditingSettings,
    ink::InkSettings,
    validate::{self, Check},
};
use crate::ipc::IpcResult;

/// The schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 2;

/// The oldest schema version that may write a file this build creates. Version 2 broke nothing, so Beta 8 may.
pub const MIN_WRITER_SCHEMA: u32 = 1;

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
    #[cfg_attr(test, ts(inline))]
    pub language: Language,
    #[cfg_attr(test, ts(inline))]
    pub text: TextSettings,
    #[cfg_attr(test, ts(inline))]
    pub tables: TablesSettings,
    #[cfg_attr(test, ts(inline))]
    pub code: CodeSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            min_writer_schema: MIN_WRITER_SCHEMA,
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
            language: Language::default(),
            text: TextSettings::default(),
            tables: TablesSettings::default(),
            code: CodeSettings::default(),
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
        check.that(
            "language.locale",
            validate::language_tag(&self.language.locale),
            "The language isn't a language tag.",
        );
        check.finish()
    }
}

/// The language of spelling, recognition, the voice, and the dictionary. Setup asks once; Settings changes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Language {
    /// A BCP 47 tag, such as `en-US`. The default is American English, whatever language Windows uses.
    pub locale: String,
}

impl Default for Language {
    fn default() -> Self {
        Self {
            locale: "en-US".to_owned(),
        }
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

/// OpenNote's own shortcuts (Word's keys for text formatting), the set that follows Google Docs, or the set that
/// follows OneNote's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum KeymapPreset {
    #[default]
    Default,
    Docs,
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

/// Text formatting (Beta 9): the paste default per source, the units of the ruler and the paragraph boxes, and how
/// custom background colors show in dark mode.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TextSettings {
    #[cfg_attr(test, ts(inline))]
    pub paste: PasteDefaults,
    pub measurement_unit: MeasurementUnit,
    pub dark_custom_backgrounds: DarkCustomBackgrounds,
}

/// What a paste keeps, by where the content came from. Word, Google Docs, and OneNote keep their formatting, and a
/// web page pastes clean.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PasteDefaults {
    pub word: PasteKeep,
    pub docs: PasteKeep,
    pub onenote: PasteKeep,
    pub web: PasteKeep,
}

impl Default for PasteDefaults {
    fn default() -> Self {
        Self {
            word: PasteKeep::KeepSource,
            docs: PasteKeep::KeepSource,
            onenote: PasteKeep::KeepSource,
            web: PasteKeep::MergeFormatting,
        }
    }
}

/// The three Paste Options: keep the source's formatting, keep only bold, italic, links, and lists, or keep text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PasteKeep {
    KeepSource,
    #[default]
    MergeFormatting,
    TextOnly,
}

/// The unit of the ruler, indents, and tab stops. Typographic values such as sizes stay in points.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum MeasurementUnit {
    #[default]
    Inches,
    Centimeters,
    Millimeters,
    Points,
    Picas,
}

/// Highlights, shading, and fills a person chose: shown exactly in dark mode, or softened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum DarkCustomBackgrounds {
    #[default]
    Exact,
    Soften,
}

/// Spreadsheet tables (Beta 9): the keys new tables use and whether the formula bar shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TablesSettings {
    pub new_table_keys: TableKeys,
    pub formula_bar: bool,
}

impl Default for TablesSettings {
    fn default() -> Self {
        Self {
            new_table_keys: TableKeys::Spreadsheet,
            formula_bar: true,
        }
    }
}

/// Spreadsheet keys (Enter moves down, typing replaces the cell) or document keys (Enter adds a line).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum TableKeys {
    #[default]
    Spreadsheet,
    Document,
}

/// The code studio's settings. Empty until the code program fills it in Beta 12.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CodeSettings {}

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
    Language,
    Text,
    Tables,
    Code,
}

impl SettingsSectionKey {
    /// Every section, in the order of `settings.json`.
    pub const ALL: [SettingsSectionKey; 14] = [
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
        Self::Language,
        Self::Text,
        Self::Tables,
        Self::Code,
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
            Self::Language => "language",
            Self::Text => "text",
            Self::Tables => "tables",
            Self::Code => "code",
        }
    }
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
