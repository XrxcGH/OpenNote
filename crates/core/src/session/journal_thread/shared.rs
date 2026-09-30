//! State that journal handles and the journal thread share: sequence numbers, durable progress, and errors.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::TreeIntent;
use crate::error::{FsError, JournalError};
use crate::id::IntentId;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How far a journal is on disk, and whether it can be written.
#[derive(Default)]
struct Progress {
    durable: u64,
    error: Option<FsError>,
    closed: bool,
}

/// A journal's durable progress and health, with a condition variable for waiters.
#[derive(Default)]
pub struct Health {
    progress: Mutex<Progress>,
    changed: Condvar,
    degraded: AtomicBool,
}

impl Health {
    fn new(seq: u64) -> Health {
        Health {
            progress: Mutex::new(Progress {
                durable: seq,
                ..Progress::default()
            }),
            ..Health::default()
        }
    }

    fn update(&self, change: impl FnOnce(&mut Progress)) {
        change(&mut lock(&self.progress));
        self.changed.notify_all();
    }

    /// Records that everything up to `seq` is on disk.
    pub fn set_durable(&self, seq: u64) {
        self.update(|p| p.durable = p.durable.max(seq));
    }

    /// The highest sequence number on disk.
    pub fn durable(&self) -> u64 {
        lock(&self.progress).durable
    }

    /// Records a write failure. Returns whether the journal was writable until now.
    pub fn set_error(&self, err: FsError) -> bool {
        self.update(|p| p.error = Some(err));
        !self.degraded.swap(true, Ordering::SeqCst)
    }

    /// The journal can be written again.
    pub fn clear_error(&self) {
        self.update(|p| p.error = None);
        self.degraded.store(false, Ordering::SeqCst);
    }

    /// The last write failure, while the journal can't be written.
    pub fn error(&self) -> Option<FsError> {
        lock(&self.progress).error.clone()
    }

    /// Whether the journal can't be written.
    pub fn degraded(&self) -> bool {
        self.degraded.load(Ordering::SeqCst)
    }

    /// The journal is closed: waiters stop waiting.
    pub fn close(&self) {
        self.update(|p| p.closed = true);
    }

    /// Waits until `seq` is on disk.
    pub fn wait(&self, seq: u64, timeout: Duration) -> Result<(), JournalError> {
        let deadline = Instant::now().checked_add(timeout);
        let mut progress = lock(&self.progress);
        loop {
            if progress.durable >= seq {
                return Ok(());
            }
            if let Some(err) = &progress.error {
                return Err(JournalError::Degraded(err.clone()));
            }
            if progress.closed {
                return Err(JournalError::Closed);
            }
            let left = deadline.map_or(Duration::MAX, |d| d.saturating_duration_since(Instant::now()));
            if left.is_zero() {
                return Err(JournalError::Timeout);
            }
            progress = self
                .changed
                .wait_timeout(progress, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

/// What a page's journal handle and the journal thread share.
pub struct PageShared {
    seq: Mutex<u64>,
    /// Progress and health.
    pub health: Health,
    bytes_since_save: AtomicU64,
}

impl PageShared {
    /// Numbers continue after `highest`.
    pub fn new(highest: u64) -> PageShared {
        PageShared {
            seq: Mutex::new(highest),
            health: Health::new(highest),
            bytes_since_save: AtomicU64::new(0),
        }
    }

    /// The sequence counter. Holding it while a record is sent keeps records in sequence order.
    pub fn seq(&self) -> MutexGuard<'_, u64> {
        lock(&self.seq)
    }

    /// Takes the next sequence number.
    pub fn next_seq(&self) -> u64 {
        let mut seq = self.seq();
        *seq = seq.saturating_add(1);
        *seq
    }

    pub fn add_bytes(&self, bytes: u64) {
        self.bytes_since_save.fetch_add(bytes, Ordering::SeqCst);
    }

    pub fn set_bytes_since_save(&self, bytes: u64) {
        self.bytes_since_save.store(bytes, Ordering::SeqCst);
    }

    pub fn bytes_since_save(&self) -> u64 {
        self.bytes_since_save.load(Ordering::SeqCst)
    }
}

/// What a notebook's tree journal handles and the journal thread share.
pub struct TreeShared {
    seq: Mutex<u64>,
    intents: Mutex<BTreeMap<IntentId, TreeIntent>>,
    /// Progress and health.
    pub health: Health,
}

impl TreeShared {
    /// Numbers continue after `highest`, and `intents` are the unfinished ones found on disk.
    pub fn new(highest: u64, intents: BTreeMap<IntentId, TreeIntent>) -> TreeShared {
        TreeShared {
            seq: Mutex::new(highest),
            intents: Mutex::new(intents),
            health: Health::new(highest),
        }
    }

    pub fn seq(&self) -> MutexGuard<'_, u64> {
        lock(&self.seq)
    }

    pub fn intents(&self) -> MutexGuard<'_, BTreeMap<IntentId, TreeIntent>> {
        lock(&self.intents)
    }

    pub fn unfinished(&self) -> Vec<TreeIntent> {
        self.intents().values().cloned().collect()
    }
}
