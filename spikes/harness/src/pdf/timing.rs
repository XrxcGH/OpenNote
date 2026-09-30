//! Summarizes the export timing runs: how long each route takes for 1, 10, and 50 pages, and how long the
//! visible page stops drawing meanwhile. Also summarizes exports from a hidden WebView.

use serde_json::{json, Value};

use super::analyze::{layout_summary, round};
use super::drive::{BackgroundCapture, ExportRun, RouteRuns, TimingCapture};
use super::inspect;
use crate::common::stats::summarize;
use crate::common::Result;

pub fn timing(capture: &TimingCapture) -> Result<Value> {
    let routes = capture
        .routes
        .iter()
        .map(|runs| route_timing(capture.sheets, runs))
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({
        "paper": capture.paper.name(),
        "sheets": capture.sheets,
        "layout": layout_summary(&capture.layout, false),
        "routes": routes,
    }))
}

fn route_timing(sheets: usize, runs: &RouteRuns) -> Result<Value> {
    let file = &runs.cold.file;
    Ok(json!({
        "route": runs.route.name(),
        "cold_ms": round(runs.cold.ms, 1),
        "pages": inspect::page_count(file)?,
        "file_bytes": std::fs::metadata(file)?.len(),
        "export": export_times(&runs.samples, sheets),
        "visible_page": frames(&runs.samples),
    }))
}

/// Export times of the runs, and the median time per page.
fn export_times(runs: &[ExportRun], sheets: usize) -> Value {
    let times: Vec<f64> = runs.iter().map(|run| run.ms).collect();
    let summary = summarize(&times);
    let per_page = summary.as_ref().map(|s| round(s.p50 / sheets.max(1) as f64, 2));
    json!({ "ms": summary, "ms_per_page_p50": per_page })
}

/// The visible page's longest frame gap and longest task during each run.
fn frames(runs: &[ExportRun]) -> Value {
    let values = |key: &str| -> Vec<f64> { runs.iter().filter_map(|run| run.frames[key].as_f64()).collect() };
    json!({
        "max_frame_gap_ms": summarize(&values("maxGapMs")),
        "longest_task_ms": summarize(&values("longestTaskMs")),
        "frames_over_50ms": values("gapsOver50Ms").iter().sum::<f64>(),
    })
}

pub fn background(capture: &BackgroundCapture) -> Result<Value> {
    let Some((cold, samples)) = capture.runs.split_first() else {
        return Ok(Value::Null);
    };
    Ok(json!({
        "description": "PrintToPdf from a hidden second WebView while the visible page shows the sample notes",
        "paper": "letter",
        "sheets": capture.sheets,
        "layout": layout_summary(&capture.layout, false),
        "cold_ms": round(cold.ms, 1),
        "pages": inspect::page_count(&cold.file)?,
        "export": export_times(samples, capture.sheets),
        "visible_page": frames(samples),
    }))
}
