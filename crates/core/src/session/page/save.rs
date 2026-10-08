//! Saving a page session (plan 9.3; spec 17.7, steps S1 and S9 to S12), and closing it.

use std::path::PathBuf;
use std::sync::{Arc, PoisonError, Weak};
use std::time::Duration;

use super::state::{Hint, PageSession, PageState};
use super::RevisionInfo;
use crate::error::{CoreError, FsErrorKind};
use crate::format::gzip::gzip;
use crate::model::{Page, ReadOnlyReason, VersionReason};
use crate::session::autosave::{retry_after, Dirty, Saveable, Urgency};
use crate::session::backend::{SaveInput, VersionToWrite};
use crate::session::budget::{page_bytes, ClosedPage};
use crate::session::events::{CoreEvent, ExternalAction, IndexHint};
use crate::session::journal_thread::BaseSnapshot;
use crate::store::external::ExternalDecision;
use crate::store::fs::{Durability, FileStamp};
use crate::store::layout::PAGE_JSON;
use crate::store::page_store::{LoadError, LoadedPage, SaveError, SaveOutcome};

/// Why a page saves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Why {
    /// Autosave's timers.
    Auto,
    /// The person or a command asked.
    Now,
    /// The last client closed the page, or the notebook closed.
    Close,
    /// The app is exiting.
    Exit,
}

/// What a save works from: a snapshot taken under the page lock (step S1).
struct Snapshot {
    page: Page,
    through: u64,
    stamp: Option<FileStamp>,
    dir: PathBuf,
    pending: usize,
    hint: Hint,
    before: Option<VersionReason>,
    base: Arc<[u8]>,
    taken: Duration,
}

impl PageSession {
    /// Saves the page if it has unsaved changes. Returns the new revision, or `None` if there was nothing to
    /// save. A failure leaves the page dirty, with every edit in memory and in the journal.
    pub(crate) fn save(&self, why: Why) -> Result<Option<RevisionInfo>, CoreError> {
        let _io = self.io.lock().unwrap_or_else(PoisonError::into_inner);
        let mut retried = false;
        loop {
            let Some(snapshot) = self.snapshot()? else {
                self.version_when_idle(why);
                return Ok(None);
            };
            self.version_before(&snapshot);
            let result = {
                let journal = self.journal();
                let input = SaveInput {
                    page: &snapshot.page,
                    through_seq: snapshot.through,
                    base_stamp: snapshot.stamp,
                    journal: journal.as_ref().map(|j| j.as_ref()),
                };
                self.ctx.backend.save(&snapshot.dir, input)
            };
            match result {
                Ok(outcome) => return Ok(Some(self.saved(snapshot, &outcome, why))),
                Err(SaveError::External { .. }) if !retried => {
                    retried = true;
                    self.external_change(snapshot)?;
                }
                Err(e) => return Err(self.failed(snapshot, e)),
            }
        }
    }

    fn snapshot(&self) -> Result<Option<Snapshot>, CoreError> {
        let mut st = self.state();
        if st.dirty.is_none() {
            return Ok(None);
        }
        if let Some(reason) = &st.read_only {
            return Err(CoreError::ReadOnly(reason.clone()));
        }
        st.saving = true;
        Ok(Some(Snapshot {
            page: st.page.clone(),
            through: st.seq,
            stamp: st.stamp,
            dir: st.dir.clone(),
            pending: st.page.ink.pending().len(),
            hint: std::mem::take(&mut st.hint),
            before: st.versions.before_save.take(),
            base: st.bytes.clone(),
            taken: self.ctx.clock.monotonic(),
        }))
    }

    /// Writes a version of the base revision before the save, when one is due (spec 13.2). History is best
    /// effort: a failure never stops the save.
    fn version_before(&self, snapshot: &Snapshot) {
        let Some(reason) = snapshot.before else { return };
        let Ok(read) = self.ctx.codec.read_page(&snapshot.base, &self.ctx.limits) else {
            return;
        };
        let _ = self.ctx.backend.write_version(VersionToWrite {
            dir: &snapshot.dir,
            bytes: &snapshot.base,
            page: &read.page,
            reason,
            name: None,
        });
    }

    /// Steps S9 to S12: the page's new base, the journal's rotation, history, events, and the work that can
    /// wait.
    fn saved(&self, snapshot: Snapshot, outcome: &SaveOutcome, why: Why) -> RevisionInfo {
        let mut saved_page = snapshot.page;
        saved_page.revision = outcome.revision.clone();
        saved_page
            .ink
            .commit(snapshot.pending, outcome.segments.clone(), outcome.dead_bytes);
        let (edited, encrypted) = {
            let mut st = self.state();
            st.page.revision = outcome.revision.clone();
            st.page
                .ink
                .commit(snapshot.pending, outcome.segments.clone(), outcome.dead_bytes);
            st.bytes = outcome.bytes.clone();
            st.stamp = Some(outcome.stamp);
            st.base = outcome.revision.id;
            st.saved_seq = snapshot.through;
            st.saving = false;
            st.failures = 0;
            st.last_error = None;
            st.urgency = Urgency::Normal;
            st.versions.saved_once = true;
            st.last_durability = outcome.durability;
            st.dirty = if st.seq > snapshot.through {
                st.dirty.map(|d| Dirty {
                    first: d.first.max(snapshot.taken),
                    ..d
                })
            } else {
                None
            };
            self.schedule(&st);
            (st.versions.edited, st.encrypted)
        };
        let confirmed = outcome.durability == Durability::Confirmed;
        if let Some(journal) = self.journal().as_ref() {
            let gzip = if confirmed { gzip(&outcome.bytes) } else { Vec::new() };
            let base = BaseSnapshot {
                revision: outcome.revision.id,
                gzip: gzip.into(),
            };
            journal.after_save(outcome.durability, base, snapshot.through);
        }
        self.version_after(&snapshot.dir, outcome, &saved_page, (why, edited));
        self.report_saved(&saved_page, snapshot.hint, encrypted);
        RevisionInfo {
            revision: outcome.revision.id,
            saved_at: outcome.revision.saved_at,
            confirmed,
        }
    }

    /// A close or exit with nothing left to save still keeps a version when the page was edited since the last one:
    /// the autosave usually saved the edits already, and without this only a page that was dirty at the end got one.
    fn version_when_idle(&self, why: Why) {
        let (reason, dir, bytes, page) = {
            let st = self.state();
            if !st.versions.edited || !st.versions.saved_once || st.dirty.is_some() {
                return;
            }
            let reason = match why {
                Why::Close => VersionReason::Closed,
                Why::Exit => VersionReason::Exit,
                _ => return,
            };
            (reason, st.dir.clone(), st.bytes.clone(), st.page.clone())
        };
        let version = VersionToWrite {
            dir: &dir,
            bytes: &bytes,
            page: &page,
            reason,
            name: None,
        };
        if self.ctx.backend.write_version(version).is_ok() {
            let mut st = self.state();
            st.versions.last = Some(self.ctx.clock.monotonic());
            st.versions.edited = st.dirty.is_some();
        }
    }

    /// Keeps the save as a version when one is due: at close, at exit, and every 10 minutes of editing.
    fn version_after(&self, dir: &std::path::Path, outcome: &SaveOutcome, page: &Page, (why, edited): (Why, bool)) {
        let now = self.ctx.clock.monotonic();
        let reason = {
            let st = self.state();
            let interval_due = st
                .versions
                .last
                .is_none_or(|last| now.saturating_sub(last) >= self.ctx.timings.history_interval);
            match why {
                Why::Close if edited => Some(VersionReason::Closed),
                Why::Exit if edited => Some(VersionReason::Exit),
                _ if edited && interval_due && st.versions.last.is_some() => Some(VersionReason::Interval),
                _ => None,
            }
        };
        let mut st = self.state();
        if st.versions.last.is_none() {
            st.versions.last = Some(now);
        }
        let Some(reason) = reason else { return };
        drop(st);
        let version = VersionToWrite {
            dir,
            bytes: &outcome.bytes,
            page,
            reason,
            name: None,
        };
        if self.ctx.backend.write_version(version).is_ok() {
            let mut st = self.state();
            st.versions.last = Some(now);
            st.versions.edited = st.dirty.is_some();
        }
    }

    /// Step S12, and the work of step S11 that can wait.
    fn report_saved(&self, page: &Page, hint: Hint, encrypted: bool) {
        self.ctx.events.emit(CoreEvent::Saved {
            page: self.id,
            revision: page.revision.id,
            at: page.revision.saved_at,
        });
        let Some(notebook) = self.notebook.upgrade() else {
            return;
        };
        if !encrypted {
            if let Some(index) = &self.ctx.index {
                index.page_saved(&IndexHint {
                    notebook: notebook.id(),
                    page: self.id,
                    revision: page.revision.id,
                    changed_blocks: hint.changed.into_iter().collect(),
                    removed_blocks: hint.removed.into_iter().collect(),
                    title_changed: hint.title,
                });
            }
        }
        notebook.page_saved(self, page, encrypted);
    }

    /// Handles a `page.json` that changed on disk since it was read (spec 14.1). An older revision of this
    /// device's, or its own, is saved over. Anything else is kept in `.conflicts/`, and the save goes ahead.
    /// A file that can't be read is never replaced unread: see [`PageSession::unreadable_change`].
    fn external_change(&self, snapshot: Snapshot) -> Result<(), CoreError> {
        let loaded = match self.ctx.backend.load(&snapshot.dir) {
            Ok(loaded) => loaded,
            Err(error) => return self.unreadable_change(snapshot, error),
        };
        let mut st = self.state();
        st.saving = false;
        restore(&mut st, snapshot.hint, snapshot.before);
        let decision = self
            .ctx
            .backend
            .classify_change(&loaded.page.revision, st.base, &st.page.revision, true);
        st.stamp = Some(loaded.stamp);
        if matches!(decision, ExternalDecision::Unchanged | ExternalDecision::OlderOfOurs) {
            return Ok(());
        }
        if let Ok(revision) = self.ctx.backend.keep_conflict(&snapshot.dir, &loaded.bytes) {
            if !st.conflicts.contains(&revision) {
                st.conflicts.push(revision);
            }
            let other_device = loaded.page.revision.device.label.clone();
            self.ctx.events.emit(CoreEvent::ExternalChange {
                page: self.id,
                action: ExternalAction::Conflict { other_device },
            });
        }
        Ok(())
    }

    /// A changed `page.json` that can't be read. A deleted one is written again, and a damaged one goes into
    /// `.damaged/` first. One from a newer version makes the page read-only (spec 5.7). One that can't be read
    /// now fails the save and keeps the old fingerprint, so the next try checks the file again. Either way
    /// every edit stays in memory and in the journal.
    fn unreadable_change(&self, snapshot: Snapshot, error: LoadError) -> Result<(), CoreError> {
        match error {
            LoadError::Missing => {}
            LoadError::Damaged(_) => {
                if let Err(err) = self.ctx.backend.move_damaged(&snapshot.dir, PAGE_JSON) {
                    return Err(self.failed(snapshot, SaveError::Fs(err)));
                }
            }
            LoadError::Unavailable(err) => return Err(self.failed(snapshot, SaveError::Fs(err))),
            LoadError::NewerFormat(_) => {
                let reason = ReadOnlyReason::NewerFormat;
                let mut st = self.state();
                st.saving = false;
                restore(&mut st, snapshot.hint, snapshot.before);
                st.read_only = Some(reason.clone());
                drop(st);
                self.ctx.events.emit(CoreEvent::ReadOnly {
                    page: self.id,
                    reason: reason.clone(),
                });
                return Err(CoreError::ReadOnly(reason));
            }
        }
        let mut st = self.state();
        st.saving = false;
        restore(&mut st, snapshot.hint, snapshot.before);
        st.stamp = None;
        Ok(())
    }

    /// A failed save (spec 17.6): the page stays dirty, autosave tries again when the error allows it, and a
    /// read-only file or a cloud placeholder makes the page read-only.
    fn failed(&self, snapshot: Snapshot, error: SaveError) -> CoreError {
        let kind = match &error {
            SaveError::Fs(e) => e.kind,
            SaveError::External { .. } => FsErrorKind::Busy,
            SaveError::MissingAsset(_) => FsErrorKind::NotFound,
            SaveError::Serializer(_) | SaveError::Journal(_) => FsErrorKind::Io,
        };
        let mut st = self.state();
        st.saving = false;
        restore(&mut st, snapshot.hint, snapshot.before);
        st.failures = st.failures.saturating_add(1);
        st.last_error = Some(kind);
        let retry = retry_after(kind, st.failures, &self.ctx.timings);
        let reason = match kind {
            FsErrorKind::ReadOnlyFile => Some(ReadOnlyReason::ReadOnlyFile),
            FsErrorKind::CloudPlaceholder => Some(ReadOnlyReason::CloudPlaceholder),
            _ => None,
        };
        if let Some(reason) = reason {
            st.read_only = Some(reason.clone());
            self.ctx.events.emit(CoreEvent::ReadOnly { page: self.id, reason });
        }
        if let Some(retry) = retry {
            let me: Weak<dyn Saveable> = self.me.clone() as Weak<dyn Saveable>;
            let due = self.ctx.clock.monotonic().saturating_add(retry);
            self.ctx.saver.schedule(self.serial, me, due);
        }
        drop(st);
        self.ctx.events.emit(CoreEvent::SaveFailed {
            page: self.id,
            kind,
            message: format!("{error:?}"),
            retry_in: retry,
        });
        match error {
            SaveError::Fs(e) => CoreError::Fs(e),
            SaveError::Journal(e) => CoreError::Journal(e),
            SaveError::External { disk } => CoreError::Conflict(format!("page.json changed on disk: {disk:?}")),
            SaveError::MissingAsset(asset) => CoreError::NotFound(format!("asset {asset}")),
            SaveError::Serializer(detail) => CoreError::Conflict(detail),
        }
    }

    /// Closes the session after its last client left, or when the notebook closes: a final save, a version
    /// of the edits, the journal's close, and a place in the cache of closed pages if the page is clean.
    pub(crate) fn finish(&self, why: Why) -> Result<(), CoreError> {
        let saved = self.save(why);
        let io_guard = self.io.lock().unwrap_or_else(PoisonError::into_inner);
        let mut st = self.state();
        if st.closed {
            return Ok(());
        }
        st.closed = true;
        self.ctx.saver.cancel(self.serial);
        let clean = st.dirty.is_none();
        let last_save = clean.then_some((st.base, st.last_durability));
        let journal = self.journal.write().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(journal) = journal {
            journal.close(last_save);
        }
        self.ctx.release_undo(st.undo_bytes);
        st.undo_bytes = 0;
        if clean && st.read_only.is_none() && st.damaged == 0 && st.missing == 0 {
            self.keep_closed(&st);
        }
        let cached = crate::store::cache::CachedPage {
            title: st.page.title.clone(),
            created: st.page.created,
            modified: st.page.modified,
            revision: Some(st.base),
        };
        let refresh = (clean && st.versions.saved_once).then_some((cached, st.encrypted));
        drop(st);
        drop(io_guard);
        if let Some(notebook) = self.notebook.upgrade() {
            // The title copy follows the final save at once, because the page's maintenance jobs may never
            // run once the notebook closes.
            if let Some((cached, encrypted)) = refresh {
                notebook.refresh_title(self.id, cached, encrypted);
            }
            notebook.page_closed(self);
        }
        saved.map(|_| ())
    }

    /// Closes the page's journal after a flush, keeping the session: the next edit opens a new one. A clean
    /// page's journal closes with its last save, so the journal can delete or park its generations (spec
    /// 20.9).
    pub(crate) fn close_journal(&self) {
        let io_guard = self.io.lock().unwrap_or_else(PoisonError::into_inner);
        let last_save = {
            let st = self.state();
            st.dirty.is_none().then_some((st.base, st.last_durability))
        };
        let journal = self.journal.write().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(journal) = journal {
            journal.close(last_save);
        }
        drop(io_guard);
    }

    fn keep_closed(&self, st: &PageState) {
        let (Some(notebook), Some(stamp)) = (self.notebook.upgrade(), st.stamp) else {
            return;
        };
        let bytes = page_bytes(&st.page, st.bytes.len());
        let loaded = LoadedPage {
            page: st.page.clone(),
            stamp,
            bytes: st.bytes.clone(),
            damaged: Vec::new(),
            missing: Vec::new(),
        };
        self.ctx
            .closed_pages()
            .put((notebook.key(), self.id), ClosedPage { loaded, bytes });
    }
}

impl Saveable for PageSession {
    fn autosave(&self) -> Option<Duration> {
        // A save reschedules itself: after edits during the save, or after a failure.
        let _ = self.save(Why::Auto);
        None
    }
}

/// Puts back what a save took from the state, after the save didn't happen.
fn restore(st: &mut PageState, hint: Hint, before: Option<VersionReason>) {
    st.hint.merge(hint);
    if let Some(before) = before {
        st.versions.before_save.get_or_insert(before);
    }
}
