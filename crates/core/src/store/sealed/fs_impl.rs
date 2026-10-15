//! [`SealedFs`] as a file system: each call goes to the disk, to an unlocked section, or to a journal in memory.

use std::collections::BTreeMap;
use std::ops::Range;
use std::path::{Component, Path};
use std::sync::{Arc, Mutex, PoisonError};

use zeroize::Zeroizing;

use super::manifest::{parent_rel, under};
use super::section::{stamp, Unlocked};
use super::{fs_error, SealedFs, SEALED_DIR};
use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{
    AppendFile, Committed, DirEntry, Durability, FileMeta, FileStamp, FolderIdentity, Fs, FsLock, VolumeInfo,
};
use crate::store::layout::parse_journal_file_name;

/// A journal file kept in memory, for a page of an unlocked section.
#[derive(Clone, Default)]
pub(super) struct MemFile(pub(super) Arc<Mutex<Zeroizing<Vec<u8>>>>);

impl MemFile {
    pub(super) fn bytes(&self) -> std::sync::MutexGuard<'_, Zeroizing<Vec<u8>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(super) struct MemAppend(pub(super) MemFile);

impl AppendFile for MemAppend {
    fn append(&mut self, bytes: &[u8]) -> Result<(), FsError> {
        self.0.bytes().extend_from_slice(bytes);
        Ok(())
    }

    fn sync(&mut self) -> Result<(), FsError> {
        Ok(())
    }

    fn len(&self) -> u64 {
        u64::try_from(self.0.bytes().len()).unwrap_or(u64::MAX)
    }
}

/// Where a path goes.
pub(super) enum Route {
    /// The real file system.
    Disk,
    /// A file or folder of an unlocked section.
    Section(Arc<Unlocked>, String),
    /// The journal of a page of an unlocked section.
    Journal,
}

impl SealedFs {
    fn route(&self, path: &Path) -> Route {
        let open = self.open_list();
        if open.is_empty() {
            return Route::Disk;
        }
        for section in &open {
            let Ok(rest) = path.strip_prefix(&section.dir) else {
                continue;
            };
            let mut parts = Vec::new();
            for part in rest.components() {
                match part {
                    Component::Normal(name) => parts.push(name.to_string_lossy().into_owned()),
                    _ => return Route::Disk,
                }
            }
            if parts.first().is_some_and(|p| p == SEALED_DIR) {
                return Route::Disk;
            }
            return Route::Section(section.clone(), parts.join("/"));
        }
        if path.starts_with(&self.journal_root) {
            let page = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(parse_journal_file_name)
                .and_then(|(page, _)| page);
            if let Some(page) = page {
                if open.iter().any(|s| s.pages().contains(&page)) || self.journals().contains_key(path) {
                    return Route::Journal;
                }
            }
        }
        Route::Disk
    }
}

impl Fs for SealedFs {
    fn read(&self, path: &Path, max_bytes: u64) -> Result<Vec<u8>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.read(path, max_bytes),
            Route::Section(s, rel) => {
                let bytes = s.read(self.inner.as_ref(), &rel)?;
                if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max_bytes {
                    return Err(fs_error(FsErrorKind::TooLarge, path));
                }
                Ok(bytes.to_vec())
            }
            Route::Journal => {
                let file = self
                    .journals()
                    .get(path)
                    .cloned()
                    .ok_or_else(|| fs_error(FsErrorKind::NotFound, path))?;
                let bytes = file.bytes();
                if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max_bytes {
                    return Err(fs_error(FsErrorKind::TooLarge, path));
                }
                Ok(bytes.to_vec())
            }
        }
    }

    fn read_prefix(&self, path: &Path, n: usize) -> Result<Vec<u8>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.read_prefix(path, n),
            _ => {
                let mut all = self.read(path, u64::MAX)?;
                all.truncate(n);
                Ok(all)
            }
        }
    }

    fn read_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.read_range(path, range),
            _ => {
                let all = self.read(path, u64::MAX)?;
                let len = all.len();
                let start = usize::try_from(range.start).unwrap_or(usize::MAX).min(len);
                let end = usize::try_from(range.end).unwrap_or(usize::MAX).clamp(start, len);
                Ok(all.get(start..end).map(<[u8]>::to_vec).unwrap_or_default())
            }
        }
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>, FsError> {
        match self.route(path) {
            Route::Section(s, rel) => s.list(&rel).ok_or_else(|| fs_error(FsErrorKind::NotFound, path)),
            _ => {
                let mut entries = match self.inner.read_dir(path) {
                    Ok(entries) => entries,
                    Err(e) if e.kind == FsErrorKind::NotFound && path.starts_with(&self.journal_root) => Vec::new(),
                    Err(e) => return Err(e),
                };
                if path.starts_with(&self.journal_root) {
                    for (file, mem) in self.journals().iter().filter(|(f, _)| f.parent() == Some(path)) {
                        if let Some(name) = file.file_name().and_then(|n| n.to_str()) {
                            entries.push(DirEntry {
                                name: name.to_owned(),
                                is_dir: false,
                                len: u64::try_from(mem.bytes().len()).unwrap_or(u64::MAX),
                                modified: 0,
                            });
                        }
                    }
                    entries.sort_by(|a, b| a.name.cmp(&b.name));
                }
                Ok(entries)
            }
        }
    }

    fn metadata(&self, path: &Path) -> Result<FileMeta, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.metadata(path),
            Route::Section(s, rel) => {
                let st = s.state();
                let (stamp, is_dir) = match st.manifest.files.get(&rel) {
                    Some(entry) => (stamp(entry), false),
                    None if st.manifest.dir_exists(&rel) => (
                        FileStamp {
                            len: 0,
                            modified: 0,
                            file_id: 0,
                        },
                        true,
                    ),
                    None => return Err(fs_error(FsErrorKind::NotFound, path)),
                };
                Ok(FileMeta {
                    stamp,
                    is_dir,
                    read_only: false,
                    placeholder: false,
                })
            }
            Route::Journal => {
                let len = self
                    .journals()
                    .get(path)
                    .map(|f| f.bytes().len())
                    .ok_or_else(|| fs_error(FsErrorKind::NotFound, path))?;
                Ok(FileMeta {
                    stamp: FileStamp {
                        len: u64::try_from(len).unwrap_or(u64::MAX),
                        modified: 0,
                        file_id: 0,
                    },
                    is_dir: false,
                    read_only: false,
                    placeholder: false,
                })
            }
        }
    }

    fn replace_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.replace_durable(path, bytes),
            Route::Section(s, rel) => s.write(self.inner.as_ref(), &rel, bytes, false),
            Route::Journal => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn create_durable(&self, path: &Path, bytes: &[u8]) -> Result<Committed, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.create_durable(path, bytes),
            Route::Section(s, rel) => s.write(self.inner.as_ref(), &rel, bytes, true),
            Route::Journal => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn write_derived(&self, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
        match self.route(path) {
            Route::Disk => self.inner.write_derived(path, bytes),
            Route::Section(s, rel) => s.write(self.inner.as_ref(), &rel, bytes, false).map(|_| ()),
            Route::Journal => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn create_dir_durable(&self, path: &Path) -> Result<Durability, FsError> {
        match self.route(path) {
            Route::Section(s, rel) => s.change(self.inner.as_ref(), path, |m| {
                if m.exists(&rel) {
                    return Err(FsErrorKind::AlreadyExists);
                }
                if !m.dir_exists(parent_rel(&rel)) {
                    return Err(FsErrorKind::NotFound);
                }
                m.dirs.insert(rel.clone());
                Ok(Vec::new())
            }),
            _ => self.inner.create_dir_durable(path),
        }
    }

    fn rename_dir(&self, from: &Path, to: &Path) -> Result<Durability, FsError> {
        match (self.route(from), self.route(to)) {
            (Route::Section(a, from_rel), Route::Section(b, to_rel)) if Arc::ptr_eq(&a, &b) && !from_rel.is_empty() => {
                a.change(self.inner.as_ref(), from, |m| {
                    if !m.dirs.contains(&from_rel) {
                        return Err(FsErrorKind::NotFound);
                    }
                    if m.exists(&to_rel) {
                        return Err(FsErrorKind::AlreadyExists);
                    }
                    if !m.dir_exists(parent_rel(&to_rel)) || under(&to_rel, &from_rel) {
                        return Err(FsErrorKind::NotFound);
                    }
                    let moved = |p: &str| format!("{to_rel}{}", p.get(from_rel.len()..).unwrap_or_default());
                    m.dirs = m
                        .dirs
                        .iter()
                        .map(|d| if under(d, &from_rel) { moved(d) } else { d.clone() })
                        .collect();
                    m.files = std::mem::take(&mut m.files)
                        .into_iter()
                        .map(|(p, e)| if under(&p, &from_rel) { (moved(&p), e) } else { (p, e) })
                        .collect();
                    Ok(Vec::new())
                })
            }
            (Route::Section(s, rel), _) if rel.is_empty() => {
                // The whole section moves, as to Trash: its sealed files go as they are, and it locks.
                let done = self.inner.rename_dir(from, to)?;
                self.lock(&s.dir);
                Ok(done)
            }
            (Route::Disk, Route::Disk) => self.inner.rename_dir(from, to),
            // A page can't carry its files into or out of a protected section; the core refuses before this.
            _ => Err(fs_error(FsErrorKind::Unsupported, from)),
        }
    }

    fn remove_file(&self, path: &Path) -> Result<(), FsError> {
        match self.route(path) {
            Route::Disk => self.inner.remove_file(path),
            Route::Section(s, rel) => s
                .change(self.inner.as_ref(), path, |m| match m.files.remove(&rel) {
                    Some(e) => Ok(vec![e.blob]),
                    None => Err(FsErrorKind::NotFound),
                })
                .map(|_| ()),
            Route::Journal => match self.journals().remove(path) {
                Some(_) => Ok(()),
                None => Err(fs_error(FsErrorKind::NotFound, path)),
            },
        }
    }

    fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
        match self.route(path) {
            Route::Section(s, rel) if !rel.is_empty() => s
                .change(self.inner.as_ref(), path, |m| {
                    if !m.dirs.contains(&rel) {
                        return Err(FsErrorKind::NotFound);
                    }
                    m.dirs.retain(|d| !under(d, &rel));
                    let (gone, kept): (BTreeMap<_, _>, BTreeMap<_, _>) = std::mem::take(&mut m.files)
                        .into_iter()
                        .partition(|(p, _)| under(p, &rel));
                    m.files = kept;
                    Ok(gone.into_values().map(|e| e.blob).collect())
                })
                .map(|_| ()),
            Route::Section(s, _) => {
                self.inner.remove_dir_all(path)?;
                self.lock(&s.dir);
                Ok(())
            }
            _ => self.inner.remove_dir_all(path),
        }
    }

    fn clear_read_only(&self, path: &Path) -> Result<(), FsError> {
        match self.route(path) {
            Route::Disk => self.inner.clear_read_only(path),
            _ => Ok(()),
        }
    }

    fn open_append(&self, path: &Path, create_new: bool) -> Result<Box<dyn AppendFile>, FsError> {
        match self.route(path) {
            Route::Disk => self.inner.open_append(path, create_new),
            Route::Journal => {
                let mut journals = self.journals();
                if create_new && journals.contains_key(path) {
                    return Err(fs_error(FsErrorKind::AlreadyExists, path));
                }
                let file = journals.entry(path.to_path_buf()).or_default().clone();
                Ok(Box::new(MemAppend(file)))
            }
            Route::Section(..) => Err(fs_error(FsErrorKind::Unsupported, path)),
        }
    }

    fn try_lock(&self, path: &Path) -> Result<Option<Box<dyn FsLock>>, FsError> {
        self.inner.try_lock(path)
    }

    fn volume(&self, path: &Path) -> Result<VolumeInfo, FsError> {
        self.inner.volume(path)
    }

    fn folder_identity(&self, path: &Path) -> Result<FolderIdentity, FsError> {
        self.inner.folder_identity(path)
    }

    fn boot_id(&self) -> Result<String, FsError> {
        self.inner.boot_id()
    }

    fn sealed(&self) -> Option<&SealedFs> {
        Some(self)
    }
}
