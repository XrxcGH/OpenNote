//! The start-up path: `Core::start`, recovery with no journals, `open_notebook`, and the last page's envelope
//! (plan 13.9). Owned by WP5.
//!
//! Like the session suite, it runs on the test core until the integrator swaps in the real file system and
//! codecs. The recovery of a 4 MiB journal belongs to the store suite, because the journal is WP4's.

use opennote_core::error::CoreError;
use opennote_core::id::PageId;
use opennote_core::model::Rect;
use opennote_core::session::kit::client;

use crate::bench_session::{build, close_open, gate, ms, text, Sample, BUDGET_STROKES};
use crate::harness::{time, BenchCtx, Samples};

/// How often each path is timed.
const RUNS: usize = 10;

/// Runs the `startup` suite and adds its measurements to the report.
pub fn run(ctx: &mut BenchCtx) -> Result<(), String> {
    let sample = build(ctx.pages, false)?;
    let last = *sample.sections.last().ok_or("the sample has no section")?;
    let (page, _) = sample
        .kit
        .inked_page_with(&sample.notebook, last, BUDGET_STROKES)
        .map_err(text)?;
    let mut scans = Samples::default();
    for _ in 0..RUNS {
        let (scanned, took) = time(|| sample.notebook.scan());
        std::hint::black_box(scanned.map_err(text)?);
        scans.push(took);
    }
    close_open(&sample.kit, &sample.root)?;
    let starts = start_path(&sample, page)?;
    let (start_gate, scan_gate) = (gate(ctx, 150.0), gate(ctx, 500.0));
    ctx.report.add(
        "startup.path.warm.p95",
        "ms",
        ms(starts.percentile(95.0)),
        Some(start_gate),
    );
    ctx.report.add(
        "scan.after_unclean_exit.p95",
        "ms",
        ms(scans.percentile(95.0)),
        Some(scan_gate),
    );
    Ok(())
}

/// Times the path from a new core to the last page's envelope, on files that are already warm.
fn start_path(sample: &Sample, page: PageId) -> Result<Samples, String> {
    let viewport = Rect {
        x: 0.0,
        y: 0.0,
        w: 800.0,
        h: 1_000.0,
    };
    let who = client("main-1");
    let mut starts = Samples::default();
    for _ in 0..RUNS {
        let (started, took) = time(|| {
            let second = sample.kit.beside();
            second.core.recover_pending(Some(&sample.root))?;
            let notebook = second.core.open_notebook(&sample.root)?;
            let handle = notebook.open_page(page, who.clone())?;
            let envelope = handle.envelope(Some(viewport))?;
            Ok::<_, CoreError>((second, handle, envelope))
        });
        let (second, handle, envelope) = started.map_err(text)?;
        std::hint::black_box(&envelope);
        handle.close(&who).map_err(text)?;
        close_open(&second, &sample.root)?;
        starts.push(took);
    }
    Ok(starts)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn the_suite_reports_the_start_path_and_the_scan() {
        let mut ctx = BenchCtx {
            pages: 60,
            quick: true,
            dir: PathBuf::new(),
            report: crate::harness::Report::default(),
        };
        run(&mut ctx).unwrap();
        let names: Vec<&str> = ctx.report.results.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["startup.path.warm.p95", "scan.after_unclean_exit.p95"]);
        assert_eq!(ctx.report.results[0].gate, Some(300.0));
    }
}
