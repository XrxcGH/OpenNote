//! How a command takes the core and how long it waits for one that holds it, and the watchdog that names a
//! command holding it too long. The core serves one command at a time; beta 4's T2-3 was one that never
//! returned, with nothing to say so. This module bounds every wait for the core and reports the holder.

use std::{
    borrow::Cow,
    panic::Location,
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

use super::{Bridge, CoreBridge};

/// How long one command may hold the core before the log and the interface hear which one, and how often they
/// hear it again while it goes on. The core serves one command at a time, so a command that never returns stops
/// every later one; beta 4's T2-3 was such a stop, and nothing said what the core was doing. Now the watchdog
/// names the holder, the interface shows that the core isn't responding, and the exit goes on without it.
pub(super) const HELD_WARNING: Duration = Duration::from_secs(10);

/// How long a command waits for the core before it fails as [`BUSY`] instead of joining the queue behind a
/// command that never returns. The interface sends its commands over the webview's IPC channel, which carries
/// only a handful at a time: once that many wait on the core, nothing else gets through, not even the window's
/// Close or a log line (beta 4's T2-3). A command that fails after this wait keeps the channel open, and the
/// interface says the core isn't responding instead of saying "Saving" for the rest of the session. It is longer
/// than the core's journal `OPEN_TIMEOUT` (10 s, journal_thread.rs), the one bounded wait a command makes on
/// another thread while it holds the core, so a stuck journal open gives up before the commands behind it do.
///
/// The channel's limit stays: the interface keeps one edit in flight per page, but with many pages open their
/// edits and the tree's and search's commands can still fill the channel for one such wait while the core is
/// held. The watchdog reports the holder after [`HELD_WARNING`] all the same.
pub(super) const COMMAND_WAIT: Duration = Duration::from_secs(15);

/// The error code of a command that gave up waiting for the core. The message names what holds it.
pub const BUSY: &str = "coreBusy";

/// The event that says a command has held the core for too long, with `what` holds it and for how many
/// `seconds`, and the one that says the core answers again.
pub const STALLED_EVENT: &str = "core:stalled";
pub const RESPONSIVE_EVENT: &str = "core:responsive";

/// What holds the core now: since when, and which command.
pub(super) type Held = Arc<Mutex<Option<(Instant, Cow<'static, str>)>>>;

/// The door the commands queue at: whether the core is taken, and the condition the waiters sleep on until
/// the holder leaves. Serializing the commands here, not on the core's own lock, is what lets a command give up
/// after a bounded wait without polling.
pub(super) type Door = Arc<(Mutex<bool>, Condvar)>;

/// The taken core: the core's state, given back through the door when dropped (after the state's own guard).
pub(super) struct CoreGuard<'a> {
    state: MutexGuard<'a, Option<Bridge>>,
    _turn: Turn<'a>,
}

impl std::ops::Deref for CoreGuard<'_> {
    type Target = Option<Bridge>;
    fn deref(&self) -> &Option<Bridge> {
        &self.state
    }
}

impl std::ops::DerefMut for CoreGuard<'_> {
    fn deref_mut(&mut self) -> &mut Option<Bridge> {
        &mut self.state
    }
}

/// Frees the door and wakes the next waiter when a command returns, or unwinds.
struct Turn<'a>(&'a Door);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        let (taken, freed) = &**self.0;
        *taken.lock().unwrap_or_else(PoisonError::into_inner) = false;
        freed.notify_one();
    }
}

/// Clears the holder when the command returns, or unwinds.
pub(super) struct Holding(pub(super) Held);

impl Drop for Holding {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

/// Where a command was called from, for the watchdog: the file and line, with the workspace path trimmed.
pub(super) fn called_from(location: &Location<'_>) -> String {
    let file = location.file().replace('\\', "/");
    let file = file.rsplit_once("/src/").map_or(file.as_str(), |(_, rest)| rest);
    format!("the command at {file}:{}", location.line())
}

impl CoreBridge {
    /// Takes the core, waiting at most `timeout` for the command that holds it. `None` when it is still held
    /// after that. Commands queue at the door: a waiter sleeps on its condition variable until the holder
    /// leaves, not on a poll, so a contended command starts the moment the one before it ends.
    pub(super) fn take_core_within(&self, timeout: Duration) -> Option<CoreGuard<'_>> {
        let deadline = Instant::now().checked_add(timeout);
        let (taken, freed) = &*self.door;
        let mut taken = taken.lock().unwrap_or_else(PoisonError::into_inner);
        while *taken {
            let left = deadline.map_or(Duration::MAX, |d| d.saturating_duration_since(Instant::now()));
            if left.is_zero() {
                return None;
            }
            taken = freed
                .wait_timeout(taken, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        *taken = true;
        drop(taken);
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        Some(CoreGuard {
            state,
            _turn: Turn(&self.door),
        })
    }

    /// What holds the core now, for the log.
    pub(super) fn holder(&self) -> String {
        let holder = self.held.lock().unwrap_or_else(PoisonError::into_inner);
        holder
            .as_ref()
            .map_or("nothing holds it now".to_owned(), |(since, what)| {
                format!("{what} has held it for {} s", since.elapsed().as_secs())
            })
    }

    /// Starts the watchdog that reports a command holding the core for longer than `warn_after`: an error in
    /// the log, and [`STALLED_EVENT`] to the interface, again every `warn_after` while it goes on, and then
    /// [`RESPONSIVE_EVENT`] once the command returns. It can't free the core, but the log then says what to
    /// look at, and the title bar says the core isn't responding, where a silent hang said "Saving" forever.
    pub(super) fn watch_held(&self) {
        let held = Arc::downgrade(&self.held);
        let relay = Arc::downgrade(&self.relay);
        let warn_after = self.warn_after;
        let spawned = std::thread::Builder::new()
            .name("opennote-core-watchdog".into())
            .spawn(move || {
                // The hold last reported, by its start, and when it was reported.
                let mut reported: Option<(Instant, Instant)> = None;
                loop {
                    std::thread::sleep(warn_after / 4);
                    let Some(held) = held.upgrade() else { return };
                    let now = held.lock().unwrap_or_else(PoisonError::into_inner).clone();
                    let send = |name, payload| {
                        if let Some(relay) = relay.upgrade() {
                            relay.send(name, payload);
                        }
                    };
                    let Some((since, what)) = now else {
                        if reported.take().is_some() {
                            ::log::info!("The core answers again");
                            send(RESPONSIVE_EVENT, serde_json::json!({}));
                        }
                        continue;
                    };
                    let elapsed = since.elapsed();
                    let due = match reported {
                        Some((hold, at)) if hold == since => at.elapsed() >= warn_after,
                        _ => elapsed >= warn_after,
                    };
                    if !due {
                        continue;
                    }
                    reported = Some((since, Instant::now()));
                    let seconds = elapsed.as_secs();
                    ::log::error!("{what} has held the core for {seconds} s, and every other command waits for it");
                    send(STALLED_EVENT, serde_json::json!({ "what": what, "seconds": seconds }));
                }
            });
        if let Err(error) = spawned {
            ::log::warn!("Couldn't start the core watchdog: {error}");
        }
    }
}
