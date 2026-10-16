//! The indexer on its own thread, and the handle the core and the app talk to.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use opennote_core::session::events::{CoreEvent, IndexHint, IndexSink};
use opennote_core::{NotebookId, PageId, SectionId};

use super::engine::Indexer;
use super::job::{jobs_for_event, Job, JobQueue};
use super::lock;
use super::source::PageSource;
use super::types::{IndexerConfig, IndexerStats, Observer};
use super::SharedIndex;
use crate::error::{Result, SearchError};
use crate::index::SearchIndex;
use crate::pattern::{PatternScan, PATTERN_TIME_BUDGET};
use crate::query::Query;
use crate::rank::RankContext;
use crate::search::{is_pattern, SearchHit, SearchLimits, SearchResults};

/// How long a pattern search holds the index before it lets go, so the indexer and other searches can go first.
const PATTERN_SLICE: Duration = Duration::from_millis(20);

struct State {
    queue: JobQueue,
    working: bool,
    stop: bool,
    retrying: bool,
    stats: IndexerStats,
    failures: Vec<(PageId, String)>,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    index: SharedIndex,
    /// Asks the indexer to end its work between two batches once its grace is over.
    stop_signal: Arc<AtomicBool>,
}

/// A handle to the indexer's thread. It is cheap to clone, never blocks the caller for long, and is what the
/// core gets as its [`IndexSink`].
#[derive(Clone)]
pub struct IndexerHandle {
    shared: Arc<Shared>,
}

impl IndexerHandle {
    /// Queues a job.
    pub fn submit(&self, job: Job) {
        lock(&self.shared.state).queue.push(job);
        self.shared.wake.notify_all();
    }

    /// The app started with these notebooks open. The indexer drops any other notebook from the index and
    /// compares each of these with it, which catches pages saved just before a crash.
    pub fn start(&self, notebooks: Vec<NotebookId>) {
        self.submit(Job::Start { notebooks });
    }

    /// The tree of a notebook changed, or the notebook just opened.
    pub fn tree_changed(&self, notebook: NotebookId) {
        self.submit(Job::Reconcile { notebook });
    }

    /// A notebook closed.
    pub fn notebook_closed(&self, notebook: NotebookId) {
        self.submit(Job::CloseNotebook { notebook });
    }

    /// A section became encrypted, or was deleted.
    pub fn section_locked(&self, section: SectionId) {
        self.submit(Job::PurgeSection { section });
    }

    /// The person finished editing a page's title, as when the title field loses focus or Enter is pressed.
    /// The links to the page follow the new title now, instead of after [`IndexerConfig::settle`].
    pub fn title_settled(&self, page: PageId) {
        self.submit(Job::SettleTitle { page });
    }

    /// A page is gone.
    pub fn page_removed(&self, page: PageId) {
        self.submit(Job::Remove { page });
    }

    /// Rebuilds the index file from these notebooks, as the "Rebuild search index" command does.
    pub fn rebuild(&self, notebooks: Vec<NotebookId>) {
        self.submit(Job::Rebuild { notebooks });
    }

    /// Passes a core event on. Events that do not concern the index are ignored.
    pub fn on_event(&self, event: &CoreEvent) {
        for job in jobs_for_event(event) {
            self.submit(job);
        }
    }

    /// Waits until the indexer has no job left, including retries, or the time runs out. Returns whether it
    /// caught up. A search after a `true` answer sees every change the core had reported before the call.
    pub fn flush(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = lock(&self.shared.state);
        loop {
            if state.queue.is_empty() && !state.working && !state.retrying {
                return true;
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = self
                .shared
                .wake
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    /// The index, for searching. Hold the lock only for the query.
    pub fn index(&self) -> SharedIndex {
        self.shared.index.clone()
    }

    /// Runs a search. It waits for the batch being written, if any. A pattern search that runs out of its time
    /// budget returns what it found so far. See [`IndexerHandle::search_within`] to tell.
    pub fn search(&self, query: &Query) -> Result<Vec<SearchHit>> {
        Ok(self.search_within(query, &SearchLimits::default())?.hits)
    }

    /// Runs a search within some limits, and says whether it read everything. A pattern search reads in short
    /// slices and lets go of the index between them. An error that shows damage also goes to the indexer, which
    /// rebuilds the file.
    pub fn search_within(&self, query: &Query, limits: &SearchLimits) -> Result<SearchResults> {
        let found = self.run_search(query, limits);
        if let Err(error) = &found {
            self.report_error(error);
        }
        found
    }

    /// Tells the indexer about an error the app met while reading the index through [`IndexerHandle::index`].
    /// Damage makes the indexer rebuild the file. Other errors are ignored.
    pub fn report_error(&self, error: &SearchError) {
        if error.is_corrupt() {
            self.submit(Job::Damaged {
                message: error.to_string(),
            });
        }
    }

    fn run_search(&self, query: &Query, limits: &SearchLimits) -> Result<SearchResults> {
        let context = RankContext::current();
        if query.limit == 0 || !is_pattern(query) {
            return lock(&self.shared.index).search_within(query, &context, limits);
        }
        let limits = limits.within(PATTERN_TIME_BUDGET);
        let mut scan = PatternScan::new(query)?;
        loop {
            let slice = SearchLimits::until(Instant::now() + PATTERN_SLICE);
            let more = scan.step(&lock(&self.shared.index), &|| slice.is_over() || limits.is_over())?;
            if !more || limits.is_over() {
                break;
            }
        }
        scan.finish(&lock(&self.shared.index), &context)
    }

    /// What the indexer has done.
    pub fn stats(&self) -> IndexerStats {
        lock(&self.shared.state).stats
    }

    /// Pages that could not be read, with why.
    pub fn failures(&self) -> Vec<(PageId, String)> {
        lock(&self.shared.state).failures.clone()
    }
}

impl IndexSink for IndexerHandle {
    fn page_saved(&self, hint: &IndexHint) {
        self.submit(Job::Reload {
            page: hint.page,
            notebook: Some(hint.notebook),
        });
    }
}

/// The indexer on its own thread.
pub struct BackgroundIndexer {
    handle: IndexerHandle,
    thread: Option<JoinHandle<()>>,
}

impl BackgroundIndexer {
    /// Starts the thread. `index` is put behind a lock that the handle shares.
    pub fn spawn<S: PageSource>(
        index: SearchIndex,
        source: S,
        config: IndexerConfig,
        observer: Option<Observer>,
    ) -> BackgroundIndexer {
        let index: SharedIndex = Arc::new(Mutex::new(index));
        let indexer = Indexer::new(index.clone(), source, config, observer);
        let stop_signal = indexer.stop_signal();
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                queue: JobQueue::default(),
                working: false,
                stop: false,
                retrying: false,
                stats: IndexerStats::default(),
                failures: Vec::new(),
            }),
            wake: Condvar::new(),
            index,
            stop_signal,
        });
        let worker_shared = shared.clone();
        let thread = std::thread::Builder::new()
            .name("opennote-indexer".to_string())
            .spawn(move || work(&worker_shared, indexer))
            .ok();
        BackgroundIndexer {
            handle: IndexerHandle { shared },
            thread,
        }
    }

    /// A handle for queueing jobs and searching. Clone it freely.
    pub fn handle(&self) -> IndexerHandle {
        self.handle.clone()
    }

    /// Finishes the jobs that wait, stops the thread, and gives the index back. Retries that are not due yet
    /// are dropped, and the next start finds those pages again.
    pub fn shutdown(mut self) -> SharedIndex {
        self.stop();
        self.handle.shared.index.clone()
    }

    /// Like [`BackgroundIndexer::shutdown`], and then closes the index file cleanly, so the next start trusts
    /// it without a check. The file closes only when no other handle still holds the index. Drop the handles you
    /// cloned first. Otherwise the index closes when the last one goes, which is the same unless the app crashes
    /// in between.
    pub fn close(self) -> Result<()> {
        let index = self.shutdown();
        match Arc::try_unwrap(index) {
            Ok(mutex) => mutex.into_inner().unwrap_or_else(PoisonError::into_inner).close(),
            Err(_) => Ok(()),
        }
    }

    fn stop(&mut self) {
        self.handle.shared.stop_signal.store(true, Ordering::Release);
        lock(&self.handle.shared.state).stop = true;
        self.handle.shared.wake.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for BackgroundIndexer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn work<S: PageSource>(shared: &Shared, mut indexer: Indexer<S>) {
    let debounce = indexer.config.debounce;
    loop {
        let mut state = lock(&shared.state);
        loop {
            let due = indexer.next_retry();
            if !state.queue.is_empty() || due.is_some_and(|due| due <= Instant::now()) {
                break;
            }
            if state.stop {
                state.retrying = false;
                shared.wake.notify_all();
                return;
            }
            state = match due {
                Some(due) => shared
                    .wake
                    .wait_timeout(state, due.saturating_duration_since(Instant::now())),
                None => shared.wake.wait_timeout(state, Duration::from_secs(3_600)),
            }
            .unwrap_or_else(PoisonError::into_inner)
            .0;
        }
        if !state.stop && !debounce.is_zero() && !state.queue.is_empty() {
            let deadline = Instant::now() + debounce;
            while !state.stop && Instant::now() < deadline {
                state = shared
                    .wake
                    .wait_timeout(state, deadline.saturating_duration_since(Instant::now()))
                    .unwrap_or_else(PoisonError::into_inner)
                    .0;
            }
        }
        let jobs = state.queue.take_all();
        state.working = true;
        drop(state);
        for job in jobs {
            indexer.enqueue(job);
        }
        indexer.run(Instant::now());
        let mut state = lock(&shared.state);
        state.working = false;
        state.retrying = !indexer.retries.is_empty();
        state.stats = indexer.stats();
        state.failures = indexer.failures();
        shared.wake.notify_all();
        if state.stop && indexer.stopping() {
            // The grace is over and jobs are left. The next start finds what they would have done.
            state.retrying = false;
            return;
        }
    }
}
