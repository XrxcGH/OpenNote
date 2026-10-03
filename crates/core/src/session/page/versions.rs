//! History, conflicts, repair, and assets of a page session (spec 9.6, 10, 13, and 14).

use std::ops::Range;
use std::path::{Path, PathBuf};

use super::save::Why;
use super::state::{PageSession, PageState};
use super::view::detached_envelope;
use super::{AssetBytes, ConflictChoice, ConflictInfo, RestoreResult, RevisionInfo, TxnAck};
use crate::error::{CoreError, EditError, FsErrorKind};
use crate::id::{AssetId, BlockId, ClientId, RevisionId};
use crate::model::{Asset, Page, ReadOnlyReason, VersionEntry, VersionReason};
use crate::ops::resolve::{resolve_restore_blocks, ResolveCtx};
use crate::session::autosave::{Dirty, Urgency};
use crate::session::backend::VersionToWrite;
use crate::session::events::CoreEvent;
use crate::store::assets::{AssetSource, ImportCtx};
use crate::store::layout::{NotebookLayout, CONFLICTS_DIR};
use crate::store::notebook_store::load_ink;
use crate::store::PageFiles;
use crate::wire::envelope::Envelope;

impl PageSession {
    fn dir(&self) -> PathBuf {
        self.state().dir.clone()
    }

    /// Reads the strokes a page from elsewhere lists, from this page's folder.
    fn with_ink(&self, dir: &Path, mut page: Page) -> Result<Page, CoreError> {
        let files = PageFiles {
            fs: self.ctx.fs.as_ref(),
            codec: self.ctx.codec.as_ref(),
            dir,
        };
        load_ink(&files, &mut page, &self.ctx.limits)?;
        Ok(page)
    }

    /// The page's saved versions, newest first.
    pub(crate) fn history(&self) -> Result<Vec<VersionEntry>, CoreError> {
        let mut versions = self.ctx.backend.list_versions(&self.dir())?.versions;
        versions.reverse();
        Ok(versions)
    }

    /// A saved version, read-only.
    pub(crate) fn open_version(&self, rev: RevisionId) -> Result<Envelope, CoreError> {
        let dir = self.dir();
        let read = self.ctx.backend.open_version(&dir, rev)?;
        let page = self.with_ink(&dir, read.page)?;
        let json = self.ctx.codec.write_page(&page);
        detached_envelope(self.ctx.codec.as_ref(), &page, &json, None)
    }

    /// Restores a version as a new revision of this page, or as a new page after it (spec 13.4).
    pub(crate) fn restore_version(&self, rev: RevisionId, as_copy: bool) -> Result<RestoreResult, CoreError> {
        let dir = self.dir();
        let read = self.ctx.backend.open_version(&dir, rev)?;
        let version = self.with_ink(&dir, read.page)?;
        if as_copy {
            let notebook = self
                .notebook
                .upgrade()
                .ok_or_else(|| CoreError::NotFound("the notebook".into()))?;
            let page = notebook.add_page_copy(self.id, version)?;
            return Ok(RestoreResult::Copied { page });
        }
        let revision = self.replace_content(version, VersionReason::BeforeRestore)?;
        Ok(RestoreResult::Restored { revision })
    }

    /// Brings blocks back from a saved version as one transaction of the client, so one undo step reverses it.
    /// The old copy of each block replaces the current one, with its strokes, and the assets it needs come back.
    pub(crate) fn restore_blocks(
        &self,
        (client, client_seq): (&ClientId, u64),
        rev: RevisionId,
        ids: &[BlockId],
    ) -> Result<TxnAck, EditError> {
        let dir = self.dir();
        let read = self.ctx.backend.open_version(&dir, rev).map_err(version_error)?;
        let old = self.with_ink(&dir, read.page).map_err(version_error)?;
        let ack = {
            let mut st = self.state();
            self.check_request(&st, client, client_seq)?;
            let ctx = ResolveCtx {
                clock: self.ctx.clock.as_ref(),
                limits: &self.ctx.limits,
                imported: &|_| None,
            };
            let txn = resolve_restore_blocks(&st.page, &old, ids, client, &ctx)?;
            self.commit_request(&mut st, &txn, (client, client_seq))?
        };
        self.ctx.enforce_undo_budget();
        Ok(ack)
    }

    /// Saves the current state as a version, then makes `content` the page's next revision and saves it. The
    /// undo history is cleared, because older edits no longer describe the page.
    fn replace_content(&self, content: Page, reason: VersionReason) -> Result<RevisionInfo, CoreError> {
        self.save(Why::Now)?;
        self.version_of_base(reason);
        {
            let mut st = self.state();
            if let Some(reason) = &st.read_only {
                return Err(CoreError::ReadOnly(reason.clone()));
            }
            let mut page = content;
            page.id = self.id;
            page.revision = st.page.revision.clone();
            page.format = crate::model::FormatInfo::default();
            st.page = page;
            self.clear_undo(&mut st);
            mark_dirty(self, &mut st);
        }
        self.save(Why::Now)?.map_or_else(|| Ok(self.current_revision()), Ok)
    }

    /// Writes the base revision as a version.
    fn version_of_base(&self, reason: VersionReason) {
        let (dir, bytes) = {
            let st = self.state();
            (st.dir.clone(), st.bytes.clone())
        };
        let Ok(read) = self.ctx.codec.read_page(&bytes, &self.ctx.limits) else {
            return;
        };
        let _ = self.ctx.backend.write_version(VersionToWrite {
            dir: &dir,
            bytes: &bytes,
            page: &read.page,
            reason,
            name: None,
        });
    }

    /// The saved revision the page is based on.
    pub(crate) fn current_revision(&self) -> RevisionInfo {
        let st = self.state();
        RevisionInfo {
            revision: st.base,
            saved_at: st.page.revision.saved_at,
            confirmed: st.dirty.is_none(),
        }
    }

    /// Names a version, or marks it to keep forever. The current revision becomes a version if it isn't one.
    pub(crate) fn name_version(&self, rev: RevisionId, name: Option<String>, keep: bool) -> Result<(), CoreError> {
        let dir = self.dir();
        let mut file = self.ctx.backend.list_versions(&dir)?;
        if !file.versions.iter().any(|v| v.revision == rev) {
            if rev != self.state().base {
                return Err(CoreError::NotFound(format!("version {rev}")));
            }
            self.version_of_base(VersionReason::Named);
            file = self.ctx.backend.list_versions(&dir)?;
        }
        let entry = file.versions.iter_mut().find(|v| v.revision == rev);
        let entry = entry.ok_or_else(|| CoreError::NotFound(format!("version {rev}")))?;
        entry.name = name;
        entry.keep = keep;
        let bytes = self.ctx.codec.write_versions(&file);
        self.ctx
            .fs
            .replace_durable(&NotebookLayout::versions_json(&dir), &bytes)?;
        Ok(())
    }

    /// The page's open conflicts: other versions kept in `.conflicts/` (spec 14.1).
    pub(crate) fn conflicts(&self) -> Result<Vec<ConflictInfo>, CoreError> {
        let dir = self.dir().join(CONFLICTS_DIR);
        let entries = match self.ctx.fs.read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if e.kind == FsErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut found = Vec::new();
        for entry in entries.iter().filter(|e| !e.is_dir) {
            let Some(rev) = entry.name.strip_suffix(".json").and_then(|r| RevisionId::parse(r).ok()) else {
                continue;
            };
            let bytes = self
                .ctx
                .fs
                .read(&dir.join(&entry.name), self.ctx.limits.page_json_bytes)?;
            if let Ok(read) = self.ctx.codec.read_page(&bytes, &self.ctx.limits) {
                found.push(ConflictInfo {
                    revision: rev,
                    device: read.page.revision.device,
                    saved_at: read.page.revision.saved_at,
                });
            }
        }
        Ok(found)
    }

    fn conflict_page(&self, rev: RevisionId) -> Result<(PathBuf, Vec<u8>, Page), CoreError> {
        let dir = self.dir();
        let path = NotebookLayout::conflict_path(&dir, rev);
        let bytes = self.ctx.fs.read(&path, self.ctx.limits.page_json_bytes)?;
        let read = self.ctx.codec.read_page(&bytes, &self.ctx.limits)?;
        let page = self.with_ink(&dir, read.page)?;
        Ok((path, bytes, page))
    }

    /// The other version of a conflict, read-only.
    pub(crate) fn open_conflict(&self, rev: RevisionId) -> Result<Envelope, CoreError> {
        let (_, bytes, page) = self.conflict_page(rev)?;
        detached_envelope(self.ctx.codec.as_ref(), &page, &bytes, None)
    }

    /// Resolves a conflict: the version not kept goes into history with the reason `conflict`, and the
    /// conflict file is deleted (spec 14.1).
    pub(crate) fn resolve_conflict(&self, rev: RevisionId, choice: ConflictChoice) -> Result<RevisionInfo, CoreError> {
        let (path, bytes, theirs) = self.conflict_page(rev)?;
        let dir = self.dir();
        let info = match choice {
            ConflictChoice::KeepMine => {
                let version = VersionToWrite {
                    dir: &dir,
                    bytes: &bytes,
                    page: &theirs,
                    reason: VersionReason::Conflict,
                    name: None,
                };
                self.ctx.backend.write_version(version)?;
                self.current_revision()
            }
            ConflictChoice::KeepTheirs => self.replace_content(theirs, VersionReason::Conflict)?,
            ConflictChoice::KeepBoth => {
                let notebook = self
                    .notebook
                    .upgrade()
                    .ok_or_else(|| CoreError::NotFound("the notebook".into()))?;
                notebook.add_page_copy(self.id, theirs)?;
                self.current_revision()
            }
        };
        self.ctx.fs.remove_file(&path)?;
        self.state().conflicts.retain(|c| *c != rev);
        Ok(info)
    }

    /// Repairs damaged ink (spec 9.6): the damaged revision is kept as a version, then the repaired page is
    /// saved as a new revision.
    pub(crate) fn repair_ink(&self) -> Result<RevisionInfo, CoreError> {
        let (dir, page) = {
            let st = self.state();
            (st.dir.clone(), st.page.clone())
        };
        let repaired = self.ctx.backend.repair_ink(&dir, &page)?;
        self.version_of_base(VersionReason::BeforeRepair);
        let mut st = self.state();
        let mut next = repaired;
        next.revision = st.page.revision.clone();
        next.format = crate::model::FormatInfo::default();
        st.page = next;
        st.damaged = 0;
        if matches!(st.read_only, Some(ReadOnlyReason::DamagedInk { .. })) {
            st.read_only = None;
        }
        mark_dirty(self, &mut st);
        drop(st);
        self.save(Why::Now)?.map_or_else(|| Ok(self.current_revision()), Ok)
    }

    /// Clears the read-only attribute of `page.json`, so saving can go on (spec 17.6).
    pub(crate) fn make_editable(&self) -> Result<(), CoreError> {
        let mut st = self.state();
        self.ctx.fs.clear_read_only(&NotebookLayout::page_json(&st.dir))?;
        if st.read_only == Some(ReadOnlyReason::ReadOnlyFile) {
            st.read_only = None;
            st.failures = 0;
            self.schedule(&st);
        }
        Ok(())
    }

    /// Imports a file as an asset. It joins the table with the edit that uses it.
    pub(crate) fn import_asset(&self, source: AssetSource) -> Result<Asset, CoreError> {
        let (dir, existing) = {
            let st = self.state();
            let mut existing = st.page.assets.clone();
            existing.extend(st.imported.clone());
            (st.dir.clone(), existing)
        };
        let page = self.id;
        let events = self.ctx.events.clone();
        let progress = move |done: u64, total: u64| {
            events.emit(CoreEvent::ImportProgress {
                page,
                asset: AssetId::ZERO,
                done,
                total,
            });
        };
        let ctx = ImportCtx {
            existing: &existing,
            clock: self.ctx.clock.as_ref(),
            progress: &progress,
        };
        let asset = self.ctx.backend.import_asset(&dir, source, &ctx)?;
        self.state().imported.insert(asset.id, asset.clone());
        Ok(asset)
    }

    /// Takes an asset whose file another part of the app wrote in the page's `assets` folder, such as an audio
    /// recording, so a following `addAsset` edit can put it in the table. A recording that is still growing
    /// comes with `state` set to `recording` (spec 10.2).
    pub(crate) fn adopt_asset(&self, asset: Asset) {
        self.state().imported.insert(asset.id, asset);
    }

    /// Reads an asset, or a range of it, and closes the file at once.
    pub(crate) fn asset_bytes(&self, id: AssetId, range: Option<Range<u64>>) -> Result<AssetBytes, CoreError> {
        let (dir, asset) = {
            let st = self.state();
            let asset = st.page.assets.get(&id).or_else(|| st.imported.get(&id)).cloned();
            (
                st.dir.clone(),
                asset.ok_or_else(|| CoreError::NotFound(format!("asset {id}")))?,
            )
        };
        let bytes = self.ctx.backend.read_asset(&dir, &asset, range.clone())?;
        Ok(AssetBytes {
            mime: asset.mime,
            total: asset.bytes,
            range,
            bytes,
        })
    }
}

/// Marks the page dirty now and schedules it to save at once.
pub(crate) fn mark_dirty(session: &PageSession, st: &mut PageState) {
    let now = session.ctx.clock.monotonic();
    st.dirty = Some(Dirty { first: now, last: now });
    st.urgency = Urgency::Now;
    st.versions.edited = true;
    session.schedule(st);
}

/// A failure to read a saved version, as the error of an edit.
fn version_error(error: CoreError) -> EditError {
    match error {
        CoreError::NotFound(what) => EditError::NotFound(what),
        CoreError::Fs(fs) if fs.kind == FsErrorKind::NotFound => EditError::NotFound("that version".into()),
        CoreError::Edit(edit) => edit,
        other => EditError::Invalid(other.to_string()),
    }
}
