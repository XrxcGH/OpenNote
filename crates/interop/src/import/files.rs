//! Importing a set of document files, such as the Word or web page exports of a OneNote notebook.
//!
//! Each file becomes a section, named after the file, and the pages cut from it become the section's pages. A
//! [`FileConverter`] reads one file. The driver finds the files, runs the converter on each, and writes the
//! notebook, checking for Cancel between files.

use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::NotebookFile;
use opennote_core::NotebookId;

use crate::error::{InteropError, Result};
use crate::report::{Entry, PageReport, Report, ReportKind};
use crate::run::{Phase, Unit};
use crate::sink::{with_sink, ImportEnv, ImportSink, ImportedPage};
use crate::tree::{section_orders, SectionBuilder};

/// A page a converter made, with its report.
pub(super) struct ConvertedPage {
    /// The section it belongs to, when the file names one. Pages without one go to the file's own section.
    pub section: Option<String>,
    /// The page and its assets.
    pub page: ImportedPage,
    /// What came over and what did not.
    pub report: PageReport,
}

/// What a converter made from one file.
pub(super) struct Converted {
    /// The pages.
    pub pages: Vec<ConvertedPage>,
    /// Entries about the file as a whole.
    pub general: Vec<Entry>,
}

/// Reads one kind of document file.
pub(super) trait FileConverter {
    /// What the report calls the source, such as `Word documents`.
    fn label(&self) -> &'static str;

    /// The extensions of the files it reads, in lowercase and without the dot.
    fn extensions(&self) -> &'static [&'static str];

    /// Reads a file into pages.
    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted>;
}

/// Imports a file, or every matching file below a folder, into a new notebook.
pub(super) fn import_files(
    root: &Path,
    converter: &dyn FileConverter,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    with_sink(sink, |sink| run(root, converter, env, sink))
}

fn run(root: &Path, converter: &dyn FileConverter, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    env.control.begin(Phase::Scanning, Unit::Items, None);
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    find_files(root, root, converter.extensions(), &mut files, &mut skipped)?;
    if files.is_empty() {
        let what = converter.label();
        return Err(InteropError::format(
            root.display().to_string(),
            format!("no {what} were found"),
        ));
    }
    env.control
        .begin(Phase::Converting, Unit::Items, Some(files.len() as u64));
    let title = notebook_title(root);
    let mut report = Report::new(ReportKind::Import, format!("{} \"{title}\"", converter.label()));
    for (name, why) in skipped {
        report.general.skipped(name, why);
    }
    let now = env.clock.now();
    sink.notebook(NotebookFile::new(NotebookId::generate(env.clock), title.clone(), now))?;
    let mut sections = Sections {
        env,
        now,
        list: Vec::new(),
    };
    for (file_index, (path, section_name)) in files.iter().enumerate() {
        env.control.checkpoint()?;
        let file_section = if section_name.is_empty() {
            title.clone()
        } else {
            section_name.clone()
        };
        let shown = display(root, path);
        match converter.convert(path, env) {
            Ok(done) => {
                for made in done.pages {
                    let name = made.section.unwrap_or_else(|| file_section.clone());
                    let section = sections.builder(file_index, name);
                    section.add_page(&made.page.page, None);
                    sink.page(section.id(), made.page)?;
                    report.add_page(made.report);
                }
                report.general.entries.extend(done.general);
            }
            Err(InteropError::Canceled) => return Err(InteropError::Canceled),
            Err(error) => report.general.skipped(shown.clone(), error.to_string()),
        }
        env.control.step(Phase::Converting, 1, &shown);
    }
    let orders = section_orders(sections.list.len())?;
    for ((_, section), order) in sections.list.into_iter().zip(orders) {
        sink.section(section.finish(order)?)?;
    }
    Ok(report)
}

/// The sections made so far, each named for a file and a section name.
struct Sections<'a, 'e> {
    env: &'a ImportEnv<'e>,
    now: opennote_core::Timestamp,
    list: Vec<((usize, String), SectionBuilder)>,
}

impl Sections<'_, '_> {
    /// The builder of the section with this name for a file, started if it is new.
    fn builder(&mut self, file: usize, name: String) -> &mut SectionBuilder {
        let key = (file, name);
        let index = match self.list.iter().position(|(k, _)| *k == key) {
            Some(index) => index,
            None => {
                let builder = SectionBuilder::new(self.env, &key.1, self.now);
                self.list.push((key, builder));
                self.list.len() - 1
            }
        };
        &mut self.list[index].1
    }
}

fn notebook_title(root: &Path) -> String {
    let part = if root.is_file() {
        root.file_stem()
    } else {
        root.file_name()
    };
    let name = part.map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    if name.trim().is_empty() {
        "Imported notes".to_owned()
    } else {
        name
    }
}

fn display(root: &Path, path: &Path) -> String {
    let base = if root.is_file() {
        root.parent().unwrap_or(root)
    } else {
        root
    };
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Finds the files with the extensions, in path order, each with the name of its section: the file name without
/// its extension, after the folders above it.
fn find_files(
    root: &Path,
    dir: &Path,
    extensions: &[&str],
    found: &mut Vec<(PathBuf, String)>,
    skipped: &mut Vec<(String, String)>,
) -> Result<()> {
    if root.is_file() {
        found.push((root.to_path_buf(), String::new()));
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
        if name.starts_with('.') || name.starts_with("~$") {
            continue;
        }
        if kind.is_symlink() {
            skipped.push((
                display(root, &path),
                "It is a link, and imports do not follow links.".to_owned(),
            ));
        } else if kind.is_dir() {
            find_files(root, &path, extensions, found, skipped)?;
        } else if path
            .extension()
            .is_some_and(|e| extensions.iter().any(|x| e.eq_ignore_ascii_case(x)))
        {
            let shown = display(root, &path);
            let section = shown
                .rsplit_once('.')
                .map_or(shown.as_str(), |(stem, _)| stem)
                .replace('/', " / ");
            found.push((path, section));
        }
    }
    Ok(())
}
