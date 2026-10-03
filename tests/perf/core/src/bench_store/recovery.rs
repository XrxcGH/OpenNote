//! Recovery of a page whose journal holds 4 MiB of unsaved strokes, as at start-up after a crash.

use std::path::{Path, PathBuf};

use opennote_core::session::events::RecoveryOutcome;
use opennote_core::store::journal::reader::list_journals;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::recovery::{recover_page, RecoverCtx};
use opennote_core::PageId;

use super::session::{Notebook, Session};
use super::workload::{ids, Workload};
use super::{make_dirs, ms, Parts, RECOVERY_BUDGET_MS};
use crate::harness::{time, BenchCtx, Samples};

/// Fills a fresh notebook's journal, stops as a crash would, and times recovery: listing the journals, loading
/// the page, replaying every record, and saving the result.
pub(super) fn run(ctx: &mut BenchCtx, parts: &Parts, workload: &Workload) -> Result<(), String> {
    let mut samples = Samples::default();
    for run in 0..workload.recoveries {
        let root = parts.root.join(format!("recovery-{run}"));
        let notebook = Notebook::create(parts, &root.join("notebook"), workload)?;
        let journals = root.join("journal");
        let mut session = Session::start(parts, &notebook, &journals)?;
        let txns = session.fill_journal(&*parts.applier, workload)?;
        session.crash();
        let recovery_dir = root.join("recovery");
        make_dirs(&*parts.fs, &recovery_dir)?;
        let (outcome, took) = time(|| recover(parts, &notebook, &journals, &recovery_dir));
        match outcome? {
            RecoveryOutcome::Replayed { txns: replayed, .. } if replayed == txns => {}
            other => return Err(format!("recovery: {other:?}, expected {txns} transactions")),
        }
        samples.push(took);
    }
    let gate = RECOVERY_BUDGET_MS * workload.gate_scale;
    ctx.report.add(
        "store.recovery.journal_4mib.max",
        "ms",
        ms(samples.percentile(100.0)),
        Some(gate),
    );
    Ok(())
}

fn recover(
    parts: &Parts,
    notebook: &Notebook,
    journals: &Path,
    recovery_dir: &Path,
) -> Result<RecoveryOutcome, String> {
    let fs = &*parts.fs;
    let generations: Vec<PathBuf> = list_journals(fs, journals)
        .map_err(|e| format!("journals: {e}"))?
        .into_iter()
        .flat_map(|key| key.pages.into_values().flatten())
        .collect();
    let layout = NotebookLayout::new(&notebook.root);
    let boot = fs.boot_id().map_err(|e| e.to_string())?;
    let dir = notebook.dir.clone();
    let locate = move |_: PageId| Some(dir.clone());
    let ctx = RecoverCtx {
        fs,
        codec: &*parts.codec,
        applier: &*parts.applier,
        store: &notebook.store,
        layout: &layout,
        identity: &notebook.identity,
        boot: &boot,
        clock: &*notebook.clock,
        locate: &locate,
        recovery_dir,
    };
    recover_page(&ctx, ids().page, &generations).map_err(|e| format!("recovery: {e}"))
}
