use std::path::PathBuf;
use std::sync::Arc;

use opennote_core::testing::{MemFs, RegistryCodec, ScriptApplier};

use super::*;
use crate::harness::Report;

/// A few of everything, so the suite runs in a moment on the fakes.
fn small() -> Workload {
    Workload {
        blocks: 12,
        strokes: 40,
        points: 16,
        runs: 12,
        saves: 12,
        appends: 20,
        journal_bytes: 16 << 10,
        recoveries: 2,
        gate_scale: 1.0,
    }
}

fn fakes() -> Parts {
    Parts {
        fs: Arc::new(MemFs::new()),
        codec: Arc::new(RegistryCodec::new()),
        applier: Arc::new(ScriptApplier),
        root: PathBuf::from("/bench"),
    }
}

fn ctx() -> BenchCtx {
    BenchCtx {
        pages: 1,
        quick: true,
        dir: PathBuf::from("/bench"),
        report: Report::default(),
    }
}

#[test]
fn the_suite_runs_on_the_fakes_and_reports_every_measure() {
    let mut ctx = ctx();
    run_with(&mut ctx, &fakes(), &small()).unwrap();
    let names: Vec<&str> = ctx.report.results.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "store.open.budget_page.p95",
            "store.open.budget_page.p50",
            "store.save.one_stroke.p95",
            "store.save.one_stroke.p50",
            "store.save.base_snapshot.p95",
            "store.journal.append_flush.p99",
            "store.journal.append_flush.p50",
            "store.recovery.journal_4mib.max",
        ]
    );
    for m in &ctx.report.results {
        assert!(m.value.is_finite() && m.value >= 0.0, "{}: {}", m.name, m.value);
        assert_eq!(m.unit, "ms");
    }
    let gated: Vec<f64> = ctx.report.results.iter().filter_map(|m| m.gate).collect();
    assert_eq!(gated, [25.0, 25.0, 30.0, 100.0]);
}

#[test]
fn the_quick_set_takes_fewer_samples_and_doubles_the_budgets() {
    let full = Workload::budget(false);
    let quick = Workload::budget(true);
    assert_eq!((full.blocks, full.strokes, full.journal_bytes), (500, 5_000, 4 << 20));
    assert_eq!((quick.blocks, quick.strokes), (full.blocks, full.strokes));
    assert!(quick.runs < full.runs && quick.saves < full.saves && quick.appends < full.appends);
    assert_eq!((full.gate_scale, quick.gate_scale), (1.0, 2.0));
}

/// The p95 of the full set's saves when each takes `save_ms`, except `stalled` saves in a row of 60 ms.
fn save_p95(save_ms: u64, stalled: usize) -> Duration {
    let mut samples = Samples::default();
    for n in 0..Workload::budget(false).saves {
        let slow = (40..40 + stalled).contains(&n);
        samples.push(Duration::from_millis(if slow { 60 } else { save_ms }));
    }
    samples.percentile(95.0)
}

#[test]
fn one_disk_stall_cannot_set_the_save_percentile() {
    // A hosted runner's disk stalled for 20 saves in a row at most. A nightly with 100 saves failed when 6 of them
    // took 60 ms. The save count must outlast such a stall, so the 95th percentile stays the save's own.
    assert_eq!(save_p95(4, 20), Duration::from_millis(4));
    assert!(ms(save_p95(4, 20)) < SAVE_BUDGET_MS);
}

#[test]
fn a_slower_save_still_moves_the_save_percentile() {
    // A save that is twice as slow doubles the 95th percentile, even with a stall. So the budget still catches it.
    assert_eq!(save_p95(8, 20), save_p95(4, 20) * 2);
    assert_eq!(save_p95(30, 0), Duration::from_millis(30));
    assert!(ms(save_p95(30, 20)) > SAVE_BUDGET_MS);
}

#[test]
fn the_budget_page_has_its_blocks_and_strokes() {
    let workload = small();
    let page = workload::budget_page(&workload);
    assert_eq!(page.blocks.len(), workload.blocks);
    assert_eq!(page.ink.strokes().count(), workload.strokes);
    assert_eq!(page.ink.pending().len(), workload.strokes);
    let stroke = workload::stroke(7, 80);
    assert_eq!(stroke.point_count, 80);
    assert!(
        stroke.points.len() <= 80 * 5,
        "about 4 bytes per point: {}",
        stroke.points.len()
    );
}

#[test]
fn the_quick_suite_runs_on_the_real_parts() {
    let dir = tempfile::tempdir().unwrap();
    let mut ctx = BenchCtx {
        dir: dir.path().to_owned(),
        ..ctx()
    };
    run(&mut ctx).unwrap();
    assert_eq!(ctx.report.results.len(), 8);
    assert!(!dir.path().join("store").exists(), "the run cleans up after itself");
}
