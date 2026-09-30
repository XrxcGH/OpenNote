//! A notebook's tree journal on the journal thread: intents of changes that touch several files (spec 18.2).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use super::files::{create_generation, generations, highest_seq, read_tree, write_record, NewGeneration};
use super::{JournalConfig, JournalMeta, TreeShared};
use crate::error::{FsError, JournalError};
use crate::id::{IntentId, RevisionId};
use crate::limits::Limits;
use crate::session::events::CoreEvent;
use crate::store::fs::AppendFile;
use crate::store::journal::reader::JournalRecord;
use crate::store::layout::NotebookKey;

use super::TreeIntent;

/// The tree journal of one notebook key.
pub struct TreeState {
    pub shared: Arc<TreeShared>,
    dir: PathBuf,
    meta: JournalMeta,
    next_generation: u64,
    file: Option<(u64, Box<dyn AppendFile>)>,
    written: u64,
    unflushed_since: Option<Instant>,
    broken: bool,
}

impl TreeState {
    /// Reads the notebook's tree generations for unfinished intents and the numbers to continue from.
    pub fn open(config: &JournalConfig, key: &NotebookKey, meta: JournalMeta) -> Result<TreeState, JournalError> {
        let dir = config.root.join(&key.0);
        let limits = Limits::default();
        let fs = &*config.fs;
        let existing = generations(fs, &dir, None).map_err(JournalError::Degraded)?;
        let mut highest = 0u64;
        let mut intents: BTreeMap<IntentId, TreeIntent> = BTreeMap::new();
        for (_, path) in &existing {
            highest = highest.max(highest_seq(fs, path, &limits).map_err(JournalError::Degraded)?);
            let Some(generation) = read_tree(fs, path, &*config.codec, &limits) else {
                continue;
            };
            for record in generation.records {
                match record {
                    JournalRecord::TreeIntent { intent, .. } => {
                        intents.insert(intent.id, intent);
                    }
                    JournalRecord::TreeDone { intent, .. } => {
                        intents.remove(&intent);
                    }
                    _ => {}
                }
            }
        }
        let next_generation = existing
            .last()
            .map_or(1, |(generation, _)| generation.saturating_add(1));
        Ok(TreeState {
            shared: Arc::new(TreeShared::new(highest, intents)),
            dir,
            meta,
            next_generation,
            file: None,
            written: highest,
            unflushed_since: None,
            broken: false,
        })
    }

    /// Appends a record, and flushes it when `flush` is set. `done` marks a finished intent, after which old
    /// generations may go.
    pub fn append(&mut self, config: &JournalConfig, seq: u64, bytes: &[u8], flush: bool) -> Result<(), JournalError> {
        if self.file.is_none() {
            // Older generations stay until every intent is done, so a new one needs no copies.
            if let Err(err) = self.start_generation(config, seq.saturating_sub(1)) {
                return Err(self.fail(config, err));
            }
        }
        if let Some((_, file)) = self.file.as_mut() {
            if let Err(err) = write_record(&mut **file, bytes) {
                return Err(self.fail(config, err));
            }
            self.written = self.written.max(seq);
            self.unflushed_since.get_or_insert_with(Instant::now);
        }
        if flush {
            self.sync(config);
        }
        match (self.broken, self.shared.health.error()) {
            (true, Some(err)) => Err(JournalError::Degraded(err)),
            _ => Ok(()),
        }
    }

    fn start_generation(&mut self, config: &JournalConfig, anchor: u64) -> Result<(), FsError> {
        let generation = self.next_generation;
        let new = NewGeneration {
            dir: &self.dir,
            page: None,
            generation,
            anchor,
            base: (RevisionId::ZERO, &[]),
            meta: &self.meta,
            created: config.clock.now(),
            records: &[],
        };
        let (_, file) = create_generation(&*config.fs, &new)?;
        self.next_generation = generation.saturating_add(1);
        self.file = Some((generation, file));
        self.broken = false;
        self.shared.health.clear_error();
        Ok(())
    }

    fn fail(&mut self, config: &JournalConfig, err: FsError) -> JournalError {
        self.broken = true;
        self.file = None;
        self.unflushed_since = None;
        if self.shared.health.set_error(err.clone()) {
            let message = format!("the tree journal can't be written: {err}");
            config.events.emit(CoreEvent::JournalDegraded { message });
        }
        JournalError::Degraded(err)
    }

    /// Flushes what was appended.
    pub fn sync(&mut self, config: &JournalConfig) {
        if self.unflushed_since.is_none() {
            return;
        }
        if let Some((_, file)) = self.file.as_mut() {
            match file.sync() {
                Ok(()) => {
                    self.unflushed_since = None;
                    self.shared.health.set_durable(self.written);
                }
                Err(err) => {
                    self.fail(config, err);
                }
            }
        }
    }

    /// When the group commit is due.
    pub fn deadline(&self, config: &JournalConfig) -> Option<Instant> {
        self.unflushed_since.map(|since| since + config.timings.group_commit)
    }

    /// Once every intent is done, deletes older generations, and starts a new one when this one passed its
    /// size limit (spec 20.9).
    pub fn tidy(&mut self, config: &JournalConfig) {
        if !self.shared.unfinished().is_empty() {
            return;
        }
        self.sync(config);
        let Some(&(current, ref file)) = self.file.as_ref() else {
            return;
        };
        let full = file.len() > config.timings.tree_rotate_bytes;
        let keep_from = if full { current.saturating_add(1) } else { current };
        if full {
            self.file = None;
            if let Err(err) = self.start_generation(config, self.written) {
                self.fail(config, err);
                return;
            }
        }
        let fs = &*config.fs;
        for (generation, path) in generations(fs, &self.dir, None).unwrap_or_default() {
            if generation < keep_from {
                let _ = fs.remove_file(&path);
            }
        }
    }
}
