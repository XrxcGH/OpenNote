//! The saver thread and its triggers (plan 9.3). Owned by WP5.
//!
//! Each dirty page session computes when it is due, with [`due_at`], and hands that time to the [`Saver`].
//! The saver keeps the due times in order and saves one page at a time: on its own thread in the app, or when
//! the embedder calls [`Saver::run_due`], as tests and tools do.

use std::collections::BTreeMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, Weak};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::error::FsErrorKind;
use crate::limits::Timings;
use crate::time::Clock;

/// What a dirty page knows about its unsaved changes, in monotonic time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Dirty {
    /// The first change since the last save.
    pub first: Duration,
    /// The latest change.
    pub last: Duration,
}

/// Why a page must save now, whatever the timers say.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Urgency {
    /// The timers decide.
    Normal,
    /// More than 4 MiB was journaled since the last save.
    JournalFull,
    /// The page is closing, or the app is leaving.
    Now,
}

/// When a dirty page is due for a save (plan 9.3): 1 second after the last change, and at most 10 seconds
/// after the first. With a degraded journal, 1 second after the first change, even while typing goes on. A
/// failed save waits for its retry time instead.
pub fn due_at(dirty: Dirty, timings: &Timings, degraded: bool, urgency: Urgency) -> Duration {
    if urgency != Urgency::Normal {
        return dirty.last.min(dirty.first);
    }
    let idle = dirty.last.saturating_add(timings.autosave_idle);
    let cap = if degraded {
        timings.autosave_idle
    } else {
        timings.max_dirty
    };
    idle.min(dirty.first.saturating_add(cap))
}

/// How long autosave waits after a failed save (spec 17.6). `None` means it doesn't retry on a timer: a
/// read-only file or a cloud placeholder waits for the person.
pub fn retry_after(kind: FsErrorKind, failures: u32, timings: &Timings) -> Option<Duration> {
    match kind {
        FsErrorKind::ReadOnlyFile | FsErrorKind::CloudPlaceholder => None,
        FsErrorKind::Blocked => Some(timings.blocked_retry),
        FsErrorKind::DiskFull => Some(timings.disk_full_check),
        _ => {
            let index = usize::try_from(failures.saturating_sub(1)).unwrap_or(usize::MAX);
            timings
                .save_backoff
                .get(index)
                .or_else(|| timings.save_backoff.last())
                .copied()
        }
    }
}

/// Something the saver can save.
pub trait Saveable: Send + Sync {
    /// Saves if still due. Returns the next due time if the page is still dirty, such as after a failure or
    /// after edits during the save.
    fn autosave(&self) -> Option<Duration>;
}

#[derive(Default)]
struct Queue {
    due: BTreeMap<u64, (Duration, Weak<dyn Saveable>)>,
    stop: bool,
}

/// The saver: due times of dirty pages, in order, and the thread that saves them.
#[derive(Default)]
pub struct Saver {
    queue: Mutex<Queue>,
    wake: Condvar,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Saver {
    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Schedules a page's save. A later call for the same page replaces the time.
    pub fn schedule(&self, serial: u64, page: Weak<dyn Saveable>, due: Duration) {
        self.queue().due.insert(serial, (due, page));
        self.wake.notify_all();
    }

    /// Forgets a page's save, such as after it saved or closed.
    pub fn cancel(&self, serial: u64) {
        self.queue().due.remove(&serial);
    }

    /// How many pages wait for a save.
    pub fn waiting(&self) -> usize {
        self.queue().due.len()
    }

    /// Takes the earliest page whose save is due at `now`.
    fn take_due(&self, now: Duration) -> Option<(u64, Weak<dyn Saveable>)> {
        let mut queue = self.queue();
        let serial = queue
            .due
            .iter()
            .filter(|(_, (due, _))| *due <= now)
            .min_by_key(|(_, (due, _))| *due)
            .map(|(serial, _)| *serial)?;
        queue.due.remove(&serial).map(|(_, page)| (serial, page))
    }

    /// Saves every page that is due at the clock's time, one at a time. Returns how many it saved.
    pub fn run_due(&self, clock: &dyn Clock) -> u32 {
        let mut saved: u32 = 0;
        while let Some((serial, page)) = self.take_due(clock.monotonic()) {
            self.save_one(serial, &page);
            saved = saved.saturating_add(1);
        }
        saved
    }

    fn save_one(&self, serial: u64, page: &Weak<dyn Saveable>) {
        let Some(strong) = page.upgrade() else { return };
        if let Some(next) = strong.autosave() {
            let mut queue = self.queue();
            queue.due.entry(serial).or_insert_with(|| (next, page.clone()));
        }
    }

    /// Starts the saver thread.
    pub fn start(self: &Arc<Self>, clock: Arc<dyn Clock>) {
        let saver = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("opennote-saver".into())
            .spawn(move || saver.run(clock.as_ref()));
        if let Ok(handle) = spawned {
            *self.thread.lock().unwrap_or_else(PoisonError::into_inner) = Some(handle);
        }
    }

    fn run(&self, clock: &dyn Clock) {
        loop {
            let wait = {
                let queue = self.queue();
                if queue.stop {
                    return;
                }
                let now = clock.monotonic();
                let next = queue.due.values().map(|(due, _)| *due).min();
                match next {
                    Some(due) if due <= now => None,
                    Some(due) => Some(due.saturating_sub(now).min(MAX_SLEEP)),
                    None => Some(MAX_SLEEP),
                }
            };
            match wait {
                None => {
                    self.run_due(clock);
                }
                Some(wait) => {
                    let queue = self.queue();
                    let _ = self.wake.wait_timeout(queue, wait);
                }
            }
        }
    }

    /// Stops the thread after the save in progress.
    pub fn stop(&self) {
        self.queue().stop = true;
        self.wake.notify_all();
        let handle = self.thread.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }
}

/// The longest the saver sleeps without looking at its queue, so a test clock that moves also moves it.
const MAX_SLEEP: Duration = Duration::from_millis(250);

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;
    use crate::time::{TestClock, Timestamp};

    fn secs(s: u64) -> Duration {
        Duration::from_secs(s)
    }

    #[test]
    fn a_page_saves_after_a_second_of_quiet_or_ten_seconds_of_typing() {
        let t = Timings::default();
        let quiet = Dirty {
            first: secs(5),
            last: secs(5),
        };
        assert_eq!(due_at(quiet, &t, false, Urgency::Normal), secs(6));
        let typing = Dirty {
            first: secs(5),
            last: secs(14),
        };
        assert_eq!(due_at(typing, &t, false, Urgency::Normal), secs(15));
        let degraded = Dirty {
            first: secs(5),
            last: secs(9),
        };
        assert_eq!(due_at(degraded, &t, true, Urgency::Normal), secs(6));
        assert_eq!(due_at(typing, &t, false, Urgency::JournalFull), secs(5));
    }

    #[test]
    fn failed_saves_back_off_as_spec_17_6_says() {
        let t = Timings::default();
        let busy: Vec<Option<Duration>> = (1..=7).map(|n| retry_after(FsErrorKind::Busy, n, &t)).collect();
        let want: Vec<Option<Duration>> = [1, 2, 5, 10, 30, 30, 30].iter().map(|s| Some(secs(*s))).collect();
        assert_eq!(busy, want);
        assert_eq!(retry_after(FsErrorKind::Blocked, 1, &t), Some(secs(300)));
        assert_eq!(retry_after(FsErrorKind::DiskFull, 3, &t), Some(secs(30)));
        assert_eq!(retry_after(FsErrorKind::ReadOnlyFile, 1, &t), None);
    }

    struct Counter {
        saves: AtomicU32,
        again: Option<Duration>,
    }

    impl Saveable for Counter {
        fn autosave(&self) -> Option<Duration> {
            self.saves.fetch_add(1, Ordering::SeqCst);
            self.again
        }
    }

    #[test]
    fn the_saver_runs_what_is_due_in_order() {
        let clock = TestClock::new(Timestamp::EPOCH);
        let saver = Saver::default();
        let a = Arc::new(Counter {
            saves: AtomicU32::new(0),
            again: None,
        });
        let b = Arc::new(Counter {
            saves: AtomicU32::new(0),
            again: Some(secs(100)),
        });
        let weak_a: Weak<dyn Saveable> = Arc::downgrade(&a) as Weak<dyn Saveable>;
        let weak_b: Weak<dyn Saveable> = Arc::downgrade(&b) as Weak<dyn Saveable>;
        saver.schedule(1, weak_a, secs(1));
        saver.schedule(2, weak_b, secs(2));
        assert_eq!(saver.run_due(&clock), 0);
        clock.advance(secs(1));
        assert_eq!(saver.run_due(&clock), 1);
        clock.advance(secs(1));
        assert_eq!(saver.run_due(&clock), 1);
        assert_eq!(saver.waiting(), 1);
        saver.cancel(2);
        assert_eq!(saver.waiting(), 0);
        assert_eq!(a.saves.load(Ordering::SeqCst) + b.saves.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn the_thread_saves_on_its_own_and_stops() {
        let clock: Arc<dyn Clock> = Arc::new(crate::time::SystemClock::new());
        let saver = Arc::new(Saver::default());
        saver.start(clock.clone());
        let page = Arc::new(Counter {
            saves: AtomicU32::new(0),
            again: None,
        });
        let weak: Weak<dyn Saveable> = Arc::downgrade(&page) as Weak<dyn Saveable>;
        saver.schedule(7, weak, clock.monotonic());
        for _ in 0..200 {
            if page.saves.load(Ordering::SeqCst) == 1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        saver.stop();
        assert_eq!(page.saves.load(Ordering::SeqCst), 1);
    }
}
