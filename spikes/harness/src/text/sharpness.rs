//! Does a compositor layer (`will-change: transform`) leave text blurry after zooming in? The page zooms the
//! text from 100% to 200% in small steps, like a pinch, with and without the layer. A DevTools screenshot of the
//! same text is scored by its edge strength: blurry text has softer edges and scores lower.

use std::thread::sleep;
use std::time::Duration;

use serde_json::{json, Value};

use crate::common::webview::Controller;
use crate::common::Result;

const CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// A world point inside the 20-page note, so the screenshot is all text.
const TEXT_POINT: (f64, f64) = (1640.0, 1400.0);
/// The screenshot, in CSS pixels, centered in the window.
const CLIP: (f64, f64) = (480.0, 240.0);

pub const METHOD: &str = "With no ink, the page zooms the 20-page note from 100% to 200% over 30 frames. After \
700 ms, Page.captureScreenshot takes the window (without a clip, which would render the page again). The score is \
the edge strength of the 480 by 240 CSS pixels in its middle: the root mean square brightness difference between \
neighboring pixels. Blurry text scores lower. The cases are no layer, a layer during the zoom, and a layer removed \
after the zoom. The cost of removing the layer is the longest of the next 8 frame intervals, with text alone and \
with the tiled ink.";

/// Decodes standard base64 (as in CDP screenshots). Skips whitespace and stops at padding.
pub fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let value = |byte: u8| -> Option<u32> {
        Some(match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let digits: Vec<u8> = text
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .take_while(|byte| *byte != b'=')
        .collect();
    let mut bytes = Vec::with_capacity(digits.len() * 3 / 4);
    for chunk in digits.chunks(4) {
        let mut bits = 0u32;
        for (index, digit) in chunk.iter().enumerate() {
            bits |= value(*digit)? << (18 - 6 * index);
        }
        let count = chunk.len().saturating_sub(1);
        bytes.extend(bits.to_be_bytes()[1..=count].iter());
    }
    Some(bytes)
}

/// The root mean square brightness difference between horizontally and vertically neighboring pixels, from 0
/// to 255. Squaring favors crisp steps over soft ramps, so blur lowers it even when the contrast stays.
pub fn edge_strength(image: &image::GrayImage) -> f64 {
    let (width, height) = image.dimensions();
    let mut total = 0.0;
    let mut count = 0usize;
    for y in 0..height.saturating_sub(1) {
        for x in 0..width.saturating_sub(1) {
            let here = f64::from(image.get_pixel(x, y)[0]);
            total += (f64::from(image.get_pixel(x + 1, y)[0]) - here).powi(2);
            total += (f64::from(image.get_pixel(x, y + 1)[0]) - here).powi(2);
            count += 2;
        }
    }
    if count == 0 {
        0.0
    } else {
        (total / count as f64).sqrt()
    }
}

/// Takes a screenshot of the whole window and scores the middle of it. A `clip` would make the browser
/// render the page again for the screenshot, which would hide the blur this looks for.
fn score(controller: &Controller) -> Result<f64> {
    let shot = controller.cdp("Page.captureScreenshot", json!({ "format": "png" }))?;
    let data = shot["data"].as_str().ok_or("The screenshot had no data.")?;
    let png = decode_base64(data).ok_or("The screenshot wasn't valid base64.")?;
    let image = image::load_from_memory(&png)?.to_luma8();
    let area = controller.client_area()?;
    let (width, height) = ((CLIP.0 * area.scale) as u32, (CLIP.1 * area.scale) as u32);
    let (left, top) = (
        image.width().saturating_sub(width) / 2,
        image.height().saturating_sub(height) / 2,
    );
    let middle = image::imageops::crop_imm(&image, left, top, width, height).to_image();
    Ok(edge_strength(&middle))
}

fn view(controller: &Controller, scale: f64, frames: u32) -> Result<()> {
    let (x, y) = TEXT_POINT;
    controller.call(
        "view",
        json!({ "x": x, "y": y, "scale": scale, "frames": frames }),
        CALL_TIMEOUT,
    )?;
    Ok(())
}

/// What one zoom case measured.
struct ZoomCase {
    /// Edge strength at 200%.
    zoomed: f64,
    /// Edge strength once the layer is removed again.
    removed: f64,
    /// The longest frame interval right after removing the layer, when the page is drawn again at 200%.
    removal_frame_ms: f64,
}

/// Zooms from 100% to 200% with or without a layer, then removes the layer.
fn zoom_case(controller: &Controller, layer: bool) -> Result<ZoomCase> {
    controller.call("setLayer", json!({ "on": false }), CALL_TIMEOUT)?;
    view(controller, 1.0, 1)?;
    sleep(Duration::from_millis(500));
    controller.call("setLayer", json!({ "on": layer }), CALL_TIMEOUT)?;
    sleep(Duration::from_millis(500));
    view(controller, 2.0, 30)?;
    sleep(Duration::from_millis(700));
    let zoomed = score(controller)?;
    let removal = controller.call("setLayer", json!({ "on": false }), CALL_TIMEOUT)?;
    sleep(Duration::from_millis(700));
    Ok(ZoomCase {
        zoomed,
        removed: score(controller)?,
        removal_frame_ms: removal["longestFrameMs"].as_f64().unwrap_or(f64::NAN),
    })
}

/// Runs the cases and returns the `sharpness` section of the results. The blur is scored on text alone; the
/// cost of removing the layer is also measured with the tiled ink, which is the heaviest content to redraw.
pub fn run(controller: &Controller) -> Result<Value> {
    super::fresh_page(controller)?;
    controller.call("setEditorCount", json!({ "n": 8 }), CALL_TIMEOUT)?;
    controller.call("setInk", json!({ "mode": "off" }), CALL_TIMEOUT)?;
    let plain = zoom_case(controller, false)?;
    let layered = zoom_case(controller, true)?;
    controller.call("setInk", json!({ "mode": "tiles" }), CALL_TIMEOUT)?;
    let with_ink = zoom_case(controller, true)?;
    let round = |value: f64| (value * 1000.0).round() / 1000.0;
    Ok(json!({
        "status": "complete",
        "method": METHOD,
        "edge_strength": {
            "no_layer": round(plain.zoomed),
            "layer_during_zoom": round(layered.zoomed),
            "layer_removed_after_zoom": round(layered.removed),
        },
        "layer_vs_no_layer": round(layered.zoomed / plain.zoomed.max(f64::EPSILON)),
        "longest_frame_after_removing_layer_ms": {
            "text_only": round(layered.removal_frame_ms),
            "text_and_tiled_ink": round(with_ink.removal_frame_ms),
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64() {
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man");
        assert_eq!(decode_base64("TWE=").unwrap(), b"Ma");
        assert_eq!(decode_base64("TQ==").unwrap(), b"M");
        assert_eq!(decode_base64("aGVs\nbG8=").unwrap(), b"hello");
        assert!(decode_base64("a*b=").is_none());
    }

    #[test]
    fn blurry_edges_score_lower_than_sharp_ones() {
        let sharp = image::GrayImage::from_fn(8, 8, |x, _| image::Luma([if x < 4 { 0 } else { 255 }]));
        let soft = image::GrayImage::from_fn(8, 8, |x, _| image::Luma([(x * 36) as u8]));
        assert!(edge_strength(&sharp) > 2.0 * edge_strength(&soft));
        assert_eq!(edge_strength(&image::GrayImage::new(1, 1)), 0.0);
    }
}
