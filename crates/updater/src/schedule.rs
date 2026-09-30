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

#[cfg(test)]
mod tests {
    use super::*;

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
