//! The library: the device-local list of notebooks this device shows, and their order. Owned by WP5.
//!
//! The note format has no list of notebooks: each notebook is an independent folder (spec 3). The navigation
//! tree still shows notebooks in an order the person chose, so the core keeps that list in `library.json` in
//! the device-local data folder, next to `device.json`. It is never synced, like the rest of that folder
//! (spec 20.1).
//!
//! Removing a notebook from the library is the notes contract's "move a notebook to Trash". The folder stays
//! untouched, and the entry moves to a list of removed notebooks, from which it can go back to its old
//! position. Deleting the folder itself is the app's job: it moves the folder to the operating system's
//! recycle bin and then calls [`Library::forget_removed`] (spec 12.4).

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, FsError, FsErrorKind};
use crate::id::NotebookId;
use crate::store::fs::Fs;
use crate::store::layout::DataLayout;
use crate::store::lock::ensure_dir_all;
use crate::time::Timestamp;

/// The library file's name in the data folder.
pub const LIBRARY_FILE: &str = "library.json";

const LIBRARY_VERSION: u32 = 1;
const MAX_LIBRARY_BYTES: u64 = 16 * 1024 * 1024;

/// A notebook in the library.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    /// The notebook folder.
    pub path: PathBuf,
    /// The notebook's ID when it was last opened.
    pub notebook: NotebookId,
    /// Its title when it was last opened, shown while the folder can't be reached.
    pub title: String,
}

/// A notebook removed from the library, which can be restored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedEntry {
    /// The entry as it was.
    pub entry: LibraryEntry,
    /// Its position in the list when it was removed.
    pub index: usize,
    /// When it was removed.
    pub removed_at: Timestamp,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryFile {
    version: u32,
    #[serde(default)]
    folder: Option<PathBuf>,
    #[serde(default)]
    notebooks: Vec<LibraryEntry>,
    #[serde(default)]
    removed: Vec<RemovedEntry>,
}

impl Default for LibraryFile {
    fn default() -> LibraryFile {
        LibraryFile {
            version: LIBRARY_VERSION,
            folder: None,
            notebooks: Vec::new(),
            removed: Vec::new(),
        }
    }
}

/// The library, in memory, with the file it is saved to.
#[derive(Clone, Debug)]
pub struct Library {
    path: PathBuf,
    file: LibraryFile,
}

impl Library {
    /// Reads the library. A missing file gives an empty library. A damaged file is kept aside as
    /// `library.json.damaged`, so a later save doesn't lose what a person could still recover by hand.
    pub fn load(fs: &dyn Fs, data: &DataLayout) -> Library {
        let path = data.root.join(LIBRARY_FILE);
        let file = match fs.read(&path, MAX_LIBRARY_BYTES) {
            Ok(bytes) => match serde_json::from_slice::<LibraryFile>(&bytes) {
                Ok(file) if file.version == LIBRARY_VERSION => file,
                _ => {
                    let _ = fs.write_derived(&data.root.join("library.json.damaged"), &bytes);
                    LibraryFile::default()
                }
            },
            Err(_) => LibraryFile::default(),
        };
        Library { path, file }
    }

    /// The notebooks, in display order.
    pub fn entries(&self) -> &[LibraryEntry] {
        &self.file.notebooks
    }

    /// The notebooks removed from the library, oldest first.
    pub fn removed(&self) -> &[RemovedEntry] {
        &self.file.removed
    }

    /// The notes folder, where new notebooks go.
    pub fn folder(&self) -> Option<&Path> {
        self.file.folder.as_deref()
    }

    /// The entry of the notebook folder at `path`.
    pub fn find(&self, path: &Path) -> Option<&LibraryEntry> {
        self.position(path).and_then(|i| self.file.notebooks.get(i))
    }

    /// The first entry with this notebook ID. A copied notebook shares its ID with the original.
    pub fn find_id(&self, notebook: NotebookId) -> Option<&LibraryEntry> {
        self.file.notebooks.iter().find(|e| e.notebook == notebook)
    }

    fn position(&self, path: &Path) -> Option<usize> {
        self.file.notebooks.iter().position(|e| same_path(&e.path, path))
    }

    /// Sets the notes folder.
    pub fn set_folder(&mut self, fs: &dyn Fs, folder: &Path) -> Result<(), CoreError> {
        self.file.folder = Some(folder.to_path_buf());
        self.save(fs)
    }

    /// Adds a notebook before `before`, or at the end. An entry already in the library only has its ID and
    /// title updated. Adding a removed notebook takes it off the removed list.
    pub fn add(&mut self, fs: &dyn Fs, entry: LibraryEntry, before: Option<&Path>) -> Result<(), CoreError> {
        self.file.removed.retain(|r| !same_path(&r.entry.path, &entry.path));
        if let Some(i) = self.position(&entry.path) {
            if let Some(existing) = self.file.notebooks.get_mut(i) {
                if *existing == entry {
                    return Ok(());
                }
                *existing = entry;
            }
            return self.save(fs);
        }
        let at = self.insert_index(before);
        self.file.notebooks.insert(at, entry);
        self.save(fs)
    }

    fn insert_index(&self, before: Option<&Path>) -> usize {
        before
            .and_then(|b| self.position(b))
            .unwrap_or(self.file.notebooks.len())
    }

    /// Moves a notebook before `before`, or to the end. Moving it before itself changes nothing.
    pub fn move_to(&mut self, fs: &dyn Fs, path: &Path, before: Option<&Path>) -> Result<(), CoreError> {
        let from = self.position(path).ok_or_else(|| not_in_library(path))?;
        if before.is_some_and(|b| same_path(b, path)) {
            return Ok(());
        }
        let entry = self.file.notebooks.remove(from);
        let at = self.insert_index(before);
        self.file.notebooks.insert(at, entry);
        self.save(fs)
    }

    /// Updates the ID and title the library shows for a notebook, if it is in the library.
    pub fn update(&mut self, fs: &dyn Fs, path: &Path, notebook: NotebookId, title: &str) -> Result<(), CoreError> {
        let Some(entry) = self.position(path).and_then(|i| self.file.notebooks.get_mut(i)) else {
            return Ok(());
        };
        if entry.notebook == notebook && entry.title == title {
            return Ok(());
        }
        entry.notebook = notebook;
        title.clone_into(&mut entry.title);
        self.save(fs)
    }

    /// Removes a notebook from the library and keeps it on the removed list. The folder is untouched.
    pub fn remove(&mut self, fs: &dyn Fs, path: &Path, now: Timestamp) -> Result<RemovedEntry, CoreError> {
        let index = self.position(path).ok_or_else(|| not_in_library(path))?;
        let entry = self.file.notebooks.remove(index);
        let removed = RemovedEntry {
            entry,
            index,
            removed_at: now,
        };
        self.file.removed.push(removed.clone());
        self.save(fs)?;
        Ok(removed)
    }

    /// Puts a removed notebook back where it was, or at the end if the list is now shorter.
    pub fn restore(&mut self, fs: &dyn Fs, path: &Path) -> Result<LibraryEntry, CoreError> {
        let i = self
            .file
            .removed
            .iter()
            .rposition(|r| same_path(&r.entry.path, path))
            .ok_or_else(|| not_in_library(path))?;
        let removed = self.file.removed.remove(i);
        if self.position(path).is_none() {
            let at = removed.index.min(self.file.notebooks.len());
            self.file.notebooks.insert(at, removed.entry.clone());
        }
        self.save(fs)?;
        Ok(removed.entry)
    }

    /// Forgets a removed notebook, after the app deleted its folder or the person chose to forget it.
    pub fn forget_removed(&mut self, fs: &dyn Fs, path: &Path) -> Result<(), CoreError> {
        let before = self.file.removed.len();
        self.file.removed.retain(|r| !same_path(&r.entry.path, path));
        if self.file.removed.len() == before {
            return Ok(());
        }
        self.save(fs)
    }

    fn save(&self, fs: &dyn Fs) -> Result<(), CoreError> {
        if let Some(dir) = self.path.parent() {
            ensure_dir_all(fs, dir)?;
        }
        let bytes = serde_json::to_vec_pretty(&self.file).unwrap_or_default();
        fs.replace_durable(&self.path, &bytes)?;
        Ok(())
    }
}

fn not_in_library(path: &Path) -> CoreError {
    CoreError::Fs(FsError::new(FsErrorKind::NotFound, path))
}

/// Whether two paths name the same folder, ignoring `.` parts and trailing separators, and case on Windows.
pub fn same_path(a: &Path, b: &Path) -> bool {
    let normal = |p: &Path| -> Vec<String> {
        p.components()
            .filter(|c| !matches!(c, std::path::Component::CurDir))
            .map(|c| {
                let text = c.as_os_str().to_string_lossy();
                if cfg!(windows) {
                    text.to_lowercase()
                } else {
                    text.into_owned()
                }
            })
            .collect()
    };
    normal(a) == normal(b)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use super::*;
    use crate::id::Id;
    use crate::testing::MemFs;

    fn entry(n: u64) -> LibraryEntry {
        LibraryEntry {
            path: PathBuf::from(format!("/notes/Notebook {n}")),
            notebook: NotebookId(Id::from_parts(n, u128::from(n))),
            title: format!("Notebook {n}"),
        }
    }

    fn titles(library: &Library) -> Vec<String> {
        library.entries().iter().map(|e| e.title.clone()).collect()
    }

    fn setup() -> (MemFs, DataLayout, Library) {
        let fs = MemFs::new();
        let data = DataLayout::new("/data");
        let library = Library::load(&fs, &data);
        (fs, data, library)
    }

    #[test]
    fn keeps_order_across_a_reload() {
        let (fs, data, mut library) = setup();
        library.add(&fs, entry(1), None).unwrap();
        library.add(&fs, entry(2), None).unwrap();
        library
            .add(&fs, entry(3), Some(Path::new("/notes/Notebook 1")))
            .unwrap();
        library.set_folder(&fs, Path::new("/notes")).unwrap();
        let again = Library::load(&fs, &data);
        assert_eq!(titles(&again), ["Notebook 3", "Notebook 1", "Notebook 2"]);
        assert_eq!(again.folder(), Some(Path::new("/notes")));
    }

    #[test]
    fn adding_twice_updates_the_entry_in_place() {
        let (fs, _, mut library) = setup();
        library.add(&fs, entry(1), None).unwrap();
        library.add(&fs, entry(2), None).unwrap();
        let mut renamed = entry(1);
        renamed.title = "Biology".into();
        library.add(&fs, renamed, None).unwrap();
        assert_eq!(titles(&library), ["Biology", "Notebook 2"]);
    }

    #[test]
    fn moves_before_a_sibling_or_to_the_end() {
        let (fs, _, mut library) = setup();
        for n in 1..=3 {
            library.add(&fs, entry(n), None).unwrap();
        }
        let path = |n: u64| entry(n).path;
        library.move_to(&fs, &path(3), Some(&path(1))).unwrap();
        assert_eq!(titles(&library), ["Notebook 3", "Notebook 1", "Notebook 2"]);
        library.move_to(&fs, &path(3), None).unwrap();
        assert_eq!(titles(&library), ["Notebook 1", "Notebook 2", "Notebook 3"]);
        library.move_to(&fs, &path(2), Some(&path(2))).unwrap();
        assert_eq!(titles(&library), ["Notebook 1", "Notebook 2", "Notebook 3"]);
        assert!(library.move_to(&fs, Path::new("/nowhere"), None).is_err());
    }

    #[test]
    fn removing_and_restoring_puts_a_notebook_back_in_place() {
        let (fs, data, mut library) = setup();
        for n in 1..=3 {
            library.add(&fs, entry(n), None).unwrap();
        }
        let removed = library.remove(&fs, &entry(2).path, Timestamp::from_unix_ms(7)).unwrap();
        assert_eq!(removed.index, 1);
        assert_eq!(titles(&library), ["Notebook 1", "Notebook 3"]);
        let mut again = Library::load(&fs, &data);
        assert_eq!(again.removed().len(), 1);
        again.restore(&fs, &entry(2).path).unwrap();
        assert_eq!(titles(&again), ["Notebook 1", "Notebook 2", "Notebook 3"]);
        assert!(again.removed().is_empty());
        assert!(again.restore(&fs, &entry(2).path).is_err());
    }

    #[test]
    fn forgetting_a_removed_notebook_drops_it() {
        let (fs, _, mut library) = setup();
        library.add(&fs, entry(1), None).unwrap();
        library.remove(&fs, &entry(1).path, Timestamp::EPOCH).unwrap();
        library.forget_removed(&fs, &entry(1).path).unwrap();
        assert!(library.removed().is_empty());
        assert!(library.entries().is_empty());
    }

    #[test]
    fn a_damaged_file_is_kept_aside() {
        let fs = MemFs::new();
        let data = DataLayout::new("/data");
        fs.put(Path::new("/data/library.json"), b"{broken");
        let library = Library::load(&fs, &data);
        assert!(library.entries().is_empty());
        assert_eq!(fs.get(Path::new("/data/library.json.damaged")).unwrap(), b"{broken");
    }

    #[test]
    fn paths_compare_without_dot_parts() {
        assert!(same_path(Path::new("/a/./b"), Path::new("/a/b")));
        assert!(!same_path(Path::new("/a/b"), Path::new("/a/c")));
    }
}
