//! When to check: 30 s after the first `app_ready`, then every 6 hours with up to 10 minutes of jitter, and after
//! waking from sleep when the last check is old. Failures back off (ARCHITECTURE.md section 18.4). The clock and
//! the network cost are traits, so tests run the schedule with fakes.

use std::time::{Duration, SystemTime};

const HOUR: Duration = Duration::from_secs(60 * 60);

/// The wait between the first `app_ready` and the first check.
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);

/// The time between automatic checks.
pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// The most random delay added to each scheduled check, so copies don't all check at once.
pub const MAX_JITTER: Duration = Duration::from_secs(10 * 60);

/// The waits after the first, second, and later failed checks.
pub const BACKOFF: [Duration; 3] = [HOUR, Duration::from_secs(2 * 60 * 60), CHECK_INTERVAL];

pub trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

/// Whether the current connection is metered. The app implements it with Windows' connection cost.
pub trait NetworkCost: Send + Sync {
    fn is_metered(&self) -> bool;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}

/// A network that's never metered, for builds and tests without a real connection cost.
#[derive(Debug, Default, Clone, Copy)]
pub struct Unmetered;

impl NetworkCost for Unmetered {
    fn is_metered(&self) -> bool {
        false
    }
}

/// The wait before the next check after `failures` failed checks in a row.
pub fn backoff(failures: u32) -> Duration {
    match failures {
        0 => CHECK_INTERVAL,
        n => BACKOFF[(n as usize - 1).min(BACKOFF.len() - 1)],
    }
}

/// The longest the scheduler thread sleeps at once. It wakes at least this often and compares the wall clock
/// with the next check, so a check that fell due while the PC slept runs soon after it wakes.
pub const TICK: Duration = Duration::from_secs(60);

/// A random wait from zero to [`MAX_JITTER`], from the standard library's per-process random hash keys.
pub fn random_jitter() -> Duration {
    use std::hash::{BuildHasher, Hasher};
    let random = std::collections::hash_map::RandomState::new().build_hasher().finish();
    Duration::from_secs(random % (MAX_JITTER.as_secs() + 1))
}

/// When the next automatic check runs. Automatic checks start at the first `app_ready`; the "Only check when I
/// ask" setting stops them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scheduler {
    next: Option<SystemTime>,
    failures: u32,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// The next automatic check, if any is planned.
    pub fn next(&self) -> Option<SystemTime> {
        self.next
    }

    /// Checks 30 s after the first `app_ready`, or when a back-off saved by an earlier run ends.
    pub fn start(&mut self, now: SystemTime, backoff_until: Option<SystemTime>) {
        let first = now + FIRST_CHECK_DELAY;
        self.next = Some(backoff_until.map_or(first, |until| until.max(first)));
    }

    /// Stops automatic checks, for "Only check when I ask".
    pub fn stop(&mut self) {
        self.next = None;
    }

    pub fn is_due(&self, now: SystemTime) -> bool {
        self.next.is_some_and(|next| now >= next)
    }

    /// How long to sleep before looking again: until the next check, and at most one [`TICK`].
    pub fn sleep_for(&self, now: SystemTime) -> Duration {
        let until_next = self.next.map(|next| next.duration_since(now).unwrap_or_default());
        until_next.map_or(TICK, |wait| wait.min(TICK))
    }

    /// A check worked: the next one is 6 hours and `jitter` later.
    pub fn succeeded(&mut self, now: SystemTime, jitter: Duration) {
        self.failures = 0;
        if self.next.is_some() {
            self.next = Some(now + CHECK_INTERVAL + jitter);
        }
    }

    /// A check failed: back off 1 hour, then 2, then 6. Returns when the next check runs, if automatic checks
    /// are on.
    pub fn failed(&mut self, now: SystemTime) -> Option<SystemTime> {
        self.failures += 1;
        if self.next.is_some() {
            self.next = Some(now + backoff(self.failures));
        }
        self.next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::time::UNIX_EPOCH;

    fn at(seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(1_792_000_000 + seconds)
    }

    #[test]
    fn checks_30_seconds_after_ready_then_every_6_hours() {
        let mut scheduler = Scheduler::new();
        assert!(!scheduler.is_due(at(0)) && scheduler.next().is_none());
        scheduler.start(at(0), None);
        assert!(!scheduler.is_due(at(29)));
        assert!(scheduler.is_due(at(30)));
        scheduler.succeeded(at(30), Duration::from_secs(90));
        assert_eq!(scheduler.next(), Some(at(30 + 6 * 3600 + 90)));
        assert!(!scheduler.is_due(at(6 * 3600)));
    }

    #[test]
    fn a_check_due_during_sleep_runs_at_the_next_tick() {
        let mut scheduler = Scheduler::new();
        scheduler.start(at(0), None);
        scheduler.succeeded(at(30), Duration::ZERO);
        assert_eq!(scheduler.sleep_for(at(40)), TICK, "never sleeps longer than one tick");
        assert_eq!(scheduler.sleep_for(at(30 + 6 * 3600 - 5)), Duration::from_secs(5));
        let woke = at(30 + 9 * 3600);
        assert!(scheduler.is_due(woke), "the PC slept past the check");
        assert_eq!(scheduler.sleep_for(woke), Duration::ZERO);
    }

    #[test]
    fn failed_checks_back_off_and_success_resets() {
        let mut scheduler = Scheduler::new();
        scheduler.start(at(0), None);
        assert_eq!(scheduler.failed(at(30)), Some(at(30 + 3600)));
        assert_eq!(scheduler.failed(at(3630)), Some(at(3630 + 7200)));
        assert_eq!(scheduler.failed(at(10_830)), Some(at(10_830 + 6 * 3600)));
        scheduler.succeeded(at(40_000), Duration::ZERO);
        assert_eq!(scheduler.failed(at(50_000)), Some(at(50_000 + 3600)));
    }

    #[test]
    fn honors_a_saved_back_off_and_the_manual_setting() {
        let mut scheduler = Scheduler::new();
        scheduler.start(at(0), Some(at(7200)));
        assert!(!scheduler.is_due(at(3600)) && scheduler.is_due(at(7200)));
        scheduler.start(at(0), Some(at(5)));
        assert_eq!(scheduler.next(), Some(at(30)));
        scheduler.stop();
        assert!(!scheduler.is_due(at(1_000_000)));
        scheduler.succeeded(at(10), Duration::ZERO);
        assert_eq!(scheduler.failed(at(20)), None, "manual mode never schedules a check");
    }

    #[test]
    fn jitter_stays_within_10_minutes() {
        for _ in 0..200 {
            assert!(random_jitter() <= MAX_JITTER);
        }
    }

    #[test]
    fn backs_off_one_then_two_then_six_hours() {
        assert_eq!(backoff(0), CHECK_INTERVAL);
        assert_eq!(backoff(1), HOUR);
        assert_eq!(backoff(2), 2 * HOUR);
        assert_eq!(backoff(3), 6 * HOUR);
        assert_eq!(backoff(40), 6 * HOUR);
        assert_eq!(MAX_JITTER, Duration::from_secs(600));
    }
}
