//! A benchmark notebook with its budget page, and a page session over it: edits applied and journaled, and
//! saves with `SaveBegin`, as the app runs them.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opennote_core::id::RevisionId;
use opennote_core::limits::{Limits, Timings};
use opennote_core::model::Page;
use opennote_core::ops::{Op, Txn};
use opennote_core::seams::Applier;
use opennote_core::session::journal_thread::{BaseSnapshot, JournalConfig, JournalHandle, JournalMeta, JournalThread};
use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::{Durability, FileStamp, FolderIdentity};
use opennote_core::store::layout::{notebook_key, NotebookLayout};
use opennote_core::store::page_store::{PageStore, PageStoreConfig, SaveOutcome, SaveRequest};
use opennote_core::testing::NullSink;
use opennote_core::{Clock, SystemClock};

use super::workload::{budget_page, device, ids, retitle, stroke, txn, Workload};
use super::{make_dirs, Parts};

/// How long a benchmark waits for the journal thread.
pub const WAIT: Duration = Duration::from_secs(30);

/// A notebook folder holding the saved budget page.
pub struct Notebook {
    /// The page store over the parts under test.
    pub store: PageStore,
    /// The notebook folder.
    pub root: PathBuf,
    /// The budget page's folder.
    pub dir: PathBuf,
    /// The clock.
    pub clock: Arc<SystemClock>,
    /// The notebook folder's identity, which its journals record.
    pub identity: FolderIdentity,
}

impl Notebook {
    /// Creates the folders and saves the budget page for the first time.
    pub fn create(parts: &Parts, root: &Path, workload: &Workload) -> Result<Notebook, String> {
        let ids = ids();
        let dir = NotebookLayout::new(root).page_dir(ids.section, ids.page);
        make_dirs(&*parts.fs, &dir)?;
        let clock = Arc::new(SystemClock::new());
        let store = PageStore::new(PageStoreConfig {
            fs: parts.fs.clone(),
            codec: parts.codec.clone(),
            clock: clock.clone(),
            device: device(),
            writer: "opennote-perf".to_owned(),
            limits: Limits::default(),
        });
        let page = budget_page(workload);
        let request = SaveRequest {
            page: &page,
            pending: page.ink.pending(),
            through_seq: 0,
            base_stamp: None,
            journal: None,
            compaction: CompactionPlan::None,
        };
        store
            .save(&dir, request)
            .map_err(|e| format!("the first save: {e:?}"))?;
        let identity = parts
            .fs
            .folder_identity(root)
            .map_err(|e| format!("{}: {e}", root.display()))?;
        Ok(Notebook {
            store,
            root: root.to_owned(),
            dir,
            clock,
            identity,
        })
    }
}

/// The budget page, open with a journal.
pub struct Session {
    /// The journal thread.
    pub thread: JournalThread,
    /// The page's journal.
    pub handle: JournalHandle,
    /// The page as the session holds it.
    pub page: Page,
    stamp: FileStamp,
    seq: u64,
    drawn: u64,
    clock: Arc<SystemClock>,
    last_save: Option<(RevisionId, Durability)>,
}

impl Session {
    /// Loads the page and opens its journal in `journals`.
    pub fn start(parts: &Parts, notebook: &Notebook, journals: &Path) -> Result<Session, String> {
        make_dirs(&*parts.fs, journals)?;
        let loaded = notebook.store.load(&notebook.dir).map_err(|e| format!("open: {e:?}"))?;
        let thread = JournalThread::start(JournalConfig {
            fs: parts.fs.clone(),
            codec: parts.codec.clone(),
            root: journals.to_owned(),
            clock: notebook.clock.clone(),
            timings: Timings::default(),
            events: Arc::new(NullSink),
        })
        .map_err(|e| format!("journal: {e}"))?;
        let ids = ids();
        let meta = JournalMeta {
            notebook: ids.notebook,
            notebook_path: notebook.root.clone(),
            identity: notebook.identity,
            section: Some(ids.section),
            app: "opennote-perf".to_owned(),
            device: device().id,
            boot: parts.fs.boot_id().map_err(|e| e.to_string())?,
            page_format: 1,
        };
        let key = notebook_key(ids.notebook, &notebook.identity);
        let base = BaseSnapshot::of(loaded.page.revision.id, &loaded.bytes);
        let handle = thread
            .open_page(&key, loaded.page.id, meta, base)
            .map_err(|e| format!("journal: {e:?}"))?;
        Ok(Session {
            thread,
            handle,
            page: loaded.page,
            stamp: loaded.stamp,
            seq: 0,
            drawn: 0,
            clock: notebook.clock.clone(),
            last_save: None,
        })
    }

    /// Draws one new stroke: applies it and journals it.
    pub fn draw(&mut self, applier: &dyn Applier, workload: &Workload) -> Result<(), String> {
        let n = (workload.strokes as u64).saturating_add(self.drawn);
        self.drawn = self.drawn.saturating_add(1);
        let ops = vec![Op::AddStrokes {
            strokes: vec![stroke(n, workload.points)],
        }];
        let txn = txn(n, self.clock.now(), ops);
        applier
            .apply(&mut self.page, &txn)
            .map_err(|e| format!("draw: {e:?}"))?;
        self.seq = self.handle.append_txn(&txn);
        Ok(())
    }

    /// Draws strokes until the journal holds `workload.journal_bytes` since the last save, and flushes it.
    /// Returns how many transactions it journaled.
    pub fn fill_journal(&mut self, applier: &dyn Applier, workload: &Workload) -> Result<u32, String> {
        let mut txns = 0u32;
        while self.handle.bytes_since_save() < workload.journal_bytes {
            self.draw(applier, workload)?;
            txns = txns.saturating_add(1);
        }
        self.thread.flush_all(WAIT).map_err(|e| format!("journal: {e:?}"))?;
        Ok(txns)
    }

    /// A rename of the page, the size of a typing batch, that nothing applies.
    pub fn retitle_txn(&self, n: u64) -> Txn {
        let title = format!("Budget page {n}");
        txn(
            n.saturating_add(10_000_000),
            self.clock.now(),
            vec![retitle(&self.page, title)],
        )
    }

    /// Saves the page as the saver does, from S2 to S9, with the `SaveBegin` flush.
    pub fn save(&mut self, notebook: &Notebook, plan: CompactionPlan) -> Result<SaveOutcome, String> {
        let pending = self.page.ink.pending().to_vec();
        let request = SaveRequest {
            page: &self.page,
            pending: &pending,
            through_seq: self.seq,
            base_stamp: Some(self.stamp),
            journal: Some(&self.handle),
            compaction: plan,
        };
        let outcome = notebook
            .store
            .save(&notebook.dir, request)
            .map_err(|e| format!("save: {e:?}"))?;
        self.page.revision = outcome.revision.clone();
        self.page
            .ink
            .commit(pending.len(), outcome.segments.clone(), outcome.dead_bytes);
        self.stamp = outcome.stamp;
        Ok(outcome)
    }

    /// Hands the journal the new base snapshot after a save, which lets it rotate.
    pub fn after_save(&mut self, outcome: &SaveOutcome) {
        let base = BaseSnapshot::of(outcome.revision.id, &outcome.bytes);
        self.handle.after_save(outcome.durability, base, self.seq);
        self.last_save = Some((outcome.revision.id, outcome.durability));
    }

    /// Closes the page after its last save, and stops the journal thread.
    pub fn close(self) {
        self.handle.close(self.last_save);
        self.thread.shutdown(WAIT);
    }

    /// Stops as a crash would, leaving the journal's generations for recovery.
    pub fn crash(self) {
        drop(self.handle);
        self.thread.shutdown(WAIT);
    }
}
