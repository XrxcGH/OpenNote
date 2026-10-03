//! The notebook lock and the network-drive lock (spec 20.3). Owned by WP5.
//!
//! Each open notebook holds an exclusive lock on `locks/<notebook key>.lock` in the device-local data folder.
//! The operating system releases it when the process ends, so a crash never leaves a stale lock. A notebook
//! on a network drive also locks `.opennote/lock` inside the notebook, because network file systems enforce
//! such locks across computers. Local notebooks never use that file, which sync tools would upload.

use std::fmt;
use std::path::Path;

use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{Fs, FsLock};
use crate::store::layout::{DataLayout, NotebookKey, NotebookLayout};

/// The locks of one open notebook. Dropping it releases them.
pub struct NotebookLock {
    _device: Box<dyn FsLock>,
    _network: Option<Box<dyn FsLock>>,
}

impl fmt::Debug for NotebookLock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NotebookLock")
            .field("network", &self._network.is_some())
            .finish()
    }
}

/// Takes the locks of a notebook. `Ok(None)` means another process has it open, so it opens read-only with
/// "This notebook is open in another OpenNote window."
pub fn lock_notebook(
    fs: &dyn Fs,
    data: &DataLayout,
    key: &NotebookKey,
    notebook: &NotebookLayout,
    remote: bool,
) -> Result<Option<NotebookLock>, FsError> {
    let path = data.lock_file(key);
    if let Some(parent) = path.parent() {
        ensure_dir_all(fs, parent)?;
    }
    let Some(device) = fs.try_lock(&path)? else {
        return Ok(None);
    };
    let network = if remote {
        let lock = notebook.network_lock();
        if let Some(parent) = lock.parent() {
            ensure_dir_all(fs, parent)?;
        }
        match fs.try_lock(&lock)? {
            Some(held) => Some(held),
            None => return Ok(None),
        }
    } else {
        None
    };
    Ok(Some(NotebookLock {
        _device: device,
        _network: network,
    }))
}

/// Creates a folder and any missing parents, each durably. An existing folder is fine.
pub fn ensure_dir_all(fs: &dyn Fs, path: &Path) -> Result<(), FsError> {
    let mut missing = Vec::new();
    let mut current = Some(path);
    while let Some(dir) = current {
        match fs.metadata(dir) {
            Ok(meta) if meta.is_dir => break,
            Ok(_) => return Err(FsError::new(FsErrorKind::AlreadyExists, dir)),
            Err(e) if e.kind == FsErrorKind::NotFound => missing.push(dir),
            Err(e) => return Err(e),
        }
        current = dir.parent().filter(|p| !p.as_os_str().is_empty());
    }
    for dir in missing.into_iter().rev() {
        match fs.create_dir_durable(dir) {
            Ok(_) => {}
            Err(e) if e.kind == FsErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::id::NotebookId;
    use crate::store::fs::FolderIdentity;
    use crate::store::layout::notebook_key;
    use crate::testing::MemFs;

    fn setup() -> (MemFs, DataLayout, NotebookKey, NotebookLayout) {
        let fs = MemFs::new();
        fs.mkdir_all(Path::new("/notebooks/Biology"));
        let key = notebook_key(NotebookId::ZERO, &FolderIdentity([7; 24]));
        (
            fs,
            DataLayout::new("/data"),
            key,
            NotebookLayout::new("/notebooks/Biology"),
        )
    }

    #[test]
    fn a_second_lock_of_the_same_notebook_fails_until_the_first_is_dropped() {
        let (fs, data, key, notebook) = setup();
        let first = lock_notebook(&fs, &data, &key, &notebook, false).unwrap();
        assert!(first.is_some());
        assert!(lock_notebook(&fs, &data, &key, &notebook, false).unwrap().is_none());
        drop(first);
        assert!(lock_notebook(&fs, &data, &key, &notebook, false).unwrap().is_some());
    }

    #[test]
    fn local_notebooks_never_create_the_network_lock() {
        let (fs, data, key, notebook) = setup();
        let _lock = lock_notebook(&fs, &data, &key, &notebook, false).unwrap().unwrap();
        assert!(!fs.exists(&notebook.network_lock()));
        assert!(fs.exists(&data.lock_file(&key)));
    }

    #[test]
    fn network_notebooks_also_lock_inside_the_notebook() {
        let (fs, data, key, notebook) = setup();
        let _lock = lock_notebook(&fs, &data, &key, &notebook, true).unwrap().unwrap();
        assert!(fs.exists(&notebook.network_lock()));
        // Another computer has its own data folder, but the lock in the notebook still stops it.
        let other = DataLayout::new("/other-data");
        assert!(lock_notebook(&fs, &other, &key, &notebook, true).unwrap().is_none());
    }

    #[test]
    fn ensure_dir_all_creates_missing_parents_and_accepts_existing_ones() {
        let fs = MemFs::new();
        ensure_dir_all(&fs, Path::new("/a/b/c")).unwrap();
        ensure_dir_all(&fs, Path::new("/a/b/c")).unwrap();
        assert!(fs.exists(Path::new("/a/b/c")));
        fs.put(Path::new("/a/file"), b"x");
        assert!(ensure_dir_all(&fs, Path::new("/a/file/d")).is_err());
    }
}
