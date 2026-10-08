//! The capture clock. On Windows it is the performance counter (QPC), the clock that WASAPI stamps
//! packets with. The recorder reads it to time pauses, and strokes and text changes use it too.
//!
//! Ink strokes carry Unix milliseconds (spec 9.3), not capture time. A [`ClockAnchor`] pairs the two
//! clocks once per recording, so a stroke's start time finds its place on the capture clock.

use serde::{Deserialize, Serialize};

/// A source of capture-clock time, in nanoseconds.
pub trait Clock: Send + Sync {
    fn now_ns(&self) -> u64;
}

/// A source of wall-clock time. The app passes its session clock, which the format spec anchors to a
/// monotonic clock once per session (spec 2.5), so a change to the system clock never moves it.
pub trait WallClock: Send + Sync {
    /// Milliseconds since 1970-01-01 UTC.
    fn unix_ms(&self) -> i64;
}

/// The operating system's wall clock.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemWallClock;

impl WallClock for SystemWallClock {
    fn unix_ms(&self) -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
    }
}

/// One instant read on both clocks. Both clocks run at the same rate for the length of a recording,
/// so the anchor converts times in either direction.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockAnchor {
    pub unix_ms: i64,
    pub capture_ns: u64,
}

impl ClockAnchor {
    /// Reads both clocks, one right after the other.
    pub fn now(capture: &dyn Clock, wall: &dyn WallClock) -> Self {
        let unix_ms = wall.unix_ms();
        ClockAnchor {
            unix_ms,
            capture_ns: capture.now_ns(),
        }
    }

    /// The capture time of a Unix time. A time before the capture clock's origin gives zero.
    pub fn capture_ns_at(&self, unix_ms: i64) -> u64 {
        let delta_ns = (i128::from(unix_ms) - i128::from(self.unix_ms)) * 1_000_000;
        (i128::from(self.capture_ns) + delta_ns).clamp(0, i128::from(u64::MAX)) as u64
    }

    /// The Unix time of a capture time, rounded down.
    pub fn unix_ms_at(&self, capture_ns: u64) -> i64 {
        let delta_ms = (i128::from(capture_ns) - i128::from(self.capture_ns)).div_euclid(1_000_000);
        (i128::from(self.unix_ms) + delta_ms).clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
    }
}

/// The real clock.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

#[cfg(windows)]
impl Clock for SystemClock {
    fn now_ns(&self) -> u64 {
        use std::sync::OnceLock;
        use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

        static FREQUENCY: OnceLock<i64> = OnceLock::new();
        let frequency = *FREQUENCY.get_or_init(|| {
            let mut frequency = 0;
            // SAFETY: the pointer is valid, and the call never fails on Windows XP or later.
            unsafe { QueryPerformanceFrequency(&mut frequency) };
            frequency.max(1)
        });
        let mut ticks = 0;
        // SAFETY: the pointer is valid, and this call can't fail either.
        unsafe { QueryPerformanceCounter(&mut ticks) };
        (i128::from(ticks) * 1_000_000_000 / i128::from(frequency)).max(0) as u64
    }
}

/// Without QPC, time runs from the first call. Only tests use this, since no other platform has a
/// capture source yet.
#[cfg(not(windows))]
impl Clock for SystemClock {
    fn now_ns(&self) -> u64 {
        use std::sync::OnceLock;
        use std::time::Instant;

        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_nanos() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_anchor_converts_in_both_directions() {
        let anchor = ClockAnchor {
            unix_ms: 1_700_000_000_000,
            capture_ns: 5_000_000_000,
        };
        assert_eq!(anchor.capture_ns_at(1_700_000_002_500), 7_500_000_000);
        assert_eq!(anchor.unix_ms_at(7_500_000_000), 1_700_000_002_500);
        assert_eq!(anchor.unix_ms_at(7_500_999_999), 1_700_000_002_500);
        assert_eq!(anchor.capture_ns_at(1_699_999_990_000), 0);
        assert_eq!(anchor.capture_ns_at(i64::MIN), 0);
    }

    #[test]
    fn the_system_clock_moves_forward() {
        let first = SystemClock.now_ns();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let elapsed_ms = (SystemClock.now_ns() - first) / 1_000_000;
        assert!((15..500).contains(&elapsed_ms), "{elapsed_ms} ms");
    }
}
