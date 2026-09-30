//! One page's journal on the journal thread: appends, group commit, rotation, and closing (spec 20.4 to 20.9).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::files::{create_generation, generations, highest_seq, write_record, NewGeneration};
use super::{BaseSnapshot, JournalConfig, JournalMeta, PageShared};
use crate::error::{FsError, JournalError};
use crate::fail_point;
use crate::id::{PageId, RevisionId};
use crate::limits::Limits;
use crate::session::events::CoreEvent;
use crate::store::fs::{AppendFile, Durability};
use crate::store::journal::encode;
use crate::store::journal::reader::JournalRecord;
use crate::store::layout::NotebookKey;

/// How often a broken journal tries a new generation.
const RETRY_EVERY: Duration = Duration::from_secs(1);

/// A record after the base, kept until a save covers it, so a new generation can copy it.
struct Kept {
    seq: u64,
    edit: bool,
    bytes: Vec<u8>,
}

/// The journal of one open page.
pub struct PageJournal {
    pub shared: Arc<PageShared>,
    pub key: NotebookKey,
    pub page: PageId,
    dir: PathBuf,
    meta: JournalMeta,
    base: BaseSnapshot,
    /// The anchor of the next generation: the last sequence number the base includes.
    anchor: u64,
    next_generation: u64,
    file: Option<(u64, Box<dyn AppendFile>)>,
    written: u64,
    unflushed_since: Option<Instant>,
    kept: Vec<Kept>,
    kept_bytes: u64,
    /// Records past the anchor that were dropped from `kept` to bound memory, up to this sequence number.
    lost_through: u64,
    last_edit: u64,
    saved_through: u64,
    broken: bool,
    last_try: Option<Instant>,
}

impl PageJournal {
    /// Finds the page's generations and the numbers to continue from (spec 20.4).
    pub fn open(
        config: &JournalConfig,
        key: NotebookKey,
        page: PageId,
        meta: JournalMeta,
        base: BaseSnapshot,
    ) -> Result<PageJournal, JournalError> {
        let dir = config.root.join(&key.0);
        let limits = Limits::default();
        let fs = &*config.fs;
        let existing = generations(fs, &dir, Some(page)).map_err(JournalError::Degraded)?;
        let mut highest = 0u64;
        for (_, path) in &existing {
            highest = highest.max(highest_seq(fs, path, &limits).map_err(JournalError::Degraded)?);
        }
        let next_generation = existing
            .last()
            .map_or(1, |(generation, _)| generation.saturating_add(1));
        Ok(PageJournal {
            shared: Arc::new(PageShared::new(highest)),
            key,
            page,
            dir,
            meta,
            base,
            anchor: highest,
            next_generation,
            file: None,
            written: highest,
            unflushed_since: None,
            kept: Vec::new(),
            kept_bytes: 0,
            lost_through: 0,
            last_edit: 0,
            saved_through: highest,
            broken: false,
            last_try: None,
        })
    }

    /// Appends a record at once, so it survives an app crash (plan 8.2).
    pub fn append(&mut self, config: &JournalConfig, seq: u64, bytes: Vec<u8>, edit: bool) {
        if edit {
            self.last_edit = self.last_edit.max(seq);
        }
        self.keep(config, seq, edit, bytes);
        self.write_last(config);
    }

    fn keep(&mut self, config: &JournalConfig, seq: u64, edit: bool, bytes: Vec<u8>) {
        self.kept_bytes = self.kept_bytes.saturating_add(bytes.len() as u64);
        self.kept.push(Kept { seq, edit, bytes });
        // Past four forced saves' worth, a journal that can't be written stops keeping copies until the next
        // save: memory is bounded, and the page is saved every second meanwhile (spec 20.12).
        if self.kept_bytes > config.timings.journal_force_bytes.saturating_mul(4) {
            self.lost_through = self.kept.last().map_or(self.lost_through, |k| k.seq);
            self.kept.clear();
            self.kept_bytes = 0;
        }
    }

    /// Writes the newest kept record, starting a generation first if needed.
    fn write_last(&mut self, config: &JournalConfig) {
        if self.broken {
            self.retry(config, false);
            return;
        }
        let Some((_, file)) = self.file.as_mut() else {
            // A new generation copies every kept record, the newest included.
            if let Err(err) = self.start_generation(config) {
                self.fail(config, err);
            }
            return;
        };
        let Some(last) = self.kept.last() else {
            return;
        };
        match write_record(&mut **file, &last.bytes) {
            Ok(()) => {
                self.written = last.seq;
                self.unflushed_since.get_or_insert_with(Instant::now);
                fail_point!("journal.appended");
            }
            Err(err) => self.fail(config, err),
        }
    }

    /// Creates the next generation with the base and every kept record, and makes it current.
    fn start_generation(&mut self, config: &JournalConfig) -> Result<(), FsError> {
        let records: Vec<&[u8]> = self.kept.iter().map(|k| k.bytes.as_slice()).collect();
        let generation = self.next_generation;
        let new = NewGeneration {
            dir: &self.dir,
            page: Some(self.page),
            generation,
            anchor: self.anchor,
            base: (self.base.revision, &self.base.gzip),
            meta: &self.meta,
            created: config.clock.now(),
            records: &records,
        };
        let (_, file) = create_generation(&*config.fs, &new)?;
        fail_point!("journal.rotate.copied");
        self.next_generation = generation.saturating_add(1);
        self.file = Some((generation, file));
        fail_point!("journal.rotate.switched");
        self.written = self.kept.last().map_or(self.anchor, |k| k.seq);
        self.unflushed_since = None;
        self.shared.health.set_durable(self.written);
        Ok(())
    }

    /// A broken journal tries a new generation, at most once a second unless `now` is set.
    fn retry(&mut self, config: &JournalConfig, now: bool) {
        let due = now || self.last_try.is_none_or(|last| last.elapsed() >= RETRY_EVERY);
        if !due || self.lost_through > self.anchor {
            return;
        }
        self.last_try = Some(Instant::now());
        match self.start_generation(config) {
            Ok(()) => {
                self.broken = false;
                self.shared.health.clear_error();
            }
            Err(err) => self.fail(config, err),
        }
    }

    fn fail(&mut self, config: &JournalConfig, err: FsError) {
        self.broken = true;
        self.file = None;
        self.unflushed_since = None;
        if self.shared.health.set_error(err.clone()) {
            let message = format!("the journal of page {} can't be written: {err}", self.page);
            config.events.emit(CoreEvent::JournalDegraded { message });
        }
    }

    /// Flushes what was appended (group commit).
    pub fn sync(&mut self, config: &JournalConfig) {
        if self.unflushed_since.is_none() {
            return;
        }
        let Some((_, file)) = self.file.as_mut() else {
            return;
        };
        match file.sync() {
            Ok(()) => {
                self.unflushed_since = None;
                self.shared.health.set_durable(self.written);
                fail_point!("journal.flushed");
            }
            Err(err) => self.fail(config, err),
        }
    }

    /// When the group commit is due.
    pub fn deadline(&self, config: &JournalConfig) -> Option<Instant> {
        self.unflushed_since.map(|since| since + config.timings.group_commit)
    }

    /// Appends and flushes `SaveBegin` (step S6).
    pub fn save_begin(&mut self, config: &JournalConfig, seq: u64, bytes: Vec<u8>) -> Result<(), JournalError> {
        self.keep(config, seq, false, bytes);
        if self.broken {
            self.retry(config, true);
        } else {
            self.write_last(config);
        }
        self.sync(config);
        match self.shared.health.error() {
            Some(err) => Err(JournalError::Degraded(err)),
            None => Ok(()),
        }
    }

    /// Takes the new base after a save, and rotates after a confirmed one (spec 20.9).
    pub fn after_save(&mut self, config: &JournalConfig, durability: Durability, base: BaseSnapshot, through: u64) {
        self.base = base;
        self.anchor = self.anchor.max(through);
        self.saved_through = self.saved_through.max(through);
        self.kept.retain(|k| k.seq > through);
        self.kept_bytes = self.kept.iter().map(|k| k.bytes.len() as u64).sum();
        let unsaved = self.kept.iter().filter(|k| k.edit).map(|k| k.bytes.len() as u64).sum();
        self.shared.set_bytes_since_save(unsaved);
        if self.broken {
            self.retry(config, true);
            return;
        }
        let large = self.current_len() > config.timings.rotate_bytes;
        if durability == Durability::Confirmed && large {
            self.rotate(config);
        }
    }

    fn current_len(&self) -> u64 {
        self.file.as_ref().map_or(0, |(_, file)| file.len())
    }

    /// Starts a generation on the new base, then deletes every generation older than the one it replaces.
    fn rotate(&mut self, config: &JournalConfig) {
        self.sync(config);
        let Some(&(current, _)) = self.file.as_ref() else {
            return;
        };
        if let Err(err) = self.start_generation(config) {
            self.fail(config, err);
            return;
        }
        let fs = &*config.fs;
        for (generation, path) in generations(fs, &self.dir, Some(self.page)).unwrap_or_default() {
            if generation < current {
                // A generation that can't be deleted now goes at the next rotation or close.
                let _ = fs.remove_file(&path);
            }
        }
        fail_point!("journal.rotate.deleted");
    }

    /// Closes the journal. After a confirmed final save that covers every edit, every generation is deleted.
    /// After an unconfirmed one, a `Closed` record is added and the generations stay (spec 20.9).
    pub fn close(&mut self, config: &JournalConfig, last_save: Option<(RevisionId, Durability)>) {
        match last_save {
            Some((_, Durability::Confirmed)) if self.saved_through >= self.last_edit => {
                self.file = None;
                let fs = &*config.fs;
                for (_, path) in generations(fs, &self.dir, Some(self.page)).unwrap_or_default() {
                    let _ = fs.remove_file(&path);
                }
            }
            Some((revision, Durability::Unconfirmed)) => {
                let seq = self.shared.next_seq();
                let record = JournalRecord::Closed {
                    seq,
                    revision,
                    boot: self.meta.boot.clone(),
                };
                let bytes = encode(&record, &*config.codec);
                self.keep(config, seq, false, bytes);
                self.write_last(config);
                self.sync(config);
            }
            _ => self.sync(config),
        }
        self.detach(config);
    }

    /// Flushes and lets go of the file, keeping every generation.
    pub fn detach(&mut self, config: &JournalConfig) {
        self.sync(config);
        self.file = None;
        self.shared.health.close();
    }
}
