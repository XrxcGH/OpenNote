//! Importing OneNote's own files (A3-17): section files (`.one`), notebook packages (`.onepkg`), and the folder
//! of a notebook. Each section file becomes a section, named after the file, and the folders above it (section
//! groups), and each page a page, with subpages under their page.
//!
//! The format itself is read by [`crate::onenote`]. A package is a Cabinet file; its sections are unpacked into
//! a temporary folder first, with every name checked so nothing lands outside it.

use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::NotebookFile;
use opennote_core::{NotebookId, PageId};

use super::onenote_page::convert_page;
use crate::archive::safe_target;
use crate::error::{InteropError, Result};
use crate::onenote::{file_kind, is_cabinet, limits, read_section, Cabinet, FileKind};
use crate::report::{Report, ReportKind};
use crate::run::{Phase, Unit};
use crate::sink::{with_sink, ImportEnv, ImportSink};
use crate::tree::{section_orders, SectionBuilder};

/// Section files read from one notebook folder.
const MAX_SECTIONS: usize = 10_000;
/// Folder levels searched for section files.
const MAX_FOLDER_DEPTH: usize = 32;
/// The folder where OneNote keeps deleted pages and sections; its sections are left out.
const RECYCLE_BIN: &str = "OneNote_RecycleBin";

/// Imports a OneNote section file, notebook package, or notebook folder into a new notebook.
pub fn import_onenote(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    env.control.begin(Phase::Scanning, Unit::Items, None);
    let package = is_package(path);
    let unpacked = if package { Some(unpack(path, env)?) } else { None };
    let root = unpacked.as_ref().map_or(path, |dir| dir.path());
    let mut report = Report::new(
        ReportKind::Import,
        format!("OneNote files \"{}\"", notebook_title(path)),
    );
    let mut sections = Vec::new();
    find_sections(root, root, 0, &mut sections, &mut report)?;
    if sections.is_empty() {
        return Err(InteropError::format(
            display(path),
            "no OneNote sections (.one files) were found",
        ));
    }
    with_sink(sink, |sink| write_notebook(path, &sections, env, sink, report))
}

fn write_notebook(
    path: &Path,
    sections: &[(PathBuf, String)],
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
    mut report: Report,
) -> Result<Report> {
    env.control
        .begin(Phase::Converting, Unit::Items, Some(sections.len() as u64));
    let now = env.clock.now();
    sink.notebook(NotebookFile::new(
        NotebookId::generate(env.clock),
        notebook_title(path),
        now,
    ))?;
    let mut built = Vec::new();
    for (file, name) in sections {
        env.control.checkpoint()?;
        if let Some(section) = convert_section(file, name, env, sink, &mut report)? {
            built.push(section);
        }
        env.control.step(Phase::Converting, 1, name);
    }
    if built.is_empty() {
        let why = report
            .general
            .entries
            .last()
            .and_then(|e| e.why.clone())
            .unwrap_or_else(|| "no section could be read".to_owned());
        return Err(InteropError::format(display(path), why));
    }
    let orders = section_orders(built.len())?;
    for (section, order) in built.into_iter().zip(orders) {
        sink.section(section.finish(order)?)?;
    }
    Ok(report)
}

/// Reads one section file and writes its pages. `None` when it is left out; the report says why.
fn convert_section(
    file: &Path,
    name: &str,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
    report: &mut Report,
) -> Result<Option<SectionBuilder>> {
    let skip = |report: &mut Report, why: &str| {
        report.general.skipped(name.to_owned(), why.to_owned());
        Ok(None)
    };
    let bytes = match read_capped(file, limits::SECTION_BYTES) {
        Ok(bytes) => bytes,
        Err(why) => return skip(report, &why),
    };
    match file_kind(&bytes) {
        Ok(FileKind::Section) => {}
        Ok(FileKind::TableOfContents) => return Ok(None),
        Ok(FileKind::Packaged) => return skip(report, PACKAGED_ADVICE),
        Err(_) => return skip(report, "It is not a OneNote section file."),
    }
    let section = match read_section(&bytes) {
        Ok(section) => section,
        Err(damage) => return skip(report, &format!("It is damaged: {}.", damage.0)),
    };
    if section.encrypted {
        return skip(
            report,
            "It is password-protected. Unlock it in OneNote, then import it again.",
        );
    }
    let onefiles = file.with_file_name(format!("{}_onefiles", stem(file)));
    let mut builder = SectionBuilder::new(env, name, env.clock.now());
    let mut levels: Vec<(u32, PageId)> = Vec::new();
    for page in &section.pages {
        env.control.checkpoint()?;
        let (imported, page_report) = match convert_page(page, name, &onefiles, env) {
            Ok(done) => done,
            Err(InteropError::Canceled) => return Err(InteropError::Canceled),
            Err(error) => {
                report
                    .general
                    .skipped(format!("{name}: {}", page.title), error.to_string());
                continue;
            }
        };
        while levels.last().is_some_and(|(level, _)| *level >= page.level) {
            levels.pop();
        }
        let parent = levels.last().map(|(_, id)| *id);
        levels.push((page.level, imported.page.id));
        builder.add_page(&imported.page, parent);
        sink.page(builder.id(), imported)?;
        report.add_page(page_report);
    }
    if section.lost_pages > 0 {
        report.general.skipped(
            format!("{name}: {} pages", section.lost_pages),
            "They are damaged or password-protected.",
        );
    }
    if section.too_many_pages > 0 {
        report.general.skipped(
            format!("{name}: {} pages", section.too_many_pages),
            "The section has more pages than OpenNote reads from one file.",
        );
    }
    Ok(Some(builder))
}

const PACKAGED_ADVICE: &str = "OneNote saved it in the form it uses on the web, which OpenNote cannot read yet. Open \
    the notebook in OneNote for Windows, choose File, then Export, and export it as a OneNote package (.onepkg).";

const PACKAGE_ADVICE: &str = "OpenNote cannot unpack this package's compression yet. Rename a copy to end in .cab, \
    open it in File Explorer, copy what it holds to a folder, and import that folder.";

/// A notebook package is a Cabinet file, whatever its name says.
fn is_package(path: &Path) -> bool {
    path.is_file()
        && fs::File::open(path)
            .and_then(|mut f| {
                let mut magic = [0u8; 4];
                std::io::Read::read_exact(&mut f, &mut magic).map(|()| is_cabinet(&magic))
            })
            .unwrap_or(false)
}

/// Unpacks the sections of a package, and the pictures and files beside them, into a temporary folder.
fn unpack(path: &Path, env: &ImportEnv<'_>) -> Result<tempfile::TempDir> {
    let bytes = read_capped(path, limits::CAB_BYTES as u64).map_err(|why| InteropError::format(display(path), why))?;
    let damaged = |damage: crate::onenote::Damage| InteropError::format(display(path), damage.0);
    let cabinet = Cabinet::open(&bytes).map_err(damaged)?;
    if cabinet.unreadable_method().is_some() {
        return Err(InteropError::unsupported(display(path), PACKAGE_ADVICE));
    }
    let dir = tempfile::Builder::new()
        .prefix("opennote-onepkg-")
        .tempdir()
        .map_err(|e| InteropError::io(std::env::temp_dir(), e))?;
    let mut failed = None;
    let stop = || env.control.checkpoint().is_err();
    cabinet
        .extract(&stop, |file, data| {
            let name = file.name.replace('\\', "/");
            let lower = name.to_ascii_lowercase();
            if !(lower.ends_with(".one") || lower.ends_with(".onebin")) {
                return Ok(());
            }
            let Some(target) = safe_target(dir.path(), &name) else {
                return Ok(());
            };
            let written = target
                .parent()
                .map_or(Ok(()), fs::create_dir_all)
                .and_then(|()| fs::write(&target, data));
            if let Err(error) = written {
                failed = Some(InteropError::io(target, error));
                return Err(crate::onenote::Damage::new("a file could not be written"));
            }
            Ok(())
        })
        .map_err(|damage| {
            if damage.0 == crate::onenote::CAB_STOPPED {
                return InteropError::Canceled;
            }
            failed.take().unwrap_or_else(|| damaged(damage))
        })?;
    Ok(dir)
}

/// Finds the section files below a folder, in name order, each with its section name. Folders become section
/// groups, written `Group / Section`.
fn find_sections(
    root: &Path,
    dir: &Path,
    depth: usize,
    found: &mut Vec<(PathBuf, String)>,
    report: &mut Report,
) -> Result<()> {
    if dir.is_file() {
        found.push((dir.to_path_buf(), stem(dir)));
        return Ok(());
    }
    if depth > MAX_FOLDER_DEPTH {
        report.general.skipped(display(dir), "It is nested too deeply.");
        return Ok(());
    }
    let mut entries: Vec<_> = fs::read_dir(dir)
        .and_then(|iter| iter.collect::<std::io::Result<Vec<_>>>())
        .map_err(|e| InteropError::io(dir, e))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = entry.file_type().map_err(|e| InteropError::io(&path, e))?;
        if name.starts_with('.') || kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            if name == RECYCLE_BIN {
                report.general.skipped(name, "It holds deleted pages and sections.");
            } else if !name.ends_with("_onefiles") {
                find_sections(root, &path, depth + 1, found, report)?;
            }
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("one")) {
            if found.len() >= MAX_SECTIONS {
                report
                    .general
                    .skipped(name, "The notebook has more sections than OpenNote reads.");
                continue;
            }
            let shown = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let section = shown
                .rsplit_once('.')
                .map_or(shown.as_str(), |(s, _)| s)
                .replace('/', " / ");
            found.push((path, section));
        }
    }
    Ok(())
}

/// Reads a whole file of at most `cap` bytes.
pub(super) fn read_capped(path: &Path, cap: u64) -> std::result::Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("It could not be read ({e})."))?;
    if !meta.is_file() {
        return Err("It is not a file.".to_owned());
    }
    if meta.len() > cap {
        return Err(format!("It is larger than {} MB, the most OpenNote reads.", cap >> 20));
    }
    fs::read(path).map_err(|e| format!("It could not be read ({e})."))
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

fn notebook_title(path: &Path) -> String {
    let name = if path.is_dir() {
        path.file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    } else {
        stem(path)
    };
    if name.trim().is_empty() {
        "Imported notes".to_owned()
    } else {
        name
    }
}

fn display(path: &Path) -> String {
    path.file_name()
        .map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned())
}
