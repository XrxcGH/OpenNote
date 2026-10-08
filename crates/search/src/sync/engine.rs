//! The single-threaded engine: queue jobs, run them, retry what may pass.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opennote_core::{NotebookId, PageId, SectionId};

use super::job::{Job, JobQueue, Key};
use super::lock;
use super::source::PageSource;
use super::types::{IndexEvent, IndexUpdate, IndexerConfig, IndexerStats, Observer, RenamePlan};
use super::SharedIndex;
use crate::doc::PageDoc;
use crate::error::{Result, SearchError};
use crate::index::SearchIndex;
use crate::persist;
use crate::prepare::Prepared;
use crate::write::prepare_unless_locked;

pub(super) struct Retry {
    pub(super) job: Job,
    pub(super) due: Instant,
}

/// The single-threaded engine. Queue jobs with [`Indexer::enqueue`] and run them with [`Indexer::run`].
pub struct Indexer<S: PageSource> {
    pub(super) index: SharedIndex,
    pub(super) source: S,
    pub(super) config: IndexerConfig,
    pub(super) observer: Option<Observer>,
    pub(super) queue: JobQueue,
    pub(super) retries: Vec<Retry>,
    pub(super) attempts: HashMap<Key, u32>,
    pub(super) failures: BTreeMap<PageId, String>,
    pub(super) known: BTreeSet<NotebookId>,
    pub(super) stats: IndexerStats,
    pub(super) damaged: bool,
    pub(super) auto_rebuilds: u32,
    /// Pages whose title changed, with when the title settles if it stays.
    pub(super) settles: BTreeMap<PageId, Instant>,
    /// Set by whoever wants the indexer to stop. See [`Indexer::stop_signal`].
    stop: Arc<AtomicBool>,
    /// When the indexer first saw the stop signal.
    stop_seen: Option<Instant>,
}

impl<S: PageSource> Indexer<S> {
    /// An indexer for an index, reading notes from a source.
    pub fn new(index: SharedIndex, source: S, config: IndexerConfig, observer: Option<Observer>) -> Indexer<S> {
        Indexer {
            index,
            source,
            config,
            observer,
            queue: JobQueue::default(),
            retries: Vec::new(),
            attempts: HashMap::new(),
            failures: BTreeMap::new(),
            known: BTreeSet::new(),
            stats: IndexerStats::default(),
            damaged: false,
            auto_rebuilds: 0,
            settles: BTreeMap::new(),
            stop: Arc::new(AtomicBool::new(false)),
            stop_seen: None,
        }
    }

    /// A flag that asks the indexer to stop. Set it from any thread. The indexer then goes on for
    /// [`IndexerConfig::shutdown_grace`], so a short queue finishes, and after that it ends its work between two
    /// batches and leaves the rest for the next start, which compares the notes with the index anyway. A rebuild
    /// that was still filling is dropped and the old file stays.
    pub fn stop_signal(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    /// Whether the work that waits should be left for the next start.
    pub(super) fn stopping(&mut self) -> bool {
        if !self.stop.load(Ordering::Acquire) {
            self.stop_seen = None;
            return false;
        }
        let seen = *self.stop_seen.get_or_insert_with(Instant::now);
        seen.elapsed() >= self.config.shutdown_grace
    }

    /// What the indexer has done so far.
    pub fn stats(&self) -> IndexerStats {
        self.stats
    }

    /// Pages that could not be read, with why. A page leaves the list when it is read or removed.
    pub fn failures(&self) -> Vec<(PageId, String)> {
        self.failures.iter().map(|(page, why)| (*page, why.clone())).collect()
    }

    /// Whether the queue and the list of retries are both empty.
    pub fn is_idle(&self) -> bool {
        self.queue.is_empty() && self.retries.is_empty()
    }

    /// When the next retry is due, or the next title settles.
    pub fn next_retry(&self) -> Option<Instant> {
        let retries = self.retries.iter().map(|retry| retry.due);
        retries.chain(self.settles.values().copied()).min()
    }

    /// Adds a job. It merges with a waiting job about the same page, notebook, or section.
    pub fn enqueue(&mut self, job: Job) {
        let key = job.key();
        self.retries.retain(|retry| retry.job.key() != key);
        self.attempts.remove(&key);
        self.queue.push(job);
    }

    /// Runs every waiting job, and every retry that is due at `now`. Returns how many jobs it ran.
    pub fn run(&mut self, now: Instant) -> usize {
        self.release_retries(now);
        let mut ran = 0;
        while !self.stopping() {
            let Some(job) = self.queue.pop() else {
                break;
            };
            ran += 1;
            if self.damaged && !matches!(job, Job::Rebuild { .. }) {
                continue;
            }
            match job {
                Job::Reload { .. } => {
                    let mut batch = vec![job];
                    while batch.len() < self.config.batch.max(1) && self.queue.front_is_reload() {
                        batch.extend(self.queue.pop());
                    }
                    self.reload(batch, now);
                }
                Job::Remove { page } => self.remove(page, now),
                Job::Reconcile { notebook } => self.reconcile(notebook, now),
                Job::CloseNotebook { notebook } => self.close_notebook(notebook, now),
                Job::PurgeSection { section } => self.purge_section(section, now),
                Job::Start { notebooks } => self.start(notebooks, now),
                Job::Rebuild { notebooks } => self.rebuild(notebooks, now),
                Job::Damaged { message } => self.index_failed(&SearchError::Damaged(message)),
                Job::SettleTitle { page } => self.settle(page),
            }
            self.release_retries(now);
        }
        if ran > 0 && self.is_idle() {
            self.emit(IndexEvent::CaughtUp);
        }
        ran
    }

    pub(super) fn emit(&mut self, event: IndexEvent) {
        if let Some(observer) = &mut self.observer {
            observer(event);
        }
    }

    pub(super) fn release_retries(&mut self, now: Instant) {
        let (due, waiting): (Vec<Retry>, Vec<Retry>) = std::mem::take(&mut self.retries)
            .into_iter()
            .partition(|retry| retry.due <= now);
        self.retries = waiting;
        for retry in due {
            self.queue.push(retry.job);
        }
        let settled: Vec<PageId> = self
            .settles
            .iter()
            .filter(|(_, due)| **due <= now)
            .map(|(page, _)| *page)
            .collect();
        for page in settled {
            self.settles.remove(&page);
            self.queue.push(Job::SettleTitle { page });
        }
    }

    /// Schedules a job again after a failure that may pass, or gives up on it.
    pub(super) fn retry(&mut self, job: Job, now: Instant, why: &str) {
        let key = job.key();
        let attempts = self.attempts.get(&key).copied().unwrap_or(0) + 1;
        if attempts > self.config.max_attempts {
            self.attempts.remove(&key);
            if let Job::Reload { page, .. } = job {
                self.fail(page, why.to_string());
            }
            return;
        }
        self.attempts.insert(key, attempts);
        self.stats.retries += 1;
        let delay = self.config.retry_base * 2u32.saturating_pow(attempts - 1);
        self.retries.push(Retry {
            job,
            due: now + delay.min(Duration::from_secs(10)),
        });
    }

    pub(super) fn fail(&mut self, page: PageId, message: String) {
        self.stats.failures += 1;
        self.failures.insert(page, message.clone());
        self.emit(IndexEvent::Failed { page, message });
    }

    /// Handles the error of a job that changes the index. Damage rebuilds the file, and anything else, such as a
    /// full disk, may pass, so the job is tried again with the same delays as a read.
    fn retry_or_rebuild(&mut self, job: Job, now: Instant, error: &SearchError) {
        if error.is_corrupt() {
            self.index_failed(error);
        } else {
            self.retry(job, now, &error.to_string());
        }
    }

    /// Handles an error of the index itself. Damage stops the work until a rebuild.
    pub(super) fn index_failed(&mut self, error: &SearchError) {
        if !error.is_corrupt() {
            return;
        }
        self.damaged = true;
        self.emit(IndexEvent::Damaged {
            message: error.to_string(),
        });
        if self.config.auto_rebuild && self.auto_rebuilds < 3 && !self.known.is_empty() {
            self.auto_rebuilds += 1;
            self.queue.push(Job::Rebuild {
                notebooks: self.known.iter().copied().collect(),
            });
        }
    }

    pub(super) fn notebook_of(&self, page: PageId) -> Option<NotebookId> {
        lock(&self.index)
            .indexed_page(page)
            .ok()
            .flatten()
            .map(|held| held.notebook)
    }

    fn reload(&mut self, batch: Vec<Job>, now: Instant) {
        let mut docs = Vec::new();
        let mut gone = Vec::new();
        for job in batch {
            let Job::Reload { page, notebook } = job else {
                continue;
            };
            let Some(notebook) = notebook.or_else(|| self.notebook_of(page)) else {
                self.stats.skipped += 1;
                continue;
            };
            match self.source.read(notebook, page) {
                Ok(Some(doc)) => {
                    self.failures.remove(&page);
                    self.attempts.remove(&Key::Page(page));
                    docs.push(doc);
                }
                Ok(None) => gone.push(page),
                Err(error) if error.transient => self.retry(
                    Job::Reload {
                        page,
                        notebook: Some(notebook),
                    },
                    now,
                    &error.message,
                ),
                Err(error) => self.fail(page, error.message),
            }
        }
        self.apply(docs, gone, now);
    }

    /// Prepares the rows of each document before any lock is taken, because turning Markdown into rows is the
    /// slow part of a write. A page whose text cannot be prepared keeps its title and tags in the index and is
    /// listed as a failure, so the next start does not read it again.
    pub(super) fn prepare_all(&mut self, docs: &mut [PageDoc]) -> Vec<Option<Prepared>> {
        let mut out = Vec::with_capacity(docs.len());
        for doc in docs.iter_mut() {
            let view: &PageDoc = doc;
            match std::panic::catch_unwind(|| prepare_unless_locked(view)) {
                Ok(rows) => out.push(rows),
                Err(_) => {
                    doc.blocks.clear();
                    out.push(prepare_unless_locked(doc));
                    self.fail(
                        doc.page,
                        "the text of the page could not be prepared for search".to_string(),
                    );
                }
            }
        }
        out
    }

    /// Writes documents and removes pages in one transaction each, and tells the observer.
    pub(super) fn apply(&mut self, mut docs: Vec<PageDoc>, gone: Vec<PageId>, now: Instant) {
        if docs.is_empty() && gone.is_empty() {
            return;
        }
        let prepared = self.prepare_all(&mut docs);
        let mut update = IndexUpdate::default();
        let settle_now = self.config.settle.is_zero();
        let mut retitled = Vec::new();
        let outcome: Result<()> = (|| {
            let mut index = lock(&self.index);
            if !docs.is_empty() {
                let report = index.write_prepared(&docs, &prepared)?;
                update.added = report.added;
                update.updated = report.updated;
                update.removed = report.removed;
                for rename in report.renames {
                    if settle_now {
                        update.renames.extend(settle_plan(&mut index, rename.page)?);
                    } else {
                        retitled.push(rename.page);
                    }
                }
            }
            for page in &gone {
                if index.delete_page(*page)? {
                    update.removed.push(*page);
                }
            }
            update.generation = index.generation();
            Ok(())
        })();
        match outcome {
            Ok(()) => {
                for page in retitled {
                    self.settles.insert(page, now + self.config.settle);
                }
                self.stats.batches += 1;
                self.stats.written += (update.added.len() + update.updated.len()) as u64;
                self.stats.removed += update.removed.len() as u64;
                for page in &gone {
                    self.failures.remove(page);
                }
                self.emit(IndexEvent::Updated(update));
            }
            Err(error) => {
                for doc in &docs {
                    self.retry(
                        Job::Reload {
                            page: doc.page,
                            notebook: Some(doc.notebook),
                        },
                        now,
                        &error.to_string(),
                    );
                }
                if !error.is_corrupt() {
                    for page in gone {
                        self.retry(Job::Remove { page }, now, &error.to_string());
                    }
                }
                self.index_failed(&error);
            }
        }
    }

    fn remove(&mut self, page: PageId, now: Instant) {
        self.failures.remove(&page);
        let removed = lock(&self.index).delete_page(page);
        match removed {
            Ok(true) => {
                self.stats.removed += 1;
                let generation = lock(&self.index).generation();
                self.emit(IndexEvent::Updated(IndexUpdate {
                    removed: vec![page],
                    generation,
                    ..IndexUpdate::default()
                }));
            }
            Ok(false) => {}
            Err(error) => self.retry_or_rebuild(Job::Remove { page }, now, &error),
        }
    }

    pub(super) fn close_notebook(&mut self, notebook: NotebookId, now: Instant) {
        self.known.remove(&notebook);
        let result = (|| {
            let mut index = lock(&self.index);
            let held: Vec<PageId> = index
                .indexed_pages()?
                .into_iter()
                .filter(|page| page.notebook == notebook)
                .map(|page| page.page)
                .collect();
            index.delete_notebook(notebook)?;
            Ok::<_, SearchError>((held, index.generation()))
        })();
        match result {
            Ok((held, generation)) if !held.is_empty() => {
                self.stats.removed += held.len() as u64;
                for page in &held {
                    self.failures.remove(page);
                }
                self.emit(IndexEvent::Updated(IndexUpdate {
                    removed: held,
                    generation,
                    ..IndexUpdate::default()
                }));
            }
            Ok(_) => {}
            Err(error) => self.retry_or_rebuild(Job::CloseNotebook { notebook }, now, &error),
        }
    }

    fn purge_section(&mut self, section: SectionId, now: Instant) {
        let result = (|| {
            let mut index = lock(&self.index);
            let held: Vec<PageId> = index
                .indexed_pages()?
                .into_iter()
                .filter(|page| page.section == section)
                .map(|page| page.page)
                .collect();
            index.purge_section(section)?;
            Ok::<_, SearchError>((held, index.generation()))
        })();
        match result {
            Ok((held, generation)) if !held.is_empty() => {
                self.stats.removed += held.len() as u64;
                self.emit(IndexEvent::Updated(IndexUpdate {
                    removed: held,
                    generation,
                    ..IndexUpdate::default()
                }));
            }
            Ok(_) => {}
            Err(error) => self.retry_or_rebuild(Job::PurgeSection { section }, now, &error),
        }
    }

    fn start(&mut self, notebooks: Vec<NotebookId>, now: Instant) {
        self.known = notebooks.iter().copied().collect();
        // A file closed cleanly is trusted at open without a check, so damage from a bad sector or a partial
        // restore would go unnoticed. The check runs here instead, where searches go on beside it.
        let path = lock(&self.index).path().map(Path::to_path_buf);
        if path.is_some_and(|path| !persist::file_passes_quick_check(&path)) {
            self.index_failed(&SearchError::Damaged(
                "the file failed SQLite's quick check".to_string(),
            ));
            return;
        }
        let stale: Result<Vec<NotebookId>> = (|| {
            let index = lock(&self.index);
            let held: BTreeSet<NotebookId> = index.indexed_pages()?.into_iter().map(|page| page.notebook).collect();
            Ok(held.into_iter().filter(|nb| !self.known.contains(nb)).collect())
        })();
        match stale {
            Ok(stale) => {
                for notebook in stale {
                    self.close_notebook(notebook, now);
                }
            }
            Err(error) => {
                self.index_failed(&error);
                return;
            }
        }
        for notebook in notebooks {
            self.queue.push(Job::Reconcile { notebook });
        }
        // A title still unsettled was changed in an earlier run that ended before it settled.
        let unsettled = lock(&self.index).unsettled_pages();
        match unsettled {
            Ok(pages) => pages
                .into_iter()
                .for_each(|page| self.queue.push(Job::SettleTitle { page })),
            Err(error) => self.index_failed(&error),
        }
    }

    /// Settles a page's title and tells the observer the plan for the links, if the title changed.
    fn settle(&mut self, page: PageId) {
        self.settles.remove(&page);
        let result = (|| {
            let mut index = lock(&self.index);
            let plan = settle_plan(&mut index, page)?;
            Ok::<_, SearchError>((plan, index.generation()))
        })();
        match result {
            Ok((Some(plan), generation)) => self.emit(IndexEvent::Updated(IndexUpdate {
                renames: vec![plan],
                generation,
                ..IndexUpdate::default()
            })),
            Ok((None, _)) => {}
            Err(error) => self.index_failed(&error),
        }
    }
}

/// Settles a page's title, and makes the plan for the links that named the title it had settled on before.
fn settle_plan(index: &mut SearchIndex, page: PageId) -> Result<Option<RenamePlan>> {
    let Some(rename) = index.settle_title(page)? else {
        return Ok(None);
    };
    let edits = index.rename_edits(&rename)?;
    Ok(Some(RenamePlan { rename, edits }))
}
