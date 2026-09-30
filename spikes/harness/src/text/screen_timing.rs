//! Keystroke-to-screen timing with the shared Desktop Duplication watcher in `common::capture`. It watches a
//! small region at the caret and reports when the next typed character first changes it on screen. A key that
//! can't be watched is skipped with the reason, so one bad key never costs a whole condition.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{json, Value};

use super::analysis::{rounded, summary_json, TYPING_BUDGET_MS};
use super::view::Placement;
use crate::common::capture::{ChangeWatcher, Region};
use crate::common::stats::share_within;
use crate::common::webview::ClientArea;
use crate::common::{clock, Result};

/// The status recorded when this branch has only the stub of `common::capture`.
pub const PENDING: &str = "pending: screen capture not available in this branch";
/// How much a color channel must change for a pixel to count as changed. Text on paper changes by far more.
pub const THRESHOLD: u8 = 32;
/// How long to wait for a typed character to appear before counting the sample as missed.
pub const TIMEOUT: Duration = Duration::from_millis(250);
/// How long the region must stay unchanged after a baseline is taken. Desktop Duplication delivers a frame a few
/// milliseconds after its present time, so a baseline can miss a frame that's already on its way. Without this
/// wait, a key could be timed by that older change, sometimes presented before the key was even sent.
pub const SETTLE: Duration = Duration::from_millis(30);
/// How many baselines to try before giving up on a region that keeps changing.
const SETTLE_TRIES: usize = 4;
/// A looser limit than the typing budget: the budget plus about one refresh at 120 Hz.
pub const LOOSE_LIMIT_MS: f64 = 25.0;
/// How far inside the window the caret must be, in CSS pixels, before a key is timed without panning first.
pub const EDGE_MARGIN_CSS: f64 = 48.0;
/// The width to the right of the caret that the next character covers, in CSS pixels at 100% zoom.
const GLYPH_CSS_PX: f64 = 12.0;

pub const METHOD: &str = "Each condition starts from a freshly loaded page, with the window centered on its \
monitor and kept above other windows. Before each key, the harness reads the caret. If the caret region isn't at \
least 48 CSS pixels inside the window, the page first pans the world so the caret's line sits a little above the \
middle. Desktop Duplication then watches a region from just left of the caret to one wide glyph right of it, over \
its height. The region's pixels become the baseline once they stay unchanged for 30 ms, since frames arrive a few \
milliseconds after they're presented. A key is timed from the CDP Input.dispatchKeyEvent call to the present time \
of the first desktop frame in which a pixel of the region changed by more than 32 in a color channel. A key is \
skipped, with the reason, if its region still isn't inside both the client area and the monitor, if the region \
kept changing before it, or if the change was presented before it was sent. A key with no change within 250 ms is \
missed.";

/// The screen region where the next typed character appears: from just left of the caret, one wide glyph to its
/// right, over the caret's height. `caret` has `left`, `top`, and `bottom` in CSS pixels. None if it's missing.
pub fn caret_region(caret: &Value, area: ClientArea, zoom: f64) -> Option<Region> {
    let (left, top, bottom) = (
        caret["left"].as_f64()?,
        caret["top"].as_f64()?,
        caret["bottom"].as_f64()?,
    );
    let (x, y) = area.to_screen(left, top);
    let (_, y_bottom) = area.to_screen(left, bottom);
    let margin = area.scale.ceil() as i32;
    let glyph = (GLYPH_CSS_PX * zoom * area.scale).round().max(6.0) as u32;
    Some(Region {
        x: x - margin,
        y,
        width: glyph + margin as u32,
        height: (y_bottom - y).max(4) as u32,
    })
}

/// What screen timing saw for one key.
#[derive(Clone, Debug, PartialEq)]
pub enum Watch {
    /// Screen timing is off.
    Off,
    /// The first changed frame came `ms` after the key was sent. `combined` means the frame combined several
    /// desktop updates, so the change may have shown a little earlier.
    Timed { ms: f64, combined: bool },
    /// Nothing changed within the timeout.
    Missed,
    /// The key wasn't timed on screen, and why.
    Skipped(String),
}

/// A screen watcher, or the reason there isn't one.
pub struct ScreenTimer {
    watcher: Option<ChangeWatcher>,
    placement: Option<Placement>,
    pub status: String,
}

impl ScreenTimer {
    /// Starts watching the middle of the window, on the monitor that shows it. If capture is still the stub, the
    /// timer records that the measurement is pending, unless `required`, when it fails instead. Any other capture
    /// error also becomes the status.
    pub fn start(placement: Placement, required: bool) -> Result<ScreenTimer> {
        let area = placement.area;
        let middle = Region::around(area.x + (area.width / 2) as i32, area.y + (area.height / 2) as i32, 16);
        match ChangeWatcher::new(middle) {
            Ok(watcher) => Ok(ScreenTimer {
                watcher: Some(watcher),
                placement: Some(placement),
                status: "measured".into(),
            }),
            Err(error) if required => Err(format!("Screen timing needs screen capture: {error}").into()),
            Err(error) => Ok(ScreenTimer::without(status_for(&error.to_string()))),
        }
    }

    /// A timer that doesn't watch the screen, for typing that only the page times.
    pub fn off() -> ScreenTimer {
        ScreenTimer::without("not used".into())
    }

    /// A timer that doesn't watch the screen, with `status` saying why.
    pub fn without(status: String) -> ScreenTimer {
        ScreenTimer {
            watcher: None,
            placement: None,
            status,
        }
    }

    pub fn active(&self) -> bool {
        self.watcher.is_some()
    }

    /// Where the window is, while the timer watches the screen.
    pub fn placement(&self) -> Option<Placement> {
        self.watcher.as_ref().and(self.placement)
    }

    /// Moves the watched region to the caret and takes the current pixels as the baseline, once the region has
    /// stayed unchanged for `SETTLE`. False when it kept changing, so the next key can't be timed.
    pub fn prepare(&mut self, region: Region) -> Result<bool> {
        let Some(watcher) = self.watcher.as_mut() else {
            return Ok(false);
        };
        watcher.set_region(region);
        for _ in 0..SETTLE_TRIES {
            watcher.reset_baseline()?;
            if watcher.wait_for_change(THRESHOLD, SETTLE)?.is_none() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Waits for the first frame that changes the region after a key sent at `sent_at`, in performance counter
    /// ticks. A capture error skips the key instead of stopping the measurement.
    pub fn wait(&mut self, sent_at: i64) -> Watch {
        let Some(watcher) = self.watcher.as_mut() else {
            return Watch::Off;
        };
        match watcher.wait_for_change(THRESHOLD, TIMEOUT) {
            Ok(Some(at)) => timed(
                clock::elapsed_ms(sent_at, at),
                watcher.last_change().accumulated_frames > 1,
            ),
            Ok(None) => Watch::Missed,
            Err(error) => Watch::Skipped(format!("capture failed: {error}")),
        }
    }
}

/// A key timed at `ms`. A change presented before the key was sent can't be the key's, so that key is skipped.
fn timed(ms: f64, combined: bool) -> Watch {
    if ms < 0.0 {
        Watch::Skipped("the region changed before the key was sent".into())
    } else {
        Watch::Timed { ms, combined }
    }
}

/// The status for a capture error: pending while capture is the stub, otherwise the error itself.
fn status_for(error: &str) -> String {
    if error.contains("isn't written yet") {
        PENDING.into()
    } else {
        format!("failed: {error}")
    }
}

/// Summarizes one condition's screen timing: the latencies, how many keys were timed, missed, or skipped (and
/// why), and how often the page panned to keep the caret in view.
pub fn summary(watches: &[Watch], panned: usize) -> Value {
    let mut latencies = Vec::new();
    let (mut missed, mut combined) = (0, 0);
    let mut reasons: BTreeMap<&str, usize> = BTreeMap::new();
    for watch in watches {
        match watch {
            Watch::Timed { ms, combined: many } => {
                latencies.push(*ms);
                combined += usize::from(*many);
            }
            Watch::Missed => missed += 1,
            Watch::Skipped(reason) => *reasons.entry(reason).or_default() += 1,
            Watch::Off => {}
        }
    }
    let mut result = json!({
        "status": "measured",
        "keys": watches.len(),
        "timed": latencies.len(),
        "missed": missed,
        "skipped": reasons.values().sum::<usize>(),
        "panned": panned,
        "combined_frames": combined,
        "to_screen_ms": summary_json(&latencies),
        "within_16ms": share_within(&latencies, TYPING_BUDGET_MS),
        "within_25ms": share_within(&latencies, LOOSE_LIMIT_MS),
        "sample_ms": rounded(&latencies),
    });
    if !reasons.is_empty() {
        result["skip_reasons"] = json!(reasons);
    }
    if latencies.is_empty() {
        let common = reasons
            .iter()
            .max_by_key(|(_, count)| **count)
            .map(|(reason, _)| *reason);
        result["status"] = "failed".into();
        result["reason"] = common
            .unwrap_or("no key changed the watched region within 250 ms")
            .into();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn places_the_region_at_the_caret() {
        let area = ClientArea {
            x: 100,
            y: 50,
            width: 1920,
            height: 1200,
            scale: 1.5,
        };
        let caret = json!({ "left": 200.0, "top": 100.0, "bottom": 124.0 });
        let region = caret_region(&caret, area, 1.0).unwrap();
        assert_eq!(
            region,
            Region {
                x: 398,
                y: 200,
                width: 20,
                height: 36
            }
        );
        let small = caret_region(&caret, area, 0.25).unwrap();
        assert_eq!(small.width, 8);
        assert!(caret_region(&json!(null), area, 1.0).is_none());
    }

    #[test]
    fn reports_the_stub_as_pending() {
        assert_eq!(status_for("Screen capture isn't written yet (region ...)."), PENDING);
        assert_eq!(status_for("No output"), "failed: No output");
    }

    #[test]
    fn counts_timed_missed_and_skipped_keys() {
        let timed = |ms: f64| Watch::Timed { ms, combined: false };
        let outside = || Watch::Skipped("the caret region isn't inside the monitor".into());
        let watches = vec![
            timed(12.0),
            timed(20.0),
            Watch::Timed {
                ms: 30.0,
                combined: true,
            },
            Watch::Missed,
            outside(),
            outside(),
        ];
        let result = summary(&watches, 1);
        assert_eq!(result["status"], "measured");
        assert_eq!((result["keys"].as_u64(), result["timed"].as_u64()), (Some(6), Some(3)));
        assert_eq!(
            (result["missed"].as_u64(), result["skipped"].as_u64()),
            (Some(1), Some(2))
        );
        assert_eq!(result["skip_reasons"]["the caret region isn't inside the monitor"], 2);
        assert_eq!(
            (result["panned"].as_u64(), result["combined_frames"].as_u64()),
            (Some(1), Some(1))
        );
        assert_eq!(result["to_screen_ms"]["p50"], 20.0);
        assert_eq!(result["within_25ms"], 2.0 / 3.0);
        assert_eq!(result["sample_ms"], json!([12.0, 20.0, 30.0]));
    }

    #[test]
    fn skips_a_change_presented_before_the_key() {
        assert_eq!(
            timed(-2.7, true),
            Watch::Skipped("the region changed before the key was sent".into())
        );
        assert_eq!(
            timed(0.0, false),
            Watch::Timed {
                ms: 0.0,
                combined: false
            }
        );
    }

    #[test]
    fn fails_a_condition_with_no_timed_key() {
        let skipped = summary(&[Watch::Skipped("capture failed: lost".into())], 0);
        assert_eq!(
            (&skipped["status"], &skipped["reason"]),
            (&json!("failed"), &json!("capture failed: lost"))
        );
        assert!(skipped["to_screen_ms"].is_null());
        let missed = summary(&[Watch::Missed, Watch::Missed], 0);
        assert_eq!(missed["reason"], "no key changed the watched region within 250 ms");
        assert!(summary(&[timed_key()], 0).get("skip_reasons").is_none());
    }

    fn timed_key() -> Watch {
        Watch::Timed {
            ms: 10.0,
            combined: false,
        }
    }
}
