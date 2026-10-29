//! Scanning a folder of Markdown notes: which files are notes, which are attachments, and how links find them.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::PageId;

use crate::error::{InteropError, Result};

/// Where a folder of notes came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flavor {
    /// An Obsidian vault, which has a `.obsidian` folder.
    Obsidian,
    /// A Joplin export, which keeps attachments in `_resources`.
    Joplin,
    /// A Notion export. Each file and folder name ends in a 32 character ID.
    Notion,
    /// A Logseq graph, which has a `logseq` folder and keeps notes in `pages` and `journals`.
    Logseq,
    /// Any other folder of Markdown files.
    Plain,
}

impl Flavor {
    /// Tells which app made a folder.
    pub fn detect(root: &Path) -> Flavor {
        if root.join(".obsidian").is_dir() {
            Flavor::Obsidian
        } else if root.join("logseq").is_dir() || (root.join("pages").is_dir() && root.join("journals").is_dir()) {
            Flavor::Logseq
        } else if root.join("_resources").is_dir() {
            Flavor::Joplin
        } else if looks_like_notion(root) {
            Flavor::Notion
        } else {
            Flavor::Plain
        }
    }

    /// The name for reports.
    pub fn label(self) -> &'static str {
        match self {
            Flavor::Obsidian => "Obsidian vault",
            Flavor::Joplin => "Joplin export",
            Flavor::Notion => "Notion export",
            Flavor::Logseq => "Logseq graph",
            Flavor::Plain => "Markdown folder",
        }
    }
}

/// Whether a name ends in the ID that Notion adds: a space and 32 hex digits, before any extension.
pub fn has_notion_id(name: &str) -> bool {
    let stem = name.rsplit_once('.').map_or(name, |(stem, ext)| {
        if ext.len() <= 4 && !ext.contains(' ') {
            stem
        } else {
            name
        }
    });
    let stem = stem.strip_suffix("_all").unwrap_or(stem);
    stem.len() > 33
        && stem.is_char_boundary(stem.len() - 33)
        && stem[stem.len() - 33..].starts_with(' ')
        && stem[stem.len() - 32..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Whether most entries at the top of the folder, or of the one folder inside it, carry Notion's IDs.
fn looks_like_notion(root: &Path) -> bool {
    let names = |dir: &Path| -> Vec<String> {
        fs::read_dir(dir)
            .map(|iter| {
                iter.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    };
    let top = names(root);
    let with_id = top.iter().filter(|n| has_notion_id(n)).count();
    with_id > 0 && with_id * 2 >= top.iter().filter(|n| !n.starts_with('.')).count()
}

/// A note on disk.
#[derive(Clone, Debug)]
pub struct NoteFile {
    /// The file.
    pub path: PathBuf,
    /// The folders above it, below the root.
    pub dir: Vec<String>,
    /// The file name without its extension.
    pub stem: String,
    /// The ID the page will have, so links between notes can be written before the pages are.
    pub id: PageId,
}

/// Everything a scan found.
#[derive(Debug, Default)]
pub struct Scan {
    /// The notes, in path order.
    pub notes: Vec<NoteFile>,
    /// The files that are not notes, by lowercase path below the root.
    files: HashMap<String, PathBuf>,
    /// Lowercase file names to paths, for links that give only a name.
    by_name: HashMap<String, Vec<PathBuf>>,
    /// Lowercase file names without extensions to paths, for Joplin's `:/id` links.
    by_stem: HashMap<String, Vec<PathBuf>>,
    /// Lowercase note paths without extension, and their IDs.
    note_paths: HashMap<String, PageId>,
    /// Lowercase note names without extension, with the folder of each.
    note_names: HashMap<String, Vec<(Vec<String>, PageId)>>,
    /// Things the scan did not look at, with the reason.
    pub skipped: Vec<(String, String)>,
    root: PathBuf,
    /// The extensions that mark a note, in lowercase and without the dot.
    exts: Vec<String>,
    /// The extensions of files that are neither notes nor attachments, such as the HTML copies in a Takeout.
    ignored: Vec<String>,
}

impl Scan {
    /// Walks the folder. Files with one of the extensions are notes. `new_id` makes the ID of each note's page.
    pub fn new(root: &Path, exts: &[&str], ignored: &[&str], mut new_id: impl FnMut() -> PageId) -> Result<Scan> {
        let mut scan = Scan {
            root: root.to_path_buf(),
            exts: exts.iter().map(|e| e.to_ascii_lowercase()).collect(),
            ignored: ignored.iter().map(|e| e.to_ascii_lowercase()).collect(),
            ..Scan::default()
        };
        if root.is_file() {
            // A single file is the only note, whatever its extension.
            let name = root
                .file_name()
                .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
            if let Some((_, ext)) = name.rsplit_once('.') {
                scan.exts.push(ext.to_ascii_lowercase());
            }
            scan.root = root.parent().map_or_else(PathBuf::new, Path::to_path_buf);
            scan.add_file(root.to_path_buf(), name, &[], &mut new_id);
            return Ok(scan);
        }
        scan.walk(root, &mut Vec::new(), &mut new_id)?;
        Ok(scan)
    }

    fn walk(&mut self, dir: &Path, parts: &mut Vec<String>, new_id: &mut dyn FnMut() -> PageId) -> Result<()> {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .and_then(|iter| iter.collect::<std::io::Result<Vec<_>>>())
            .map_err(|e| InteropError::io(dir, e))?;
        entries.sort_by_key(fs::DirEntry::file_name);
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            let kind = entry.file_type().map_err(|e| InteropError::io(&path, e))?;
            if name.starts_with('.') || name == "node_modules" || matches!(name.as_str(), "Thumbs.db" | "desktop.ini") {
                continue;
            }
            if kind.is_symlink() {
                self.skipped
                    .push((name, "It is a link, and imports do not follow links.".to_owned()));
            } else if kind.is_dir() {
                parts.push(name);
                self.walk(&path, parts, new_id)?;
                parts.pop();
            } else {
                self.add_file(path, name, parts, new_id);
            }
        }
        Ok(())
    }

    fn add_file(&mut self, path: PathBuf, name: String, dir: &[String], new_id: &mut dyn FnMut() -> PageId) {
        let lower = name.to_lowercase();
        if lower
            .rsplit_once('.')
            .is_some_and(|(_, ext)| self.ignored.iter().any(|i| i == ext))
        {
            return;
        }
        let (stem, is_note) = match lower.rsplit_once('.') {
            Some((_, ext)) if self.exts.iter().any(|e| e == ext) => {
                (name[..name.rfind('.').unwrap_or(name.len())].to_owned(), true)
            }
            Some((stem, _)) => (stem.to_owned(), false),
            None => (lower.clone(), false),
        };
        let mut rel: Vec<String> = dir.iter().map(|p| p.to_lowercase()).collect();
        if is_note {
            let id = new_id();
            rel.push(stem.to_lowercase());
            self.note_paths.insert(rel.join("/"), id);
            self.note_names
                .entry(stem.to_lowercase())
                .or_default()
                .push((dir.to_vec(), id));
            self.notes.push(NoteFile {
                path,
                dir: dir.to_vec(),
                stem,
                id,
            });
        } else {
            rel.push(lower.clone());
            self.files.insert(rel.join("/"), path.clone());
            self.by_name.entry(lower).or_default().push(path.clone());
            self.by_stem.entry(stem).or_default().push(path);
        }
    }

    /// Lets links by `name` find the note, besides its file name: an alias, or a title that differs from it.
    pub fn add_alias(&mut self, note: &NoteFile, name: &str) {
        let key = name.trim().to_lowercase();
        if !key.is_empty() && !key.contains('/') {
            self.note_names
                .entry(key)
                .or_default()
                .push((note.dir.clone(), note.id));
        }
    }

    /// The files that are not notes.
    pub fn file_paths(&self) -> impl Iterator<Item = &PathBuf> {
        self.files.values()
    }

    /// Finds the page that a note link points at: `Note`, `folder/Note`, or `Note.md`. Anything after `#` or `^`
    /// is ignored. A name that several notes have goes to the one in the nearest folder.
    pub fn note(&self, target: &str, from_dir: &[String]) -> Option<PageId> {
        let target = target.split(['#', '^']).next().unwrap_or("").trim();
        let target = percent_decode(target);
        let lower = target.to_lowercase();
        let target = self
            .exts
            .iter()
            .find_map(|ext| lower.strip_suffix(&format!(".{ext}")))
            .unwrap_or(&lower);
        let target = target.trim_start_matches("./").to_owned();
        if target.is_empty() {
            return None;
        }
        let beside = normalize(from_dir, &target).and_then(|path| self.note_paths.get(&path));
        if let Some(id) = beside.or_else(|| self.note_paths.get(&target)) {
            return Some(*id);
        }
        let name = target.rsplit('/').next().unwrap_or(&target);
        let candidates = self.note_names.get(name)?;
        let shared = |dir: &[String]| dir.iter().zip(from_dir).take_while(|(a, b)| a == b).count();
        candidates.iter().max_by_key(|(dir, _)| shared(dir)).map(|(_, id)| *id)
    }

    /// Finds the file that a link or an embed points at: a path relative to the note or the root, a bare name
    /// anywhere in the folder, or Joplin's `:/id`.
    pub fn file(&self, dest: &str, from_dir: &[String]) -> Option<&Path> {
        let dest = percent_decode(dest.split(['#', '?']).next().unwrap_or(""));
        if let Some(id) = dest.strip_prefix(":/") {
            return self.by_stem.get(&id.to_lowercase())?.first().map(PathBuf::as_path);
        }
        let relative = normalize(from_dir, &dest);
        let from_root = normalize(&[], &dest);
        let found = relative
            .and_then(|p| self.files.get(&p))
            .or_else(|| from_root.and_then(|p| self.files.get(&p)));
        if let Some(path) = found {
            return Some(path);
        }
        let name = dest.rsplit('/').next().unwrap_or(&dest).to_lowercase();
        self.by_name.get(&name)?.first().map(PathBuf::as_path)
    }

    /// The path of a file below the root, for reports.
    pub fn display(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }
}

/// Joins a link to the folder it is in and resolves `.` and `..`. Returns a lowercase path below the root, or
/// `None` when the link leaves the root.
fn normalize(from_dir: &[String], dest: &str) -> Option<String> {
    let mut parts: Vec<String> = from_dir.iter().map(|p| p.to_lowercase()).collect();
    for part in dest.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other.to_lowercase()),
        }
    }
    Some(parts.join("/"))
}

/// Decodes `%20` and the like. Invalid sequences stay as written.
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| char::from(b).to_digit(16);
        let decoded = match (
            bytes[i],
            bytes.get(i + 1).and_then(|b| hex(*b)),
            bytes.get(i + 2).and_then(|b| hex(*b)),
        ) {
            (b'%', Some(high), Some(low)) => u8::try_from(high * 16 + low).ok(),
            _ => None,
        };
        match decoded {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
