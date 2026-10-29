//! A folder as storage: a USB drive, a network share, or a folder that OneDrive, Dropbox, iCloud Drive, or Syncthing
//! already syncs (ADR 0036). Each blob is one file. A write goes to a temporary name in the same folder, is
//! flushed, and is renamed into place, so a sync tool or another device never picks up half a blob.
//!
//! Sync tools add their own files (conflict copies, `desktop.ini`, `.stfolder`): listing skips every name the
//! engine didn't write, and symbolic links and junctions are never followed.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{check, valid_name, Backend};
use crate::crypto::{hex, random};
use crate::error::{Result, SyncError};

/// How deep a listing goes: names have at most three parts.
const MAX_DEPTH: usize = 4;

/// Storage in a folder.
#[derive(Clone, Debug)]
pub struct FolderBackend {
    root: PathBuf,
}

fn storage(error: std::io::Error) -> SyncError {
    SyncError::Storage(format!("the folder answered \"{}\"", error.kind()))
}

impl FolderBackend {
    /// Storage in `root`, which is made if it is missing.
    pub fn new(root: impl Into<PathBuf>) -> Result<FolderBackend> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(storage)?;
        Ok(FolderBackend { root })
    }

    /// The folder.
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn path(&self, name: &str) -> PathBuf {
        name.split('/').fold(self.root.clone(), |path, part| path.join(part))
    }

    fn walk(&self, dir: &Path, rel: &str, depth: usize, out: &mut Vec<String>) -> Result<()> {
        if depth > MAX_DEPTH {
            return Ok(());
        }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(storage(error)),
        };
        for entry in entries {
            let entry = entry.map_err(storage)?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let child = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if !valid_name(&child) {
                continue;
            }
            if kind.is_dir() {
                self.walk(&entry.path(), &child, depth + 1, out)?;
            } else if kind.is_file() {
                out.push(child);
            }
        }
        Ok(())
    }
}

impl Backend for FolderBackend {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>> {
        check(name)?;
        let path = self.path(name);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_file() => fs::read(&path).map(Some).map_err(storage),
            Ok(_) => Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(storage(error)),
        }
    }

    fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
        check(name)?;
        let path = self.path(name);
        let dir = path.parent().unwrap_or(&self.root);
        fs::create_dir_all(dir).map_err(storage)?;
        let temp = dir.join(format!(".osync-{}.tmp", hex(&random::<8>()?)));
        let written = (|| {
            let mut file = fs::File::create(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, &path)
        })();
        if let Err(error) = written {
            let _ = fs::remove_file(&temp);
            return Err(storage(error));
        }
        Ok(())
    }

    fn exists(&self, name: &str) -> Result<bool> {
        check(name)?;
        Ok(fs::symlink_metadata(self.path(name))
            .map(|m| m.file_type().is_file())
            .unwrap_or(false))
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>> {
        let dir_part = prefix.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
        let start = if dir_part.is_empty() {
            self.root.clone()
        } else {
            self.path(dir_part)
        };
        let mut out = Vec::new();
        self.walk(
            &start,
            dir_part,
            dir_part.matches('/').count() + usize::from(!dir_part.is_empty()),
            &mut out,
        )?;
        out.retain(|name| name.starts_with(prefix));
        out.sort();
        Ok(out)
    }

    fn delete(&self, name: &str) -> Result<()> {
        check(name)?;
        match fs::remove_file(self.path(name)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(storage(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_stores_whole_blobs_and_lists_only_engine_names() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = FolderBackend::new(dir.path().join("sync")).expect("folder");
        store.put("vault", b"header").expect("put");
        store.put("c/ab/ab01", b"chunk").expect("put");
        store.put("h/0f/1", b"head").expect("put");
        store.put("h/0f/1", b"head again").expect("replace");
        // What sync tools and people leave behind.
        fs::write(dir.path().join("sync/h/0f/1 (Sam's conflicted copy)"), b"x").expect("write");
        fs::write(dir.path().join("sync/desktop.ini"), b"x").expect("write");
        fs::create_dir_all(dir.path().join("sync/.stfolder")).expect("dir");
        assert_eq!(store.get("h/0f/1").expect("get"), Some(b"head again".to_vec()));
        assert_eq!(store.get("h/0f/2").expect("get"), None);
        assert_eq!(store.list("h/").expect("list"), ["h/0f/1"]);
        assert_eq!(store.list("").expect("list all"), ["c/ab/ab01", "h/0f/1", "vault"]);
        assert!(store.exists("vault").expect("exists"));
        store.delete("vault").expect("delete");
        store.delete("vault").expect("delete again");
        assert!(!store.exists("vault").expect("exists"));
        assert!(store.get("../escape").is_err());
        let leftovers: Vec<_> = fs::read_dir(dir.path().join("sync/h/0f"))
            .expect("read")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temporary files stay behind");
    }
}
