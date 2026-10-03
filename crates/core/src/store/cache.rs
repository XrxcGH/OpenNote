//! The device-local cache of page titles, times, and revisions (spec 20.1). Owned by WP5.
//!
//! It keeps nothing for pages in encrypted sections (spec 5.7).
//!
//! The cache lives in `cache/<notebook key>/pages.json` in the device-local data folder. It can be rebuilt at
//! any time, so it is written without flushes, and a missing or damaged file reads as empty. It holds each
//! page's title, created and modified times, and last saved revision. It also remembers when this device first
//! found a listed page folder missing, and when it first saw a temporary file. The scan needs those times
//! because it must never use file times to decide what to drop (spec 18.3).

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::FsError;
use crate::id::{PageId, RevisionId};
use crate::store::fs::Fs;
use crate::store::layout::{DataLayout, NotebookKey};
use crate::store::lock::ensure_dir_all;
use crate::time::Timestamp;

/// The cache file's name inside the notebook's cache folder.
pub const CACHE_FILE: &str = "pages.json";

/// The version of the cache file. A file with another version is ignored and rebuilt.
const CACHE_VERSION: u32 = 1;

/// The largest cache file read, so a damaged file can't use much memory.
const MAX_CACHE_BYTES: u64 = 64 * 1024 * 1024;

/// What the cache knows about one page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPage {
    /// The title from `page.json`, as last read or saved.
    pub title: String,
    /// When the page was made.
    pub created: Timestamp,
    /// The last content change.
    pub modified: Timestamp,
    /// The last revision this device read or saved.
    #[serde(default)]
    pub revision: Option<RevisionId>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    version: u32,
    #[serde(default)]
    pages: BTreeMap<PageId, CachedPage>,
    #[serde(default)]
    missing_since: BTreeMap<PageId, Timestamp>,
    #[serde(default)]
    temp_seen: BTreeMap<String, Timestamp>,
}

/// The cache of one notebook, in memory, with the path it is written to.
#[derive(Clone, Debug)]
pub struct PageCache {
    path: PathBuf,
    file: CacheFile,
    dirty: bool,
}

impl PageCache {
    /// Reads the cache of a notebook. A missing, damaged, or other-version file gives an empty cache.
    pub fn load(fs: &dyn Fs, data: &DataLayout, key: &NotebookKey) -> PageCache {
        let path = data.cache_dir(key).join(CACHE_FILE);
        let file = fs
            .read(&path, MAX_CACHE_BYTES)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CacheFile>(&bytes).ok())
            .filter(|file| file.version == CACHE_VERSION)
            .unwrap_or_else(|| CacheFile {
                version: CACHE_VERSION,
                ..CacheFile::default()
            });
        PageCache {
            path,
            file,
            dirty: false,
        }
    }

    /// An empty cache that is never written, for notebooks opened without a data folder.
    pub fn detached() -> PageCache {
        PageCache {
            path: PathBuf::new(),
            file: CacheFile {
                version: CACHE_VERSION,
                ..CacheFile::default()
            },
            dirty: false,
        }
    }

    /// What the cache knows about a page.
    pub fn page(&self, id: PageId) -> Option<&CachedPage> {
        self.file.pages.get(&id)
    }

    /// How many pages the cache knows.
    pub fn len(&self) -> usize {
        self.file.pages.len()
    }

    /// Whether the cache knows no page.
    pub fn is_empty(&self) -> bool {
        self.file.pages.is_empty()
    }

    /// Records what a read or a save found. The caller never records pages of encrypted sections.
    pub fn record(&mut self, id: PageId, page: CachedPage) {
        if self.file.pages.get(&id) != Some(&page) {
            self.file.pages.insert(id, page);
            self.dirty = true;
        }
        if self.file.missing_since.remove(&id).is_some() {
            self.dirty = true;
        }
    }

    /// Records a page folder the scan found. What the cache knows stays; the rest is filled in.
    pub fn seen(&mut self, id: PageId, title: &str, fallback_time: Timestamp) {
        if self.file.missing_since.remove(&id).is_some() {
            self.dirty = true;
        }
        if self.file.pages.contains_key(&id) {
            return;
        }
        let created = created_from_id(id).unwrap_or(fallback_time);
        let page = CachedPage {
            title: title.to_owned(),
            created,
            modified: created,
            revision: None,
        };
        self.file.pages.insert(id, page);
        self.dirty = true;
    }

    /// Forgets a page, such as one purged from Trash or one in an encrypted section.
    pub fn forget(&mut self, id: PageId) {
        let removed = self.file.pages.remove(&id).is_some();
        let unmissed = self.file.missing_since.remove(&id).is_some();
        self.dirty |= removed || unmissed;
    }

    /// Whether this device saw the page's folder before.
    pub fn was_seen(&self, id: PageId) -> bool {
        self.file.pages.contains_key(&id)
    }

    /// When this device first found the page's folder missing. Records `now` the first time.
    pub fn missing_since(&mut self, id: PageId, now: Timestamp) -> Timestamp {
        if let Some(&since) = self.file.missing_since.get(&id) {
            return since;
        }
        self.file.missing_since.insert(id, now);
        self.dirty = true;
        now
    }

    /// When this device first saw a temporary file or partial folder, by its path relative to the notebook.
    /// Records `now` the first time.
    pub fn first_seen(&mut self, name: &str, now: Timestamp) -> Timestamp {
        if let Some(&since) = self.file.temp_seen.get(name) {
            return since;
        }
        self.file.temp_seen.insert(name.to_owned(), now);
        self.dirty = true;
        now
    }

    /// Forgets temporary files that are gone, keeping only the names in `present`.
    pub fn keep_seen(&mut self, present: &HashSet<String>) {
        let before = self.file.temp_seen.len();
        self.file.temp_seen.retain(|name, _| present.contains(name));
        self.dirty |= self.file.temp_seen.len() != before;
    }

    /// Whether the cache changed since it was read or written.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Writes the cache if it changed. The cache can be rebuilt, so it is written without flushes.
    pub fn save(&mut self, fs: &dyn Fs) -> Result<(), FsError> {
        if !self.dirty || self.path.as_os_str().is_empty() {
            return Ok(());
        }
        if let Some(dir) = self.path.parent() {
            ensure_dir_all(fs, dir)?;
        }
        let bytes = serde_json::to_vec(&self.file).unwrap_or_default();
        fs.write_derived(&self.path, &bytes)?;
        self.dirty = false;
        Ok(())
    }
}

/// A page's created time from its ID, which starts with the time it was made (spec 2.4).
pub fn created_from_id(id: PageId) -> Option<Timestamp> {
    let ms = i64::try_from(id.0.time_ms()).ok()?;
    (ms > 0).then(|| Timestamp::from_unix_ms(ms))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::arithmetic_side_effects)]

    use std::path::Path;

    use super::*;
    use crate::id::{Id, NotebookId};
    use crate::store::fs::FolderIdentity;
    use crate::store::layout::notebook_key;
    use crate::testing::MemFs;

    fn page(n: u64) -> PageId {
        PageId(Id::from_parts(1_790_000_000_000 + n, u128::from(n)))
    }

    fn at(ms: i64) -> Timestamp {
        Timestamp::from_unix_ms(ms)
    }

    fn setup() -> (MemFs, DataLayout, NotebookKey) {
        let key = notebook_key(NotebookId::ZERO, &FolderIdentity([1; 24]));
        (MemFs::new(), DataLayout::new("/data"), key)
    }

    #[test]
    fn records_survive_a_write_and_a_read() {
        let (fs, data, key) = setup();
        let mut cache = PageCache::load(&fs, &data, &key);
        assert!(cache.is_empty());
        let entry = CachedPage {
            title: "Mitosis".into(),
            created: at(5),
            modified: at(9),
            revision: None,
        };
        cache.record(page(1), entry.clone());
        cache.first_seen("s/~x.tmp", at(3));
        assert!(cache.is_dirty());
        cache.save(&fs).unwrap();
        assert!(!cache.is_dirty());
        let again = PageCache::load(&fs, &data, &key);
        assert_eq!(again.page(page(1)), Some(&entry));
        assert_eq!(again.len(), 1);
    }

    #[test]
    fn a_damaged_or_other_version_file_reads_as_empty() {
        let (fs, data, key) = setup();
        let path = data.cache_dir(&key).join(CACHE_FILE);
        fs.put(&path, b"{not json");
        assert!(PageCache::load(&fs, &data, &key).is_empty());
        fs.put(&path, br#"{"version":99,"pages":{}}"#);
        assert!(PageCache::load(&fs, &data, &key).is_empty());
    }

    #[test]
    fn seen_pages_take_their_created_time_from_the_id() {
        let mut cache = PageCache::detached();
        cache.seen(page(4), "Four", at(1));
        let entry = cache.page(page(4)).unwrap();
        assert_eq!(entry.created, at(1_790_000_000_004));
        assert_eq!(entry.title, "Four");
        assert!(cache.was_seen(page(4)));
        // A second sighting keeps what is known.
        cache.seen(page(4), "Other", at(2));
        assert_eq!(cache.page(page(4)).unwrap().title, "Four");
    }

    #[test]
    fn missing_pages_remember_when_they_went_missing() {
        let mut cache = PageCache::detached();
        assert_eq!(cache.missing_since(page(2), at(10)), at(10));
        assert_eq!(cache.missing_since(page(2), at(20)), at(10));
        cache.seen(page(2), "Back", at(30));
        assert_eq!(cache.missing_since(page(2), at(40)), at(40));
        cache.forget(page(2));
        assert!(!cache.was_seen(page(2)));
    }

    #[test]
    fn temporary_files_are_forgotten_once_gone() {
        let mut cache = PageCache::detached();
        assert_eq!(cache.first_seen("a", at(1)), at(1));
        assert_eq!(cache.first_seen("a", at(2)), at(1));
        cache.first_seen("b", at(3));
        cache.keep_seen(&HashSet::from(["b".to_owned()]));
        assert_eq!(cache.first_seen("a", at(4)), at(4));
        assert_eq!(cache.first_seen("b", at(5)), at(3));
    }

    #[test]
    fn a_detached_cache_is_never_written() {
        let fs = MemFs::new();
        let mut cache = PageCache::detached();
        cache.seen(page(1), "x", at(1));
        cache.save(&fs).unwrap();
        assert!(fs.files().is_empty());
        assert!(!fs.exists(Path::new("/data")));
    }
}
