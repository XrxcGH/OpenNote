//! Zoom and pan smoothness with all eight editors and the ink: the page animates the camera once per frame, and
//! reports the requestAnimationFrame intervals and each frame's main-thread rendering time.

use std::thread::sleep;
use std::time::Duration;

use serde_json::{json, Value};

use super::analysis::{frame_summary, summary_json};
use crate::common::screen::check_desktop;
use crate::common::webview::Controller;
use crate::common::Result;

/// One way of drawing the page while it moves.
pub struct Variant {
    pub name: &'static str,
    pub ink: &'static str,
    /// Whether the world gets `will-change: transform`, so the compositor can scale it without repainting.
    pub layer: bool,
}

const fn variant(name: &'static str, ink: &'static str, layer: bool) -> Variant {
    Variant { name, ink, layer }
}

/// No ink as the reference, then ink as SVG in the world, on a canvas redrawn each frame, or as tiles drawn once
/// by a worker. Most run with and without a compositor layer for the world.
pub const VARIANTS: &[Variant] = &[
    variant("no-ink", "off", false),
    variant("no-ink-layer", "off", true),
    variant("svg-ink", "svg", false),
    variant("svg-ink-layer", "svg", true),
    variant("canvas-ink", "canvas", false),
    variant("tiles-ink", "tiles", false),
    variant("tiles-ink-layer", "tiles", true),
];

pub const MOTIONS: &[&str] = &["zoom", "pan", "zoom-pan"];
const MOTION_MS: u64 = 5000;
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

pub const METHOD: &str = "Each motion runs for 5 seconds with all eight editors. Every requestAnimationFrame \
callback sets the world's CSS transform (and redraws the canvas ink, when used). Zoom breathes between 30% and \
250% every 2 seconds; pan sweeps across the notes and ink at up to about 2,000 CSS pixels a second; zoom-pan does \
both. Frame intervals come from requestAnimationFrame timestamps. Main-thread time runs from each frame's start to \
a MessageChannel message posted in that frame, which arrives after style, layout, and paint.";

/// Runs every motion for every variant and returns the `zoom` section of the results.
pub fn run(controller: &Controller, refresh_hz: u32) -> Result<Value> {
    let mut variants = Vec::new();
    let mut status = String::from("complete");
    for variant in VARIANTS {
        if let Err(error) = check_desktop() {
            status = format!("incomplete: {error}");
            break;
        }
        println!("Zoom and pan: {}", variant.name);
        variants.push(measure(controller, variant, refresh_hz)?);
    }
    Ok(json!({
        "status": status,
        "method": METHOD,
        "motion_ms": MOTION_MS,
        "variants": variants,
    }))
}

fn measure(controller: &Controller, variant: &Variant, refresh_hz: u32) -> Result<Value> {
    controller.call("setEditorCount", json!({ "n": 8 }), CALL_TIMEOUT)?;
    controller.call("setInk", json!({ "mode": variant.ink }), CALL_TIMEOUT)?;
    controller.call("setLayer", json!({ "on": variant.layer }), CALL_TIMEOUT)?;
    sleep(Duration::from_millis(600));
    let mut motions = Vec::new();
    for motion in MOTIONS {
        let report = controller.call("animate", json!({ "motion": motion, "ms": MOTION_MS }), CALL_TIMEOUT)?;
        motions.push(motion_result(motion, &report, refresh_hz));
        sleep(Duration::from_millis(300));
    }
    Ok(json!({
        "name": variant.name,
        "ink": variant.ink,
        "layer": variant.layer,
        "motions": motions,
    }))
}

fn numbers(value: &Value) -> Vec<f64> {
    value
        .as_array()
        .map_or_else(Vec::new, |items| items.iter().filter_map(Value::as_f64).collect())
}

/// Summarizes one motion report from the page.
pub fn motion_result(motion: &str, report: &Value, refresh_hz: u32) -> Value {
    let tiles = numbers(&report["tileMs"]);
    json!({
        "motion": motion,
        "frames": frame_summary(&numbers(&report["intervals"]), refresh_hz),
        "main_thread_ms": summary_json(&numbers(&report["mainThread"])),
        "long_animation_frames": report["longAnimationFrames"],
        "tiles_drawn": tiles.len(),
        "tile_draw_ms": summary_json(&tiles),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_a_motion_report() {
        let report = json!({
            "intervals": [8.3, 8.4, 25.0],
            "mainThread": [2.0, 3.0],
            "longAnimationFrames": 0,
            "tileMs": [4.0],
        });
        let result = motion_result("zoom", &report, 120);
        assert_eq!(result["frames"]["frames"], 4);
        assert_eq!(result["frames"]["over_16_7ms"], 1);
        assert_eq!(result["main_thread_ms"]["count"], 2);
        assert_eq!(result["long_animation_frames"], 0);
        assert_eq!(result["tiles_drawn"], 1);
    }

    #[test]
    fn every_variant_has_all_editors_and_a_known_ink_mode() {
        assert!(VARIANTS
            .iter()
            .all(|variant| ["svg", "canvas", "tiles", "off"].contains(&variant.ink)));
        assert!(VARIANTS.iter().any(|variant| variant.layer));
    }
}
