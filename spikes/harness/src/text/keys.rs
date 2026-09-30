//! Typing latency under each condition in `conditions.rs`. Each key is timed three ways. The page times keydown to
//! the end of the next frame's rendering. The browser's Event Timing API times keydown to the next presented
//! frame, in 8 ms steps. Desktop Duplication times it on screen, when `common::capture` is available.
//!
//! A condition that fails is recorded in its own entry, with the reason, and the next condition still runs.

use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::analysis::{event_summary, key_summary, summary_json};
use super::conditions::{Condition, Tweak, CONDITIONS};
use super::input::{key_events, send_key, typed_char};
use super::metrics;
use super::screen_timing::{self, caret_region, ScreenTimer, Watch, EDGE_MARGIN_CSS};
use super::view::{self, Placement};
use crate::common::capture::Region;
use crate::common::results::today;
use crate::common::screen::check_desktop;
use crate::common::webview::Controller;
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
    screen: Watch,
    /// Whether the page panned to bring the caret back into view before this key.
    panned: bool,
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

/// Types into every condition and returns the `keys` section of the results. With `require_screen`, it fails
/// unless screen capture starts, since screen timing is all that mode adds.
pub fn run(controller: &Controller, samples: usize, require_screen: bool) -> Result<Value> {
    let placement = view::placement(controller)?;
    metrics::enable(controller)?;
    let mut screen = start_screen(controller, placement, require_screen)?;
    let mut conditions = Vec::new();
    let mut stopped = None;
    for condition in CONDITIONS {
        if let Err(error) = check_desktop() {
            stopped = Some(error.to_string());
            break;
        }
        println!("Typing: {} ({samples} keys)", condition.name);
        let outcome = setup(controller, condition).and_then(|_| measure(controller, condition, samples, &mut screen));
        if condition.tweak == Tweak::Accessibility {
            let _ = controller.cdp("Accessibility.disable", json!({}));
        }
        conditions.push(match outcome {
            Ok(measured) => condition_result(condition, &measured, &screen),
            Err(error) => {
                eprintln!("The {} condition failed: {error}", condition.name);
                failed_entry(condition, &error.to_string())
            }
        });
    }
    Ok(json!({
        "status": section_status(stopped, &conditions),
        "date": today(),
        "method": METHOD,
        "samples_per_condition": samples,
        "screen_status": screen.status,
        "screen_method": screen_timing::METHOD,
        "placement": placement.to_json(),
        "conditions": conditions,
    }))
}

/// Starts screen timing, once the page's pixels are known to map to the screen as expected.
fn start_screen(controller: &Controller, placement: Placement, required: bool) -> Result<ScreenTimer> {
    let ratio = controller.eval("window.devicePixelRatio")?.as_f64().unwrap_or(0.0);
    if (ratio - placement.area.scale).abs() > 0.01 {
        let problem = format!(
            "The page's device pixel ratio ({ratio}) doesn't match the window's scale ({}).",
            placement.area.scale
        );
        return if required {
            Err(problem.into())
        } else {
            Ok(ScreenTimer::without(format!("failed: {problem}")))
        };
    }
    if !placement.window_fits() {
        println!("The window doesn't fit on its monitor, so keys near its edge may be skipped: {placement:?}");
    }
    ScreenTimer::start(placement, required)
}

/// "complete", or why the section is incomplete.
fn section_status(stopped: Option<String>, conditions: &[Value]) -> String {
    let failed = conditions.iter().filter(|entry| entry["status"] == "failed").count();
    match (stopped, failed) {
        (Some(reason), _) => format!("incomplete: {reason}"),
        (None, 0) => "complete".into(),
        (None, failed) => format!("incomplete: {failed} of {} conditions failed", conditions.len()),
    }
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
) -> Result<Measured> {
    for n in 0..WARM_UP {
        type_key(controller, typed_char(n), screen, condition.zoom)?;
    }
    let counts_before = controller.call("startLog", json!({}), CALL_TIMEOUT)?;
    let totals_before = metrics::totals(controller)?;
    let taken: Vec<KeySample> = (0..samples)
        .map(|n| type_key(controller, typed_char(WARM_UP + n), screen, condition.zoom))
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

/// Where to watch for the next key, or why not to.
enum Aim {
    Watch(Region),
    Skip(String),
}

/// Finds the caret region to watch. When the caret is near the window's edge, the page pans it back first. The
/// region must then lie inside the client area and the monitor, or the key is skipped. Also returns whether the
/// page panned.
fn aim(controller: &Controller, placement: Placement, zoom: f64) -> Result<(Aim, bool)> {
    let area = placement.area;
    let margin = (EDGE_MARGIN_CSS * area.scale).round() as u32;
    let caret = controller.call("caretRect", json!({}), CALL_TIMEOUT)?;
    if let Some(region) = caret_region(&caret, area, zoom) {
        if placement.well_inside(region, margin) {
            return Ok((Aim::Watch(region), false));
        }
    }
    let caret = controller.call("revealCaret", json!({}), CALL_TIMEOUT)?;
    let aim = match caret_region(&caret, area, zoom) {
        None => Aim::Skip("the page reported no caret".into()),
        Some(region) => match placement.check(region) {
            Some(reason) => Aim::Skip(reason.into()),
            None => Aim::Watch(region),
        },
    };
    Ok((aim, true))
}

/// Points the watcher at the caret and takes a baseline. Returns None when the next key can be timed, or else what
/// to record for it instead, and whether the page panned.
fn prepare_watch(controller: &Controller, screen: &mut ScreenTimer, zoom: f64) -> Result<(Option<Watch>, bool)> {
    let Some(placement) = screen.placement() else {
        return Ok((Some(Watch::Off), false));
    };
    let (aimed, panned) = aim(controller, placement, zoom)?;
    let not_timed = match aimed {
        Aim::Watch(region) => match screen.prepare(region) {
            Ok(true) => None,
            Ok(false) => Some(Watch::Skipped("the caret region kept changing before the key".into())),
            Err(error) => Some(Watch::Skipped(format!("capture failed: {error}"))),
        },
        Aim::Skip(reason) => Some(Watch::Skipped(reason)),
    };
    Ok((not_timed, panned))
}

/// Presses and releases one key, watching the screen at the caret when capture is available.
pub(super) fn type_key(controller: &Controller, ch: char, screen: &mut ScreenTimer, zoom: f64) -> Result<KeySample> {
    let started = Instant::now();
    let (press, release) = key_events(ch).ok_or_else(|| format!("No key events for {ch:?}."))?;
    let (not_timed, panned) = prepare_watch(controller, screen, zoom)?;
    let sent = send_key(controller, &press)?;
    let watched = not_timed.unwrap_or_else(|| screen.wait(sent.at));
    let acknowledged = sent.acknowledged.recv_timeout(Duration::from_secs(5)).ok();
    controller.cdp("Input.dispatchKeyEvent", release)?;
    sleep(CADENCE.saturating_sub(started.elapsed()));
    Ok(KeySample {
        acknowledged_ms: acknowledged.map(|at| clock::elapsed_ms(sent.at, at)),
        screen: watched,
        panned,
    })
}

/// How many events named `name` the page dispatched between two `eventCounts()` snapshots.
fn dispatched(before: &Value, after: &Value, name: &str) -> u64 {
    let count = |value: &Value| value[name].as_u64().unwrap_or(0);
    count(after).saturating_sub(count(before))
}

/// The fields that name a condition in the results.
fn condition_fields(condition: &Condition) -> Value {
    json!({
        "name": condition.name,
        "zoom": condition.zoom,
        "ink": condition.ink,
        "editors": condition.editors,
        "target": condition.target,
        "tweak": condition.tweak.name(),
    })
}

/// The entry for a condition that failed, with the reason.
fn failed_entry(condition: &Condition, reason: &str) -> Value {
    let mut entry = condition_fields(condition);
    entry["status"] = "failed".into();
    entry["reason"] = reason.into();
    entry
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
    let page = key_summary(&records);
    let mut entry = condition_fields(condition);
    entry["page"] = page.clone();
    entry["event_timing"] = event_timing;
    entry["main_thread_per_key"] = measured.main_thread.clone();
    entry["cdp_acknowledged_ms"] = summary_json(&acknowledged);
    entry["screen"] = screen_result(&measured.taken, screen, &page);
    entry
}

/// The screen timing for one condition. It carries the page's own numbers for the same keys, so a later merge
/// into earlier results can compare the two from one run.
fn screen_result(taken: &[KeySample], screen: &ScreenTimer, page: &Value) -> Value {
    if !screen.active() {
        return json!({ "status": screen.status });
    }
    let watches: Vec<Watch> = taken.iter().map(|sample| sample.screen.clone()).collect();
    let panned = taken.iter().filter(|sample| sample.panned).count();
    let mut result = screen_timing::summary(&watches, panned);
    result["page_same_keys"] = json!({
        "to_painted_ms": page["to_painted_ms"],
        "painted_within_budget": page["painted_within_budget"],
    });
    if let Some(reasons) = result.get("skip_reasons") {
        println!("  Skipped keys: {reasons}");
    }
    result
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

    #[test]
    fn records_a_failed_condition_in_its_own_entry() {
        let entry = failed_entry(&CONDITIONS[0], "setup failed in the page");
        assert_eq!(entry["name"], "baseline");
        assert_eq!(entry["status"], "failed");
        assert_eq!(entry["reason"], "setup failed in the page");
        let ok = condition_fields(&CONDITIONS[1]);
        assert_eq!(section_status(None, &[ok.clone(), ok.clone()]), "complete");
        assert_eq!(
            section_status(None, &[ok.clone(), entry]),
            "incomplete: 1 of 2 conditions failed"
        );
        assert_eq!(section_status(Some("locked".into()), &[ok]), "incomplete: locked");
    }
}
