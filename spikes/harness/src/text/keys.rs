//! Typing latency under each condition in `conditions.rs`. Each key is timed three ways. The page times keydown to
//! the end of the next frame's rendering. The browser's Event Timing API times keydown to the next presented
//! frame, in 8 ms steps. Desktop Duplication times it on screen, when `common::capture` is available.

use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::analysis::{event_summary, key_summary, rounded, summary_json, TYPING_BUDGET_MS};
use super::conditions::{Condition, Tweak, CONDITIONS};
use super::input::{key_events, send_key, typed_char};
use super::metrics;
use super::screen_timing::{caret_region, ScreenTimer};
use crate::common::screen::check_desktop;
use crate::common::stats::share_within;
use crate::common::webview::{ClientArea, Controller};
use crate::common::{clock, Result};

/// Keys typed before measuring, so the editor, caches, and caret blink settle.
pub(super) const WARM_UP: usize = 10;
/// Time from one key press to the next: about 100 words a minute.
const CADENCE: Duration = Duration::from_millis(120);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

pub const METHOD: &str = "Each condition starts from a freshly loaded page. Keys are sent with CDP \
Input.dispatchKeyEvent (keyDown with text, then keyUp) every 120 ms after 10 warm-up keys. The page times each \
character from the keydown event's timestamp to the editor's document change and to the end of the next frame's \
rendering (a MessageChannel message posted from requestAnimationFrame). \
Event Timing entries (durationThreshold 16, rounded to 8 ms) time keydown and input to the next presented frame. \
The CDP Performance domain gives main-thread time per key. Screen timing watches a region at the caret with \
Desktop Duplication and measures from the CDP call to the first changed frame's present time.";

/// What the harness saw for one key.
pub(super) struct KeySample {
    acknowledged_ms: Option<f64>,
    screen_ms: Option<f64>,
    screen_missed: bool,
}

/// Everything one condition measured.
struct Measured {
    /// The page's event counts when logging started.
    counts_before: Value,
    /// The page's `stats()`: key records, Event Timing entries, and event counts.
    stats: Value,
    taken: Vec<KeySample>,
    main_thread: Value,
}

/// Types into every condition and returns the `keys` section of the results.
pub fn run(controller: &Controller, samples: usize, require_screen: bool) -> Result<Value> {
    let area = controller.client_area()?;
    metrics::enable(controller)?;
    let mut screen: Option<ScreenTimer> = None;
    let mut conditions = Vec::new();
    let mut status = String::from("complete");
    for condition in CONDITIONS {
        if let Err(error) = check_desktop() {
            status = format!("incomplete: {error}");
            break;
        }
        println!("Typing: {} ({samples} keys)", condition.name);
        let caret = setup(controller, condition)?;
        if screen.is_none() {
            let region = caret_region(&caret, area, condition.zoom).ok_or("The page reported no caret.")?;
            screen = Some(ScreenTimer::start(region, require_screen)?);
        }
        let timer = screen.as_mut().ok_or("No screen timer.")?;
        let measured = measure(controller, condition, samples, timer, area)?;
        if condition.tweak == Tweak::Accessibility {
            controller.cdp("Accessibility.disable", json!({}))?;
        }
        conditions.push(condition_result(condition, &measured, timer));
    }
    Ok(json!({
        "status": status,
        "method": METHOD,
        "samples_per_condition": samples,
        "screen_status": screen.map_or_else(|| "not started".to_string(), |timer| timer.status),
        "conditions": conditions,
    }))
}

/// Sets up a condition in a freshly loaded page and returns the caret rectangle.
pub(super) fn setup(controller: &Controller, condition: &Condition) -> Result<Value> {
    super::fresh_page(controller)?;
    if condition.tweak == Tweak::Accessibility {
        controller.cdp("Accessibility.enable", json!({}))?;
    }
    let reply = controller.call("setup", condition.setup_args(), CALL_TIMEOUT)?;
    // Let garbage collection and raster work from the setup finish before typing.
    sleep(Duration::from_millis(600));
    Ok(reply["caret"].clone())
}

fn measure(
    controller: &Controller,
    condition: &Condition,
    samples: usize,
    screen: &mut ScreenTimer,
    area: ClientArea,
) -> Result<Measured> {
    for n in 0..WARM_UP {
        type_key(controller, typed_char(n), screen, area, condition.zoom)?;
    }
    let counts_before = controller.call("startLog", json!({}), CALL_TIMEOUT)?;
    let totals_before = metrics::totals(controller)?;
    let taken: Vec<KeySample> = (0..samples)
        .map(|n| type_key(controller, typed_char(WARM_UP + n), screen, area, condition.zoom))
        .collect::<Result<_>>()?;
    let main_thread = metrics::per_key(&totals_before, &metrics::totals(controller)?, samples);
    let stats = controller.call("stats", json!({}), CALL_TIMEOUT)?;
    Ok(Measured {
        counts_before,
        stats,
        taken,
        main_thread,
    })
}

/// Presses and releases one key, watching the screen at the caret when capture is available.
pub(super) fn type_key(
    controller: &Controller,
    ch: char,
    screen: &mut ScreenTimer,
    area: ClientArea,
    zoom: f64,
) -> Result<KeySample> {
    let started = Instant::now();
    let (press, release) = key_events(ch).ok_or_else(|| format!("No key events for {ch:?}."))?;
    let mut watching = false;
    if screen.active() {
        let caret = controller.call("caretRect", json!({}), CALL_TIMEOUT)?;
        if let Some(region) = caret_region(&caret, area, zoom) {
            screen.prepare(region)?;
            watching = true;
        }
    }
    let sent = send_key(controller, &press)?;
    let changed = if watching { screen.wait()? } else { None };
    let acknowledged = sent.acknowledged.recv_timeout(Duration::from_secs(5)).ok();
    controller.cdp("Input.dispatchKeyEvent", release)?;
    sleep(CADENCE.saturating_sub(started.elapsed()));
    Ok(KeySample {
        acknowledged_ms: acknowledged.map(|at| clock::elapsed_ms(sent.at, at)),
        screen_ms: changed.map(|at| clock::elapsed_ms(sent.at, at)),
        screen_missed: watching && changed.is_none(),
    })
}

/// How many events named `name` the page dispatched between two `eventCounts()` snapshots.
fn dispatched(before: &Value, after: &Value, name: &str) -> u64 {
    let count = |value: &Value| value[name].as_u64().unwrap_or(0);
    count(after).saturating_sub(count(before))
}

fn condition_result(condition: &Condition, measured: &Measured, screen: &ScreenTimer) -> Value {
    let stats = &measured.stats;
    let records = stats["keys"].as_array().cloned().unwrap_or_default();
    let entries = stats["events"].as_array().cloned().unwrap_or_default();
    let (before, after) = (&measured.counts_before, &stats["counts"]);
    let event_timing = json!({
        "supported": stats["eventTiming"],
        "keydown": event_summary(&entries, "keydown", dispatched(before, after, "keydown")),
        "input": event_summary(&entries, "input", dispatched(before, after, "input")),
    });
    let acknowledged: Vec<f64> = measured
        .taken
        .iter()
        .filter_map(|sample| sample.acknowledged_ms)
        .collect();
    json!({
        "name": condition.name,
        "zoom": condition.zoom,
        "ink": condition.ink,
        "editors": condition.editors,
        "target": condition.target,
        "tweak": condition.tweak.name(),
        "page": key_summary(&records),
        "event_timing": event_timing,
        "main_thread_per_key": measured.main_thread,
        "cdp_acknowledged_ms": summary_json(&acknowledged),
        "screen": screen_result(&measured.taken, screen),
    })
}

fn screen_result(taken: &[KeySample], screen: &ScreenTimer) -> Value {
    if !screen.active() {
        return json!({ "status": screen.status });
    }
    let latencies: Vec<f64> = taken.iter().filter_map(|sample| sample.screen_ms).collect();
    json!({
        "status": screen.status,
        "to_screen_ms": summary_json(&latencies),
        "within_budget": share_within(&latencies, TYPING_BUDGET_MS),
        "missed": taken.iter().filter(|sample| sample.screen_missed).count(),
        "sample_ms": rounded(&latencies),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_events_between_snapshots() {
        let before = json!({ "keydown": 10 });
        let after = json!({ "keydown": 110, "input": 100 });
        assert_eq!(dispatched(&before, &after, "keydown"), 100);
        assert_eq!(dispatched(&before, &after, "input"), 100);
        assert_eq!(dispatched(&after, &before, "keydown"), 0);
    }
}
