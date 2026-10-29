//! The notes folder on this device: which paths sync, scanning them, hashing files a chunk at a time, and writing
//! files so a crash never leaves half of one.
//!
//! Paths are relative, with forward slashes. A path from another device is checked before it touches the disk: no
//! `..`, no drive letters, no names Windows reserves, and never through a symbolic link or junction, so nothing can
//! be written outside the notes folder.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use blake2::digest::consts::U32;
use blake2::digest::{KeyInit, Mac};
use blake2::Blake2bMac;

use crate::crypto::{hex, mac, random};
use crate::error::{Result, SyncError};
use crate::manifest::Content;

/// The size of a chunk.
pub const CHUNK: usize = 1024 * 1024;
const MAX_DEPTH: usize = 24;
const MAX_FILES: usize = 2_000_000;

/// A file's size and last-write time, to skip hashing files that didn't change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Fingerprint {
    /// Bytes.
    pub size: u64,
    /// Nanoseconds since the Unix epoch.
    pub mtime: i128,
}

/// The fingerprint of a file, or `None` when there is no regular file there.
pub fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.file_type().is_file() {
        return None;
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i128)
        .unwrap_or(0);
    Some(Fingerprint {
        size: meta.len(),
        mtime,
    })
}

/// Whether a file or folder name never syncs: temporary files of OpenNote and of this engine, the writer lock, and
/// what operating systems and sync tools leave in folders.
fn excluded(name: &str, rel: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with(".osync-")
        || (name.starts_with('~') && lower.ends_with(".tmp"))
        || name.starts_with("~$")
        || matches!(
            lower.as_str(),
            "desktop.ini"
                | "thumbs.db"
                | "ehthumbs.db"
                | ".ds_store"
                | ".dropbox"
                | ".dropbox.attr"
                | ".dropbox.cache"
                | ".stfolder"
                | ".stversions"
                | ".stignore"
                | "@eadir"
                | "$recycle.bin"
                | "system volume information"
                | "icon\r"
        )
        || lower.starts_with(".trash-")
        || lower.ends_with(".partial")
        || lower.ends_with(".crdownload")
        || rel == ".opennote/lock"
        || rel.ends_with("/.opennote/lock")
}

/// Whether a path from another device may be written here.
pub fn valid_path(rel: &str) -> bool {
    if rel.is_empty() || rel.len() > 1024 || rel.starts_with('/') {
        return false;
    }
    let parts: Vec<&str> = rel.split('/').collect();
    parts.len() <= MAX_DEPTH
        && parts.iter().all(|part| {
            let upper = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || ((upper.starts_with("COM") || upper.starts_with("LPT"))
                    && upper.len() == 4
                    && upper.as_bytes()[3].is_ascii_digit());
            !part.is_empty()
                && *part != "."
                && *part != ".."
                && part.len() <= 255
                && !part.ends_with('.')
                && !part.ends_with(' ')
                && !reserved
                && !part
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
                && !excluded(part, rel)
        })
}

/// The path of `rel` under `root`.
pub fn join(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |path, part| path.join(part))
}

/// Every file that syncs under `root`, with its fingerprint. Leftover temporary files of this engine are removed.
pub fn scan(root: &Path) -> Result<Vec<(String, Fingerprint)>> {
    let mut out = Vec::new();
    walk(root, "", 0, &mut out)?;
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<(String, Fingerprint)>) -> Result<()> {
    if depth >= MAX_DEPTH {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && depth == 0 => return Ok(()),
        Err(error) => return Err(SyncError::local(error)),
    };
    for entry in entries {
        let entry = entry.map_err(SyncError::local)?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let child = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        if name.starts_with(".osync-") && kind.is_file() {
            let _ = fs::remove_file(entry.path());
            continue;
        }
        if excluded(&name, &child) || !valid_path(&child) {
            continue;
        }
        if kind.is_dir() {
            walk(&entry.path(), &child, depth + 1, out)?;
        } else if kind.is_file() {
            if let Some(print) = fingerprint(&entry.path()) {
                out.push((child, print));
            }
            if out.len() > MAX_FILES {
                return Err(SyncError::Local(
                    "the notes folder has more files than sync handles".into(),
                ));
            }
        }
    }
    Ok(())
}

/// Hashes content a chunk at a time: the chunk names, and the name of the whole.
pub struct Hasher<'k> {
    chunk_key: &'k [u8; 32],
    whole: Blake2bMac<U32>,
    size: u64,
    chunks: Vec<String>,
}

impl<'k> Hasher<'k> {
    /// A hasher under the vault's keys.
    pub fn new(chunk_key: &'k [u8; 32], content_key: &[u8; 32]) -> Hasher<'k> {
        let whole = <Blake2bMac<U32> as KeyInit>::new_from_slice(content_key).expect("32 byte key");
        Hasher {
            chunk_key,
            whole,
            size: 0,
            chunks: Vec::new(),
        }
    }

    /// Adds one chunk, and returns its name's hash.
    pub fn chunk(&mut self, bytes: &[u8]) -> String {
        self.whole.update(bytes);
        self.size += bytes.len() as u64;
        let id = hex(&mac(self.chunk_key, &[bytes]));
        self.chunks.push(id.clone());
        id
    }

    /// The content.
    pub fn finish(mut self) -> Content {
        self.whole.update(&self.size.to_le_bytes());
        Content {
            id: hex(&self.whole.finalize().into_bytes()),
            size: self.size,
            chunks: self.chunks,
        }
    }
}

/// Reads up to one chunk.
pub fn read_chunk(file: &mut impl Read, buf: &mut Vec<u8>) -> Result<usize> {
    buf.clear();
    file.take(CHUNK as u64).read_to_end(buf).map_err(SyncError::local)
}

/// Hashes a file a chunk at a time.
pub fn hash_file(path: &Path, chunk_key: &[u8; 32], content_key: &[u8; 32]) -> Result<Content> {
    let mut file = fs::File::open(path).map_err(SyncError::local)?;
    let mut hasher = Hasher::new(chunk_key, content_key);
    let mut buf = Vec::with_capacity(CHUNK);
    while read_chunk(&mut file, &mut buf)? > 0 {
        hasher.chunk(&buf);
    }
    Ok(hasher.finish())
}

/// Hashes bytes held in memory.
pub fn hash_bytes(bytes: &[u8], chunk_key: &[u8; 32], content_key: &[u8; 32]) -> Content {
    let mut hasher = Hasher::new(chunk_key, content_key);
    for part in bytes.chunks(CHUNK) {
        hasher.chunk(part);
    }
    hasher.finish()
}

/// Makes the folders of `rel` under `root`, refusing to pass through a link, a junction, or a file.
pub fn safe_dir(root: &Path, rel_dir: &str) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    fs::create_dir_all(root).map_err(SyncError::local)?;
    if rel_dir.is_empty() {
        return Ok(path);
    }
    for part in rel_dir.split('/') {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_dir() => {}
            Ok(_) => return Err(SyncError::Local("a file or link is in the way".into())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&path).map_err(SyncError::local)?;
            }
            Err(error) => return Err(SyncError::local(error)),
        }
    }
    Ok(path)
}

/// A file being written next to its target, under a name scans skip and remove.
pub struct Staged {
    /// The temporary file.
    pub path: PathBuf,
    file: Option<fs::File>,
}

impl Staged {
    /// Starts a temporary file in `dir`.
    pub fn new(dir: &Path) -> Result<Staged> {
        let path = dir.join(format!(".osync-{}.tmp", hex(&random::<8>()?)));
        let file = fs::File::create(&path).map_err(SyncError::local)?;
        Ok(Staged { path, file: Some(file) })
    }

    /// Appends bytes.
    pub fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.file
            .as_mut()
            .expect("open until finished")
            .write_all(bytes)
            .map_err(SyncError::local)
    }

    /// Empties the file, to start it again.
    pub fn rewind(&mut self) -> Result<()> {
        use std::io::Seek;
        let file = self.file.as_mut().expect("open until finished");
        file.set_len(0).map_err(SyncError::local)?;
        file.rewind().map_err(SyncError::local)
    }

    /// Flushes the file to disk.
    pub fn finish(&mut self) -> Result<()> {
        if let Some(file) = self.file.take() {
            file.sync_all().map_err(SyncError::local)?;
        }
        Ok(())
    }

    /// Removes the temporary file.
    pub fn discard(mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

/// Writes a small file whole: to a temporary name, flushed, then renamed over the target.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir).map_err(SyncError::local)?;
    let mut staged = Staged::new(dir)?;
    staged.write(bytes)?;
    staged.finish()?;
    fs::rename(&staged.path, path).map_err(|error| {
        let _ = fs::remove_file(&staged.path);
        SyncError::local(error)
    })
}

/// Removes empty folders from `rel_dir` up to, but not including, `root`.
pub fn prune_dirs(root: &Path, rel_dir: &str) {
    let mut rel = rel_dir.to_owned();
    while !rel.is_empty() {
        if fs::remove_dir(join(root, &rel)).is_err() {
            break;
        }
        rel = rel.rsplit_once('/').map(|(dir, _)| dir.to_owned()).unwrap_or_default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_from_elsewhere_stay_inside_the_notes_folder() {
        for good in [
            "Bio/notebook.json",
            "Bio/s/p/ink/01ab.onk",
            "Bio/.opennote/trash/x/item.json",
            "a b/c (1).txt",
        ] {
            assert!(valid_path(good), "{good}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../../x",
            "a/./b",
            "C:/x",
            "a\\b",
            "a//b",
            "CON",
            "a/nul.txt",
            "a/COM1",
            "a/b.",
            "a/b ",
            "a/\u{0}b",
            "Bio/.opennote/lock",
            "Bio/.osync-1.tmp",
            "Bio/~page.json.0000000a.tmp",
            "Bio/desktop.ini",
        ] {
            assert!(!valid_path(bad), "{bad:?}");
        }
        assert!(valid_path("a/COM10"), "only COM1 to COM9 are reserved");
        assert!(!valid_path(&"a/".repeat(30)));
    }

    #[test]
    fn scans_skip_what_never_syncs_and_tidy_leftovers() {
        let dir = tempfile::tempdir().expect("temp");
        let root = dir.path();
        fs::create_dir_all(root.join("Bio/s/p")).expect("dirs");
        fs::write(root.join("Bio/s/p/page.json"), b"{}").expect("write");
        fs::write(root.join("Bio/s/p/~page.json.0000000a.tmp"), b"half").expect("write");
        fs::write(root.join("Bio/s/p/.osync-ab.tmp"), b"half").expect("write");
        fs::write(root.join("Bio/Thumbs.db"), b"x").expect("write");
        fs::create_dir_all(root.join("Bio/.opennote")).expect("dirs");
        fs::write(root.join("Bio/.opennote/lock"), b"x").expect("write");
        let files: Vec<String> = scan(root).expect("scans").into_iter().map(|(p, _)| p).collect();
        assert_eq!(files, ["Bio/s/p/page.json"]);
        assert!(
            !root.join("Bio/s/p/.osync-ab.tmp").exists(),
            "a leftover of a crash is removed"
        );
        assert!(
            root.join("Bio/s/p/~page.json.0000000a.tmp").exists(),
            "the core's own temporary files are left alone"
        );
        assert!(scan(&root.join("missing")).expect("an empty folder").is_empty());
    }

    #[test]
    fn content_names_depend_on_every_byte_and_the_chunking() {
        let (chunk, content) = ([1u8; 32], [2u8; 32]);
        let small = hash_bytes(b"hello", &chunk, &content);
        assert_eq!(small.size, 5);
        assert_eq!(small.chunks.len(), 1);
        assert_ne!(small.id, hash_bytes(b"hellp", &chunk, &content).id);
        assert_ne!(small.id, hash_bytes(b"hello", &chunk, &[3; 32]).id, "keyed");
        let big = vec![7u8; CHUNK * 2 + 10];
        let hashed = hash_bytes(&big, &chunk, &content);
        assert_eq!(hashed.chunks.len(), 3);
        assert_eq!(hashed.chunks[0], hashed.chunks[1], "equal chunks share a name");
        let dir = tempfile::tempdir().expect("temp");
        fs::write(dir.path().join("f"), &big).expect("write");
        assert_eq!(
            hash_file(&dir.path().join("f"), &chunk, &content).expect("hashes"),
            hashed
        );
        assert_eq!(hash_bytes(b"", &chunk, &content).chunks.len(), 0);
    }

    #[test]
    fn folders_are_never_made_through_a_file_in_the_way() {
        let dir = tempfile::tempdir().expect("temp");
        fs::write(dir.path().join("blocker"), b"x").expect("write");
        assert!(safe_dir(dir.path(), "blocker/inside").is_err());
        assert!(safe_dir(dir.path(), "a/b").expect("makes").ends_with("b"));
        write_atomic(&dir.path().join("a/b/f.json"), b"whole").expect("writes");
        assert_eq!(fs::read(dir.path().join("a/b/f.json")).expect("reads"), b"whole");
        fs::remove_file(dir.path().join("a/b/f.json")).expect("remove");
        prune_dirs(dir.path(), "a/b");
        assert!(!dir.path().join("a").exists());
    }
}
