//! The app's lifecycle after start-up (ARCHITECTURE.md sections 8.2 and 8.7): the show strategy, first paint,
//! `app_ready`, and the exit handshake that every way of closing goes through (ADR 0015).

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard, PoisonError,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{events, ipc::IpcResult, window};

/// How long the interface has to answer `app://before-exit`.
pub const EXIT_TIMEOUT: Duration = Duration::from_secs(3);

/// How long it has while Windows is ending the session.
pub const SESSION_END_TIMEOUT: Duration = Duration::from_secs(1);

/// How long a hidden window waits for the first paint before it shows anyway. Only the hidden show strategy
/// uses it; see [`SHOW_EARLY`].
pub const FIRST_PAINT_FALLBACK: Duration = Duration::from_millis(700);

/// The show strategy (ARCHITECTURE.md section 8.2). The window shows as soon as it's built, with `surface.app`
/// as both the window's and WebView2's background, so no white or wrong-theme frame should appear.
///
/// The alternative keeps it hidden until `app_first_paint`, with [`FIRST_PAINT_FALLBACK`]. A hidden WebView2 may
/// not run animation frames, so that costs up to the fallback. The frame-sampling spike that decides between
/// them hasn't run, so ADR 0015 records the early strategy as provisional.
pub const SHOW_EARLY: bool = true;

/// Why the app is closing, matching the interface's `ExitReason`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum ExitReason {
    Close,
    RestartToUpdate,
    GoBack,
    MoveApp,
    SessionEnd,
}

/// What to do once the handshake allows the exit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExitPlan {
    pub relaunch: Option<Relaunch>,
}

/// A process to start on the way out. The lifecycle adds `--wait-pid` with this process's id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relaunch {
    pub exe: PathBuf,
    pub args: Vec<String>,
}

/// Work other modules do at lifecycle points. The updater implements it.
pub trait LifecycleHooks: Send + Sync + 'static {
    /// The last page is on screen. The updater starts its healthy timer and its schedule.
    fn on_ready(&self, app: &AppHandle);
    /// The interface allowed the exit. The updater applies or swaps when the reason and policy allow it.
    fn on_exit(&self, app: &AppHandle, reason: ExitReason) -> ExitPlan;
}

/// The hooks in managed state.
pub struct Hooks(pub Arc<dyn LifecycleHooks>);

/// The interface's answer to `app://before-exit`: `{ ok: true }`, or `{ ok: false, reason }` with a message key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct ExitResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub reason: Option<String>,
}

/// When the page first painted and when the last page was ready, as epoch milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct ReadyTimings {
    pub first_paint_epoch_ms: f64,
    pub page_ready_epoch_ms: f64,
    pub page_id: Option<String>,
}

/// How long the handshake waits for the interface, for a reason.
pub fn timeout_for(reason: ExitReason) -> Duration {
    match reason {
        ExitReason::SessionEnd => SESSION_END_TIMEOUT,
        _ => EXIT_TIMEOUT,
    }
}

/// The handshake in progress, in managed state. Only one runs at a time.
#[derive(Default)]
pub struct ExitState {
    inner: Mutex<ExitInner>,
    ui_ready: AtomicBool,
}

#[derive(Default)]
struct ExitInner {
    next_id: u64,
    pending: Option<(u64, ExitReason)>,
    planned_relaunch: Option<Relaunch>,
}

impl ExitState {
    fn inner(&self) -> MutexGuard<'_, ExitInner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Starts a handshake, and returns its id. Returns `None` when one is already running, except that Windows
    /// ending the session takes over from a slower one.
    pub fn begin(&self, reason: ExitReason) -> Option<u64> {
        let mut inner = self.inner();
        let taken = match inner.pending {
            None => false,
            Some((_, current)) => current == ExitReason::SessionEnd || reason != ExitReason::SessionEnd,
        };
        if taken {
            return None;
        }
        inner.next_id += 1;
        let id = inner.next_id;
        inner.pending = Some((id, reason));
        Some(id)
    }

    /// The interface said `ok`: ends the handshake and returns why the app is closing.
    pub fn accept(&self) -> Option<ExitReason> {
        self.inner().pending.take().map(|(_, reason)| reason)
    }

    /// The interface refused: the window stays open.
    pub fn refuse(&self) -> Option<ExitReason> {
        self.accept()
    }

    /// The time ran out for handshake `id`. Returns the reason if it was still waiting.
    pub fn expire(&self, id: u64) -> Option<ExitReason> {
        let mut inner = self.inner();
        match inner.pending {
            Some((pending, reason)) if pending == id => {
                inner.pending = None;
                Some(reason)
            }
            _ => None,
        }
    }

    /// Remembers a process to start when the next exit completes, such as the moved copy of the app.
    pub fn plan_relaunch(&self, relaunch: Relaunch) {
        self.inner().planned_relaunch = Some(relaunch);
    }

    /// Forgets a planned relaunch, when the exit it was for didn't happen.
    pub fn cancel_relaunch(&self) {
        self.inner().planned_relaunch = None;
    }

    fn take_relaunch(&self) -> Option<Relaunch> {
        self.inner().planned_relaunch.take()
    }

    /// The page has painted, so the interface is listening for the exit event.
    pub fn mark_ui_ready(&self) {
        self.ui_ready.store(true, Ordering::Release);
    }

    fn ui_ready(&self) -> bool {
        self.ui_ready.load(Ordering::Acquire)
    }
}

/// Starts the exit handshake (section 8.7): holds the close, tells the interface why, and waits for its answer
/// for up to 3 s (1 s when Windows is ending the session). Every way of closing comes through here.
pub fn request_exit(app: &AppHandle, reason: ExitReason) {
    let state = app.state::<ExitState>();
    let Some(id) = state.begin(reason) else {
        log::debug!("Already closing, so {reason:?} was ignored.");
        return;
    };
    // Before the first paint the interface has nothing to save and isn't listening.
    if !state.ui_ready() {
        if let Some(reason) = state.expire(id) {
            finish(app, reason, false);
        }
        return;
    }
    if let Err(error) = app.emit_to(window::MAIN, events::APP_BEFORE_EXIT, reason) {
        log::warn!("Couldn't send {}: {error}", events::APP_BEFORE_EXIT);
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(timeout_for(reason));
        if let Some(reason) = app.state::<ExitState>().expire(id) {
            log::warn!("The interface didn't answer the exit request in time, so OpenNote exits without it.");
            finish(&app, reason, false);
        }
    });
}

/// Saves what Rust holds, starts the update's or the move's new process if there is one, and exits. `answered`
/// says the interface agreed, which is what allows an update to apply. A relaunch that Rust planned itself, such
/// as the moved copy, starts either way, except when Windows is ending the session.
fn finish(app: &AppHandle, reason: ExitReason, answered: bool) {
    window::placement::save_now(app);
    let state = app.state::<ExitState>();
    let session_end = reason == ExitReason::SessionEnd;
    let plan = if answered && !session_end {
        app.state::<Hooks>().0.on_exit(app, reason)
    } else {
        ExitPlan::default()
    };
    let planned = state.take_relaunch();
    crate::flush_files(app);
    if !session_end {
        if let Some(relaunch) = plan.relaunch.or(planned) {
            start_relaunch(&relaunch);
        }
    }
    app.exit(0);
}

/// Starts the new process with `--wait-pid` for this one, so it waits for this process to exit before it takes
/// the instance lock.
fn start_relaunch(relaunch: &Relaunch) {
    let result = std::process::Command::new(&relaunch.exe)
        .arg("--wait-pid")
        .arg(std::process::id().to_string())
        .args(&relaunch.args)
        .spawn();
    if let Err(error) = result {
        log::error!("Couldn't start {}: {error}", relaunch.exe.display());
    }
}

/// Holds a close and runs it through the handshake. `lib.rs` calls it for the window's close request, which is
/// what Alt+F4 and the taskbar send.
pub fn on_close_requested(app: &AppHandle) {
    request_exit(app, ExitReason::Close);
}

/// The page has painted its first frame. Under the hidden show strategy, this shows the window.
#[tauri::command]
pub fn app_first_paint(app: AppHandle) -> IpcResult<()> {
    app.state::<ExitState>().mark_ui_ready();
    window::show(&app);
    Ok(())
}

/// The last page is on screen.
#[tauri::command]
pub fn app_ready(app: AppHandle, timings: ReadyTimings) -> IpcResult<()> {
    log::debug!(
        "Ready {} ms after the first paint",
        timings.page_ready_epoch_ms - timings.first_paint_epoch_ms
    );
    app.state::<ExitState>().mark_ui_ready();
    app.state::<Hooks>().0.on_ready(&app);
    Ok(())
}

/// The interface's answer to `app://before-exit`: `ok` lets the exit finish, and a refusal keeps the window open.
#[tauri::command]
pub fn app_exit_ready(app: AppHandle, result: ExitResult) -> IpcResult<()> {
    let state = app.state::<ExitState>();
    if result.ok {
        if let Some(reason) = state.accept() {
            finish(&app, reason, true);
        }
    } else if state.refuse().is_some() {
        log::info!(
            "The interface kept the window open: {}",
            result.reason.as_deref().unwrap_or("no reason given")
        );
        state.cancel_relaunch();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_both_shapes_of_the_exit_answer() {
        let ok: ExitResult = serde_json::from_value(json!({ "ok": true })).expect("parses");
        assert_eq!(ok, ExitResult { ok: true, reason: None });
        let blocked: ExitResult =
            serde_json::from_value(json!({ "ok": false, "reason": "errors.recording" })).expect("parses");
        assert_eq!(blocked.reason.as_deref(), Some("errors.recording"));
    }

    #[test]
    fn names_exit_reasons_as_the_interface_does() {
        let names = [
            ExitReason::Close,
            ExitReason::RestartToUpdate,
            ExitReason::GoBack,
            ExitReason::MoveApp,
        ]
        .map(|reason| serde_json::to_value(reason).expect("serializes"));
        assert_eq!(
            names,
            [
                json!("close"),
                json!("restartToUpdate"),
                json!("goBack"),
                json!("moveApp")
            ]
        );
        assert_eq!(
            serde_json::to_value(ExitReason::SessionEnd).expect("serializes"),
            json!("sessionEnd")
        );
    }

    #[test]
    fn gives_windows_shutdown_one_second_and_everything_else_three() {
        assert_eq!(timeout_for(ExitReason::SessionEnd), Duration::from_secs(1));
        for reason in [
            ExitReason::Close,
            ExitReason::RestartToUpdate,
            ExitReason::GoBack,
            ExitReason::MoveApp,
        ] {
            assert_eq!(timeout_for(reason), Duration::from_secs(3));
        }
    }

    #[test]
    fn runs_one_handshake_at_a_time() {
        let state = ExitState::default();
        let first = state.begin(ExitReason::Close).expect("the first starts");
        assert_eq!(state.begin(ExitReason::Close), None);
        assert_eq!(state.begin(ExitReason::RestartToUpdate), None);
        assert_eq!(state.accept(), Some(ExitReason::Close));
        // After the answer, a later close may start again.
        assert!(state.begin(ExitReason::Close).is_some_and(|second| second != first));
    }

    #[test]
    fn a_refusal_keeps_the_window_and_the_old_timer_does_nothing() {
        let state = ExitState::default();
        let id = state.begin(ExitReason::Close).expect("starts");
        assert_eq!(state.refuse(), Some(ExitReason::Close));
        assert_eq!(state.expire(id), None);
        let later = state.begin(ExitReason::Close).expect("starts again");
        assert_eq!(state.expire(id), None, "a stale timer can't end a newer handshake");
        assert_eq!(state.expire(later), Some(ExitReason::Close));
    }

    #[test]
    fn a_hung_interface_times_out_once() {
        let state = ExitState::default();
        let id = state.begin(ExitReason::Close).expect("starts");
        assert_eq!(state.expire(id), Some(ExitReason::Close));
        assert_eq!(state.expire(id), None);
        assert_eq!(state.accept(), None, "a late answer finds nothing to finish");
    }

    #[test]
    fn windows_ending_the_session_takes_over_from_a_slower_handshake() {
        let state = ExitState::default();
        state.begin(ExitReason::RestartToUpdate).expect("starts");
        assert!(state.begin(ExitReason::SessionEnd).is_some());
        assert_eq!(state.begin(ExitReason::Close), None);
        assert_eq!(state.begin(ExitReason::SessionEnd), None);
    }

    #[test]
    fn remembers_a_planned_relaunch_until_the_exit_happens_or_is_cancelled() {
        let state = ExitState::default();
        let relaunch = Relaunch {
            exe: PathBuf::from("C:\\Programs\\OpenNote.exe"),
            args: vec!["--moved-from".into(), "C:\\Downloads\\OpenNote.exe".into()],
        };
        state.plan_relaunch(relaunch.clone());
        assert_eq!(state.take_relaunch(), Some(relaunch.clone()));
        assert_eq!(state.take_relaunch(), None);
        state.plan_relaunch(relaunch);
        state.cancel_relaunch();
        assert_eq!(state.take_relaunch(), None);
    }
}
