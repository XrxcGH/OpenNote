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
    /// What each window refused last, for its "Close anyway".
    refusals: BTreeMap<String, Refusal>,
    /// The windows whose own close came while the app's exit waited. The exit closes them; if it is refused, their
    /// close is asked again rather than dropped.
    held: BTreeSet<String>,
}

/// The app's exit while it waits for its windows.
struct Pending {
    id: u64,
    reason: ExitReason,
    /// The windows that haven't answered yet.
    waiting: BTreeSet<String>,
    /// A window it waited for went without answering, so not every window agreed.
    lost: bool,
}

/// What a window refused: the app's exit, or its own close.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    App,
    Window,
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
    /// Every window answered and none refused: the app exits. `answered` is false when a window it waited for went
    /// without answering, so its pages may not have saved, and an update mustn't apply.
    Exit { reason: ExitReason, answered: bool },
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
        inner.pending = Some(Pending {
            id,
            reason,
            waiting,
            lost: false,
        });
        Some(Begun { id, windows })
    }

    /// A window answered `app://before-exit`. While the app exits, a window's answer is its answer to the exit,
    /// even when it was asked to close on its own first: the exit closes it too.
    pub fn answer(&self, window: &str, ok: bool) -> Answer {
        let mut inner = self.inner();
        let for_exit = inner
            .pending
            .as_ref()
            .is_some_and(|pending| pending.waiting.contains(window));
        if !for_exit {
            if inner.closing.remove(window).is_none() {
                return Answer::Stale;
            }
            if ok {
                return Answer::CloseWindow;
            }
            inner.refusals.insert(window.to_owned(), Refusal::Window);
            return Answer::KeepWindow;
        }
        inner.closing.remove(window);
        let Some(pending) = inner.pending.as_mut() else {
            return Answer::Stale;
        };
        pending.waiting.remove(window);
        if !ok {
            inner.pending = None;
            inner.refusals.insert(window.to_owned(), Refusal::App);
            return Answer::Refused;
        }
        if !pending.waiting.is_empty() {
            return Answer::Wait;
        }
        let (reason, answered) = (pending.reason, !pending.lost);
        inner.pending = None;
        Answer::Exit { reason, answered }
    }

    /// The windows whose own close was held while an exit waited, which a refused exit asks again. A window that
    /// refused the exit itself is left out: it refused its close too, and its "Close anyway" says so.
    pub fn take_held(&self, refused_by: &str) -> Vec<String> {
        let mut inner = self.inner();
        let held = std::mem::take(&mut inner.held);
        held.into_iter().filter(|window| window != refused_by).collect()
    }

    /// What `window` refused last, which its "Close anyway" repeats. Each refusal is taken once.
    pub fn take_refusal(&self, window: &str) -> Option<Refusal> {
        self.inner().refusals.remove(window)
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
    /// A window that went without answering didn't agree, so an exit it ends counts as unanswered (see
    /// [`Answer::Exit`]), however the others answered.
    pub fn forget_window(&self, window: &str) -> Option<ExitReason> {
        let mut inner = self.inner();
        inner.ready.remove(window);
        inner.closing.remove(window);
        inner.refusals.remove(window);
        inner.held.remove(window);
        let pending = inner.pending.as_mut()?;
        if !pending.waiting.remove(window) {
            return None;
        }
        pending.lost = true;
        if !pending.waiting.is_empty() {
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
        if inner.pending.is_some() {
            inner.held.insert(window.to_owned());
            return WindowClose::Hold;
        }
        if inner.closing.contains_key(window) {
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

/// What the handshakes do to the app's windows. The app's handle does it for real, and the tests record it, so the
/// wiring of closes, answers, and windows that go runs without a Tauri runtime.
pub(crate) trait Shell: Clone + Send + 'static {
    /// Runs `work` on the handshakes' state.
    fn exits<R>(&self, work: impl FnOnce(&ExitState) -> R) -> R;
    /// The labels of the open windows.
    fn windows(&self) -> Vec<String>;
    /// Sends `app://before-exit` with `reason` to one window.
    fn ask(&self, window: &str, reason: ExitReason);
    /// Asks a window to close, which runs its close through [`window_close_requested`].
    fn close(&self, window: &str);
    /// Closes a window at once, without asking it.
    fn destroy(&self, window: &str);
    /// Brings a window to the front.
    fn focus(&self, window: &str);
    /// Runs `work` after `delay`, off this thread.
    fn after(&self, delay: Duration, work: impl FnOnce() + Send + 'static);
    /// A window went: what it held in Rust is let go, such as the page sessions it left open.
    fn release(&self, window: &str);
    /// Saves, starts a planned process, and exits. See [`finish`].
    fn finish(&self, reason: ExitReason, answered: bool);
}

impl Shell for AppHandle {
    fn exits<R>(&self, work: impl FnOnce(&ExitState) -> R) -> R {
        work(&self.state::<ExitState>())
    }

    fn windows(&self) -> Vec<String> {
        self.webview_windows().into_keys().collect()
    }

    fn ask(&self, window: &str, reason: ExitReason) {
        if let Err(error) = self.emit_to(window, events::APP_BEFORE_EXIT, reason) {
            log::warn!("Couldn't send {} to {window}: {error}", events::APP_BEFORE_EXIT);
        }
    }

    fn close(&self, window: &str) {
        if let Some(open) = self.get_webview_window(window) {
            if let Err(error) = open.close() {
                log::warn!("Couldn't close the {window} window: {error}");
            }
        }
    }

    fn destroy(&self, window: &str) {
        if let Some(open) = self.get_webview_window(window) {
            if let Err(error) = open.destroy() {
                log::warn!("Couldn't close the {window} window: {error}");
            }
        }
    }

    fn focus(&self, window: &str) {
        if let Some(open) = self.get_webview_window(window) {
            let _ = open.unminimize();
            let _ = open.show();
            let _ = open.set_focus();
        }
    }

    fn after(&self, delay: Duration, work: impl FnOnce() + Send + 'static) {
        thread::spawn(move || {
            thread::sleep(delay);
            work();
        });
    }

    fn release(&self, window: &str) {
        if let Some(audio) = self.try_state::<crate::audio::AudioState>() {
            audio.forget_window(window);
        }
        let Some(bridge) = self.try_state::<crate::core_bridge::CoreBridge>() else {
            return;
        };
        // Retired now, so a window opened again with this label keeps its own sessions, while the old ones close as
        // soon as the bridge is free.
        let gone = bridge.window_went(window);
        let app = self.clone();
        thread::spawn(move || {
            let closed = app.state::<crate::core_bridge::CoreBridge>().close_window(&gone);
            if closed > 0 {
                log::debug!("Closed {closed} page sessions the {} window left open.", gone.label);
            }
        });
    }

    fn finish(&self, reason: ExitReason, answered: bool) {
        finish(self, reason, answered);
    }
}

/// Starts the exit handshake (section 8.7): holds the close, tells every window whose interface listens why, and
/// waits for all their answers for up to 3 s (1 s when Windows is ending the session). Every way of closing the
/// app comes through here. Each window flushes its own pages, so asking only the main window would lose what a
/// page window hadn't sent yet.
pub fn request_exit(app: &AppHandle, reason: ExitReason) {
    begin_exit(app, reason);
}

/// [`request_exit`] on any shell.
pub(crate) fn begin_exit<S: Shell>(shell: &S, reason: ExitReason) {
    let open = shell.windows();
    let Some(begun) = shell.exits(|state| state.begin(reason, open)) else {
        log::debug!("Already closing, so {reason:?} was ignored.");
        return;
    };
    // Before the first paint the interface has nothing to save and isn't listening.
    if begun.windows.is_empty() {
        if let Some(reason) = shell.exits(|state| state.expire(begun.id)) {
            shell.finish(reason, false);
        }
        return;
    }
    for label in &begun.windows {
        shell.ask(label, reason);
    }
    let timer = shell.clone();
    let id = begun.id;
    shell.after(timeout_for(reason), move || {
        if let Some(reason) = timer.exits(|state| state.expire(id)) {
            log::warn!("The interface didn't answer the exit request in time, so OpenNote exits without it.");
            timer.finish(reason, false);
        }
    });
}

/// Keeps a window beside the main one (a page, quick capture, or a tool) in the handshake. Its close asks only
/// that window to save, as the app's exit asks every window, and waits for it. A window that went is no longer
/// waited for, and the page sessions it left open close.
pub fn watch_window(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            if window_close_requested(&app, &label) {
                api.prevent_close();
            }
        }
        WindowEvent::Destroyed => window_destroyed(&app, &label),
        _ => {}
    });
}

/// A window beside the main one was asked to close. Returns whether the close waits: for the window's answer,
/// which closes it ([`exit_answered`]), or for the time to run out, which closes it anyway.
pub(crate) fn window_close_requested<S: Shell>(shell: &S, label: &str) -> bool {
    match shell.exits(|state| state.begin_window_close(label)) {
        WindowClose::Now => false,
        WindowClose::Hold => true,
        WindowClose::Ask(id) => {
            shell.ask(label, ExitReason::Close);
            let timer = shell.clone();
            let label = label.to_owned();
            shell.after(EXIT_TIMEOUT, move || {
                if timer.exits(|state| state.expire_window_close(&label, id)) {
                    log::warn!("The {label} window didn't answer its close in time, so it closes without it.");
                    timer.destroy(&label);
                }
            });
            true
        }
    }
}

/// A window beside the main one went: what it held is let go, and the exit stops waiting for it. An exit it was
/// the last one waited for goes ahead as unanswered, as that window never saved.
pub(crate) fn window_destroyed<S: Shell>(shell: &S, label: &str) {
    shell.release(label);
    if let Some(reason) = shell.exits(|state| state.forget_window(label)) {
        shell.finish(reason, false);
    }
}

/// A window's answer to `app://before-exit`, as [`app_exit_ready`] gets it.
pub(crate) fn exit_answered<S: Shell>(shell: &S, label: &str, result: &ExitResult) {
    match shell.exits(|state| state.answer(label, result.ok)) {
        Answer::Exit { reason, answered } => shell.finish(reason, answered),
        Answer::Refused => {
            log::info!(
                "The {label} window kept the app open: {}",
                result.reason.as_deref().unwrap_or("no reason given")
            );
            shell.exits(ExitState::cancel_relaunch);
            // A window closed while the exit waited had its close held for the exit, which won't come now.
            for window in shell.exits(|state| state.take_held(label)) {
                shell.close(&window);
            }
            // That window says why, with "Close anyway". The person closed another window, so it comes forward.
            if label != window::MAIN {
                shell.focus(label);
            }
        }
        Answer::CloseWindow => shell.destroy(label),
        Answer::KeepWindow | Answer::Wait | Answer::Stale => {}
    }
}

/// "Close anyway" in a window that refused repeats what it refused: the app's exit is asked again, from whichever
/// window refused it, and a window's own close closes that window.
pub(crate) fn close_anyway<S: Shell>(shell: &S, label: &str) {
    match shell.exits(|state| state.take_refusal(label)) {
        Some(Refusal::App) => begin_exit(shell, ExitReason::Close),
        Some(Refusal::Window) => shell.close(label),
        None if label == window::MAIN => begin_exit(shell, ExitReason::Close),
        None => shell.close(label),
    }
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
    exit_answered(&app, window.label(), &result);
    Ok(())
}

/// "Close anyway" from the toast of a window that refused: repeats the close it refused. See [`close_anyway`].
#[tauri::command]
pub fn app_close_anyway(app: AppHandle, window: WebviewWindow) -> IpcResult<()> {
    close_anyway(&app, window.label());
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
        assert_eq!(
            state.answer("main", true),
            Answer::Exit {
                reason: ExitReason::Close,
                answered: true
            }
        );
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
        assert_eq!(
            state.answer("page-p1", true),
            Answer::Exit {
                reason: ExitReason::Close,
                answered: true
            }
        );
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

    /// A shell that records what the handshakes do, with timers the test runs by hand.
    #[derive(Clone, Default)]
    struct Fake(Arc<FakeInner>);

    type Timer = Box<dyn FnOnce() + Send>;

    #[derive(Default)]
    struct FakeInner {
        state: ExitState,
        open: Mutex<Vec<String>>,
        done: Mutex<Vec<String>>,
        timers: Mutex<Vec<Timer>>,
    }

    impl Fake {
        /// The app with these windows open and listening.
        fn with(windows: &[&str]) -> Fake {
            let fake = Fake::default();
            for window in windows {
                fake.0.state.mark_ui_ready(window);
                fake.0.open.lock().unwrap().push((*window).to_owned());
            }
            fake
        }

        fn note(&self, what: String) {
            self.0.done.lock().unwrap().push(what);
        }

        /// What happened since the last call.
        fn take(&self) -> Vec<String> {
            std::mem::take(&mut *self.0.done.lock().unwrap())
        }

        /// Lets the time run out for every timer started so far.
        fn run_timers(&self) {
            let timers = std::mem::take(&mut *self.0.timers.lock().unwrap());
            for timer in timers {
                timer();
            }
        }

        /// The window answers, as app_exit_ready does.
        fn answer(&self, window: &str, ok: bool) {
            let result = ExitResult {
                ok,
                reason: (!ok).then(|| "errors.recording".to_owned()),
            };
            exit_answered(self, window, &result);
        }

        /// The window's webview goes, as Tauri's Destroyed event says.
        fn gone(&self, window: &str) {
            self.0.open.lock().unwrap().retain(|open| open != window);
            window_destroyed(self, window);
        }
    }

    impl Shell for Fake {
        fn exits<R>(&self, work: impl FnOnce(&ExitState) -> R) -> R {
            work(&self.0.state)
        }
        fn windows(&self) -> Vec<String> {
            self.0.open.lock().unwrap().clone()
        }
        fn ask(&self, window: &str, reason: ExitReason) {
            self.note(format!("ask {window} {reason:?}"));
        }
        fn close(&self, window: &str) {
            self.note(format!("close {window}"));
        }
        fn destroy(&self, window: &str) {
            self.note(format!("destroy {window}"));
        }
        fn focus(&self, window: &str) {
            self.note(format!("focus {window}"));
        }
        fn after(&self, _delay: Duration, work: impl FnOnce() + Send + 'static) {
            self.0.timers.lock().unwrap().push(Box::new(work));
        }
        fn release(&self, window: &str) {
            self.note(format!("release {window}"));
        }
        fn finish(&self, reason: ExitReason, answered: bool) {
            self.note(format!("finish {reason:?} answered={answered}"));
        }
    }

    fn says(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|line| (*line).to_owned()).collect()
    }

    /// F3-3: a page window's close tore its webview down with its last typing unsent. The close is held, the window
    /// is asked, it closes when it agrees, and what it held is let go when it has gone.
    #[test]
    fn a_page_window_close_asks_it_closes_it_when_it_agrees_and_lets_its_sessions_go() {
        let fake = Fake::with(&["main", "page-p1"]);
        assert!(window_close_requested(&fake, "page-p1"), "the close waits");
        assert_eq!(fake.take(), says(&["ask page-p1 Close"]));
        assert!(window_close_requested(&fake, "page-p1"), "a second click waits too");
        assert_eq!(fake.take(), says(&[]), "and doesn't ask again");
        fake.answer("page-p1", true);
        assert_eq!(fake.take(), says(&["destroy page-p1"]));
        fake.gone("page-p1");
        assert_eq!(fake.take(), says(&["release page-p1"]));
        fake.run_timers();
        assert_eq!(fake.take(), says(&[]), "the timer finds the close done");
        assert!(
            !window_close_requested(&fake, "tool-timers"),
            "a window not listening closes at once"
        );
    }

    #[test]
    fn a_page_window_that_does_not_answer_its_close_closes_when_the_time_runs_out() {
        let fake = Fake::with(&["main", "page-p1"]);
        assert!(window_close_requested(&fake, "page-p1"));
        fake.take();
        fake.run_timers();
        assert_eq!(fake.take(), says(&["destroy page-p1"]));
        fake.answer("page-p1", true);
        assert_eq!(fake.take(), says(&[]), "a late answer finds nothing to do");
    }

    /// F3-3: the exit asked only the main window, so a page window's unsent typing died with the process.
    #[test]
    fn the_app_exit_asks_every_listening_window_and_exits_when_all_agree() {
        let fake = Fake::with(&["main", "page-p1", "capture"]);
        fake.0.open.lock().unwrap().push("tool-timers".into());
        begin_exit(&fake, ExitReason::Close);
        assert_eq!(
            fake.take(),
            says(&["ask capture Close", "ask main Close", "ask page-p1 Close"])
        );
        fake.answer("main", true);
        fake.answer("capture", true);
        assert_eq!(fake.take(), says(&[]));
        fake.answer("page-p1", true);
        assert_eq!(fake.take(), says(&["finish Close answered=true"]));
        fake.run_timers();
        assert_eq!(fake.take(), says(&[]), "the timer finds the exit done");
    }

    /// A window that died during the exit never saved, so the exit it ends mustn't count as agreed: an update
    /// applies only on an agreed exit.
    #[test]
    fn a_window_that_dies_during_the_exit_leaves_it_unanswered() {
        let fake = Fake::with(&["main", "page-p1"]);
        begin_exit(&fake, ExitReason::RestartToUpdate);
        fake.take();
        fake.answer("main", true);
        fake.gone("page-p1");
        assert_eq!(
            fake.take(),
            says(&["release page-p1", "finish RestartToUpdate answered=false"])
        );

        let fake = Fake::with(&["main", "page-p1"]);
        begin_exit(&fake, ExitReason::RestartToUpdate);
        fake.gone("page-p1");
        fake.take();
        fake.answer("main", true);
        assert_eq!(
            fake.take(),
            says(&["finish RestartToUpdate answered=false"]),
            "however the others answer after it"
        );
    }

    /// A page window that refuses the app's exit says why in its own toast, so it comes to the front, and its
    /// "Close anyway" asks for the app's exit again, not for that window alone.
    #[test]
    fn a_page_window_refusing_the_exit_comes_forward_and_its_close_anyway_retries_the_exit() {
        let fake = Fake::with(&["main", "page-p1"]);
        begin_exit(&fake, ExitReason::Close);
        fake.take();
        fake.answer("main", true);
        fake.answer("page-p1", false);
        assert_eq!(fake.take(), says(&["focus page-p1"]));
        fake.run_timers();
        assert_eq!(fake.take(), says(&[]), "the refusal ended the exit");
        close_anyway(&fake, "page-p1");
        assert_eq!(fake.take(), says(&["ask main Close", "ask page-p1 Close"]));
        fake.answer("main", true);
        fake.answer("page-p1", true);
        assert_eq!(fake.take(), says(&["finish Close answered=true"]));
    }

    /// A page window closed while the app's exit waited had its close held for the exit; when the exit was refused,
    /// that close was dropped and the window stayed open.
    #[test]
    fn a_window_closed_while_a_refused_exit_waited_is_asked_to_close_again() {
        let fake = Fake::with(&["main", "page-p1", "page-p2"]);
        begin_exit(&fake, ExitReason::Close);
        assert!(window_close_requested(&fake, "page-p1"), "held for the exit");
        assert!(window_close_requested(&fake, "page-p2"), "held for the exit");
        fake.take();
        fake.answer("page-p1", true);
        fake.answer("page-p2", false);
        assert_eq!(
            fake.take(),
            says(&["close page-p1", "focus page-p2"]),
            "the window that refused keeps its close refused, the other is asked again"
        );
        assert!(window_close_requested(&fake, "page-p1"));
        assert_eq!(fake.take(), says(&["ask page-p1 Close"]));
        fake.answer("page-p1", true);
        assert_eq!(fake.take(), says(&["destroy page-p1"]));
    }

    #[test]
    fn close_anyway_after_a_window_refused_its_own_close_closes_that_window() {
        let fake = Fake::with(&["main", "page-p1"]);
        window_close_requested(&fake, "page-p1");
        fake.answer("page-p1", false);
        assert_eq!(
            fake.take(),
            says(&["ask page-p1 Close"]),
            "its own close: nothing comes forward"
        );
        close_anyway(&fake, "page-p1");
        assert_eq!(fake.take(), says(&["close page-p1"]));
        // The main window's own refusal retries the app's exit, as its caption button does.
        begin_exit(&fake, ExitReason::Close);
        fake.answer("main", false);
        fake.take();
        close_anyway(&fake, "main");
        assert_eq!(fake.take(), says(&["ask main Close", "ask page-p1 Close"]));
    }

    #[test]
    fn a_window_asked_to_close_on_its_own_answers_the_exit_that_starts_meanwhile() {
        let fake = Fake::with(&["main", "page-p1"]);
        window_close_requested(&fake, "page-p1");
        begin_exit(&fake, ExitReason::Close);
        fake.take();
        fake.answer("page-p1", true);
        fake.answer("main", true);
        assert_eq!(fake.take(), says(&["finish Close answered=true"]));
        fake.answer("page-p1", true);
        assert_eq!(fake.take(), says(&[]), "its second answer is stale");
    }
}
