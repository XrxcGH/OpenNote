//! One unlocked protected section: its key, header, and manifest, and how its files are read and sealed.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde_json::Value;
use zeroize::Zeroizing;

use super::crypto::{self, Key};
use super::manifest::{parent_rel, Entry, Manifest};
use super::{fs_error, MANIFEST, SEALED_DIR, UNLOCKED};
use crate::error::{FsError, FsErrorKind};
use crate::id::PageId;
use crate::store::fs::{Committed, DirEntry, Durability, FileStamp, Fs};
use crate::store::layout::SECTION_JSON;

/// One unlocked section.
pub(super) struct Unlocked {
    pub(super) id: String,
    pub(super) dir: PathBuf,
    pub(super) key: Key,
    pub(super) state: Mutex<OpenState>,
}

pub(super) struct OpenState {
    pub(super) header: Value,
    pub(super) manifest: Manifest,
}

impl Unlocked {
    pub(super) fn state(&self) -> std::sync::MutexGuard<'_, OpenState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn sealed_dir(&self) -> PathBuf {
        self.dir.join(SEALED_DIR)
    }

    pub(super) fn blob_path(&self, blob: &str) -> PathBuf {
        self.sealed_dir().join(blob)
    }

    pub(super) fn path_of(&self, rel: &str) -> PathBuf {
        rel.split('/')
            .filter(|p| !p.is_empty())
            .fold(self.dir.clone(), |p, part| p.join(part))
    }

    pub(super) fn write_manifest(&self, inner: &dyn Fs, manifest: &Manifest) -> Result<Committed, FsError> {
        let path = self.sealed_dir().join(MANIFEST);
        let sealed = crypto::seal(&self.key, &crypto::aad(&self.id, MANIFEST), &manifest.to_json())
            .map_err(|_| fs_error(FsErrorKind::Io, &path))?;
        inner.replace_durable(&path, &sealed)
    }

    pub(super) fn read_blob(&self, inner: &dyn Fs, rel: &str, entry: &Entry) -> Result<Zeroizing<Vec<u8>>, FsError> {
        let path = self.blob_path(&entry.blob);
        let bytes = inner.read(&path, entry.len.saturating_add(64))?;
        crypto::open(&self.key, &crypto::aad(&self.id, &entry.blob), &bytes)
            .map_err(|_| fs_error(FsErrorKind::Io, &self.path_of(rel)))
    }

    pub(super) fn read(&self, inner: &dyn Fs, rel: &str) -> Result<Zeroizing<Vec<u8>>, FsError> {
        let entry = self
            .state()
            .manifest
            .files
            .get(rel)
            .cloned()
            .ok_or_else(|| fs_error(FsErrorKind::NotFound, &self.path_of(rel)))?;
        let bytes = self.read_blob(inner, rel, &entry)?;
        if rel == SECTION_JSON {
            let header = self.state().header.clone();
            return Ok(Zeroizing::new(with_encryption(&bytes, Some(unlocked_header(&header)))));
        }
        Ok(bytes)
    }

    /// Seals `bytes` as the file `rel`, then records it in the manifest. The old blob goes last, so a crash at
    /// any step leaves either file whole.
    pub(super) fn write(
        &self,
        inner: &dyn Fs,
        rel: &str,
        bytes: &[u8],
        create_new: bool,
    ) -> Result<Committed, FsError> {
        let path = self.path_of(rel);
        let mut st = self.state();
        if !st.manifest.dir_exists(parent_rel(rel)) {
            return Err(fs_error(FsErrorKind::NotFound, &path));
        }
        if st.manifest.dirs.contains(rel) {
            return Err(fs_error(FsErrorKind::AlreadyExists, &path));
        }
        let stored = if rel == SECTION_JSON {
            // The header in memory is the one that counts: the core's copy may predate a new key slot.
            Zeroizing::new(with_encryption(bytes, Some(st.header.clone())))
        } else {
            Zeroizing::new(bytes.to_vec())
        };
        if create_new {
            if let Some(entry) = st.manifest.files.get(rel).cloned() {
                drop(st);
                let same = self.read_blob(inner, rel, &entry)?.as_slice() == stored.as_slice();
                return if same {
                    Ok(Committed {
                        durability: Durability::Confirmed,
                        stamp: stamp(&entry),
                    })
                } else {
                    Err(fs_error(FsErrorKind::AlreadyExists, &path))
                };
            }
        }
        let blob = crypto::hex(&crypto::random::<16>().map_err(|_| fs_error(FsErrorKind::Io, &path))?);
        let sealed = crypto::seal(&self.key, &crypto::aad(&self.id, &blob), &stored)
            .map_err(|_| fs_error(FsErrorKind::Io, &path))?;
        let made = inner.create_durable(&self.blob_path(&blob), &sealed)?;
        let mut next = st.manifest.clone();
        next.tick = next.tick.saturating_add(1);
        let entry = Entry {
            blob,
            len: u64::try_from(stored.len()).unwrap_or(u64::MAX),
            modified: next.tick,
        };
        let old = next.files.insert(rel.to_owned(), entry.clone());
        if let Err(error) = self.write_manifest(inner, &next) {
            let _ = inner.remove_file(&self.blob_path(&entry.blob));
            return Err(error);
        }
        st.manifest = next;
        if rel == SECTION_JSON {
            inner.replace_durable(&self.dir.join(SECTION_JSON), &public_section(&stored, &st.header))?;
        }
        drop(st);
        if let Some(old) = old {
            let _ = inner.remove_file(&self.blob_path(&old.blob));
        }
        Ok(Committed {
            durability: made.durability,
            stamp: stamp(&entry),
        })
    }

    /// Changes the manifest, seals it, then removes the blobs `edit` returns, which nothing names any more.
    pub(super) fn change(
        &self,
        inner: &dyn Fs,
        path: &Path,
        edit: impl FnOnce(&mut Manifest) -> Result<Vec<String>, FsErrorKind>,
    ) -> Result<Durability, FsError> {
        let mut st = self.state();
        let mut next = st.manifest.clone();
        let gone = edit(&mut next).map_err(|kind| fs_error(kind, path))?;
        let done = self.write_manifest(inner, &next)?;
        st.manifest = next;
        drop(st);
        for blob in gone {
            let _ = inner.remove_file(&self.blob_path(&blob));
        }
        Ok(done.durability)
    }

    pub(super) fn list(&self, rel: &str) -> Option<Vec<DirEntry>> {
        let st = self.state();
        if !st.manifest.dir_exists(rel) {
            return None;
        }
        let child = |path: &str| -> Option<String> {
            let rest = if rel.is_empty() {
                path
            } else {
                path.strip_prefix(rel)?.strip_prefix('/')?
            };
            (!rest.is_empty() && !rest.contains('/')).then(|| rest.to_owned())
        };
        let mut out: Vec<DirEntry> = st
            .manifest
            .dirs
            .iter()
            .filter_map(|d| child(d))
            .map(|name| DirEntry {
                name,
                is_dir: true,
                len: 0,
                modified: 0,
            })
            .collect();
        out.extend(st.manifest.files.iter().filter_map(|(path, e)| {
            child(path).map(|name| DirEntry {
                name,
                is_dir: false,
                len: e.len,
                modified: e.modified,
            })
        }));
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Some(out)
    }

    pub(super) fn pages(&self) -> Vec<PageId> {
        self.state()
            .manifest
            .dirs
            .iter()
            .filter(|d| !d.contains('/'))
            .filter_map(|d| PageId::parse(d).ok())
            .collect()
    }
}

pub(super) fn stamp(entry: &Entry) -> FileStamp {
    FileStamp {
        len: entry.len,
        modified: entry.modified,
        file_id: u128::from_str_radix(&entry.blob, 16).unwrap_or(0),
    }
}

pub(super) fn unlocked_header(header: &Value) -> Value {
    let mut out = header.clone();
    if let Some(map) = out.as_object_mut() {
        map.insert(UNLOCKED.into(), Value::Bool(true));
    }
    out
}

/// `section.json` with its `encryption` key replaced, or removed for `None`. Bytes that aren't a JSON object come
/// back unchanged, for the core's reader to refuse.
pub(super) fn with_encryption(bytes: &[u8], encryption: Option<Value>) -> Vec<u8> {
    let Ok(Value::Object(mut obj)) = serde_json::from_slice::<Value>(bytes) else {
        return bytes.to_vec();
    };
    match encryption {
        Some(e) => {
            obj.insert("encryption".into(), e);
        }
        None => {
            obj.remove("encryption");
        }
    }
    serde_json::to_vec_pretty(&Value::Object(obj)).unwrap_or_else(|_| bytes.to_vec())
}

/// The `section.json` a locked section shows: everything but its pages and defaults, with the header.
pub(super) fn public_section(inner_json: &[u8], header: &Value) -> Vec<u8> {
    let Ok(Value::Object(mut obj)) = serde_json::from_slice::<Value>(inner_json) else {
        return Vec::new();
    };
    obj.remove("pages");
    obj.remove("defaults");
    obj.insert("encryption".into(), header.clone());
    serde_json::to_vec_pretty(&Value::Object(obj)).unwrap_or_default()
}
