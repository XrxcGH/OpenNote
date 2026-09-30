//! Typing latency under each condition: zoom, ink, the number of editors, and a short note versus the
//! 20-page note. Each key is timed three ways. The page times keydown to the end of the next frame's rendering.
//! The browser's Event Timing API times keydown to the next presented frame, in 8 ms steps. Desktop Duplication
//! times it on screen, when `common::capture` is available.

use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::analysis::{event_summary, key_summary, rounded, summary_json, TYPING_BUDGET_MS};
use super::input::{key_events, send_key, typed_char};
use super::screen_timing::{caret_region, ScreenTimer};
use crate::common::screen::check_desktop;
use crate::common::stats::share_within;
use crate::common::webview::{ClientArea, Controller};
use crate::common::{clock, Result};

/// One typing condition. `editors` counts the editors on the page, always including the one typed into.
pub struct Condition {
    pub name: &'static str,
    pub zoom: f64,
    /// "svg" draws the ink as SVG paths in the zoomed world, "canvas" on a window-sized canvas, and "tiles" as
    /// tiles drawn by a worker. "off" hides it.
    pub ink: &'static str,
    pub editors: usize,
    /// "short" types at the end of a short note; "long" types mid-paragraph halfway through the 20-page note.
    pub target: &'static str,
}

const fn condition(
    name: &'static str,
    zoom: f64,
    ink: &'static str,
    editors: usize,
    target: &'static str,
) -> Condition {
    Condition {
        name,
        zoom,
        ink,
        editors,
        target,
    }
}

/// The baseline, then one change at a time, then the heaviest combination with the long note.
pub const CONDITIONS: &[Condition] = &[
    condition("baseline", 1.0, "svg", 8, "short"),
    condition("zoom-50", 0.5, "svg", 8, "short"),
    condition("zoom-200", 2.0, "svg", 8, "short"),
    condition("no-ink", 1.0, "off", 8, "short"),
    condition("canvas-ink", 1.0, "canvas", 8, "short"),
    condition("tiles-ink", 1.0, "tiles", 8, "short"),
    condition("one-editor", 1.0, "svg", 1, "short"),
    condition("long", 1.0, "svg", 8, "long"),
    condition("long-zoom-50", 0.5, "svg", 8, "long"),
    condition("long-alone", 1.0, "svg", 1, "long"),
];

/// Keys typed before measuring, so the editor, caches, and caret blink settle.
const WARM_UP: usize = 10;
/// Time from one key press to the next: about 100 words a minute.
const CADENCE: Duration = Duration::from_millis(120);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

pub const METHOD: &str = "Keys are sent with CDP Input.dispatchKeyEvent (keyDown with text, then keyUp) every 120 ms \
after 10 warm-up keys. The page times each character from the keydown event's timestamp to the editor's document \
change, the next requestAnimationFrame, and the end of that frame's rendering (a MessageChannel message posted from \
requestAnimationFrame). Event Timing entries (durationThreshold 16, rounded to 8 ms) time keydown and input to the \
next presented frame. Screen timing watches a region at the caret with Desktop Duplication and measures from the \
CDP call to the first changed frame's present time.";

/// What the harness saw for one key.
struct KeySample {
    acknowledged_ms: Option<f64>,
    screen_ms: Option<f64>,
    screen_missed: bool,
}

/// Types into every condition and returns the `keys` section of the results.
pub fn run(controller: &Controller, samples: usize, require_screen: bool) -> Result<Value> {
    let area = controller.client_area()?;
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
        conditions.push(measure(controller, condition, samples, timer, area)?);
    }
    Ok(json!({
        "status": status,
        "method": METHOD,
        "samples_per_condition": samples,
        "screen_status": screen.map_or_else(|| "not started".to_string(), |timer| timer.status),
        "conditions": conditions,
    }))
}

/// Sets up a condition in the page and returns the caret rectangle.
fn setup(controller: &Controller, condition: &Condition) -> Result<Value> {
    let args = json!({
        "zoom": condition.zoom,
        "ink": condition.ink,
        "editors": condition.editors,
        "target": condition.target,
    });
    let reply = controller.call("setup", args, CALL_TIMEOUT)?;
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
) -> Result<Value> {
    for n in 0..WARM_UP {
        type_key(controller, typed_char(n), screen, area, condition.zoom)?;
    }
    let before = controller.call("startLog", json!({}), CALL_TIMEOUT)?;
    let taken: Vec<KeySample> = (0..samples)
        .map(|n| type_key(controller, typed_char(WARM_UP + n), screen, area, condition.zoom))
        .collect::<Result<_>>()?;
    let stats = controller.call("stats", json!({}), CALL_TIMEOUT)?;
    Ok(condition_result(condition, &before, &stats, &taken, screen))
}

/// Presses and releases one key, watching the screen at the caret when capture is available.
fn type_key(
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

fn condition_result(
    condition: &Condition,
    before: &Value,
    stats: &Value,
    taken: &[KeySample],
    screen: &ScreenTimer,
) -> Value {
    let records = stats["keys"].as_array().cloned().unwrap_or_default();
    let entries = stats["events"].as_array().cloned().unwrap_or_default();
    let counts = &stats["counts"];
    let event_timing = json!({
        "supported": stats["eventTiming"],
        "keydown": event_summary(&entries, "keydown", dispatched(before, counts, "keydown")),
        "input": event_summary(&entries, "input", dispatched(before, counts, "input")),
    });
    let acknowledged: Vec<f64> = taken.iter().filter_map(|sample| sample.acknowledged_ms).collect();
    json!({
        "name": condition.name,
        "zoom": condition.zoom,
        "ink": condition.ink,
        "editors": condition.editors,
        "target": condition.target,
        "page": key_summary(&records),
        "event_timing": event_timing,
        "cdp_acknowledged_ms": summary_json(&acknowledged),
        "screen": screen_result(taken, screen),
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
    fn conditions_cover_every_factor() {
        let names: Vec<&str> = CONDITIONS.iter().map(|condition| condition.name).collect();
        assert_eq!(names.len(), 10);
        assert!(CONDITIONS.iter().any(|condition| condition.zoom == 0.5));
        assert!(CONDITIONS.iter().any(|condition| condition.zoom == 2.0));
        assert!(CONDITIONS.iter().any(|condition| condition.ink == "off"));
        assert!(CONDITIONS.iter().any(|condition| condition.editors == 1));
        assert!(CONDITIONS.iter().any(|condition| condition.target == "long"));
    }

    #[test]
    fn counts_events_between_snapshots() {
        let before = json!({ "keydown": 10 });
        let after = json!({ "keydown": 110, "input": 100 });
        assert_eq!(dispatched(&before, &after, "keydown"), 100);
        assert_eq!(dispatched(&before, &after, "input"), 100);
        assert_eq!(dispatched(&after, &before, "keydown"), 0);
    }
}
