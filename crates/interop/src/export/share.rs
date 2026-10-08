//! Sharing a page, a section, or a notebook as one file that opens in OpenNote as a new notebook.
//!
//! The file is a ZIP archive with the extension `.opennote`. It holds `opennote-share.json` (a small manifest) and
//! the OpenNote Markdown export of what is shared, in a folder named for it. That is the format the Markdown
//! importer reads, so opening the file needs nothing new. Sections, pages, tags, properties, links between pages,
//! and pictures come back. Every page gets a new ID, so a file shared to the same PC never collides with the
//! original. A password locks the whole archive (see [`crate::lock`]). The format is described in
//! `docs/adr/0035-share-as-a-file.md`.

use std::fs;
use std::path::Path;

use super::files::{export_files_with, Exported, Format};
use super::names::sanitize_name;
use super::plan::Scope;
use crate::docx::zip::ZipWriter;
use crate::error::{InteropError, Result};
use crate::lock;
use crate::run::Control;
use crate::source::NoteSource;

/// The extension of a shared file.
pub const EXTENSION: &str = "opennote";

/// The name of the manifest in the archive.
pub const MANIFEST: &str = "opennote-share.json";

/// The most data a shared file may hold before it is locked or written.
const MAX_BYTES: u64 = 1 << 30;

/// Exports to `out_dir/<title>.opennote`, or `out_dir/<title> (2).opennote` and so on, so nothing is overwritten.
pub fn export_share(
    source: &dyn NoteSource,
    scope: Scope,
    password: Option<&str>,
    out_dir: &Path,
    control: &Control,
) -> Result<Exported> {
    let staging = tempfile::tempdir().map_err(|e| InteropError::io(std::env::temp_dir(), e))?;
    let mut inner = export_files_with(source, scope, Format::Markdown, staging.path(), control)?;
    let title = inner
        .root
        .file_name()
        .map_or_else(|| "OpenNote notes".to_owned(), |n| n.to_string_lossy().into_owned());
    let scope_name = match scope {
        Scope::Page(_) => "page",
        Scope::Section(_) => "section",
        Scope::Notebook => "notebook",
    };
    let manifest = serde_json::json!({
        "format": "opennote-share",
        "version": 1,
        "title": title,
        "scope": scope_name,
        "pages": inner.report.pages.len(),
        "locked": password.is_some(),
    });
    let mut zip = ZipWriter::new();
    zip.add(MANIFEST, manifest.to_string().as_bytes())?;
    let mut total = 0u64;
    add_folder(&mut zip, &inner.root, &title, &mut total)?;
    let mut bytes = zip.finish()?;
    if let Some(password) = password.filter(|p| !p.is_empty()) {
        bytes = lock::lock(password, &bytes)?;
    }
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let name = sanitize_name(&title, "OpenNote export");
    let mut path = out_dir.join(format!("{name}.{EXTENSION}"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{name} ({n}).{EXTENSION}"));
        n += 1;
    }
    fs::write(&path, bytes).map_err(|e| InteropError::io(&path, e))?;
    inner.report.general.skipped(
        "page history",
        "A shared file holds the pages as they are now, not their earlier versions.",
    );
    inner.report.general.simplified(
        "handwriting",
        "Handwriting is shared as a picture of each page's ink, which cannot be edited after opening.",
    );
    Ok(Exported {
        root: out_dir.to_path_buf(),
        files: vec![path],
        report: inner.report,
    })
}

/// Adds every file below `dir` to the archive under `prefix`.
fn add_folder(zip: &mut ZipWriter, dir: &Path, prefix: &str, total: &mut u64) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| InteropError::io(dir, e))?
        .flatten()
        .collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        let path = entry.path();
        if path.is_dir() {
            add_folder(zip, &path, &name, total)?;
        } else {
            let data = fs::read(&path).map_err(|e| InteropError::io(&path, e))?;
            *total += data.len() as u64;
            if *total > MAX_BYTES {
                return Err(InteropError::TooBig("the shared file (over 1 GiB)".to_owned()));
            }
            zip.add(&name, &data)?;
        }
    }
    Ok(())
}
