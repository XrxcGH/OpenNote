//! [`Writer`]: one page's session, as the app runs it: edits applied and journaled, saves with `SaveBegin`, and
//! an oracle of every state the page went through. Every call tolerates a crashed file system.

use std::sync::Arc;
use std::time::Duration;

use opennote_core::id::RevisionId;
use opennote_core::limits::Timings;
use opennote_core::model::Page;
use opennote_core::ops::Op;
use opennote_core::seams::Applier;
use opennote_core::session::journal_thread::{BaseSnapshot, JournalConfig, JournalHandle, JournalThread};
use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::{Durability, FileStamp, Fs};
use opennote_core::store::page_store::{PageStore, SaveError, SaveOutcome, SaveRequest};
use opennote_core::testing::{NullSink, RegistryCodec, ScriptApplier};
use opennote_core::{Clock, TestClock};

use super::{clock, key, meta, page_dir, retitle, store, stroke, txn, JOURNALS, WAIT};

/// A page session over any file system.
pub struct Writer {
    pub fs: Arc<dyn Fs>,
    pub clock: Arc<TestClock>,
    pub store: PageStore,
    pub thread: JournalThread,
    pub handle: Option<JournalHandle>,
    pub page: Page,
    pub stamp: Option<FileStamp>,
    pub seq: u64,
    /// The journal sequence number of each oracle step after the first.
    pub seqs: Vec<u64>,
    /// The page after each step, starting with the page as loaded.
    pub oracle: Vec<Page>,
    pub last_save: Option<(RevisionId, Durability)>,
}

impl Writer {
    /// Loads the page and opens its journal.
    pub fn open(fs: Arc<dyn Fs>, codec: &RegistryCodec, timings: Timings) -> Writer {
        let clock = clock();
        let store = store(fs.clone(), codec);
        let loaded = store.load(&page_dir()).unwrap();
        let thread = JournalThread::start(JournalConfig {
            fs: fs.clone(),
            codec: Arc::new(codec.clone()),
            root: JOURNALS.into(),
            clock: clock.clone(),
            timings,
            events: Arc::new(NullSink),
        })
        .unwrap();
        let base = BaseSnapshot::of(loaded.page.revision.id, &loaded.bytes);
        let handle = thread.open_page(&key(&*fs), loaded.page.id, meta(&*fs), base).unwrap();
        Writer {
            fs,
            clock,
            store,
            thread,
            handle: Some(handle),
            oracle: vec![loaded.page.clone()],
            page: loaded.page,
            stamp: Some(loaded.stamp),
            seq: 0,
            seqs: Vec::new(),
            last_save: None,
        }
    }

    /// Applies and journals a transaction, if its checks pass.
    pub fn apply(&mut self, ops: Vec<Op>) -> Option<u64> {
        let txn = txn(self.clock.now(), ops);
        ScriptApplier.apply(&mut self.page, &txn).ok()?;
        self.seq = self.handle.as_ref()?.append_txn(&txn);
        self.seqs.push(self.seq);
        self.oracle.push(self.page.clone());
        self.clock.advance(Duration::from_millis(10));
        Some(self.seq)
    }

    /// Renames the page.
    pub fn retitle(&mut self, title: &str) -> Option<u64> {
        let before = self.page.title.clone();
        self.apply(vec![retitle(&before, title)])
    }

    /// Draws stroke `n`, unless it is on the page.
    pub fn draw(&mut self, n: u64) -> Option<u64> {
        if self.page.ink.stroke(stroke(n).id).is_some() {
            return None;
        }
        self.apply(vec![Op::AddStrokes {
            strokes: vec![stroke(n)],
        }])
    }

    /// Erases stroke `n`, if it is on the page.
    pub fn erase(&mut self, n: u64) -> Option<u64> {
        let found = self.page.ink.stroke(stroke(n).id)?.clone();
        self.apply(vec![Op::RemoveStrokes { strokes: vec![found] }])
    }

    /// Saves as a session does, and waits for the journal to take the new base.
    pub fn save(&mut self, compaction: CompactionPlan) -> Result<SaveOutcome, SaveError> {
        let pending = self.page.ink.pending().to_vec();
        let request = SaveRequest {
            page: &self.page,
            pending: &pending,
            through_seq: self.seq,
            base_stamp: self.stamp,
            journal: self.handle.as_ref(),
            compaction,
        };
        let outcome = self.store.save(&page_dir(), request)?;
        self.page.revision = outcome.revision.clone();
        self.page
            .ink
            .commit(pending.len(), outcome.segments.clone(), outcome.dead_bytes);
        self.stamp = Some(outcome.stamp);
        self.last_save = Some((outcome.revision.id, outcome.durability));
        if let Some(handle) = &self.handle {
            handle.after_save(
                outcome.durability,
                BaseSnapshot::of(outcome.revision.id, &outcome.bytes),
                self.seq,
            );
        }
        self.flush();
        Ok(outcome)
    }

    /// Flushes every journal, and waits for the journal thread to finish what it was sent.
    pub fn flush(&self) -> bool {
        self.thread.flush_all(WAIT).is_ok()
    }

    /// Closes the page's journal with the last save, and waits for it.
    pub fn close(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.close(self.last_save);
        }
        self.flush();
    }

    /// How many oracle steps after the first are durable in the journal.
    pub fn durable_steps(&self) -> usize {
        let durable = self.handle.as_ref().map_or(self.seq, JournalHandle::durable_seq);
        self.seqs.iter().filter(|&&seq| seq <= durable).count()
    }
}
