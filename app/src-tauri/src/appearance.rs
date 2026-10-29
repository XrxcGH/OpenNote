//! The Windows appearance: the app theme (`AppsUseLightTheme`), contrast themes (`SPI_GETHIGHCONTRAST`), animation
//! effects, the screen reader flag, and the text scale, re-read on `WM_SETTINGCHANGE` (ARCHITECTURE.md section
//! 9.2). The interface never infers the Windows theme from `prefers-color-scheme`; it gets it from here, in the
//! boot payload and in `os://appearance-changed` events.
//!
//! The text scale comes from the `TextScaleFactor` value that Windows' "Text size" setting writes, which is what
//! `UISettings.TextScaleFactor` reads, so no WinRT activation is needed before the window exists.

use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    events,
    settings::{schema::ThemePreference, SettingsStore},
    window, zoom,
};

/// The Windows appearance, matching the interface's `OsAppearance`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
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
    /// A screen reader is running (`SPI_GETSCREENREADER`), so the page can mount for assistive technology.
    pub screen_reader: bool,
}

impl Default for OsAppearance {
    fn default() -> Self {
        Self {
            dark: false,
            contrast: false,
            animations: true,
            text_scale: 1.0,
            zoom: 1.0,
            screen_reader: false,
        }
    }
}

/// A theme as shown: the preference resolved against Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum ThemeName {
    Light,
    Dark,
}

/// What Windows reports, before it becomes an [`OsAppearance`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawAppearance {
    /// `AppsUseLightTheme`: 0 is dark, anything else is light, and `None` (an old Windows) is light.
    pub apps_use_light_theme: Option<u32>,
    /// `HIGHCONTRASTW.dwFlags` has `HCF_HIGHCONTRASTON`.
    pub high_contrast: bool,
    /// `SPI_GETCLIENTAREAANIMATION`.
    pub animations: bool,
    /// `SPI_GETSCREENREADER`.
    pub screen_reader: bool,
    /// `TextScaleFactor` in percent, 100 to 225, or `None` when the person never changed it.
    pub text_scale_percent: Option<u32>,
}

impl RawAppearance {
    /// Windows' defaults: light, no contrast theme, animations on, no screen reader, 100% text.
    pub const DEFAULT: RawAppearance = RawAppearance {
        apps_use_light_theme: None,
        high_contrast: false,
        animations: true,
        screen_reader: false,
        text_scale_percent: None,
    };
}

/// The interface's view of what Windows reports. The zoom is the page's, which the caller computes.
pub fn decode(raw: RawAppearance, zoom: f64) -> OsAppearance {
    OsAppearance {
        dark: raw.apps_use_light_theme == Some(0),
        contrast: raw.high_contrast,
        animations: raw.animations,
        text_scale: f64::from(raw.text_scale_percent.unwrap_or(100).clamp(100, 225)) / 100.0,
        zoom,
        screen_reader: raw.screen_reader,
    }
}

/// Reads the current Windows appearance, with a zoom of 1.
pub fn read() -> OsAppearance {
    decode(read_raw(), 1.0)
}

#[cfg(windows)]
pub fn read_raw() -> RawAppearance {
    use windows::{
        core::BOOL,
        Win32::UI::{
            Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW},
            WindowsAndMessaging::{
                SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SPI_GETHIGHCONTRAST, SPI_GETSCREENREADER,
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
            },
        },
    };

    let none = SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0);
    let mut contrast = HIGHCONTRASTW {
        cbSize: u32::try_from(std::mem::size_of::<HIGHCONTRASTW>()).unwrap_or(0),
        ..HIGHCONTRASTW::default()
    };
    // SAFETY: each call writes one value of the size its action documents into a local that outlives the call.
    let high_contrast = unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            Some((&raw mut contrast).cast()),
            none,
        )
        .is_ok()
    } && contrast.dwFlags.0 & HCF_HIGHCONTRASTON.0 != 0;
    let flag = |action| {
        let mut value = BOOL(0);
        // SAFETY: as above.
        let read = unsafe { SystemParametersInfoW(action, 0, Some((&raw mut value).cast()), none).is_ok() };
        read.then_some(value.as_bool())
    };
    RawAppearance {
        apps_use_light_theme: registry_dword(
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme",
        ),
        high_contrast,
        animations: flag(SPI_GETCLIENTAREAANIMATION).unwrap_or(true),
        screen_reader: flag(SPI_GETSCREENREADER).unwrap_or(false),
        text_scale_percent: registry_dword(r"Software\Microsoft\Accessibility", "TextScaleFactor"),
    }
}

/// Other systems report Windows' defaults.
#[cfg(not(windows))]
pub fn read_raw() -> RawAppearance {
    RawAppearance::DEFAULT
}

/// A `REG_DWORD` under `HKEY_CURRENT_USER`, or `None` when it isn't there.
#[cfg(windows)]
pub(crate) fn registry_dword(subkey: &str, value: &str) -> Option<u32> {
    use windows::{
        core::PCWSTR,
        Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
    };

    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (subkey, value) = (wide(subkey), wide(value));
    let mut data = 0u32;
    let mut size = 4u32;
    // SAFETY: the names are NUL-terminated and outlive the call, and `data` has the four bytes `size` says.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some((&raw mut data).cast()),
            Some(&raw mut size),
        )
    };
    status.is_ok().then_some(data)
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

/// The appearance the interface last heard about, in managed state.
pub struct Current(Mutex<OsAppearance>);

impl Current {
    pub fn new(os: OsAppearance) -> Self {
        Self(Mutex::new(os))
    }

    pub fn get(&self) -> OsAppearance {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stores `os`, and says whether it differs from what was there.
    fn replace(&self, os: OsAppearance) -> bool {
        let mut current = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let changed = *current != os;
        *current = os;
        changed
    }
}

/// Re-reads Windows and the text size setting, applies the effective zoom to the main window, and tells the
/// interface when anything changed. Runs on `WM_SETTINGCHANGE`, on a monitor change, and after the text size
/// changes. A call that finds nothing new does nothing.
pub fn refresh(app: &AppHandle) {
    let Some(window) = app.get_webview_window(window::MAIN) else {
        return;
    };
    let raw = read_raw();
    let text_size = app.state::<SettingsStore>().get().appearance.text_size.percent();
    let scale = decode(raw, 1.0).text_scale;
    let zoom = zoom::apply(&window, text_size, scale);
    let os = decode(raw, zoom);
    if app.state::<Current>().replace(os) {
        if let Err(error) = app.emit_to(window::MAIN, events::OS_APPEARANCE_CHANGED, os) {
            log::warn!("Couldn't send {}: {error}", events::OS_APPEARANCE_CHANGED);
        }
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

    #[test]
    fn windows_defaults_read_as_light_with_animations() {
        assert_eq!(decode(RawAppearance::DEFAULT, 1.0), OsAppearance::default());
    }

    #[test]
    fn a_zero_app_mode_is_dark_and_anything_else_is_light() {
        let raw = |value| RawAppearance {
            apps_use_light_theme: value,
            ..RawAppearance::DEFAULT
        };
        assert!(decode(raw(Some(0)), 1.0).dark);
        assert!(!decode(raw(Some(1)), 1.0).dark);
        assert!(!decode(raw(None), 1.0).dark);
    }

    #[test]
    fn keeps_the_text_scale_between_100_and_225_percent() {
        let scale = |percent| {
            decode(
                RawAppearance {
                    text_scale_percent: percent,
                    ..RawAppearance::DEFAULT
                },
                1.0,
            )
            .text_scale
        };
        assert_eq!(scale(None), 1.0);
        assert_eq!(scale(Some(125)), 1.25);
        assert_eq!(scale(Some(400)), 2.25);
        assert_eq!(scale(Some(0)), 1.0);
    }

    #[test]
    fn carries_the_contrast_animation_and_screen_reader_flags() {
        let os = decode(
            RawAppearance {
                high_contrast: true,
                animations: false,
                screen_reader: true,
                ..RawAppearance::DEFAULT
            },
            1.5,
        );
        assert!(os.contrast && !os.animations && os.screen_reader);
        assert_eq!(os.zoom, 1.5);
    }

    #[cfg(windows)]
    #[test]
    fn reads_this_machine_without_failing() {
        let os = read();
        assert!((1.0..=2.25).contains(&os.text_scale));
    }
}
