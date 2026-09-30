//! Talking to the ink page: switching modes, reading its event records, and lining its clock up with
//! the performance counter.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::measure::Surface;
use crate::common::webview::Controller;
use crate::common::{clock, Result};

const CALL_TIMEOUT: Duration = Duration::from_secs(15);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Round trips used to line up the clocks. The shortest one gives the tightest estimate.
const CLOCK_PINGS: usize = 25;

/// One pointer event as the page recorded it (see `EventRecord` in spikes/web/ink-metrics.ts).
/// Times are the page's performance.now() in milliseconds; positions are CSS pixels.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PageEvent {
    /// "d" for pen down, "m" for a move.
    pub k: String,
    /// event.timeStamp.
    pub t: f64,
    /// Handler start and end.
    pub s: f64,
    pub e: f64,
    /// When this event's ink was drawn (0 if not yet).
    pub d: f64,
    /// When the next animation frame started (0 if not yet).
    pub f: f64,
    pub x: f64,
    pub y: f64,
    /// Coalesced and predicted events that came with it.
    pub n: f64,
    pub p: f64,
}

/// Waits for the page's ready message.
pub fn wait_ready(controller: &Controller) -> Result<Value> {
    controller.wait_for("ready", READY_TIMEOUT)
}

/// Calls a function the page registered.
pub fn call(controller: &Controller, name: &str, args: Value) -> Result<Value> {
    controller.call(name, args, CALL_TIMEOUT)
}

/// Clears the ink.
pub fn clear(controller: &Controller) -> Result<()> {
    call(controller, "clear", Value::Null).map(|_| ())
}

/// The page's event records from index `from` on.
pub fn events(controller: &Controller, from: usize) -> Result<Vec<PageEvent>> {
    let value = call(controller, "events", json!({ "from": from }))?;
    Ok(serde_json::from_value(value)?)
}

/// The intervals between the next `count` animation frames, in milliseconds.
pub fn frame_intervals(controller: &Controller, count: usize) -> Result<Vec<f64>> {
    Ok(serde_json::from_value(call(
        controller,
        "frames",
        json!({ "count": count }),
    )?)?)
}

/// The ink page as a surface that the latency samples can clear.
pub struct PageSurface<'a>(pub &'a Controller);

impl Surface for PageSurface<'_> {
    fn clear(&self) -> Result<()> {
        clear(self.0)?;
        // Three animation frames later, the cleared canvas has reached the screen.
        frame_intervals(self.0, 3).map(|_| ())
    }
}

/// Adding `offset_ms` to a page time gives performance counter milliseconds, within `uncertainty_ms`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClockOffset {
    pub offset_ms: f64,
    pub uncertainty_ms: f64,
}

/// Estimates the page clock's offset. Chromium's performance.now() also counts performance counter
/// ticks, so the offset stays fixed; `drift` in the results checks that.
pub fn clock_offset(controller: &Controller) -> Result<ClockOffset> {
    let mut best: Option<ClockOffset> = None;
    for _ in 0..CLOCK_PINGS {
        let before = clock::ticks_to_ms(clock::now());
        let page = controller.eval("performance.now()")?;
        let after = clock::ticks_to_ms(clock::now());
        let page = page.as_f64().ok_or("The page didn't return performance.now().")?;
        let estimate = offset_from(before, page, after);
        if best.is_none_or(|best| estimate.uncertainty_ms < best.uncertainty_ms) {
            best = Some(estimate);
        }
    }
    best.ok_or_else(|| "The page clock couldn't be read.".into())
}

/// The offset from one round trip: the page read its clock somewhere between `before` and `after`.
fn offset_from(before_ms: f64, page_ms: f64, after_ms: f64) -> ClockOffset {
    ClockOffset {
        offset_ms: (before_ms + after_ms) / 2.0 - page_ms,
        uncertainty_ms: (after_ms - before_ms) / 2.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_the_clock_offset_from_a_round_trip() {
        let estimate = offset_from(1000.0, 250.0, 1002.0);
        assert_eq!(estimate.offset_ms, 751.0);
        assert_eq!(estimate.uncertainty_ms, 1.0);
    }

    #[test]
    fn reads_page_events() {
        let json = json!([{ "k": "m", "t": 1.0, "s": 2.0, "e": 2.5, "d": 2.5, "f": 9.0,
            "x": 78.0, "y": 50.0, "n": 1, "p": 0 }]);
        let events: Vec<PageEvent> = serde_json::from_value(json).unwrap();
        assert_eq!(events[0].k, "m");
        assert_eq!(events[0].e - events[0].s, 0.5);
    }
}
