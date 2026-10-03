//! Telling what a file or folder is, so the app can offer the right import.
//!
//! [`detect`] looks at the name, the first bytes, and for folders and ZIP archives at what they hold. It never
//! reads whole files. The result says which importer fits, and whether this version can run it.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::archive::ZipArchive;
use crate::error::{InteropError, Result};
use crate::import::{is_bundle_name, is_sticky_notes_database, looks_like_keep, Flavor, STICKY_NOTES_FILE};
use crate::run::Control;
use crate::sqlite::Database;

/// The kinds of source an import can read.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    /// A folder or file of Markdown notes: Obsidian, Joplin, Logseq, or plain Markdown.
    Markdown,
    /// A Notion export of Markdown and CSV files.
    Notion,
    /// Evernote export files (`.enex`).
    Evernote,
    /// Word files (`.docx`) and OpenDocument text (`.odt`), including OneNote's exports.
    Word,
    /// Web page archives (`.mht`), including OneNote's exports.
    WebArchive,
    /// HTML pages, including OpenNote's own HTML export.
    Html,
    /// Plain text files.
    Text,
    /// CSV files, each of which becomes a table.
    Csv,
    /// A Google Takeout export of Keep notes.
    GoogleKeep,
    /// Bear notes exported as TextBundle folders.
    TextBundle,
    /// The database of the Windows Sticky Notes app (`plum.sqlite`).
    StickyNotes,
    /// Excel workbooks (`.xlsx`), each sheet a table page.
    Spreadsheet,
    /// PowerPoint presentations (`.pptx`), each slide a page.
    Presentation,
    /// Email files (`.eml`), each message a page.
    Email,
    /// Kindle `My Clippings.txt` and Readwise CSV exports.
    Highlights,
    /// OneNote's own section and notebook files (`.one`, `.onepkg`), which this version cannot read.
    OneNoteFile,
}

impl SourceKind {
    /// The name of the kind, for the interface and for reports.
    pub fn label(self) -> &'static str {
        match self {
            SourceKind::Markdown => "Markdown notes",
            SourceKind::Notion => "Notion export",
            SourceKind::Evernote => "Evernote export",
            SourceKind::Word => "Word documents",
            SourceKind::WebArchive => "Web page archives",
            SourceKind::Html => "HTML pages",
            SourceKind::Text => "Text files",
            SourceKind::Csv => "CSV files",
            SourceKind::GoogleKeep => "Google Keep export",
            SourceKind::TextBundle => "Bear export",
            SourceKind::StickyNotes => "Windows Sticky Notes",
            SourceKind::Spreadsheet => "Excel workbooks",
            SourceKind::Presentation => "PowerPoint presentations",
            SourceKind::Email => "Email files",
            SourceKind::Highlights => "Kindle and Readwise highlights",
            SourceKind::OneNoteFile => "OneNote files",
        }
    }
}

/// What a path is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Detected {
    /// The kind of source.
    pub kind: SourceKind,
    /// A more exact name, such as `Obsidian vault`.
    pub label: String,
    /// Whether this version can import it.
    pub supported: bool,
    /// Whether the path is a ZIP archive that is unpacked first.
    pub zipped: bool,
    /// What to do instead, when the source cannot be imported.
    pub advice: Option<String>,
}

const ONENOTE_ADVICE: &str = "OneNote keeps notebooks in its own binary files, which OpenNote cannot open yet. In \
    OneNote, choose File, then Export, and save each section as a Word document (.docx) or a Web page (.mht). \
    Then import those files.";

const STICKY_ADVICE: &str = "This is the old Sticky Notes file. Open the Sticky Notes app from the Microsoft Store \
    once, so it moves the notes into its new database. Then import plum.sqlite from the app's LocalState folder.";

/// Looks at a file, folder, or ZIP archive and says what it is.
pub fn detect(path: &Path) -> Result<Detected> {
    let meta = fs::metadata(path).map_err(|e| InteropError::io(path, e))?;
    if meta.is_dir() {
        return detect_folder(path);
    }
    let ext = extension(path);
    match ext.as_str() {
        "zip" => detect_zip(path),
        "one" | "onepkg" | "onetoc2" => Ok(onenote_files()),
        "sqlite" | "sqlite3" | "db" => detect_database(path),
        "snt" => Err(InteropError::unsupported(file_name(path), STICKY_ADVICE)),
        "doc" | "rtf" | "pages" | "wpd" => Err(InteropError::unsupported(
            file_name(path),
            "Save the document as .docx in its own app, then import that file.",
        )),
        "txt" | "text" | "csv" if holds_highlights(path, &ext) => {
            Ok(detected(SourceKind::Highlights, SourceKind::Highlights.label()))
        }
        _ => by_extension(&ext).ok_or_else(|| {
            let hint = if starts_with(path, b"%PDF") {
                "PDF files are added to a page, not imported as notes."
            } else {
                "OpenNote does not know this kind of file."
            };
            InteropError::unsupported(file_name(path), hint)
        }),
    }
}

/// A SQLite file is a Sticky Notes database when it has the app's `Note` table.
fn detect_database(path: &Path) -> Result<Detected> {
    let database = Database::open(path)?;
    if is_sticky_notes_database(&database) {
        return Ok(detected(SourceKind::StickyNotes, SourceKind::StickyNotes.label()));
    }
    Err(InteropError::unsupported(
        file_name(path),
        "OpenNote reads only the Sticky Notes database from SQLite files.",
    ))
}

fn onenote_files() -> Detected {
    Detected {
        kind: SourceKind::OneNoteFile,
        label: SourceKind::OneNoteFile.label().to_owned(),
        supported: false,
        zipped: false,
        advice: Some(ONENOTE_ADVICE.to_owned()),
    }
}

fn detected(kind: SourceKind, label: impl Into<String>) -> Detected {
    Detected {
        kind,
        label: label.into(),
        supported: true,
        zipped: false,
        advice: None,
    }
}

/// Whether a text or CSV file is a Kindle clippings file or a Readwise export, from its first few kilobytes.
fn holds_highlights(path: &Path, ext: &str) -> bool {
    let mut head = vec![0u8; 8192];
    let Ok(read) = File::open(path).and_then(|mut f| f.read(&mut head)) else {
        return false;
    };
    let text = String::from_utf8_lossy(&head[..read]).replace("\r\n", "\n");
    if ext == "csv" {
        crate::import::is_readwise(&text)
    } else {
        crate::import::is_kindle(&text)
    }
}

fn by_extension(ext: &str) -> Option<Detected> {
    let kind = match ext {
        "md" | "markdown" => SourceKind::Markdown,
        "enex" => SourceKind::Evernote,
        "docx" | "docm" | "odt" | "ott" => SourceKind::Word,
        "mht" | "mhtml" => SourceKind::WebArchive,
        "html" | "htm" => SourceKind::Html,
        "txt" | "text" => SourceKind::Text,
        "csv" | "tsv" => SourceKind::Csv,
        "xlsx" | "xlsm" => SourceKind::Spreadsheet,
        "pptx" | "pptm" => SourceKind::Presentation,
        "eml" => SourceKind::Email,
        _ => return None,
    };
    Some(detected(kind, kind.label()))
}

fn extension(path: &Path) -> String {
    path.extension()
        .map_or_else(String::new, |e| e.to_string_lossy().to_ascii_lowercase())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

fn starts_with(path: &Path, magic: &[u8]) -> bool {
    let mut buffer = vec![0u8; magic.len()];
    File::open(path)
        .and_then(|mut f| f.read_exact(&mut buffer))
        .is_ok_and(|()| buffer == magic)
}

/// The counts of what a folder or archive holds, by extension.
#[derive(Default)]
struct Survey {
    by_ext: HashMap<String, usize>,
    notion_ids: usize,
    scanned: usize,
}

impl Survey {
    fn add(&mut self, name: &str) {
        self.scanned += 1;
        if crate::import::has_notion_id(name) {
            self.notion_ids += 1;
        }
        if let Some((_, ext)) = name.rsplit_once('.') {
            *self.by_ext.entry(ext.to_ascii_lowercase()).or_default() += 1;
        }
    }

    fn count(&self, exts: &[&str]) -> usize {
        exts.iter().map(|e| self.by_ext.get(*e).copied().unwrap_or(0)).sum()
    }

    /// The kind with the most files. Ties go to the kind that keeps the most structure.
    fn majority(&self) -> Option<SourceKind> {
        let candidates = [
            (SourceKind::Markdown, self.count(&["md", "markdown"])),
            (SourceKind::Word, self.count(&["docx", "docm", "odt", "ott"])),
            (SourceKind::WebArchive, self.count(&["mht", "mhtml"])),
            (SourceKind::Html, self.count(&["html", "htm"])),
            (SourceKind::Evernote, self.count(&["enex"])),
            (SourceKind::Text, self.count(&["txt", "text"])),
            (SourceKind::Csv, self.count(&["csv", "tsv"])),
            (SourceKind::Spreadsheet, self.count(&["xlsx", "xlsm"])),
            (SourceKind::Presentation, self.count(&["pptx", "pptm"])),
            (SourceKind::Email, self.count(&["eml"])),
        ];
        let best = candidates.iter().map(|(_, n)| *n).max().unwrap_or(0);
        candidates.iter().find(|(_, n)| *n == best && best > 0).map(|(k, _)| *k)
    }
}

/// The most entries a survey looks at, so a huge drive cannot stall the dialog.
const SURVEY_LIMIT: usize = 20_000;

fn survey_folder(dir: &Path, depth: usize, survey: &mut Survey) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if survey.scanned >= SURVEY_LIMIT {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        survey.add(&name);
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        if is_dir && depth < 4 {
            survey_folder(&entry.path(), depth + 1, survey);
        }
    }
}

/// The first JSON file below a folder, down to a few levels, read for its first bytes.
fn first_json_bytes(dir: &Path, depth: usize) -> Option<String> {
    let mut entries: Vec<_> = fs::read_dir(dir).ok()?.flatten().collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in &entries {
        let path = entry.path();
        if path.is_file() && extension(&path) == "json" {
            let mut buffer = vec![0u8; 8192];
            let n = File::open(&path).and_then(|mut f| f.read(&mut buffer)).ok()?;
            return Some(String::from_utf8_lossy(&buffer[..n]).into_owned());
        }
    }
    if depth < 3 {
        for entry in &entries {
            let path = entry.path();
            if path.is_dir() && !entry.file_name().to_string_lossy().starts_with('.') {
                if let Some(found) = first_json_bytes(&path, depth + 1) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn detect_folder(dir: &Path) -> Result<Detected> {
    if dir.join(STICKY_NOTES_FILE).is_file() {
        return Ok(detected(SourceKind::StickyNotes, SourceKind::StickyNotes.label()));
    }
    let mut survey = Survey::default();
    survey_folder(dir, 0, &mut survey);
    if is_bundle_name(&file_name(dir)) || survey.count(&["textbundle"]) > 0 {
        return Ok(detected(SourceKind::TextBundle, SourceKind::TextBundle.label()));
    }
    if survey.count(&["json"]) > 0 && first_json_bytes(dir, 0).is_some_and(|b| looks_like_keep(&b)) {
        return Ok(detected(SourceKind::GoogleKeep, SourceKind::GoogleKeep.label()));
    }
    let flavor = Flavor::detect(dir);
    let markdown = survey.count(&["md", "markdown"]);
    match flavor {
        Flavor::Notion => return Ok(detected(SourceKind::Notion, flavor.label())),
        Flavor::Obsidian | Flavor::Logseq | Flavor::Joplin if markdown > 0 => {
            return Ok(detected(SourceKind::Markdown, flavor.label()));
        }
        _ => {}
    }
    if let Some(kind) = survey.majority() {
        let label = if kind == SourceKind::Markdown {
            flavor.label()
        } else {
            kind.label()
        };
        return Ok(detected(kind, label));
    }
    if survey.count(&["one", "onepkg", "onetoc2"]) > 0 {
        return Ok(onenote_files());
    }
    Err(InteropError::unsupported(
        file_name(dir),
        "The folder holds no notes that OpenNote can import: Markdown, Evernote, Word, web page, HTML, or text files.",
    ))
}

fn detect_zip(path: &Path) -> Result<Detected> {
    let archive = ZipArchive::open(path)?;
    let mut survey = Survey::default();
    let mut office = false;
    for entry in archive.entries().iter().take(SURVEY_LIMIT) {
        if entry.name == "[Content_Types].xml" {
            office = true;
        }
        if entry.is_dir || entry.name.starts_with("__MACOSX/") || entry.name.contains("/.") {
            continue;
        }
        survey.add(entry.name.rsplit('/').next().unwrap_or(&entry.name));
    }
    if office {
        return Ok(Detected {
            kind: SourceKind::Word,
            label: "Word document".to_owned(),
            supported: true,
            zipped: false,
            advice: None,
        });
    }
    let markdown_or_csv = survey.count(&["md", "markdown", "csv"]);
    let bundles = archive
        .entries()
        .iter()
        .any(|e| e.name.to_ascii_lowercase().contains(".textbundle/"));
    let keep = survey.count(&["json"]) > 0 && archive_has_keep(archive);
    let kind = if bundles {
        Some(SourceKind::TextBundle)
    } else if keep {
        Some(SourceKind::GoogleKeep)
    } else if survey.notion_ids > 0 && survey.notion_ids * 3 >= markdown_or_csv {
        Some(SourceKind::Notion)
    } else {
        survey.majority()
    };
    match kind {
        Some(kind) => Ok(Detected {
            kind,
            label: format!("{} in a ZIP archive", kind.label()),
            supported: true,
            zipped: true,
            advice: None,
        }),
        None => Err(InteropError::unsupported(
            file_name(path),
            "The archive holds no notes that OpenNote can import.",
        )),
    }
}

/// Whether the first JSON file in the archive looks like a Keep note.
fn archive_has_keep(mut archive: ZipArchive<std::io::BufReader<File>>) -> bool {
    let first = archive
        .entries()
        .iter()
        .position(|e| !e.is_dir && e.name.to_ascii_lowercase().ends_with(".json") && e.size < (1 << 20));
    let Some(index) = first else {
        return false;
    };
    archive
        .read(index)
        .is_ok_and(|bytes| looks_like_keep(&String::from_utf8_lossy(&bytes[..bytes.len().min(8192)])))
}

/// A folder to import from, which may be a temporary copy of a ZIP archive's files.
pub struct Prepared {
    /// The file or folder to hand to the importer.
    pub root: PathBuf,
    /// Entries of the archive that were not unpacked, with the reason.
    pub skipped: Vec<(String, String)>,
    _guard: Option<tempfile::TempDir>,
}

/// The name that every temporary folder of an unpacked archive starts with.
const TEMP_PREFIX: &str = "opennote-import-";

/// How old a temporary folder must be before a later import deletes it as left behind. Only an import that was
/// killed leaves one, because the folder is deleted when the import ends.
const LEFTOVER_AGE: Duration = Duration::from_secs(12 * 60 * 60);

/// Unpacks a ZIP archive into a temporary folder that is deleted when the result is dropped. Other paths are
/// returned as they are. `control` hears the bytes unpacked, and its Cancel stops the unpacking.
///
/// It first deletes the temporary folders of earlier imports that were killed before they could.
pub fn prepare(path: &Path, control: &Control) -> Result<Prepared> {
    if !path.is_file() || extension(path) != "zip" {
        return Ok(Prepared {
            root: path.to_path_buf(),
            skipped: Vec::new(),
            _guard: None,
        });
    }
    let mut archive = ZipArchive::open(path)?;
    remove_leftovers(&std::env::temp_dir(), LEFTOVER_AGE);
    let guard = tempfile::Builder::new()
        .prefix(TEMP_PREFIX)
        .tempdir()
        .map_err(|e| InteropError::io(std::env::temp_dir(), e))?;
    let stem = path
        .file_stem()
        .map_or_else(|| "Imported notes".to_owned(), |n| n.to_string_lossy().into_owned());
    let root = guard.path().join(stem);
    std::fs::create_dir_all(&root).map_err(|e| InteropError::io(&root, e))?;
    let mut skipped = Vec::new();
    archive.extract(&root, true, &mut skipped, control)?;
    Ok(Prepared {
        root,
        skipped,
        _guard: Some(guard),
    })
}

/// Deletes the temporary folders in `temp` that earlier imports unpacked into and are at least `older_than` old.
fn remove_leftovers(temp: &Path, older_than: Duration) {
    let Ok(entries) = fs::read_dir(temp) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let ours = entry.file_name().to_string_lossy().starts_with(TEMP_PREFIX);
        let folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
        let age = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .map(|changed| now.duration_since(changed).unwrap_or_default());
        if ours && folder && age.is_ok_and(|age| age >= older_than) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::zip_bytes;

    #[test]
    fn folders_left_by_killed_imports_are_deleted_and_others_kept() {
        let temp = tempfile::tempdir().expect("a temp folder");
        touch(temp.path(), "opennote-import-old/Vault/a.md");
        touch(temp.path(), "other/a.md");
        touch(temp.path(), "opennote-import-file");
        remove_leftovers(temp.path(), Duration::from_secs(3600));
        assert!(
            temp.path().join("opennote-import-old").exists(),
            "a new folder may be in use"
        );
        remove_leftovers(temp.path(), Duration::ZERO);
        assert!(!temp.path().join("opennote-import-old").exists());
        assert!(temp.path().join("other/a.md").is_file());
        assert!(
            temp.path().join("opennote-import-file").is_file(),
            "only folders are deleted"
        );
    }

    fn touch(dir: &Path, name: &str) {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().expect("a parent")).expect("creates");
        fs::write(path, "x").expect("writes");
    }

    #[test]
    fn files_are_told_by_extension() {
        let dir = tempfile::tempdir().expect("a temp folder");
        for (name, kind) in [
            ("a.md", SourceKind::Markdown),
            ("a.ENEX", SourceKind::Evernote),
            ("a.docx", SourceKind::Word),
            ("a.mht", SourceKind::WebArchive),
            ("a.htm", SourceKind::Html),
            ("a.txt", SourceKind::Text),
        ] {
            touch(dir.path(), name);
            assert_eq!(detect(&dir.path().join(name)).expect("known").kind, kind, "{name}");
        }
        touch(dir.path(), "notes.one");
        let one = detect(&dir.path().join("notes.one")).expect("known");
        assert!(!one.supported && one.advice.as_deref().is_some_and(|a| a.contains(".docx")));
        touch(dir.path(), "x.rtf");
        assert!(matches!(
            detect(&dir.path().join("x.rtf")),
            Err(InteropError::Unsupported { .. })
        ));
    }

    #[test]
    fn folders_are_told_by_their_markers_and_their_majority() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let vault = dir.path().join("vault");
        touch(&vault, ".obsidian/app.json");
        touch(&vault, "a.md");
        assert_eq!(detect(&vault).expect("known").label, "Obsidian vault");
        let notion = dir.path().join("notion");
        touch(&notion, "Page 0123456789abcdef0123456789abcdef.md");
        assert_eq!(detect(&notion).expect("known").kind, SourceKind::Notion);
        let docs = dir.path().join("docs");
        touch(&docs, "a.docx");
        touch(&docs, "b.docx");
        touch(&docs, "c.txt");
        assert_eq!(detect(&docs).expect("known").kind, SourceKind::Word);
        let empty = dir.path().join("empty");
        fs::create_dir_all(&empty).expect("creates");
        assert!(detect(&empty).is_err());
    }

    #[test]
    fn zip_archives_are_sniffed_and_unpacked() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let id = "0123456789abcdef0123456789abcdef";
        let zip = zip_bytes(&[
            (&format!("Export/Page {id}.md"), b"# Page"),
            (&format!("Export/DB {id}.csv"), b"a,b"),
        ]);
        let path = dir.path().join("Export-1.zip");
        fs::write(&path, zip).expect("writes");
        let found = detect(&path).expect("known");
        assert_eq!((found.kind, found.zipped), (SourceKind::Notion, true));
        let prepared = prepare(&path, &Control::none()).expect("unpacks");
        assert!(prepared.root.ends_with("Export-1"));
        assert!(
            prepared.root.join(format!("Page {id}.md")).is_file(),
            "the top folder is stripped"
        );
        let root = prepared.root.clone();
        drop(prepared);
        assert!(!root.exists(), "the temporary files are deleted");
    }
}
