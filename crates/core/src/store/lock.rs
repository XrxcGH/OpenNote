//! The notebook lock and the network-drive lock (spec 20.3). Owned by WP5.
//!
//! Each open notebook holds an exclusive lock on `locks/<notebook key>.lock` in the device-local data folder.
//! The operating system releases it when the process ends, so a crash never leaves a stale lock. A notebook
//! on a network drive also locks `.opennote/lock` inside the notebook, because network file systems enforce
//! such locks across computers. Local notebooks never use that file, which sync tools would upload.

use std::fmt;
use std::path::Path;
use std::time::{Duration, Instant};

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

/// Why a notebook's locks couldn't be taken.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Held {
    /// The device lock was held: a previous run of this profile is still ending (spec 20.3).
    Ending,
    /// Only the network lock was held: another computer's app has the notebook open.
    Elsewhere,
}

/// Takes the locks of a notebook, trying a held one again until `deadline` (spec 20.3). A deadline that has
/// passed means one try.
///
/// The device lock lives in this profile's data, and one process runs per profile, so its holder is a previous
/// run that crashed or was killed and hasn't ended yet. The network lock is tried once, because its holder is
/// normally another computer's app, unless the device lock was held too: then the ending run holds both, and the
/// network lock waits until the same deadline.
pub fn lock_notebook(
    fs: &dyn Fs,
    data: &DataLayout,
    key: &NotebookKey,
    notebook: &NotebookLayout,
    (remote, deadline): (bool, Instant),
) -> Result<Result<NotebookLock, Held>, FsError> {
    let path = data.lock_file(key);
    if let Some(parent) = path.parent() {
        ensure_dir_all(fs, parent)?;
    }
    let (device, contended) = match fs.try_lock(&path)? {
        Some(lock) => (lock, false),
        None => match lock_until(fs, &path, deadline)? {
            Some(lock) => (lock, true),
            None => return Ok(Err(Held::Ending)),
        },
    };
    let network = if remote {
        let lock = notebook.network_lock();
        if let Some(parent) = lock.parent() {
            ensure_dir_all(fs, parent)?;
        }
        let until = if contended { deadline } else { Instant::now() };
        match lock_until(fs, &lock, until)? {
            Some(held) => Some(held),
            None if contended => return Ok(Err(Held::Ending)),
            None => return Ok(Err(Held::Elsewhere)),
        }
    } else {
        None
    };
    Ok(Ok(NotebookLock {
        _device: device,
        _network: network,
    }))
}

/// How often a held lock is tried again.
const LOCK_RETRY: Duration = Duration::from_millis(50);

/// Takes a lock, trying again every 50 ms while another process holds it, until `deadline`. A deadline that has
/// passed means one try.
pub(crate) fn lock_until(fs: &dyn Fs, path: &Path, deadline: Instant) -> Result<Option<Box<dyn FsLock>>, FsError> {
    loop {
        if let Some(lock) = fs.try_lock(path)? {
            return Ok(Some(lock));
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(None);
        }
        std::thread::sleep(LOCK_RETRY.min(left));
    }
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

    /// Takes the locks of `notebook` in `data`, waiting up to `wait` for a held one.
    fn take(
        fs: &MemFs,
        (data, key, notebook): (&DataLayout, &NotebookKey, &NotebookLayout),
        remote: bool,
        wait: Duration,
    ) -> Result<NotebookLock, Held> {
        lock_notebook(
            fs,
            data,
            key,
            notebook,
            (remote, Instant::now().checked_add(wait).unwrap()),
        )
        .unwrap()
    }

    #[test]
    fn a_second_lock_of_the_same_notebook_fails_until_the_first_is_dropped() {
        let (fs, data, key, notebook) = setup();
        let at = (&data, &key, &notebook);
        let first = take(&fs, at, false, Duration::ZERO);
        assert!(first.is_ok());
        assert_eq!(take(&fs, at, false, Duration::ZERO).err(), Some(Held::Ending));
        drop(first);
        assert!(take(&fs, at, false, Duration::ZERO).is_ok());
    }

    #[test]
    fn a_held_lock_is_tried_again_until_the_ending_run_lets_go() {
        let (fs, data, key, notebook) = setup();
        let at = (&data, &key, &notebook);
        let ending = take(&fs, at, false, Duration::ZERO).unwrap();
        std::thread::scope(|scope| {
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(150));
                drop(ending);
            });
            assert!(take(&fs, at, false, Duration::from_secs(10)).is_ok());
        });
    }

    #[test]
    fn a_lock_held_past_the_deadline_is_given_up() {
        let (fs, data, key, notebook) = setup();
        let at = (&data, &key, &notebook);
        let _held = take(&fs, at, false, Duration::ZERO).unwrap();
        let started = Instant::now();
        let patience = Duration::from_millis(150);
        assert_eq!(take(&fs, at, false, patience).err(), Some(Held::Ending));
        assert!(started.elapsed() >= patience);
    }

    #[test]
    fn local_notebooks_never_create_the_network_lock() {
        let (fs, data, key, notebook) = setup();
        let _lock = take(&fs, (&data, &key, &notebook), false, Duration::ZERO).unwrap();
        assert!(!fs.exists(&notebook.network_lock()));
        assert!(fs.exists(&data.lock_file(&key)));
    }

    #[test]
    fn network_notebooks_also_lock_inside_the_notebook() {
        let (fs, data, key, notebook) = setup();
        let _lock = take(&fs, (&data, &key, &notebook), true, Duration::ZERO).unwrap();
        assert!(fs.exists(&notebook.network_lock()));
        // Another computer has its own data folder, but the lock in the notebook still stops it.
        let other = DataLayout::new("/other-data");
        let theirs = take(&fs, (&other, &key, &notebook), true, Duration::ZERO);
        assert_eq!(theirs.err(), Some(Held::Elsewhere));
    }

    #[test]
    fn a_network_lock_another_computer_holds_is_tried_once() {
        let (fs, data, key, notebook) = setup();
        let other = DataLayout::new("/other-data");
        let _theirs = take(&fs, (&other, &key, &notebook), true, Duration::ZERO).unwrap();
        let started = Instant::now();
        let mine = take(&fs, (&data, &key, &notebook), true, Duration::from_secs(10));
        assert_eq!(mine.err(), Some(Held::Elsewhere));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn a_network_lock_waits_too_while_the_device_lock_was_held() {
        let (fs, data, key, notebook) = setup();
        let at = (&data, &key, &notebook);
        let ending = take(&fs, at, true, Duration::ZERO).unwrap();
        // The ending run lets go of the network lock after the device lock.
        let network = fs.try_lock(&notebook.network_lock()).unwrap();
        assert!(network.is_none(), "the ending run holds the network lock");
        let ending_network = ending._network;
        let ending_device = ending._device;
        std::thread::scope(|scope| {
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(100));
                drop(ending_device);
                std::thread::sleep(Duration::from_millis(150));
                drop(ending_network);
            });
            assert!(take(&fs, at, true, Duration::from_secs(10)).is_ok());
        });
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
