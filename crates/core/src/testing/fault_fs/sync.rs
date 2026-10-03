//! A simulated sync tool on a [`FaultFs`](super::FaultFs) (plan 13.4): out-of-order delivery, conflict copies,
//! rollbacks, old folders coming back, and writes that land between two of the app's calls.
//!
//! The tool is another program, so its changes are durable at once and never count as the app's calls.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use super::state::Disk;
use super::tree::{key_of, parent, Entry, MetaOp};
use super::FaultFs;

/// A change a sync tool makes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SyncAction {
    /// Writes a file. It replaces any file there and creates missing folders.
    Write {
        /// The file.
        path: PathBuf,
        /// Its new bytes.
        bytes: Vec<u8>,
    },
    /// Deletes a file, or a folder with everything in it.
    Remove {
        /// The file or folder.
        path: PathBuf,
    },
    /// Creates a folder and its missing parents.
    MkdirAll {
        /// The folder.
        path: PathBuf,
    },
}

/// How a sync tool names the copy it keeps when a file changed in two places (spec 14.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictStyle {
    /// `page (Sam's conflicted copy 2026-09-30).json`
    Dropbox,
    /// `page-LAPTOP.json`
    OneDrive,
    /// `page.sync-conflict-20260930-140312-ABCDEFG.json`
    Syncthing,
    /// `page (conflicted copy 2026-09-30 140312).json`
    Nextcloud,
    /// `page 2.json`
    ICloud,
    /// `page (1).json`
    GoogleDrive,
}

impl ConflictStyle {
    /// Every style.
    pub const ALL: [ConflictStyle; 6] = [
        ConflictStyle::Dropbox,
        ConflictStyle::OneDrive,
        ConflictStyle::Syncthing,
        ConflictStyle::Nextcloud,
        ConflictStyle::ICloud,
        ConflictStyle::GoogleDrive,
    ];

    /// The name of this tool's conflict copy of `file_name`.
    pub fn name_for(self, file_name: &str) -> String {
        let (stem, ext) = file_name.rsplit_once('.').map_or((file_name, ""), |(s, e)| (s, e));
        let suffix = match self {
            ConflictStyle::Dropbox => " (Sam's conflicted copy 2026-09-30)",
            ConflictStyle::OneDrive => "-LAPTOP",
            ConflictStyle::Syncthing => ".sync-conflict-20260930-140312-ABCDEFG",
            ConflictStyle::Nextcloud => " (conflicted copy 2026-09-30 140312)",
            ConflictStyle::ICloud => " 2",
            ConflictStyle::GoogleDrive => " (1)",
        };
        if ext.is_empty() {
            format!("{stem}{suffix}")
        } else {
            format!("{stem}{suffix}.{ext}")
        }
    }
}

/// A folder as it was, to bring back later.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FolderSnapshot {
    /// The folder.
    pub root: PathBuf,
    /// Its folders, parents first.
    pub dirs: Vec<PathBuf>,
    /// Its files and their bytes.
    pub files: Vec<(PathBuf, Vec<u8>)>,
}

/// A sync tool working on a [`FaultFs`].
pub struct SyncSim {
    fs: FaultFs,
    withheld: Mutex<Vec<(PathBuf, Vec<u8>)>>,
}

impl SyncSim {
    pub(super) fn new(fs: FaultFs) -> SyncSim {
        SyncSim {
            fs,
            withheld: Mutex::new(Vec::new()),
        }
    }

    fn apply(&self, action: SyncAction) {
        apply(&mut self.fs.lock().disk, &action);
    }

    /// Writes a file, as a download from another device or a rollback to an older version.
    pub fn write(&self, path: &Path, bytes: &[u8]) {
        self.apply(SyncAction::Write {
            path: path.to_path_buf(),
            bytes: bytes.to_vec(),
        });
    }

    /// Deletes a file or a folder.
    pub fn remove(&self, path: &Path) {
        self.apply(SyncAction::Remove {
            path: path.to_path_buf(),
        });
    }

    /// Writes `bytes` as this tool's conflict copy of `path`, next to it, and returns the copy's path.
    pub fn conflict_copy(&self, path: &Path, style: ConflictStyle, bytes: &[u8]) -> PathBuf {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let copy = path.with_file_name(style.name_for(&name));
        self.write(&copy, bytes);
        copy
    }

    /// Takes a file away now, to deliver it later with [`SyncSim::deliver`], as a tool that delivers files out of
    /// order does.
    pub fn withhold(&self, path: &Path) {
        if let Some(bytes) = self.fs.get(path) {
            self.remove(path);
            self.withheld
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push((path.to_path_buf(), bytes));
        }
    }

    /// Delivers every withheld file, and returns how many.
    pub fn deliver(&self) -> usize {
        let files = std::mem::take(&mut *self.withheld.lock().unwrap_or_else(PoisonError::into_inner));
        for (path, bytes) in &files {
            self.write(path, bytes);
        }
        files.len()
    }

    /// Remembers a folder as it is now.
    pub fn snapshot(&self, root: &Path) -> FolderSnapshot {
        let prefix = key_of(root).unwrap_or_default();
        let state = self.fs.lock();
        let mut snapshot = FolderSnapshot {
            root: root.to_path_buf(),
            dirs: Vec::new(),
            files: Vec::new(),
        };
        for (key, entry) in state.disk.live.range(prefix.clone()..) {
            if !key.starts_with(&prefix) {
                break;
            }
            let path = root.join(key[prefix.len()..].iter().collect::<PathBuf>());
            match entry {
                Entry::Dir(_) => snapshot.dirs.push(path),
                Entry::File(ino) => {
                    let bytes = state.disk.inodes.get(ino).map(|i| i.data.to_vec()).unwrap_or_default();
                    snapshot.files.push((path, bytes));
                }
            }
        }
        snapshot
    }

    /// Brings a folder back as it was, such as an old folder a sync tool restores after it was moved or deleted.
    pub fn bring_back(&self, snapshot: &FolderSnapshot) {
        for dir in &snapshot.dirs {
            self.apply(SyncAction::MkdirAll { path: dir.clone() });
        }
        for (path, bytes) in &snapshot.files {
            self.write(path, bytes);
        }
    }

    /// Makes `action` happen just before the app's call number `call`, such as a write of `page.json` between
    /// the fingerprint check and the replace of a save (spec 17.9).
    pub fn before_call(&self, call: u64, action: SyncAction) {
        self.fs.lock().scheduled.push((call, action));
    }

    /// Holds a file open, like [`FaultFs::hold_open`].
    pub fn hold(&self, path: &Path, share_delete: bool, calls: u32) {
        self.fs.hold_open(path, share_delete, calls);
    }
}

/// Applies an outside change, durably.
pub(super) fn apply(disk: &mut Disk, action: &SyncAction) {
    match action {
        SyncAction::Write { path, bytes } => {
            let Ok(key) = key_of(path) else { return };
            mkdir_all(disk, &parent(&key));
            let ino = disk.new_file(bytes.clone(), true);
            disk.external(MetaOp::Put {
                key,
                entry: Entry::File(ino),
            });
        }
        SyncAction::Remove { path } => {
            let Ok(key) = key_of(path) else { return };
            match disk.live.get(&key) {
                Some(Entry::File(_)) => disk.external(MetaOp::Remove { key }),
                Some(Entry::Dir(_)) => disk.external(MetaOp::RemoveTree { key }),
                None => {}
            }
        }
        SyncAction::MkdirAll { path } => {
            if let Ok(key) = key_of(path) {
                mkdir_all(disk, &key);
            }
        }
    }
}

fn mkdir_all(disk: &mut Disk, key: &[String]) {
    for end in 1..=key.len() {
        let prefix = key[..end].to_vec();
        if !disk.live.contains_key(&prefix) {
            let ino = disk.new_ino();
            disk.external(MetaOp::Create {
                key: prefix,
                entry: Entry::Dir(ino),
            });
        }
    }
}
