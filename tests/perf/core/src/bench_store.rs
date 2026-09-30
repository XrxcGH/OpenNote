//! Storage benchmarks: page open and save costs, journal append and flush, and recovery of a 4 MiB journal
//! (plan 13.9). Owned by WP4.
//!
//! [`run`] measures the real parts on the disk under test: `StdFs`, `CanonicalCodec`, and `OpsApplier`.
//! [`run_with`] takes any parts, so a test can run the whole suite on the in-memory fakes.

mod recovery;
mod session;
pub mod workload;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opennote_core::format::CanonicalCodec;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::seams::{Applier, Codec};
use opennote_core::store::compact::plan_compaction;
use opennote_core::store::fs::Fs;
use opennote_core::store::std_fs::StdFs;
use opennote_core::{FsErrorKind, Timings};

use crate::harness::{time, BenchCtx, Samples};
use session::{Notebook, Session};
pub use workload::Workload;

/// The budgets of plan 13.9, in milliseconds, before the quick set doubles them.
const OPEN_BUDGET_MS: f64 = 25.0;
const SAVE_BUDGET_MS: f64 = 25.0;
const JOURNAL_BUDGET_MS: f64 = 30.0;
const RECOVERY_BUDGET_MS: f64 = 100.0;

/// The file system, codec, and applier a run measures, and the folder it works in.
pub struct Parts {
    /// The file system under test.
    pub fs: Arc<dyn Fs>,
    /// The codec.
    pub codec: Arc<dyn Codec>,
    /// The applier recovery replays with.
    pub applier: Arc<dyn Applier>,
    /// An empty folder for the benchmark's notebooks and journals.
    pub root: PathBuf,
}

/// Runs the `store` suite on the disk that holds `ctx.dir`, and adds its measurements to the report.
pub fn run(ctx: &mut BenchCtx) -> Result<(), String> {
    let root = ctx.dir.join("store");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| format!("{}: {e}", root.display()))?;
    let parts = Parts {
        fs: Arc::new(StdFs::new(&Timings::default())),
        codec: Arc::new(CanonicalCodec),
        applier: Arc::new(OpsApplier),
        root: root.clone(),
    };
    let workload = Workload::budget(ctx.quick);
    let result = run_with(ctx, &parts, &workload);
    let _ = std::fs::remove_dir_all(&root);
    result
}

/// Runs the `store` suite with these parts and this much work.
pub fn run_with(ctx: &mut BenchCtx, parts: &Parts, workload: &Workload) -> Result<(), String> {
    let notebook = Notebook::create(parts, &parts.root.join("notebook"), workload)?;
    open_budget_page(ctx, &notebook, workload)?;
    let mut session = Session::start(parts, &notebook, &parts.root.join("journal"))?;
    save_after_one_stroke(ctx, parts, &notebook, &mut session, workload)?;
    append_and_flush(ctx, &session, workload)?;
    session.close();
    recovery::run(ctx, parts, workload)
}

/// Warm opens of the budget page: `page.json`, every segment, and the live ink.
fn open_budget_page(ctx: &mut BenchCtx, notebook: &Notebook, workload: &Workload) -> Result<(), String> {
    let mut samples = Samples::default();
    for _ in 0..workload.runs {
        let (loaded, took) = time(|| notebook.store.load(&notebook.dir));
        let loaded = loaded.map_err(|e| format!("open: {e:?}"))?;
        if !loaded.damaged.is_empty() || !loaded.missing.is_empty() {
            return Err(format!(
                "open: {} damaged, {} missing",
                loaded.damaged.len(),
                loaded.missing.len()
            ));
        }
        samples.push(took);
    }
    let gate = OPEN_BUDGET_MS * workload.gate_scale;
    ctx.report.add(
        "store.open.budget_page.p95",
        "ms",
        ms(samples.percentile(95.0)),
        Some(gate),
    );
    ctx.report
        .add("store.open.budget_page.p50", "ms", ms(samples.percentile(50.0)), None);
    Ok(())
}

/// Saves of the budget page after one new stroke each: steps S2 to S9 of spec 17.7, with the `SaveBegin` flush
/// and whatever compaction the saver would choose. The gzip of the new base snapshot, which the saver hands the
/// journal afterward, is measured on its own.
fn save_after_one_stroke(
    ctx: &mut BenchCtx,
    parts: &Parts,
    notebook: &Notebook,
    session: &mut Session,
    workload: &Workload,
) -> Result<(), String> {
    let mut saves = Samples::default();
    let mut snapshots = Samples::default();
    for _ in 0..workload.runs {
        session.draw(&*parts.applier, workload)?;
        let plan = plan_compaction(&session.page.ink);
        let (outcome, took) = time(|| session.save(notebook, plan));
        let outcome = outcome?;
        saves.push(took);
        let ((), took) = time(|| session.after_save(&outcome));
        snapshots.push(took);
    }
    let gate = SAVE_BUDGET_MS * workload.gate_scale;
    ctx.report.add(
        "store.save.one_stroke.p95",
        "ms",
        ms(saves.percentile(95.0)),
        Some(gate),
    );
    ctx.report
        .add("store.save.one_stroke.p50", "ms", ms(saves.percentile(50.0)), None);
    ctx.report.add(
        "store.save.base_snapshot.p95",
        "ms",
        ms(snapshots.percentile(95.0)),
        None,
    );
    Ok(())
}

/// Journal appends of a typing-sized record, each flushed at once.
fn append_and_flush(ctx: &mut BenchCtx, session: &Session, workload: &Workload) -> Result<(), String> {
    let mut samples = Samples::default();
    for n in 0..workload.appends {
        let txn = session.retitle_txn(n as u64);
        let (flushed, took) = time(|| {
            session.handle.append_txn(&txn);
            session.thread.flush_all(session::WAIT)
        });
        flushed.map_err(|e| format!("journal: {e:?}"))?;
        samples.push(took);
    }
    let gate = JOURNAL_BUDGET_MS * workload.gate_scale;
    ctx.report.add(
        "store.journal.append_flush.p99",
        "ms",
        ms(samples.percentile(99.0)),
        Some(gate),
    );
    ctx.report.add(
        "store.journal.append_flush.p50",
        "ms",
        ms(samples.percentile(50.0)),
        None,
    );
    Ok(())
}

/// Creates a folder and every missing folder above it.
fn make_dirs(fs: &dyn Fs, path: &Path) -> Result<(), String> {
    let mut missing = Vec::new();
    for dir in path.ancestors() {
        match fs.metadata(dir) {
            Ok(_) => break,
            Err(err) if err.kind == FsErrorKind::NotFound => missing.push(dir),
            Err(err) => return Err(format!("{}: {err}", dir.display())),
        }
    }
    for dir in missing.into_iter().rev() {
        match fs.create_dir_durable(dir) {
            Ok(_) => {}
            Err(err) if err.kind == FsErrorKind::AlreadyExists => {}
            Err(err) => return Err(format!("{}: {err}", dir.display())),
        }
    }
    Ok(())
}

/// A duration in milliseconds.
fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

#[cfg(test)]
mod tests;
