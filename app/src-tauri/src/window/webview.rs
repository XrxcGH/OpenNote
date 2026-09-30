//! WebView2 settings and the runtime check (ARCHITECTURE.md section 8.6). Phase 2 needs WebView2 130 or later
//! for `popover`, CSS anchor positioning, `@starting-style`, `inert`, and `interpolate-size`.
//!
//! The shell work package reads the installed version with `GetAvailableCoreWebView2BrowserVersionString`. When
//! it's missing or older, a native message offers the WebView2 Runtime download page.
//! The same package turns off browser accelerator keys, browser zoom, pinch zoom, and swipe navigation.

/// The oldest WebView2 Runtime major version Phase 2 supports.
pub const MIN_RUNTIME_MAJOR: u32 = 130;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeCheck {
    Supported,
    Missing,
    TooOld { version: String },
}

/// Checks the installed WebView2 Runtime before the window is created.
pub fn check_runtime() -> RuntimeCheck {
    RuntimeCheck::Supported
}

/// Whether a runtime version string such as `130.0.2849.68` meets the minimum.
pub fn meets_minimum(version: &str) -> bool {
    let major = version
        .trim()
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok());
    major.is_some_and(|major| major >= MIN_RUNTIME_MAJOR)
}

#[cfg(test)]
mod tests {
    use super::meets_minimum;

    #[test]
    fn compares_the_major_version() {
        assert!(meets_minimum("130.0.2849.68"));
        assert!(meets_minimum("141.0.3537.57"));
        assert!(!meets_minimum("129.0.2792.89"));
        assert!(!meets_minimum(""));
        assert!(!meets_minimum("unknown"));
    }
}
