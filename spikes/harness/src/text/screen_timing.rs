//! Keystroke-to-screen timing with the shared Desktop Duplication watcher in `common::capture`. It watches a
//! small region at the caret and reports when the next typed character first changes it on screen.

use std::time::Duration;

use serde_json::Value;

use crate::common::capture::{ChangeWatcher, Region};
use crate::common::webview::ClientArea;
use crate::common::Result;

/// The status recorded when this branch has only the stub of `common::capture`.
pub const PENDING: &str = "pending: screen capture not available in this branch";
/// How much a color channel must change for a pixel to count as changed. Text on paper changes by far more.
pub const THRESHOLD: u8 = 32;
/// How long to wait for a typed character to appear before counting the sample as missed.
pub const TIMEOUT: Duration = Duration::from_millis(250);
/// The width to the right of the caret that the next character covers, in CSS pixels at 100% zoom.
const GLYPH_CSS_PX: f64 = 12.0;

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

/// A screen watcher, or the reason there isn't one.
pub struct ScreenTimer {
    watcher: Option<ChangeWatcher>,
    pub status: String,
}

impl ScreenTimer {
    /// Starts watching `region`. If capture is still the stub, the timer records that the measurement is pending,
    /// unless `required`, when it fails instead. Any other capture error also becomes the status.
    pub fn start(region: Region, required: bool) -> Result<ScreenTimer> {
        match ChangeWatcher::new(region) {
            Ok(watcher) => Ok(ScreenTimer {
                watcher: Some(watcher),
                status: "measured".into(),
            }),
            Err(error) if required => Err(format!("Screen timing needs screen capture: {error}").into()),
            Err(error) => Ok(ScreenTimer {
                watcher: None,
                status: status_for(&error.to_string()),
            }),
        }
    }

    pub fn active(&self) -> bool {
        self.watcher.is_some()
    }

    /// Moves the watched region to the caret and takes the current pixels as the baseline.
    pub fn prepare(&mut self, region: Region) -> Result<()> {
        if let Some(watcher) = self.watcher.as_mut() {
            watcher.set_region(region);
            watcher.reset_baseline()?;
        }
        Ok(())
    }

    /// The present time of the first frame that changed the region, in performance counter ticks.
    pub fn wait(&mut self) -> Result<Option<i64>> {
        match self.watcher.as_mut() {
            Some(watcher) => watcher.wait_for_change(THRESHOLD, TIMEOUT),
            None => Ok(None),
        }
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
}
