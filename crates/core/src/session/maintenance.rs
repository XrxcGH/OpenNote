//! The maintenance thread: readable copies, the index file, thinning, clean-up, and the scan (plan 10.1).
//! Owned by WP5.
//!
//! Work that can wait goes here as jobs with a due time: readable copies and title copies after saves,
//! conflict-copy checks 5 and 60 seconds after saves, the scan after a notebook opens, retries of folder
//! moves, Trash expiry, history thinning, and garbage collection of closed pages. A job with a key replaces
//! the waiting job with the same key, which debounces work such as rewriting `index.md`.
//!
//! The plan runs this thread at background input and output priority. Setting that priority needs a
//! platform call, which belongs in `store::sys`, so the thread runs at normal priority until that exists.

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::time::Clock;

/// A piece of maintenance work.
pub struct Job {
    /// When it may run, in monotonic time.
    pub due: Duration,
    /// A key that replaces a waiting job with the same key.
    pub key: Option<String>,
    /// The work.
    pub run: Box<dyn FnOnce() + Send>,
}

#[derive(Default)]
struct Queue {
    jobs: Vec<Job>,
    stop: bool,
    paused: u32,
}

/// The maintenance queue and its thread.
#[derive(Default)]
pub struct Maintenance {
    queue: Mutex<Queue>,
    wake: Condvar,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Maintenance {
    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Adds a job.
    pub fn add(&self, job: Job) {
        let mut queue = self.queue();
        if let Some(key) = &job.key {
            queue.jobs.retain(|j| j.key.as_ref() != Some(key));
        }
        queue.jobs.push(job);
        drop(queue);
        self.wake.notify_all();
    }

    /// Adds a job that runs `after` from now.
    pub fn after(&self, clock: &dyn Clock, after: Duration, key: Option<String>, run: impl FnOnce() + Send + 'static) {
        self.add(Job {
            due: clock.monotonic().saturating_add(after),
            key,
            run: Box::new(run),
        });
    }

    /// How many jobs wait.
    pub fn waiting(&self) -> usize {
        self.queue().jobs.len()
    }

    /// Pauses jobs while a page opens, so they don't compete with it (plan 10.1). Returns a guard that resumes
    /// them when dropped.
    pub fn pause(self: &Arc<Self>) -> PauseGuard {
        let mut queue = self.queue();
        queue.paused = queue.paused.saturating_add(1);
        PauseGuard {
            maintenance: Arc::clone(self),
        }
    }

    fn take_due(&self, now: Duration) -> Option<Job> {
        let mut queue = self.queue();
        if queue.paused > 0 {
            return None;
        }
        let index = queue
            .jobs
            .iter()
            .enumerate()
            .filter(|(_, j)| j.due <= now)
            .min_by_key(|(_, j)| j.due)
            .map(|(i, _)| i)?;
        Some(queue.jobs.remove(index))
    }

    /// Runs every job that is due at the clock's time, and jobs those jobs add that are due too. Returns how
    /// many ran.
    pub fn run_due(&self, clock: &dyn Clock) -> u32 {
        let mut ran: u32 = 0;
        while let Some(job) = self.take_due(clock.monotonic()) {
            (job.run)();
            ran = ran.saturating_add(1);
        }
        ran
    }

    /// Starts the maintenance thread.
    pub fn start(self: &Arc<Self>, clock: Arc<dyn Clock>) {
        let maintenance = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("opennote-maintenance".into())
            .spawn(move || maintenance.run(clock.as_ref()));
        if let Ok(handle) = spawned {
            *self.thread.lock().unwrap_or_else(PoisonError::into_inner) = Some(handle);
        }
    }

    fn run(&self, clock: &dyn Clock) {
        loop {
            if self.queue().stop {
                return;
            }
            if self.run_due(clock) > 0 {
                continue;
            }
            let queue = self.queue();
            if queue.stop {
                return;
            }
            let now = clock.monotonic();
            let next = queue.jobs.iter().map(|j| j.due).min();
            let wait = next.map_or(MAX_SLEEP, |due| due.saturating_sub(now).min(MAX_SLEEP));
            let _ = self.wake.wait_timeout(queue, wait.max(Duration::from_millis(1)));
        }
    }

    /// Stops the thread after the job in progress. Jobs still waiting are dropped: each is safe to skip,
    /// because the next start or the next save does the same work again.
    pub fn stop(&self) {
        self.queue().stop = true;
        self.wake.notify_all();
        let handle = self.thread.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }
}

/// Keeps maintenance paused while it lives.
pub struct PauseGuard {
    maintenance: Arc<Maintenance>,
}

impl Drop for PauseGuard {
    fn drop(&mut self) {
        let mut queue = self.maintenance.queue();
        queue.paused = queue.paused.saturating_sub(1);
        drop(queue);
        self.maintenance.wake.notify_all();
    }
}

/// The longest the thread sleeps without looking at its queue.
const MAX_SLEEP: Duration = Duration::from_millis(250);

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;
    use crate::time::{TestClock, Timestamp};

    #[test]
    fn jobs_run_when_due_and_keys_debounce() {
        let clock = TestClock::new(Timestamp::EPOCH);
        let maintenance = Arc::new(Maintenance::default());
        let count = Arc::new(AtomicU32::new(0));
        for delay in [5, 3] {
            let count = count.clone();
            maintenance.after(&clock, Duration::from_secs(delay), Some("index".into()), move || {
                count.fetch_add(1, Ordering::SeqCst);
            });
        }
        assert_eq!(maintenance.waiting(), 1);
        clock.advance(Duration::from_secs(2));
        assert_eq!(maintenance.run_due(&clock), 0);
        clock.advance(Duration::from_secs(1));
        let paused = maintenance.pause();
        assert_eq!(maintenance.run_due(&clock), 0);
        drop(paused);
        assert_eq!(maintenance.run_due(&clock), 1);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_thread_runs_jobs_and_stops() {
        let clock: Arc<dyn Clock> = Arc::new(crate::time::SystemClock::new());
        let maintenance = Arc::new(Maintenance::default());
        maintenance.start(clock.clone());
        let count = Arc::new(AtomicU32::new(0));
        let job_count = count.clone();
        maintenance.after(clock.as_ref(), Duration::ZERO, None, move || {
            job_count.fetch_add(1, Ordering::SeqCst);
        });
        for _ in 0..200 {
            if count.load(Ordering::SeqCst) == 1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        maintenance.stop();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
