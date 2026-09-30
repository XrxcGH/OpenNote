//! Turns the captured screenshots and PDFs into the results. For each paper and export route, it reports the
//! page count and sizes, fonts, vector ink, and a page-by-page comparison with the screen. Then it summarizes
//! the export times.

use std::path::Path;

use image::RgbaImage;
use serde_json::{json, Map, Value};

use super::compare::{self, Gray};
use super::drive::{Captured, ExportRun, PaperCapture};
use super::encoding::{close, hex, parse_hex};
use super::inspect::{self, PageReport, PdfReport};
use super::summary::summary;
use super::timing::{background, timing};
use super::{raster, Plan};
use crate::common::stats::summarize;
use crate::common::Result;

/// Search ranges and tile size, in pixels at the chosen resolution.
const PROFILE_SEARCH_PX: usize = 20;
const TILE_PX: usize = 96;
const TILE_SEARCH_PX: usize = 6;
/// PDF sizes are written with limited precision; half a point is far below anything a reader could see.
const SIZE_TOLERANCE_PT: f64 = 0.5;
/// Colors in the PDF may be rounded differently from the page's 8-bit values.
const COLOR_TOLERANCE: u8 = 2;

pub fn results(plan: &Plan, captured: &Captured) -> Result<Value> {
    let fidelity = captured
        .fidelity
        .iter()
        .map(|capture| paper_fidelity(plan, capture))
        .collect::<Result<Vec<_>>>()?;
    let timing = captured.timing.iter().map(timing).collect::<Result<Vec<_>>>()?;
    let background = captured.background.as_ref().map(background).transpose()?;
    Ok(json!({
        "status": "measured",
        "method": {
            "dpi": plan.dpi,
            "screen": "CDP Page.captureScreenshot of each sheet, clipped to the sheet, with captureBeyondViewport",
            "pdf_renderer": "Windows.Data.Pdf at the same resolution",
            "ink_threshold_darkness": compare::INK_THRESHOLD,
            "profile_search_px": PROFILE_SEARCH_PX,
            "tile_px": TILE_PX,
            "tile_search_px": TILE_SEARCH_PX,
            "timing_samples": plan.samples,
        },
        "summary": summary(&fidelity),
        "fidelity": fidelity,
        "timing": timing,
        "background_export": background,
    }))
}

fn load(path: &Path) -> Result<RgbaImage> {
    Ok(image::open(path)?.to_rgba8())
}

fn paper_fidelity(plan: &Plan, capture: &PaperCapture) -> Result<Value> {
    let screens = capture
        .screens
        .iter()
        .map(|path| load(path))
        .collect::<Result<Vec<_>>>()?;
    let mut exports = Vec::new();
    let mut rasters = Vec::new();
    for run in &capture.exports {
        let report = inspect::inspect(&run.file)?;
        let rendered = raster::rasterize(&run.file, plan.dpi)?;
        let mut pages = Vec::new();
        for (index, (screen, pdf)) in screens.iter().zip(&rendered.pages).enumerate() {
            let strokes = &capture.layout["sheetDetails"][index]["strokes"];
            let name = format!(
                "{}-{}-{}-page{}",
                capture.variant,
                capture.paper.name(),
                run.route.short(),
                index + 1
            );
            pdf.save(plan.out_dir.join(format!("{name}.png")))?;
            let diff = plan.out_dir.join(format!("{name}-diff.png"));
            let page = report.pages.get(index).cloned().unwrap_or_default();
            pages.push(compare_page(index + 1, (screen, pdf), &page, strokes, &diff)?);
        }
        let render = json!({
            "ms_per_page": summarize(&rendered.page_ms),
            "windows_scale_factor": round(rendered.scale_factor, 4),
        });
        exports.push(export_summary(capture, run, &report, pages, render));
        rasters.push(rendered.pages);
    }
    let routes_agree = match &rasters[..] {
        [first, second] => routes_compared(first, second),
        _ => Value::Null,
    };
    let (width, height) = screens.first().map_or((0, 0), RgbaImage::dimensions);
    Ok(json!({
        "paper": capture.paper.name(),
        "variant": capture.variant,
        "layout": layout_summary(&capture.layout, true),
        "screen_page_px": [width, height],
        "exports": exports,
        "webview2_vs_cdp": routes_agree,
    }))
}

fn compare_page(
    page: usize,
    (screen, pdf): (&RgbaImage, &RgbaImage),
    report: &PageReport,
    strokes: &Value,
    diff: &Path,
) -> Result<Value> {
    let (width, height) = (screen.width().min(pdf.width()), screen.height().min(pdf.height()));
    let pixels = compare::pixel_stats(screen, pdf, width, height);
    let (a, b) = (
        Gray::from_rgba(screen, width as usize, height as usize),
        Gray::from_rgba(pdf, width as usize, height as usize),
    );
    let (offset_px, correlation) = offsets(&a, &b);
    compare::overlay(&a, &b).save(diff)?;
    let corner = pdf.get_pixel(8, 8).0;
    Ok(json!({
        "page": page,
        "screen_px": [screen.width(), screen.height()],
        "pdf_px": [pdf.width(), pdf.height()],
        "pixels": pixels,
        "offset_px": offset_px,
        "profile_correlation": correlation,
        "tiles": compare::tile_shifts(&a, &b, TILE_PX, TILE_SEARCH_PX),
        "ink_mismatch": {
            "exact": round(compare::ink_mismatch(&a, &b, 0), 4),
            "within_1px": round(compare::ink_mismatch(&a, &b, 1), 4),
        },
        "vector_ink": vector_ink(strokes, report),
        "images": report.images,
        "paper_color": hex([corner[0], corner[1], corner[2]]),
    }))
}

/// The PDF page's offset from the screen, for the whole page and for each half. Halves that disagree
/// point to a difference in scale rather than a shift.
fn offsets(a: &Gray, b: &Gray) -> (Value, Value) {
    let (columns_a, columns_b, rows_a, rows_b) = (a.columns(), b.columns(), a.rows(), b.rows());
    let shift = |x: &[f64], y: &[f64]| compare::profile_offset(x, y, PROFILE_SEARCH_PX);
    let (mid_x, mid_y) = (columns_a.len() / 2, rows_a.len() / 2);
    let (x, y) = (shift(&columns_a, &columns_b), shift(&rows_a, &rows_b));
    let offsets = json!({
        "x": round(x.shift_px, 2),
        "y": round(y.shift_px, 2),
        "left": round(shift(&columns_a[..mid_x], &columns_b[..mid_x]).shift_px, 2),
        "right": round(shift(&columns_a[mid_x..], &columns_b[mid_x..]).shift_px, 2),
        "top": round(shift(&rows_a[..mid_y], &rows_b[..mid_y]).shift_px, 2),
        "bottom": round(shift(&rows_a[mid_y..], &rows_b[mid_y..]).shift_px, 2),
    });
    let correlation = json!({ "columns": round(x.correlation, 4), "rows": round(y.correlation, 4) });
    (offsets, correlation)
}

pub(super) fn round(value: f64, places: i32) -> f64 {
    let factor = 10f64.powi(places);
    (value * factor).round() / factor
}

/// Compares the page's pen strokes, by color, with the filled paths of that color in the PDF.
fn vector_ink(strokes: &Value, report: &PageReport) -> Value {
    let mut by_color = Map::new();
    let (mut expected, mut found) = (0u64, 0u64);
    for (color, count) in strokes.as_object().into_iter().flatten() {
        let want = count.as_u64().unwrap_or(0);
        let target = parse_hex(color).unwrap_or_default();
        let have: usize = report
            .fills
            .iter()
            .filter(|(fill, _)| parse_hex(fill).is_some_and(|rgb| close(rgb, target, COLOR_TOLERANCE)))
            .map(|(_, n)| n)
            .sum();
        by_color.insert(color.clone(), json!({ "strokes": want, "pdf_paths": have }));
        expected += want;
        found += (have as u64).min(want);
    }
    json!({ "strokes": expected, "found_as_paths": found, "by_color": by_color })
}

fn export_summary(
    capture: &PaperCapture,
    run: &ExportRun,
    report: &PdfReport,
    pages: Vec<Value>,
    render: Value,
) -> Value {
    let sheets = capture.screens.len();
    let (width, height) = capture.paper.points();
    let sizes: Vec<[f64; 2]> = report
        .pages
        .iter()
        .map(|page| {
            [
                page.media_box_pt[2] - page.media_box_pt[0],
                page.media_box_pt[3] - page.media_box_pt[1],
            ]
        })
        .collect();
    let size_ok = sizes
        .iter()
        .all(|[w, h]| (w - width).abs() <= SIZE_TOLERANCE_PT && (h - height).abs() <= SIZE_TOLERANCE_PT);
    let images: Vec<[i64; 2]> = report.pages.iter().flat_map(|page| page.images.clone()).collect();
    json!({
        "route": run.route.name(),
        "export_ms": round(run.ms, 1),
        "frames_during_export": run.frames,
        "file_bytes": report.file_bytes,
        "producer": report.producer,
        "pages": report.pages.len(),
        "sheets": sheets,
        "page_count_matches": report.pages.len() == sheets,
        "page_size_pt": sizes,
        "page_size_matches": size_ok,
        "images_drawn": images,
        "fonts": report.fonts,
        "pdf_render": render,
        "page_comparisons": pages,
    })
}

/// How closely the two export routes agree, page by page.
fn routes_compared(first: &[RgbaImage], second: &[RgbaImage]) -> Value {
    let pages: Vec<Value> = first
        .iter()
        .zip(second)
        .map(|(a, b)| {
            let (width, height) = (a.width().min(b.width()), a.height().min(b.height()));
            let (ga, gb) = (
                Gray::from_rgba(a, width as usize, height as usize),
                Gray::from_rgba(b, width as usize, height as usize),
            );
            json!({
                "mean_abs_diff": round(compare::pixel_stats(a, b, width, height).mean_abs_diff, 4),
                "ink_mismatch_exact": round(compare::ink_mismatch(&ga, &gb, 0), 4),
            })
        })
        .collect();
    json!({ "pages_compared": pages.len(), "pages": pages })
}

/// The page's layout report, without the per-sheet details for long documents.
pub(super) fn layout_summary(layout: &Value, details: bool) -> Value {
    let mut summary = layout.as_object().cloned().unwrap_or_default();
    if !details {
        summary.remove("sheetDetails");
    }
    summary.remove("printEvents");
    Value::Object(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn matches_pen_strokes_with_filled_paths_by_color() {
        let report = PageReport {
            fills: BTreeMap::from([
                ("#2f4f9a".to_string(), 3),
                ("#b0342b".to_string(), 1),
                ("#000000".to_string(), 9),
            ]),
            ..PageReport::default()
        };
        let strokes = json!({ "#2F4F9A": 3, "#B0342A": 2 });
        let ink = vector_ink(&strokes, &report);
        assert_eq!(ink["strokes"], 5);
        assert_eq!(ink["found_as_paths"], 4);
        assert_eq!(ink["by_color"]["#B0342A"]["pdf_paths"], 1);
    }

    #[test]
    fn drops_sheet_details_from_long_layouts() {
        let layout = json!({ "sheets": 50, "sheetDetails": [1, 2], "printEvents": {} });
        assert_eq!(layout_summary(&layout, false), json!({ "sheets": 50 }));
        assert_eq!(layout_summary(&layout, true)["sheetDetails"], json!([1, 2]));
    }
}
