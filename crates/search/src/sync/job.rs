//! The work the indexer is given, and the queue that merges jobs about the same thing.

use std::collections::{HashMap, VecDeque};

use opennote_core::session::events::{CoreEvent, RecoveryOutcome};
use opennote_core::{NotebookId, PageId, SectionId};

/// One piece of work for the indexer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Job {
    /// Read a page again and index it. The notebook comes from a save hint. Without it, the index's own record
    /// of the page says, and a page the index has never held is skipped until its notebook reconciles.
    Reload {
        /// The page.
        page: PageId,
        /// Its notebook, if known.
        notebook: Option<NotebookId>,
    },
    /// A page is gone.
    Remove {
        /// The page.
        page: PageId,
    },
    /// Compare a notebook's tree with the index and fix every difference.
    Reconcile {
        /// The notebook.
        notebook: NotebookId,
    },
    /// A notebook closed: drop its pages.
    CloseNotebook {
        /// The notebook.
        notebook: NotebookId,
    },
    /// A section became encrypted or was deleted: drop its pages and wipe their text from the file.
    PurgeSection {
        /// The section.
        section: SectionId,
    },
    /// The app started with these notebooks open: drop the pages of any other notebook, and reconcile these.
    Start {
        /// The open notebooks.
        notebooks: Vec<NotebookId>,
    },
    /// Fill a new index file from these notebooks and swap it in when it is complete.
    Rebuild {
        /// The notebooks to index.
        notebooks: Vec<NotebookId>,
    },
    /// Settle a page's title: the links that named its settled title follow the title it has now.
    SettleTitle {
        /// The page.
        page: PageId,
    },
    /// A read of the index met damage. The indexer stops and rebuilds the file, as when its own work meets it.
    Damaged {
        /// What the read reported, for logs.
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) enum Key {
    Page(PageId),
    Notebook(NotebookId),
    Section(SectionId),
    Start,
    Rebuild,
    Damaged,
    Settle(PageId),
}

impl Job {
    pub(super) fn key(&self) -> Key {
        match self {
            Job::Reload { page, .. } | Job::Remove { page } => Key::Page(*page),
            Job::Reconcile { notebook } | Job::CloseNotebook { notebook } => Key::Notebook(*notebook),
            Job::PurgeSection { section } => Key::Section(*section),
            Job::Start { .. } => Key::Start,
            Job::Rebuild { .. } => Key::Rebuild,
            Job::Damaged { .. } => Key::Damaged,
            Job::SettleTitle { page } => Key::Settle(*page),
        }
    }
}

/// Jobs in the order they arrived, with jobs on the same thing merged.
#[derive(Default)]
pub(super) struct JobQueue {
    order: VecDeque<Key>,
    jobs: HashMap<Key, Job>,
}

impl JobQueue {
    pub(super) fn push(&mut self, job: Job) {
        let key = job.key();
        match self.jobs.get_mut(&key) {
            Some(old) => {
                // A reload that does not know the notebook keeps what an earlier one knew.
                let kept = match (&*old, &job) {
                    (
                        Job::Reload {
                            notebook: Some(known), ..
                        },
                        Job::Reload { page, notebook: None },
                    ) => Job::Reload {
                        page: *page,
                        notebook: Some(*known),
                    },
                    _ => job,
                };
                *old = kept;
            }
            None => {
                self.order.push_back(key.clone());
                self.jobs.insert(key, job);
            }
        }
    }

    pub(super) fn pop(&mut self) -> Option<Job> {
        while let Some(key) = self.order.pop_front() {
            if let Some(job) = self.jobs.remove(&key) {
                return Some(job);
            }
        }
        None
    }

    pub(super) fn front_is_reload(&self) -> bool {
        self.order
            .front()
            .and_then(|key| self.jobs.get(key))
            .is_some_and(|job| matches!(job, Job::Reload { .. }))
    }

    pub(super) fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }

    pub(super) fn take_all(&mut self) -> Vec<Job> {
        let mut out = Vec::with_capacity(self.jobs.len());
        while let Some(job) = self.pop() {
            out.push(job);
        }
        out
    }
}

/// The jobs a core event calls for.
pub fn jobs_for_event(event: &CoreEvent) -> Vec<Job> {
    match event {
        CoreEvent::TreeChanged { notebook } => vec![Job::Reconcile { notebook: *notebook }],
        CoreEvent::ExternalChange { page, .. } => vec![Job::Reload {
            page: *page,
            notebook: None,
        }],
        CoreEvent::Recovered(report) => report
            .pages
            .iter()
            .filter(|(_, outcome)| !matches!(outcome, RecoveryOutcome::Nothing | RecoveryOutcome::OwnerAlive))
            .map(|(page, _)| Job::Reload {
                page: *page,
                notebook: None,
            })
            .collect(),
        _ => Vec::new(),
    }
}
