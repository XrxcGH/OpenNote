//! The app's lifecycle after start-up (ARCHITECTURE.md sections 8.2 and 8.7): the show strategy, first paint,
//! `app_ready`, and the exit handshake that every way of closing goes through (ADR 0015).

use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

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

/// The handshakes in progress, in managed state: the app's exit, which asks every window whose interface listens,
/// and the closes of single windows beside the main one, which ask only that window. One exit runs at a time.
#[derive(Default)]
pub struct ExitState {
    inner: Mutex<ExitInner>,
}

#[derive(Default)]
struct ExitInner {
    next_id: u64,
    pending: Option<Pending>,
    planned_relaunch: Option<Relaunch>,
    /// The windows whose interface has painted, so listens for the exit event.
    ready: BTreeSet<String>,
    /// The windows asked to close on their own, with their handshake's id.
    closing: BTreeMap<String, u64>,
}

/// The app's exit while it waits for its windows.
struct Pending {
    id: u64,
    reason: ExitReason,
    /// The windows that haven't answered yet.
    waiting: BTreeSet<String>,
}

/// An exit that began: its id and the windows to ask. No windows means no interface listens yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Begun {
    pub id: u64,
    pub windows: Vec<String>,
}

/// What a window's answer to `app://before-exit` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    /// Every window agreed: the app exits.
    Exit(ExitReason),
    /// The window agreed, and others still have to.
    Wait,
    /// The window refused, so the app stays open.
    Refused,
    /// The window agreed to close on its own.
    CloseWindow,
    /// The window refused to close on its own.
    KeepWindow,
    /// Nothing asked this window, or the question ran out of time.
    Stale,
}

/// What a close request for a window beside the main one does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowClose {
    /// Its interface isn't listening, so it has nothing to save: it closes now.
    Now,
    /// Ask it with `app://before-exit` and wait for handshake `id`.
    Ask(u64),
    /// It is already being asked, or the app is exiting: the request waits for that.
    Hold,
}

impl ExitState {
    fn inner(&self) -> MutexGuard<'_, ExitInner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Starts the app's exit, asking those of the `open` windows whose interface listens. Returns `None` when an
    /// exit is already running, except that Windows ending the session takes over from a slower one.
    pub fn begin(&self, reason: ExitReason, open: impl IntoIterator<Item = String>) -> Option<Begun> {
        let mut inner = self.inner();
        let taken = match &inner.pending {
            None => false,
            Some(current) => current.reason == ExitReason::SessionEnd || reason != ExitReason::SessionEnd,
        };
        if taken {
            return None;
        }
        inner.next_id += 1;
        let id = inner.next_id;
        let waiting: BTreeSet<String> = open.into_iter().filter(|label| inner.ready.contains(label)).collect();
        let windows = waiting.iter().cloned().collect();
        inner.pending = Some(Pending { id, reason, waiting });
        Some(Begun { id, windows })
    }

    /// A window answered `app://before-exit`.
    pub fn answer(&self, window: &str, ok: bool) -> Answer {
        let mut inner = self.inner();
        if inner.closing.remove(window).is_some() {
            return if ok { Answer::CloseWindow } else { Answer::KeepWindow };
        }
        let Some(pending) = inner.pending.as_mut() else {
            return Answer::Stale;
        };
        if !pending.waiting.remove(window) {
            return Answer::Stale;
        }
        if !ok {
            inner.pending = None;
            return Answer::Refused;
        }
        if !pending.waiting.is_empty() {
            return Answer::Wait;
        }
        let reason = pending.reason;
        inner.pending = None;
        Answer::Exit(reason)
    }

    /// The time ran out for exit `id`. Returns the reason if it was still waiting.
    pub fn expire(&self, id: u64) -> Option<ExitReason> {
        let mut inner = self.inner();
        match &inner.pending {
            Some(pending) if pending.id == id => {
                let reason = pending.reason;
                inner.pending = None;
                Some(reason)
            }
            _ => None,
        }
    }

    /// A window went. The exit stops waiting for it, and returns the reason when it was the last one waited for.
    pub fn forget_window(&self, window: &str) -> Option<ExitReason> {
        let mut inner = self.inner();
        inner.ready.remove(window);
        inner.closing.remove(window);
        let pending = inner.pending.as_mut()?;
        if !pending.waiting.remove(window) || !pending.waiting.is_empty() {
            return None;
        }
        let reason = pending.reason;
        inner.pending = None;
        Some(reason)
    }

    /// Someone asked to close a window beside the main one.
    pub fn begin_window_close(&self, window: &str) -> WindowClose {
        let mut inner = self.inner();
        if !inner.ready.contains(window) {
            return WindowClose::Now;
        }
        if inner.pending.is_some() || inner.closing.contains_key(window) {
            return WindowClose::Hold;
        }
        inner.next_id += 1;
        let id = inner.next_id;
        inner.closing.insert(window.to_owned(), id);
        WindowClose::Ask(id)
    }

    /// The time ran out for a window's close `id`. True if it was still waiting, so the window closes anyway.
    pub fn expire_window_close(&self, window: &str, id: u64) -> bool {
        let mut inner = self.inner();
        if inner.closing.get(window) == Some(&id) {
            inner.closing.remove(window);
            return true;
        }
        false
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

    /// The window's page has painted, so its interface is listening for the exit event.
    pub fn mark_ui_ready(&self, window: &str) {
        self.inner().ready.insert(window.to_owned());
    }
}

/// Starts the exit handshake (section 8.7): holds the close, tells every window whose interface listens why, and
/// waits for all their answers for up to 3 s (1 s when Windows is ending the session). Every way of closing the
/// app comes through here. Each window flushes its own pages, so asking only the main window would lose what a
/// page window hadn't sent yet.
pub fn request_exit(app: &AppHandle, reason: ExitReason) {
    let state = app.state::<ExitState>();
    let open: Vec<String> = app.webview_windows().into_keys().collect();
    let Some(begun) = state.begin(reason, open) else {
        log::debug!("Already closing, so {reason:?} was ignored.");
        return;
    };
    // Before the first paint the interface has nothing to save and isn't listening.
    if begun.windows.is_empty() {
        if let Some(reason) = state.expire(begun.id) {
            finish(app, reason, false);
        }
        return;
    }
    for label in &begun.windows {
        if let Err(error) = app.emit_to(label.as_str(), events::APP_BEFORE_EXIT, reason) {
            log::warn!("Couldn't send {} to {label}: {error}", events::APP_BEFORE_EXIT);
        }
    }
    let app = app.clone();
    let id = begun.id;
    thread::spawn(move || {
        thread::sleep(timeout_for(reason));
        if let Some(reason) = app.state::<ExitState>().expire(id) {
            log::warn!("The interface didn't answer the exit request in time, so OpenNote exits without it.");
            finish(&app, reason, false);
        }
    });
}

/// Keeps a window beside the main one (a page, quick capture, or a tool) in the handshake. Its close asks only
/// that window to save, as the app's exit asks every window, and waits for it. A window that went is no longer
/// waited for, and the page sessions it left open close.
pub fn watch_window(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    let watched = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => match app.state::<ExitState>().begin_window_close(&label) {
            WindowClose::Now => {}
            WindowClose::Hold => api.prevent_close(),
            WindowClose::Ask(id) => {
                api.prevent_close();
                if let Err(error) = app.emit_to(label.as_str(), events::APP_BEFORE_EXIT, ExitReason::Close) {
                    log::warn!("Couldn't send {} to {label}: {error}", events::APP_BEFORE_EXIT);
                }
                let app = app.clone();
                let label = label.clone();
                let window = watched.clone();
                thread::spawn(move || {
                    thread::sleep(EXIT_TIMEOUT);
                    if app.state::<ExitState>().expire_window_close(&label, id) {
                        log::warn!("The {label} window didn't answer its close in time, so it closes without it.");
                        let _ = window.destroy();
                    }
                });
            }
        },
        WindowEvent::Destroyed => window_gone(&app, &label),
        _ => {}
    });
}

/// A window beside the main one went: the exit stops waiting for it, and its page sessions close.
fn window_gone(app: &AppHandle, label: &str) {
    if let Some(reason) = app.state::<ExitState>().forget_window(label) {
        finish(app, reason, true);
        return;
    }
    let app = app.clone();
    let label = label.to_owned();
    thread::spawn(move || {
        let closed = app.state::<crate::core_bridge::CoreBridge>().close_window(&label);
        if closed > 0 {
            log::debug!("Closed {closed} page sessions the {label} window left open.");
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
/// Every window's interface calls it, as its exit handshake listens from then on. Only the main window shows.
#[tauri::command]
pub fn app_first_paint(app: AppHandle, window: WebviewWindow) -> IpcResult<()> {
    app.state::<ExitState>().mark_ui_ready(window.label());
    if window.label() == window::MAIN {
        window::show(&app);
    }
    Ok(())
}

/// The last page is on screen.
#[tauri::command]
pub fn app_ready(app: AppHandle, window: WebviewWindow, timings: ReadyTimings) -> IpcResult<()> {
    log::debug!(
        "Ready {} ms after the first paint",
        timings.page_ready_epoch_ms - timings.first_paint_epoch_ms
    );
    app.state::<ExitState>().mark_ui_ready(window.label());
    app.state::<Hooks>().0.on_ready(&app);
    Ok(())
}

/// A window's answer to `app://before-exit`. The app exits once every window it asked agreed, and a refusal keeps
/// it open. A window asked to close on its own closes when it agrees.
#[tauri::command]
pub fn app_exit_ready(app: AppHandle, window: WebviewWindow, result: ExitResult) -> IpcResult<()> {
    let state = app.state::<ExitState>();
    match state.answer(window.label(), result.ok) {
        Answer::Exit(reason) => finish(&app, reason, true),
        Answer::Refused => {
            log::info!(
                "The {} window kept the app open: {}",
                window.label(),
                result.reason.as_deref().unwrap_or("no reason given")
            );
            state.cancel_relaunch();
        }
        Answer::CloseWindow => window.destroy()?,
        Answer::KeepWindow | Answer::Wait | Answer::Stale => {}
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

    /// An exit state with these windows listening.
    fn listening(windows: &[&str]) -> ExitState {
        let state = ExitState::default();
        for window in windows {
            state.mark_ui_ready(window);
        }
        state
    }

    fn open(windows: &[&str]) -> Vec<String> {
        windows.iter().map(|window| (*window).to_owned()).collect()
    }

    #[test]
    fn runs_one_handshake_at_a_time() {
        let state = listening(&["main"]);
        let first = state
            .begin(ExitReason::Close, open(&["main"]))
            .expect("the first starts");
        assert_eq!(state.begin(ExitReason::Close, open(&["main"])), None);
        assert_eq!(state.begin(ExitReason::RestartToUpdate, open(&["main"])), None);
        assert_eq!(state.answer("main", true), Answer::Exit(ExitReason::Close));
        // After the answer, a later close may start again.
        let second = state.begin(ExitReason::Close, open(&["main"])).expect("starts again");
        assert_ne!(second.id, first.id);
    }

    #[test]
    fn a_refusal_keeps_the_window_and_the_old_timer_does_nothing() {
        let state = listening(&["main"]);
        let begun = state.begin(ExitReason::Close, open(&["main"])).expect("starts");
        assert_eq!(state.answer("main", false), Answer::Refused);
        assert_eq!(state.expire(begun.id), None);
        let later = state.begin(ExitReason::Close, open(&["main"])).expect("starts again");
        assert_eq!(
            state.expire(begun.id),
            None,
            "a stale timer can't end a newer handshake"
        );
        assert_eq!(state.expire(later.id), Some(ExitReason::Close));
    }

    #[test]
    fn a_hung_interface_times_out_once() {
        let state = listening(&["main"]);
        let begun = state.begin(ExitReason::Close, open(&["main"])).expect("starts");
        assert_eq!(state.expire(begun.id), Some(ExitReason::Close));
        assert_eq!(state.expire(begun.id), None);
        assert_eq!(
            state.answer("main", true),
            Answer::Stale,
            "a late answer finds nothing to finish"
        );
    }

    #[test]
    fn windows_ending_the_session_takes_over_from_a_slower_handshake() {
        let state = listening(&["main"]);
        state
            .begin(ExitReason::RestartToUpdate, open(&["main"]))
            .expect("starts");
        assert!(state.begin(ExitReason::SessionEnd, open(&["main"])).is_some());
        assert_eq!(state.begin(ExitReason::Close, open(&["main"])), None);
        assert_eq!(state.begin(ExitReason::SessionEnd, open(&["main"])), None);
    }

    #[test]
    fn an_interface_that_has_not_painted_is_not_asked() {
        let state = ExitState::default();
        let begun = state.begin(ExitReason::Close, open(&["main"])).expect("starts");
        assert!(begun.windows.is_empty());
    }

    /// F3-3: the exit asked only the main window, so a page window's unsent typing died with the process.
    #[test]
    fn the_exit_asks_every_listening_window_and_waits_for_all_of_them() {
        let state = listening(&["main", "page-p1", "capture"]);
        let begun = state
            .begin(ExitReason::Close, open(&["main", "page-p1", "capture", "tool-timers"]))
            .expect("starts");
        assert_eq!(
            begun.windows,
            open(&["capture", "main", "page-p1"]),
            "a tool window has nothing to save"
        );
        assert_eq!(state.answer("main", true), Answer::Wait);
        assert_eq!(state.answer("capture", true), Answer::Wait);
        assert_eq!(state.answer("main", true), Answer::Stale, "one answer per window");
        assert_eq!(state.answer("page-p1", true), Answer::Exit(ExitReason::Close));
    }

    #[test]
    fn one_window_refusing_keeps_the_app_open() {
        let state = listening(&["main", "page-p1"]);
        state
            .begin(ExitReason::Close, open(&["main", "page-p1"]))
            .expect("starts");
        assert_eq!(state.answer("main", true), Answer::Wait);
        assert_eq!(state.answer("page-p1", false), Answer::Refused);
        assert!(
            state.begin(ExitReason::Close, open(&["main"])).is_some(),
            "a later close may start"
        );
    }

    #[test]
    fn a_window_that_goes_during_the_exit_is_not_waited_for() {
        let state = listening(&["main", "page-p1"]);
        state
            .begin(ExitReason::Close, open(&["main", "page-p1"]))
            .expect("starts");
        assert_eq!(state.answer("main", true), Answer::Wait);
        assert_eq!(state.forget_window("page-p1"), Some(ExitReason::Close));
        assert_eq!(state.forget_window("page-p1"), None);
    }

    /// F3-3: closing a page window tore its webview down at once, with the last typing still unsent.
    #[test]
    fn closing_a_page_window_asks_that_window_and_closes_it_when_it_agrees() {
        let state = listening(&["main", "page-p1"]);
        let WindowClose::Ask(id) = state.begin_window_close("page-p1") else {
            panic!("a listening window is asked before it closes");
        };
        assert_eq!(
            state.begin_window_close("page-p1"),
            WindowClose::Hold,
            "a second click waits for the first"
        );
        assert_eq!(state.answer("page-p1", true), Answer::CloseWindow);
        assert!(
            !state.expire_window_close("page-p1", id),
            "the timer finds nothing left to close"
        );
        assert!(matches!(state.begin_window_close("page-p1"), WindowClose::Ask(_)));
        assert_eq!(state.answer("page-p1", false), Answer::KeepWindow);
    }

    #[test]
    fn a_window_that_does_not_answer_its_close_closes_anyway_and_one_not_listening_closes_now() {
        let state = listening(&["page-p1"]);
        let WindowClose::Ask(id) = state.begin_window_close("page-p1") else {
            panic!("asked");
        };
        assert!(state.expire_window_close("page-p1", id));
        assert_eq!(state.answer("page-p1", true), Answer::Stale);
        assert_eq!(state.begin_window_close("tool-timers"), WindowClose::Now);
        state.forget_window("page-p1");
        assert_eq!(
            state.begin_window_close("page-p1"),
            WindowClose::Now,
            "a closed window stops listening"
        );
    }

    #[test]
    fn a_window_close_during_the_exit_waits_for_the_exit() {
        let state = listening(&["main", "page-p1"]);
        state
            .begin(ExitReason::Close, open(&["main", "page-p1"]))
            .expect("starts");
        assert_eq!(state.begin_window_close("page-p1"), WindowClose::Hold);
        assert_eq!(
            state.answer("page-p1", true),
            Answer::Wait,
            "its answer belongs to the exit"
        );
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
