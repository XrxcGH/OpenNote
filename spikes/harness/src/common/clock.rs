//! The Windows performance counter (QPC). Desktop Duplication frame times and input injection use the
//! same clock, so latencies measured with it need no conversion between time bases.

use std::sync::OnceLock;

use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

/// The current performance counter value, in ticks.
pub fn now() -> i64 {
    let mut ticks = 0;
    // Never fails on Windows XP or later.
    let _ = unsafe { QueryPerformanceCounter(&mut ticks) };
    ticks
}

/// Performance counter ticks per second.
pub fn frequency() -> i64 {
    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    *FREQUENCY.get_or_init(|| {
        let mut frequency = 0;
        let _ = unsafe { QueryPerformanceFrequency(&mut frequency) };
        frequency.max(1)
    })
}

/// Converts a tick count (or a difference between two counts) to milliseconds.
pub fn ticks_to_ms(ticks: i64) -> f64 {
    ticks as f64 * 1000.0 / frequency() as f64
}

/// Milliseconds from `start` to `end`, both in ticks.
pub fn elapsed_ms(start: i64, end: i64) -> f64 {
    ticks_to_ms(end - start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_counter_moves_forward_at_a_known_rate() {
        let start = now();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let elapsed = elapsed_ms(start, now());
        assert!(
            frequency() > 1_000_000,
            "QPC should tick at least a million times a second"
        );
        assert!(
            (15.0..500.0).contains(&elapsed),
            "20 ms of sleep measured as {elapsed} ms"
        );
    }
}
