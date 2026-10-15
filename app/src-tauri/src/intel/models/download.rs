//! Downloading the files of a model: resumed from a `.part` file, cut off at the published size, and kept only when the
//! checksum matches.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

use sha1::Sha1;
use sha2::{Digest as _, Sha256};

use super::{Digest, DownloadError, ModelSpec, Part, Source};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Whether the file at `path` matches `digest` and `size`.
fn matches(path: &Path, size: u64, digest: Digest) -> io::Result<bool> {
    let mut file = File::open(path)?;
    let mut buffer = vec![0u8; 1 << 16];
    let found = match digest {
        Digest::Sha256(_) => {
            let mut hasher = Sha256::new();
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            hex(&hasher.finalize())
        }
        Digest::GitBlob(_) => {
            let mut hasher = Sha1::new();
            hasher.update(format!("blob {size}\0").as_bytes());
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            hex(&hasher.finalize())
        }
    };
    Ok(found == digest.hex())
}

pub(super) fn part_path(dir: &Path, part: &Part) -> PathBuf {
    let mut name = dir.join(part.file).into_os_string();
    name.push(".part");
    PathBuf::from(name)
}

pub(super) fn size_of(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|meta| meta.len())
}

/// Whether every file of the model is on disk at its published size.
pub fn is_installed(dir: &Path, spec: &ModelSpec) -> bool {
    spec.parts
        .iter()
        .all(|part| size_of(&dir.join(part.file)) == Some(part.size))
}

/// Downloads one file into `dir`, resuming a `.part` file left by an earlier try. The file is kept only when its
/// size and checksum match the catalog. Cancel leaves the `.part` file so the next try resumes. `progress` holds
/// the bytes of the whole model: `base` is what the earlier files took.
fn download_part(
    source: &dyn Source,
    part: &Part,
    dir: &Path,
    cancel: &AtomicBool,
    progress: &AtomicU64,
    base: u64,
) -> Result<(), DownloadError> {
    let target = dir.join(part.file);
    if size_of(&target) == Some(part.size) {
        progress.store(base + part.size, Ordering::Relaxed);
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = part_path(dir, part);
    let mut have = size_of(&partial).unwrap_or(0);
    if have > part.size {
        fs::remove_file(&partial)?;
        have = 0;
    }
    if have < part.size {
        let opened = source.open(part.url, have).map_err(DownloadError::Network)?;
        let mut file = if opened.resumed && have > 0 {
            OpenOptions::new().append(true).open(&partial)?
        } else {
            have = 0;
            File::create(&partial)?
        };
        progress.store(base + have, Ordering::Relaxed);
        // Never read past the published size, whatever the server sends.
        let mut reader = opened.reader.take(part.size - have + 1);
        let mut buffer = vec![0u8; 1 << 16];
        while have <= part.size {
            if cancel.load(Ordering::Relaxed) {
                file.flush()?;
                return Err(DownloadError::Canceled);
            }
            let read = reader
                .read(&mut buffer)
                .map_err(|error| DownloadError::Network(error.to_string()))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])?;
            have += read as u64;
            progress.store(base + have.min(part.size), Ordering::Relaxed);
        }
        file.flush()?;
        drop(file);
        if have != part.size {
            return if have > part.size {
                fs::remove_file(&partial)?;
                Err(DownloadError::Checksum)
            } else {
                Err(DownloadError::Network("The connection ended early.".to_owned()))
            };
        }
    }
    if !matches(&partial, part.size, part.digest)? {
        fs::remove_file(&partial)?;
        return Err(DownloadError::Checksum);
    }
    fs::rename(&partial, &target)?;
    Ok(())
}

/// Downloads every file of a model, one after another.
pub fn download(
    source: &dyn Source,
    spec: &ModelSpec,
    dir: &Path,
    cancel: &AtomicBool,
    progress: &AtomicU64,
) -> Result<(), DownloadError> {
    fs::create_dir_all(dir)?;
    let mut base = 0;
    for part in spec.parts {
        download_part(source, part, dir, cancel, progress, base)?;
        base += part.size;
    }
    Ok(())
}
