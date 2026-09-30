//! The Windows appearance: the app theme (`AppsUseLightTheme`), contrast themes (`SPI_GETHIGHCONTRAST`), animation
//! effects, and the text scale, re-read on `WM_SETTINGCHANGE` (ARCHITECTURE.md section 9.2). The interface never
//! infers the Windows theme from `prefers-color-scheme`; it gets it from here.
//!
//! This skeleton reports a light Windows theme with default settings. The shell work package reads the real
//! values and sends `os://appearance-changed`.

use serde::{Deserialize, Serialize};

use crate::settings::schema::ThemePreference;

/// The Windows appearance, matching the interface's `OsAppearance`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsAppearance {
    /// Windows' app mode is Dark.
    pub dark: bool,
    /// A Windows contrast theme is on.
    pub contrast: bool,
    /// Windows' "Animation effects" is on.
    pub animations: bool,
    /// Windows' text size setting, from 1.0 to 2.25.
    pub text_scale: f64,
    /// The effective zoom Rust applied to the page (section 10.4).
    pub zoom: f64,
}

impl Default for OsAppearance {
    fn default() -> Self {
        Self {
            dark: false,
            contrast: false,
            animations: true,
            text_scale: 1.0,
            zoom: 1.0,
        }
    }
}

/// A theme as shown: the preference resolved against Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeName {
    Light,
    Dark,
}

/// Reads the current Windows appearance.
pub fn read() -> OsAppearance {
    OsAppearance::default()
}

/// The theme to show for a preference: Match Windows follows Windows' app mode.
pub fn resolve_theme(preference: ThemePreference, os: &OsAppearance) -> ThemeName {
    match preference {
        ThemePreference::Light => ThemeName::Light,
        ThemePreference::Dark => ThemeName::Dark,
        ThemePreference::System if os.dark => ThemeName::Dark,
        ThemePreference::System => ThemeName::Light,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_windows_follows_the_app_mode() {
        let light = OsAppearance::default();
        let dark = OsAppearance { dark: true, ..light };
        assert_eq!(resolve_theme(ThemePreference::System, &light), ThemeName::Light);
        assert_eq!(resolve_theme(ThemePreference::System, &dark), ThemeName::Dark);
        assert_eq!(resolve_theme(ThemePreference::Light, &dark), ThemeName::Light);
        assert_eq!(resolve_theme(ThemePreference::Dark, &light), ThemeName::Dark);
    }
}
