//! WebView2 settings and the runtime check (ARCHITECTURE.md section 8.6). Phase 2 needs WebView2 130 or later
//! for `popover`, CSS anchor positioning, `@starting-style`, `inert`, and `interpolate-size`.
//!
//! Rust reads the installed version with `GetAvailableCoreWebView2BrowserVersionString` before it creates the
//! window. When it's missing or older, a native message offers the WebView2 Runtime download page. It never
//! downloads anything itself. [`configure`] then turns off the browser's own accelerator keys (release builds),
//! browser zoom, pinch zoom, swipe navigation, and the status bar, because the app owns those.

use tauri::WebviewWindow;

/// The oldest WebView2 Runtime major version Phase 2 supports.
pub const MIN_RUNTIME_MAJOR: u32 = 130;

/// Microsoft's page for the WebView2 Runtime. The message opens it only when the person says yes.
pub const DOWNLOAD_PAGE: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeCheck {
    Supported { version: String },
    Missing,
    TooOld { version: String },
}

impl RuntimeCheck {
    /// The installed version, when there is one.
    pub fn version(&self) -> Option<&str> {
        match self {
            Self::Supported { version } | Self::TooOld { version } => Some(version),
            Self::Missing => None,
        }
    }
}

/// Judges an installed version string, or its absence.
pub fn classify(version: Option<String>) -> RuntimeCheck {
    match version.filter(|version| !version.trim().is_empty()) {
        None => RuntimeCheck::Missing,
        Some(version) if meets_minimum(&version) => RuntimeCheck::Supported { version },
        Some(version) => RuntimeCheck::TooOld { version },
    }
}

/// Checks the installed WebView2 Runtime before the window is created.
pub fn check_runtime() -> RuntimeCheck {
    classify(installed_version())
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

/// The sentence of the native message.
pub const MISSING_MESSAGE: &str =
    "OpenNote needs Microsoft Edge WebView2 Runtime 130 or later. Open the download page?";

#[cfg(windows)]
fn installed_version() -> Option<String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::System::Com::CoTaskMemFree,
    };

    let mut version = PWSTR::null();
    // SAFETY: a null folder means the installed Evergreen runtime, and `version` is a local that receives a
    // string this function owns and frees with `CoTaskMemFree`.
    unsafe {
        GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version).ok()?;
        let text = version.to_string().ok();
        CoTaskMemFree(Some(version.0.cast_const().cast()));
        text
    }
}

#[cfg(not(windows))]
fn installed_version() -> Option<String> {
    Some(format!("{MIN_RUNTIME_MAJOR}.0.0.0"))
}

/// Tells the person what is wrong, and opens Microsoft's page if they say yes. Does nothing for a supported runtime.
#[cfg(windows)]
pub fn show_runtime_message(check: &RuntimeCheck) {
    use windows::{
        core::{w, HSTRING},
        Win32::{
            Foundation::HWND,
            UI::{
                Shell::ShellExecuteW,
                WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONWARNING, MB_YESNO, SW_SHOWNORMAL},
            },
        },
    };

    if matches!(check, RuntimeCheck::Supported { .. }) {
        return;
    }
    let text = match check.version() {
        Some(version) => format!("{MISSING_MESSAGE}\n\nInstalled version: {version}"),
        None => MISSING_MESSAGE.to_owned(),
    };
    // SAFETY: both calls take NUL-terminated strings that outlive them, and no owner window.
    unsafe {
        let answer = MessageBoxW(None, &HSTRING::from(text), w!("OpenNote"), MB_YESNO | MB_ICONWARNING);
        if answer == IDYES {
            ShellExecuteW(
                Some(HWND::default()),
                w!("open"),
                &HSTRING::from(DOWNLOAD_PAGE),
                None,
                None,
                SW_SHOWNORMAL,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn show_runtime_message(_check: &RuntimeCheck) {}

/// Sets WebView2's settings for the main window (section 8.6). Development builds keep DevTools and the
/// accelerator keys, so the inspector and reload still work there.
#[cfg(windows)]
pub fn configure(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings, ICoreWebView2Settings3, ICoreWebView2Settings5, ICoreWebView2Settings6,
    };
    use windows::core::Interface;

    let release = !cfg!(debug_assertions);
    let result = window.with_webview(move |webview| {
        // SAFETY: the controller and its settings are live COM objects owned by the window, and this closure runs
        // on the main thread that created them.
        let outcome = unsafe {
            (|| -> windows::core::Result<()> {
                let settings: ICoreWebView2Settings = webview.controller().CoreWebView2()?.Settings()?;
                settings.SetIsZoomControlEnabled(false)?;
                settings.SetIsStatusBarEnabled(false)?;
                settings.SetAreDevToolsEnabled(!release)?;
                settings
                    .cast::<ICoreWebView2Settings3>()?
                    .SetAreBrowserAcceleratorKeysEnabled(!release)?;
                settings
                    .cast::<ICoreWebView2Settings5>()?
                    .SetIsPinchZoomEnabled(false)?;
                settings
                    .cast::<ICoreWebView2Settings6>()?
                    .SetIsSwipeNavigationEnabled(false)?;
                Ok(())
            })()
        };
        if let Err(error) = outcome {
            log::warn!("Couldn't set the WebView2 settings: {error}");
        }
    });
    if let Err(error) = result {
        log::warn!("Couldn't reach WebView2 to set its settings: {error}");
    }
}

#[cfg(not(windows))]
pub fn configure(_window: &WebviewWindow) {}

/// Calls `run` when WebView2 reports that the page is gone: its render process or the browser process exited,
/// or the page stopped responding. A failed helper process, such as the GPU process, leaves the page in place.
#[cfg(windows)]
pub fn on_page_lost(window: &WebviewWindow, run: impl Fn() + Send + 'static) {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
        },
        ProcessFailedEventHandler,
    };

    let lost = [
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    ];
    let result = window.with_webview(move |webview| {
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Some(args) = args {
                // SAFETY: the event's arguments are a live COM object for the length of this call.
                unsafe { args.ProcessFailedKind(&mut kind)? };
                if lost.contains(&kind) {
                    log::warn!("The page's WebView2 process failed (kind {}).", kind.0);
                    run();
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the controller is a live COM object owned by the window, and this closure runs on the main thread
        // that created it. WebView2 keeps the handler for as long as the page lives.
        let outcome = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.add_ProcessFailed(&handler, &mut token))
        };
        if let Err(error) = outcome {
            log::warn!("Couldn't listen for WebView2 process failures: {error}");
        }
    });
    if let Err(error) = result {
        log::warn!("Couldn't reach WebView2 to listen for process failures: {error}");
    }
}

#[cfg(not(windows))]
pub fn on_page_lost(_window: &WebviewWindow, _run: impl Fn() + Send + 'static) {}

/// What wry gives WebView2 when an app gives it no arguments: the ones that turn off the "mini menu" and Smart
/// Screen, and the autoplay policy. Arguments passed through Tauri replace these, so a build that passes some
/// starts from the same ones.
#[cfg(any(test, feature = "test-endpoints"))]
const WRY_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// The browser arguments a build driven by WebDriver passes to WebView2, or `None` when the driver asked for none.
/// msedgedriver asks for the debugging port it needs in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. WebView2 153 on
/// GitHub's Windows runners left that variable out of the browser's command line, because the app passes
/// arguments of its own, so msedgedriver waited a minute for a port file that never appeared. Passing the same
/// text through Tauri puts it on the command line. Only `test-endpoints` builds do this.
#[cfg(any(test, feature = "test-endpoints"))]
#[cfg_attr(not(windows), allow(dead_code))]
pub fn driver_browser_args(requested: Option<&str>) -> Option<String> {
    let requested = requested?.trim();
    (!requested.is_empty()).then(|| format!("{WRY_BROWSER_ARGS} {requested}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_the_major_version() {
        assert!(meets_minimum("130.0.2849.68"));
        assert!(meets_minimum("141.0.3537.57"));
        assert!(!meets_minimum("129.0.2792.89"));
        assert!(!meets_minimum(""));
        assert!(!meets_minimum("unknown"));
    }

    #[test]
    fn judges_the_installed_version() {
        assert_eq!(classify(None), RuntimeCheck::Missing);
        assert_eq!(classify(Some("  ".into())), RuntimeCheck::Missing);
        assert_eq!(
            classify(Some("129.0.1".into())),
            RuntimeCheck::TooOld {
                version: "129.0.1".into()
            }
        );
        let supported = classify(Some("141.0.3537.57".into()));
        assert_eq!(supported.version(), Some("141.0.3537.57"));
        assert!(matches!(supported, RuntimeCheck::Supported { .. }));
    }

    #[test]
    fn adds_the_arguments_a_webdriver_asks_for_after_wrys_own() {
        assert_eq!(driver_browser_args(None), None);
        assert_eq!(driver_browser_args(Some("  ")), None);
        let args = driver_browser_args(Some(" --remote-debugging-port=0 ")).expect("arguments");
        assert!(args.starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection "));
        assert!(args.contains("--autoplay-policy=no-user-gesture-required"));
        assert!(args.ends_with(" --remote-debugging-port=0"));
    }

    #[cfg(windows)]
    #[test]
    fn asks_this_machine_for_its_runtime() {
        // The runtime is installed where the tests run, and Tauri's own tests need it.
        assert!(matches!(check_runtime(), RuntimeCheck::Supported { .. }));
    }
}
