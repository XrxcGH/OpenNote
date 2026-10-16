//! The panic hook and the Windows exception handler, which save a report when the app crashes.
//!
//! [`install`] once at start-up, before any other thread starts. Both handlers do nothing until the person
//! turns crash reports on, which [`set_enabled`] can do at any time. A report goes to the local folder, and
//! never anywhere else. The app keeps running its own panic hook too: this one calls the hook it replaced.

use std::panic::{self, PanicHookInfo};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::report::{drop_panic_frames, Capture, Environment, Kind, RawFrame, Report};
use crate::scrub::Scrubber;
use crate::send::Settings;
use crate::store::CrashStore;
use crate::sys;

/// The most reports one run of the app saves, so a panic in a loop can't fill the folder.
pub const MAX_PER_RUN: u32 = 3;

/// What [`install`] needs to know.
#[derive(Clone, Debug)]
pub struct Config {
    /// The OpenNote version, such as `env!("CARGO_PKG_VERSION")` of the app.
    pub app_version: String,
    /// Where to save reports, usually [`CrashStore::standard`].
    pub store: CrashStore,
    /// The person's settings. Only [`Settings::saving_allowed`] matters here.
    pub settings: Settings,
}

struct State {
    app_version: String,
    os: String,
    store: CrashStore,
    enabled: AtomicBool,
    saved: AtomicU32,
    scrubber: RwLock<Scrubber>,
}

static STATE: OnceLock<State> = OnceLock::new();
/// Set while a report is being written, so a crash inside the handler can't start another report.
static BUSY: AtomicBool = AtomicBool::new(false);

/// Installs the panic hook and, on Windows, the exception handler. Returns `false` if they were installed
/// already. Nothing is saved until [`Settings::enabled`] is true.
pub fn install(config: Config) -> bool {
    let state = State {
        app_version: config.app_version,
        os: sys::os_description(),
        store: config.store,
        enabled: AtomicBool::new(config.settings.saving_allowed()),
        saved: AtomicU32::new(0),
        scrubber: RwLock::new(Scrubber::detect()),
    };
    if STATE.set(state).is_err() {
        return false;
    }
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        on_panic(info);
        previous(info);
    }));
    sys::install_exception_filter(on_exception);
    true
}

/// Turns saving reports on or off. The person's choice takes effect at once, without a restart. Prefer
/// [`apply`], which also checks that they said yes to the consent screen.
pub fn set_enabled(enabled: bool) {
    if let Some(state) = STATE.get() {
        state.enabled.store(enabled, Ordering::Relaxed);
    }
}

/// Follows the person's settings: reports are saved only while [`Settings::saving_allowed`], that is while the
/// switch is on and they have said yes to the current consent wording. The app calls it at start-up and
/// whenever the settings change.
pub fn apply(settings: &Settings) {
    set_enabled(settings.saving_allowed());
}

/// Whether reports are being saved.
pub fn is_enabled() -> bool {
    STATE.get().is_some_and(|state| state.enabled.load(Ordering::Relaxed))
}

/// Also removes `text`, such as the open notebook's name or folder, from every report. Never pass note
/// content: the scrubber would keep a copy of it in memory.
pub fn add_private(text: &str) {
    if let Some(state) = STATE.get() {
        if let Ok(mut scrubber) = state.scrubber.write() {
            scrubber.add_private(text);
        }
    }
}

/// The store that reports are saved to, once [`install`] has run.
pub fn store() -> Option<CrashStore> {
    STATE.get().map(|state| state.store.clone())
}

fn on_panic(info: &PanicHookInfo<'_>) {
    let Some(turn) = Turn::begin() else { return };
    // Only a string literal can be kept. A message built at run time can hold note content.
    let message = info.payload().downcast_ref::<&'static str>().copied();
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
    let backtrace = std::backtrace::Backtrace::force_capture().to_string();
    turn.save(Capture {
        kind: Kind::Panic,
        message,
        location,
        exception_code: None,
        frames: sys::capture_frames(),
        backtrace: drop_panic_frames(&backtrace),
    });
}

fn on_exception(code: u32, address: usize) {
    let Some(turn) = Turn::begin() else { return };
    turn.save(exception_capture(code, address, sys::capture_frames()));
}

/// What an exception at `address` becomes: its code, the place it happened, and the stack.
fn exception_capture(code: u32, address: usize, stack: Vec<RawFrame>) -> Capture {
    let mut frames = vec![sys::frame_for(address)];
    frames.extend(stack);
    Capture {
        kind: Kind::Exception,
        message: None,
        location: None,
        exception_code: Some(code),
        frames,
        backtrace: String::new(),
    }
}

/// The right to save one report. It is given out only while reports are on, below the limit, and while no
/// other report is being written, and it gives the right back when dropped.
struct Turn(&'static State);

impl Turn {
    fn begin() -> Option<Turn> {
        let state = STATE.get()?;
        if !state.enabled.load(Ordering::Relaxed) || state.saved.load(Ordering::Relaxed) >= MAX_PER_RUN {
            return None;
        }
        if BUSY.swap(true, Ordering::Acquire) {
            return None;
        }
        state.saved.fetch_add(1, Ordering::Relaxed);
        Some(Turn(state))
    }

    fn save(&self, capture: Capture) {
        let state = self.0;
        // A lock held by the crashed thread must not stop the report, so a busy lock means a fresh scrubber.
        let scrubber = state
            .scrubber
            .try_read()
            .map(|s| s.clone())
            .unwrap_or_else(|_| Scrubber::detect());
        let time_unix = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let environment = Environment {
            app_version: state.app_version.clone(),
            os: state.os.clone(),
            time_unix,
        };
        let report = Report::build(capture, &environment, &scrubber);
        // Nothing more can be done about a report that can't be saved.
        let _ = state.store.save(&report);
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}

#[cfg(test)]
#[path = "hook_tests.rs"]
mod tests;
