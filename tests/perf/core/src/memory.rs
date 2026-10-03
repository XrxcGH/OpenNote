//! Core memory after opening and closing every page, and with 10 budget pages open (plan 10.2 and 13.9).
//! Owned by WP5.
//!
//! This counts what the core accounts for: open page sessions, recently closed pages, undo stacks, and the
//! buffers. The process's private working set, and the whole-app figure of measurement M4 that adds the
//! WebView2 processes, come from the app bridge and the nightly run on the reference laptop.

use opennote_core::error::CoreError;
use opennote_core::session::core::MemoryReport;
use opennote_core::session::kit::client;

use crate::bench_session::{build, text, BUDGET_STROKES};
use crate::harness::BenchCtx;

const MIB: f64 = 1024.0 * 1024.0;
/// How many budget pages are open at once in the plan's second gate.
const BUDGET_PAGES_OPEN: usize = 10;

/// Everything the core accounts for, in bytes.
fn total(report: &MemoryReport) -> usize {
    [
        report.open_pages,
        report.closed_pages,
        report.undo,
        report.asset_cache,
        report.journal_buffers,
    ]
    .into_iter()
    .fold(0, usize::saturating_add)
}

/// Runs the `memory` suite and adds its measurements to the report.
pub fn run(ctx: &mut BenchCtx) -> Result<(), String> {
    let sample = build(ctx.pages, false)?;
    let who = client("main-1");
    let baseline = total(&sample.kit.core.memory());
    let pass = || -> Result<usize, CoreError> {
        for page in &sample.pages {
            sample.notebook.open_page(*page, who.clone())?.close(&who)?;
        }
        Ok(total(&sample.kit.core.memory()))
    };
    let first = pass().map_err(text)?;
    let second = pass().map_err(text)?;
    let growth = if first == 0 {
        0.0
    } else {
        (second as f64 - first as f64) / first as f64 * 100.0
    };
    ctx.report.add(
        "memory.core.all_pages_opened.delta",
        "MB",
        first.saturating_sub(baseline) as f64 / MIB,
        Some(64.0),
    );
    ctx.report
        .add("memory.core.reopen_growth", "percent", growth.max(0.0), Some(10.0));
    budget_pages(ctx, baseline)
}

/// Ten budget pages open at once.
fn budget_pages(ctx: &mut BenchCtx, baseline: usize) -> Result<(), String> {
    let sample = build(ctx.pages.min(50), false)?;
    let section = *sample.sections.first().ok_or("the sample has no section")?;
    let who = client("main-1");
    let mut handles = Vec::new();
    for _ in 0..BUDGET_PAGES_OPEN {
        let (page, _) = sample
            .kit
            .inked_page_with(&sample.notebook, section, BUDGET_STROKES)
            .map_err(text)?;
        handles.push(sample.notebook.open_page(page, who.clone()).map_err(text)?);
    }
    let open = total(&sample.kit.core.memory());
    for handle in handles {
        handle.close(&who).map_err(text)?;
    }
    ctx.report.add(
        "memory.core.ten_budget_pages.delta",
        "MB",
        open.saturating_sub(baseline) as f64 / MIB,
        Some(96.0),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn ten_budget_pages_stay_under_the_plans_memory_gate() {
        let mut ctx = BenchCtx {
            pages: 60,
            quick: true,
            dir: PathBuf::new(),
            report: crate::harness::Report::default(),
        };
        run(&mut ctx).unwrap();
        assert_eq!(ctx.report.results.len(), 3);
        assert!(ctx.report.over_budget().is_empty(), "{:?}", ctx.report.over_budget());
    }
}
