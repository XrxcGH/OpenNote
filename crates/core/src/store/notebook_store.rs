//! Creating and opening notebooks, and every tree change of spec 18. Owned by WP5.
//!
//! A [`NotebookStore`] holds one notebook's tree files in memory: `notebook.json`, every `section.json`, and
//! every Trash item's `item.json`. Each change writes the files it touches with `replace_durable`. A change
//! that touches several files records a tree intent first and leaves the portable mark the spec requires
//! (spec 18.2), so the scan or [`crate::store::tree_log::roll_forward`] can finish it after a crash.
//!
//! The store is not thread-safe on its own. The notebook session keeps it behind the notebook's tree lock,
//! which is always taken before any page lock (plan 10.1).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::{CoreError, EditError};
use crate::id::{GroupId, Id, IntentId, PageId, SectionId, TrashItemId};
use crate::limits::{Limits, Policy, Timings};
use crate::model::{
    Access, DeviceRef, Group, NotebookFile, PageEntry, PageNodeState, ReadOnlyReason, SectionFile, TrashItemFile,
    Warning,
};
use crate::order::OrderKey;
use crate::seams::Codec;
use crate::session::journal_thread::{TreeIntent, TreeOp};
use crate::store::cache::PageCache;
use crate::store::fs::Fs;
use crate::store::layout::{NotebookLayout, SECTION_JSON};
use crate::store::tree_log::IntentLog;
use crate::time::{Clock, Timestamp};

mod arrange;
mod create;
mod duplicates;
mod edit;
mod flat;
mod formats;
#[cfg(any(test, feature = "testing"))]
pub mod kit;
mod pages;
mod place;
mod read;
mod steps;
mod template;
mod transfer;
mod view;

pub use arrange::FlatPage;
pub use create::create_notebook;
#[cfg(any(test, feature = "testing"))]
pub use formats::SimpleFormats;
pub use formats::{CanonicalFormats, TreeFormats};
pub use pages::{load_ink, next_revision, read_page_files, write_page_files, WrittenPage};
pub(crate) use read::{add_section, read_notebook_file, read_section_file, skipped_name};
#[cfg(test)]
pub(crate) use transfer::copy_tree;
pub(crate) use transfer::load_failed;
pub use transfer::Transfer;

/// The error code of a move that breaks a rule of the tree, such as a loop or a fifth level of groups.
pub const INVALID_MOVE: &str = "invalid-move";

/// The error code of a title the tree can't hold.
pub const INVALID_NAME: &str = "invalid-name";

/// A move that breaks a rule of the tree. The notes contract reports it as `invalid-move`.
pub fn invalid_move(detail: impl std::fmt::Display) -> CoreError {
    CoreError::Edit(EditError::Invalid(format!("{INVALID_MOVE}: {detail}")))
}

/// A title the tree can't hold. The notes contract reports it as `invalid-name` with `reason`.
pub fn invalid_name(reason: &str) -> CoreError {
    CoreError::Edit(EditError::Invalid(format!("{INVALID_NAME}: {reason}")))
}

pub(crate) fn not_found(what: impl std::fmt::Display) -> CoreError {
    CoreError::NotFound(what.to_string())
}

/// What tree code works with: the seams, the clock, the limits, and this device.
#[derive(Clone)]
pub struct TreeEnv {
    /// The file system.
    pub fs: Arc<dyn Fs>,
    /// The codec.
    pub codec: Arc<dyn Codec>,
    /// The format functions outside the codec.
    pub formats: Arc<dyn TreeFormats>,
    /// The clock.
    pub clock: Arc<dyn Clock>,
    /// Reader limits.
    pub limits: Limits,
    /// Trash, clean-up, and retry timings.
    pub timings: Timings,
    /// Tree policy, such as the group depth.
    pub policy: Policy,
    /// This device, for revisions and Trash items.
    pub device: DeviceRef,
    /// The app and version, for revisions.
    pub writer: String,
}

/// A section as the store holds it.
#[derive(Clone, Debug, PartialEq)]
pub struct SectionState {
    /// Its `section.json`.
    pub file: SectionFile,
    /// Its folder, normally `<notebook>/<section ID>`.
    pub dir: PathBuf,
}

impl SectionState {
    /// Whether the section is encrypted (spec 5.7). A version 1 writer never changes it.
    pub fn encrypted(&self) -> bool {
        self.file.encryption.is_some()
    }

    /// The entry of a page.
    pub fn entry(&self, page: PageId) -> Option<&PageEntry> {
        self.file.pages.iter().find(|e| e.id == page)
    }
}

/// A Trash item as the store holds it.
#[derive(Clone, Debug, PartialEq)]
pub struct TrashEntry {
    /// Its `item.json`.
    pub file: TrashItemFile,
    /// The folders of `contents` that are inside the item folder. The others are pending deletions.
    pub present: HashSet<Id>,
}

/// A folder move that failed because a file inside was held open. The maintenance thread retries it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingMove {
    /// The page or section.
    pub id: Id,
    /// Where the folder is.
    pub from: PathBuf,
    /// Where it goes.
    pub to: PathBuf,
}

/// One notebook's tree, in memory.
pub struct NotebookStore {
    /// The seams and settings.
    pub env: Arc<TreeEnv>,
    /// The notebook folder.
    pub layout: NotebookLayout,
    /// `notebook.json`.
    pub notebook: NotebookFile,
    /// Every section outside Trash, by ID.
    pub sections: BTreeMap<SectionId, SectionState>,
    /// Every Trash item, by ID.
    pub trash: BTreeMap<TrashItemId, TrashEntry>,
    /// Page folders that are not where their entry says, such as during a move.
    pub places: HashMap<PageId, PathBuf>,
    /// Pages whose state is not normal.
    pub states: HashMap<PageId, PageNodeState>,
    /// Pages and sections whose deletion is pending. The tree doesn't show them.
    pub hidden: HashSet<Id>,
    /// Folder moves waiting for a retry.
    pub pending: Vec<PendingMove>,
    /// Notices from the last read or scan.
    pub notices: Vec<Warning>,
    /// The device-local cache.
    pub cache: PageCache,
    /// Why the whole notebook is read-only, if it is.
    pub read_only: Option<ReadOnlyReason>,
    /// A sync tool manages the notebook's folder, so missing folders may still arrive.
    pub sync_managed: bool,
    /// The tree journal.
    pub log: Box<dyn IntentLog>,
}

impl std::fmt::Debug for NotebookStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotebookStore")
            .field("root", &self.layout.root)
            .field("notebook", &self.notebook.id)
            .field("sections", &self.sections.len())
            .finish_non_exhaustive()
    }
}

impl NotebookStore {
    /// Reads a notebook's tree files: `notebook.json`, every `section.json`, and every Trash item. This is the
    /// fast part of opening a notebook. The scan (spec 18.3) runs afterward and heals what it finds.
    pub fn open(
        env: Arc<TreeEnv>,
        root: &Path,
        cache: PageCache,
        log: Box<dyn IntentLog>,
    ) -> Result<NotebookStore, CoreError> {
        let layout = NotebookLayout::new(root);
        let notebook = read_notebook_file(&env, &layout)?;
        let read_only = match &notebook.format.access {
            Access::ReadOnly(reason) => Some(reason.clone()),
            Access::ReadWrite => None,
        };
        let mut store = NotebookStore {
            env,
            layout,
            notebook,
            sections: BTreeMap::new(),
            trash: BTreeMap::new(),
            places: HashMap::new(),
            states: HashMap::new(),
            hidden: HashSet::new(),
            pending: Vec::new(),
            notices: Vec::new(),
            cache,
            read_only,
            sync_managed: false,
            log,
        };
        store.read_sections()?;
        store.read_trash_items();
        store.mark_pending();
        Ok(store)
    }

    /// The section whose page list has this page.
    pub fn section_of(&self, page: PageId) -> Option<SectionId> {
        self.sections
            .values()
            .find(|s| s.file.pages.iter().any(|e| e.id == page))
            .map(|s| s.file.id)
    }

    /// Where a page's folder is now.
    pub fn page_dir(&self, page: PageId) -> Option<PathBuf> {
        if let Some(place) = self.places.get(&page) {
            return Some(place.clone());
        }
        let section = self.section_of(page)?;
        self.sections.get(&section).map(|s| s.dir.join(page.to_string()))
    }

    /// The section, if it exists and is shown.
    pub fn section(&self, id: SectionId) -> Result<&SectionState, CoreError> {
        self.sections
            .get(&id)
            .filter(|_| !self.hidden.contains(&id.0))
            .ok_or_else(|| not_found(format!("section {id}")))
    }

    /// The group, if it exists.
    pub fn group(&self, id: GroupId) -> Result<&Group, CoreError> {
        self.notebook
            .groups
            .iter()
            .find(|g| g.id == id)
            .ok_or_else(|| not_found(format!("group {id}")))
    }

    /// Fails when the notebook may not change.
    pub fn check_writable(&self) -> Result<(), CoreError> {
        match &self.read_only {
            Some(reason) => Err(CoreError::ReadOnly(reason.clone())),
            None => Ok(()),
        }
    }

    /// Fails when a section may not change: the notebook is read-only, or the section is encrypted or newer.
    pub fn check_section_writable(&self, id: SectionId) -> Result<(), CoreError> {
        self.check_writable()?;
        let section = self.section(id)?;
        if section.encrypted() {
            return Err(CoreError::ReadOnly(ReadOnlyReason::Encrypted));
        }
        match &section.file.format.access {
            Access::ReadOnly(reason) => Err(CoreError::ReadOnly(reason.clone())),
            Access::ReadWrite => Ok(()),
        }
    }

    /// Writes `notebook.json`.
    pub fn write_notebook(&mut self) -> Result<(), CoreError> {
        let bytes = self.env.codec.write_notebook(&self.notebook);
        self.env.fs.replace_durable(&self.layout.notebook_json(), &bytes)?;
        Ok(())
    }

    /// Writes a section's `section.json`.
    pub fn write_section(&self, id: SectionId) -> Result<(), CoreError> {
        let section = self
            .sections
            .get(&id)
            .ok_or_else(|| not_found(format!("section {id}")))?;
        let bytes = self.env.codec.write_section(&section.file);
        self.env.fs.replace_durable(&section.dir.join(SECTION_JSON), &bytes)?;
        Ok(())
    }

    /// The current time.
    pub fn now(&self) -> Timestamp {
        self.env.clock.now()
    }

    /// Records a tree intent before a change that touches several files. A journal that can't be written
    /// doesn't stop the change: the portable marks in the notebook still let the scan finish it.
    pub(crate) fn begin(&self, op: TreeOp) -> IntentId {
        let id = IntentId::generate(self.env.clock.as_ref());
        let intent = TreeIntent { id, op, steps_done: 0 };
        let _ = self.log.begin(&intent);
        id
    }
}

/// A plain page entry: not pinned, without a color, and not moving.
pub(crate) fn plain_entry(
    id: PageId,
    title: String,
    parent: Option<PageId>,
    order: OrderKey,
    changed: Timestamp,
) -> PageEntry {
    PageEntry {
        id,
        title,
        parent,
        order,
        pinned: false,
        color: None,
        changed,
        moving: None,
        extra: crate::model::JsonMap::new(),
    }
}

/// A sibling in display order: its order key and ID.
pub(crate) type Sibling = (OrderKey, Id);

/// The order key for a node inserted at `index` among `siblings`, which are in display order without the
/// node. Also returns the siblings that need new keys because no key fits between the neighbors, as with
/// equal keys or keys another tool wrote.
pub(crate) fn place_key(siblings: &[Sibling], index: usize) -> Result<(OrderKey, Vec<(Id, OrderKey)>), CoreError> {
    let index = index.min(siblings.len());
    let prev = index.checked_sub(1).and_then(|i| siblings.get(i)).map(|s| &s.0);
    let next = siblings.get(index).map(|s| &s.0);
    if let Ok(key) = OrderKey::between(prev, next) {
        return Ok((key, Vec::new()));
    }
    let total = siblings.len().saturating_add(1);
    let mut keys = OrderKey::spread(None, None, total)
        .map_err(|e| invalid_move(format!("no order keys: {e}")))?
        .into_iter();
    let mut rekeys = Vec::new();
    let mut placed = None;
    for (slot, sibling) in siblings.iter().enumerate() {
        if slot == index {
            placed = keys.next();
        }
        if let Some(key) = keys.next() {
            if key != sibling.0 {
                rekeys.push((sibling.1, key));
            }
        }
    }
    let key = placed
        .or_else(|| keys.next())
        .ok_or_else(|| invalid_move("no order key"))?;
    Ok((key, rekeys))
}

#[cfg(test)]
mod tests;
