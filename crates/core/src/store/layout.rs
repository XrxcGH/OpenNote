//! Paths from IDs (spec 3 and 20.1). Readers build every path from IDs and checked names, never from strings
//! found in files, so no path can leave the notebook folder (spec 2.10).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use crate::error::{FormatError, FormatErrorKind};
use crate::format::names::check_asset_file_name;
use crate::id::{Id, NotebookId, PageId, RevisionId, SectionId, SegmentId, TrashItemId};
use crate::model::Asset;
use crate::store::fs::FolderIdentity;
use crate::time::Timestamp;

/// `notebook.json`.
pub const NOTEBOOK_JSON: &str = "notebook.json";
/// `section.json`.
pub const SECTION_JSON: &str = "section.json";
/// `page.json`.
pub const PAGE_JSON: &str = "page.json";
/// `page.md`, the readable copy of a page.
pub const PAGE_MD: &str = "page.md";
/// `ink.svg`, the picture of a page's handwriting.
pub const INK_SVG: &str = "ink.svg";
/// `index.md`, the notebook's table of contents.
pub const INDEX_MD: &str = "index.md";
/// `README.md`, for people without OpenNote.
pub const README_MD: &str = "README.md";
/// A Trash item's `item.json`.
pub const ITEM_JSON: &str = "item.json";
/// `.history/versions.json`.
pub const VERSIONS_JSON: &str = "versions.json";
/// The notebook's own folder, `.opennote`.
pub const OPENNOTE_DIR: &str = ".opennote";
/// A page's ink segments.
pub const INK_DIR: &str = "ink";
/// A page's assets.
pub const ASSETS_DIR: &str = "assets";
/// A page's saved versions.
pub const HISTORY_DIR: &str = ".history";
/// Versions of a page waiting for review after a conflict.
pub const CONFLICTS_DIR: &str = ".conflicts";
/// Files moved aside because they failed to read.
pub const DAMAGED_DIR: &str = ".damaged";

/// The paths inside one notebook folder (spec 3.1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotebookLayout {
    /// The notebook folder.
    pub root: PathBuf,
}

impl NotebookLayout {
    /// The layout of the notebook at `root`.
    pub fn new(root: impl Into<PathBuf>) -> NotebookLayout {
        NotebookLayout { root: root.into() }
    }

    /// `notebook.json`.
    pub fn notebook_json(&self) -> PathBuf {
        self.root.join(NOTEBOOK_JSON)
    }

    /// `README.md`.
    pub fn readme(&self) -> PathBuf {
        self.root.join(README_MD)
    }

    /// `index.md`.
    pub fn index_md(&self) -> PathBuf {
        self.root.join(INDEX_MD)
    }

    /// `.opennote/FORMAT.md`, the copy of the specification.
    pub fn format_md(&self) -> PathBuf {
        self.root.join(OPENNOTE_DIR).join("FORMAT.md")
    }

    /// `.opennote/trash`.
    pub fn trash_dir(&self) -> PathBuf {
        self.root.join(OPENNOTE_DIR).join("trash")
    }

    /// `.opennote/conflicts`, for sync-tool copies of tree files.
    pub fn tree_conflicts_dir(&self) -> PathBuf {
        self.root.join(OPENNOTE_DIR).join("conflicts")
    }

    /// `.opennote/lock`, the writer lock on network drives.
    pub fn network_lock(&self) -> PathBuf {
        self.root.join(OPENNOTE_DIR).join("lock")
    }

    /// A section's folder.
    pub fn section_dir(&self, s: SectionId) -> PathBuf {
        self.root.join(s.to_string())
    }

    /// A section's `section.json`.
    pub fn section_json(&self, s: SectionId) -> PathBuf {
        self.section_dir(s).join(SECTION_JSON)
    }

    /// A page's folder.
    pub fn page_dir(&self, s: SectionId, p: PageId) -> PathBuf {
        self.section_dir(s).join(p.to_string())
    }

    /// A Trash item's folder.
    pub fn trash_item_dir(&self, t: TrashItemId) -> PathBuf {
        self.trash_dir().join(t.to_string())
    }

    /// A Trash item's folder while it is being purged (spec 12.4).
    pub fn purge_dir(&self, t: TrashItemId) -> PathBuf {
        self.trash_dir().join(purge_name(t))
    }

    /// A page's `page.json`.
    pub fn page_json(page_dir: &Path) -> PathBuf {
        page_dir.join(PAGE_JSON)
    }

    /// An ink segment's file.
    pub fn segment_path(page_dir: &Path, id: SegmentId) -> PathBuf {
        page_dir.join(INK_DIR).join(format!("{id}.onk"))
    }

    /// An asset's file, after checking its name (spec 10.1).
    pub fn asset_path(page_dir: &Path, asset: &Asset) -> Result<PathBuf, FormatError> {
        if check_asset_file_name(asset.id, &asset.file) {
            Ok(page_dir.join(ASSETS_DIR).join(&asset.file))
        } else {
            let detail = format!("asset {} has the file name {:?}", asset.id, asset.file);
            Err(FormatError::new(FormatErrorKind::Validation, detail))
        }
    }

    /// A saved version's snapshot.
    pub fn version_path(page_dir: &Path, rev: RevisionId) -> PathBuf {
        page_dir.join(HISTORY_DIR).join(format!("{rev}.json.gz"))
    }

    /// `.history/versions.json`.
    pub fn versions_json(page_dir: &Path) -> PathBuf {
        page_dir.join(HISTORY_DIR).join(VERSIONS_JSON)
    }

    /// A version kept after a conflict (spec 14.1).
    pub fn conflict_path(page_dir: &Path, rev: RevisionId) -> PathBuf {
        page_dir.join(CONFLICTS_DIR).join(format!("{rev}.json"))
    }
}

/// The paths of device-local data (spec 20.1), such as `%LOCALAPPDATA%\OpenNote`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataLayout {
    /// The device-local data folder.
    pub root: PathBuf,
}

impl DataLayout {
    /// The layout of the data folder at `root`.
    pub fn new(root: impl Into<PathBuf>) -> DataLayout {
        DataLayout { root: root.into() }
    }

    /// `device.json`: this device's ID and label.
    pub fn device_json(&self) -> PathBuf {
        self.root.join("device.json")
    }

    /// `session.json`: the "running" marker.
    pub fn session_json(&self) -> PathBuf {
        self.root.join("session.json")
    }

    /// The journal folder of one notebook.
    pub fn journal_dir(&self, key: &NotebookKey) -> PathBuf {
        self.root.join("journal").join(&key.0)
    }

    /// A page journal generation, or with `page` set to `None`, a tree journal generation.
    pub fn journal_file(&self, key: &NotebookKey, page: Option<PageId>, generation: u64) -> PathBuf {
        self.journal_dir(key).join(journal_file_name(page, generation))
    }

    /// The lock of one open notebook.
    pub fn lock_file(&self, key: &NotebookKey) -> PathBuf {
        self.root.join("locks").join(format!("{}.lock", key.0))
    }

    /// Per-device view state of one notebook.
    pub fn state_file(&self, key: &NotebookKey) -> PathBuf {
        self.root.join("state").join(format!("{}.json", key.0))
    }

    /// The rebuildable cache of one notebook.
    pub fn cache_dir(&self, key: &NotebookKey) -> PathBuf {
        self.root.join("cache").join(&key.0)
    }

    /// The backup sets of one notebook (spec 15.4).
    pub fn backups_dir(&self, notebook: NotebookId) -> PathBuf {
        self.root.join("backups").join(notebook.to_string())
    }

    /// One backup set, made before an upgrade from one format version to another.
    pub fn backup_set(&self, notebook: NotebookId, at: Timestamp, from: u32, to: u32) -> PathBuf {
        self.backups_dir(notebook)
            .join(format!("{}-v{from}-to-v{to}", file_time(at)))
    }

    /// Changes that recovery couldn't apply, as readable JSON.
    pub fn recovery_dir(&self) -> PathBuf {
        self.root.join("recovery")
    }
}

/// A notebook key: the notebook ID, `-`, and 8 hexadecimal digits of the folder identity's hash (spec 20.2).
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NotebookKey(pub String);

/// The key of a notebook in a folder with this identity.
pub fn notebook_key(id: NotebookId, identity: &FolderIdentity) -> NotebookKey {
    let hash = Sha256::digest(identity.0);
    let prefix: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    NotebookKey(format!("{id}-{prefix}"))
}

/// A journal generation's file name: `<page ID>-<generation>.wal`, or `tree-<generation>.wal` (spec 20.4).
pub fn journal_file_name(page: Option<PageId>, generation: u64) -> String {
    match page {
        Some(page) => format!("{page}-{generation:016x}.wal"),
        None => format!("tree-{generation:016x}.wal"),
    }
}

/// The page, or `None` for a tree journal, and the generation of a journal file name.
pub fn parse_journal_file_name(name: &str) -> Option<(Option<PageId>, u64)> {
    let (owner, generation) = name.strip_suffix(".wal")?.rsplit_once('-')?;
    let valid_hex = generation.len() == 16
        && generation
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !valid_hex {
        return None;
    }
    let generation = u64::from_str_radix(generation, 16).ok()?;
    match owner {
        "tree" => Some((None, generation)),
        _ => Some((Some(PageId::parse(owner).ok()?), generation)),
    }
}

/// A temporary file's name next to its target: `~<target>.<8 hex digits>.tmp` (spec 3.3).
pub fn temp_name(target: &str) -> String {
    format!("~{target}.{:08x}.tmp", random_u32())
}

/// The target of a temporary file's name, or `None` if the name doesn't have that form.
pub fn parse_temp_name(name: &str) -> Option<&str> {
    let (target, hex) = name.strip_prefix('~')?.strip_suffix(".tmp")?.rsplit_once('.')?;
    let valid_hex = hex.len() == 8 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    (valid_hex && !target.is_empty()).then_some(target)
}

/// What a partial folder is for (spec 18.2 and 19).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartialFolder {
    /// `~<ID>.copying`: a page being duplicated.
    Copying(Id),
    /// `~<ID>.moving`: a page or section being moved to another notebook.
    Moving(Id),
    /// `~purge-<ID>`: a Trash item being purged.
    Purge(TrashItemId),
}

impl PartialFolder {
    /// The folder's name.
    pub fn name(&self) -> String {
        match self {
            PartialFolder::Copying(id) => format!("~{id}.copying"),
            PartialFolder::Moving(id) => format!("~{id}.moving"),
            PartialFolder::Purge(item) => purge_name(*item),
        }
    }

    /// Recognizes a partial folder's name.
    pub fn parse(name: &str) -> Option<PartialFolder> {
        let rest = name.strip_prefix('~')?;
        if let Some(item) = rest.strip_prefix("purge-") {
            return TrashItemId::parse(item).ok().map(PartialFolder::Purge);
        }
        let (id, kind) = rest.rsplit_once('.')?;
        let id = Id::parse(id).ok()?;
        match kind {
            "copying" => Some(PartialFolder::Copying(id)),
            "moving" => Some(PartialFolder::Moving(id)),
            _ => None,
        }
    }
}

fn purge_name(item: TrashItemId) -> String {
    format!("~purge-{item}")
}

/// A time as `20260930T140740Z`, for names of edited copies, damaged files, and backup sets.
pub fn file_time(at: Timestamp) -> String {
    let text = at.to_rfc3339();
    let digits: String = text.chars().filter(char::is_ascii_digit).take(14).collect();
    let (date, time) = digits.split_at_checked(8).unwrap_or((&digits, ""));
    format!("{date}T{time}Z")
}

/// Random bits for temporary names. Falls back to a counter if the random generator fails, because a
/// temporary name only has to avoid names in use.
fn random_u32() -> u32 {
    static FALLBACK: AtomicU32 = AtomicU32::new(0x5eed_0000);
    getrandom::u32().unwrap_or_else(|_| FALLBACK.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests;
