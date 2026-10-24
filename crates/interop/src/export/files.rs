//! Writing an export as a folder of Markdown or HTML files with its assets.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::{Asset, Page};
use opennote_core::PageId;

use super::convert::{page_to_blocks, Resolver};
use super::names::{relative_path, sanitize_name, Namer};
use super::plan::{self, Plan, PlannedPage, Scope};
use crate::doc::write::to_markdown;
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;
use crate::{frontmatter, html};

/// The kind of file an export writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// Markdown with front matter: `title`, `created`, `updated`, and `tags`.
    Markdown,
    /// HTML pages, with an index page for sections and notebooks.
    Html,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Markdown => "md",
            Format::Html => "html",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Format::Markdown => "Markdown",
            Format::Html => "HTML",
        }
    }
}

/// What an export wrote.
#[derive(Debug)]
pub struct Exported {
    /// The new folder that holds the export.
    pub root: PathBuf,
    /// The files written, in order.
    pub files: Vec<PathBuf>,
    /// What came over, what was simplified, and what was skipped.
    pub report: Report,
}

/// Exports pages to a new folder inside `out_dir`.
pub fn export_files(source: &dyn NoteSource, scope: Scope, format: Format, out_dir: &Path) -> Result<Exported> {
    export_files_with(source, scope, format, out_dir, &Control::none())
}

/// Exports pages to a new folder inside `out_dir`, reporting progress and stopping when the control is
/// canceled. A canceled export deletes the folder it made.
pub fn export_files_with(
    source: &dyn NoteSource,
    scope: Scope,
    format: Format,
    out_dir: &Path,
    control: &Control,
) -> Result<Exported> {
    let plan = plan::build(source, scope, format.extension())?;
    let root = new_folder(out_dir, &plan.title)?;
    let result = write_pages(source, scope, format, &plan, &root, control);
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

fn write_pages(
    source: &dyn NoteSource,
    scope: Scope,
    format: Format,
    plan: &Plan,
    root: &Path,
    control: &Control,
) -> Result<Exported> {
    let label = format!("{} as {}", plan.title, format.label());
    let mut run = Run::new(plan);
    let mut exported = Exported {
        root: root.to_path_buf(),
        files: Vec::new(),
        report: Report::new(ReportKind::Export, label),
    };
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    for planned in &plan.pages {
        control.checkpoint()?;
        match export_page(source, planned, format, root, &mut run) {
            Ok((path, report)) => {
                exported.files.push(path);
                exported.report.add_page(report);
            }
            Err(error) => {
                exported
                    .report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
            }
        }
        control.step(Phase::Writing, 1, &planned.title);
    }
    if format == Format::Html && !matches!(scope, Scope::Page(_)) {
        let entries: Vec<_> = plan
            .pages
            .iter()
            .map(|p| (p.path().join("/"), p.title.clone(), p.level))
            .collect();
        let index = root.join("index.html");
        write_file(&index, html::index_document(&plan.title, &entries).as_bytes())?;
        exported.files.push(index);
    }
    Ok(exported)
}

/// Creates `out_dir/<name>`, or `out_dir/<name> (2)` and so on, so nothing is overwritten.
pub(super) fn new_folder(out_dir: &Path, title: &str) -> Result<PathBuf> {
    let name = sanitize_name(title, "OpenNote export");
    let mut candidate = out_dir.join(&name);
    let mut n = 2;
    while candidate.exists() {
        candidate = out_dir.join(format!("{name} ({n})"));
        n += 1;
    }
    fs::create_dir_all(&candidate).map_err(|e| InteropError::io(&candidate, e))?;
    Ok(candidate)
}

pub(super) fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| InteropError::io(parent, e))?;
    }
    fs::write(path, bytes).map_err(|e| InteropError::io(path, e))
}

fn export_page(
    source: &dyn NoteSource,
    planned: &PlannedPage,
    format: Format,
    root: &Path,
    run: &mut Run,
) -> Result<(PathBuf, PageReport)> {
    let page = source.page(planned.id)?;
    let mut report = PageReport {
        title: page.title.clone(),
        source: String::new(),
        entries: Vec::new(),
    };
    run.dir = planned.dir.clone();
    let blocks = page_to_blocks(&page, run, &mut report);
    let body = match format {
        Format::Markdown => {
            let head = frontmatter::write(&page.title, page.created, page.modified, &page.tags);
            format!("{head}{}\n", to_markdown(&blocks))
        }
        Format::Html => {
            let meta = html::Meta {
                created: Some(page.created),
                modified: Some(page.modified),
                tags: &page.tags,
                index: false,
            };
            html::page_document(&page.title, &meta, &html::blocks_to_html(&blocks))
        }
    };
    let path = planned
        .path()
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part));
    write_file(&path, body.as_bytes())?;
    run.copy_assets(source, &page, root, &mut report)?;
    Ok((path, report))
}

/// The state of one export: names handed out so far, and the assets that still need copying.
struct Run {
    dir: Vec<String>,
    pages: HashMap<PageId, Vec<String>>,
    asset_names: HashMap<opennote_core::AssetId, String>,
    namer: Namer,
    pending: Vec<(Asset, String)>,
    /// Files the export made itself, such as the picture of a page's handwriting, with their names.
    generated: Vec<(String, Vec<u8>)>,
}

impl Run {
    fn new(plan: &Plan) -> Run {
        Run {
            dir: Vec::new(),
            pages: plan.pages.iter().map(|p| (p.id, p.path())).collect(),
            asset_names: HashMap::new(),
            namer: Namer::default(),
            pending: Vec::new(),
            generated: Vec::new(),
        }
    }

    fn copy_assets(
        &mut self,
        source: &dyn NoteSource,
        page: &Page,
        root: &Path,
        report: &mut PageReport,
    ) -> Result<()> {
        for (name, bytes) in std::mem::take(&mut self.generated) {
            write_file(&root.join("assets").join(&name), &bytes)?;
        }
        for (asset, name) in std::mem::take(&mut self.pending) {
            match source.asset_bytes(page, &asset) {
                Ok(bytes) => write_file(&root.join("assets").join(&name), &bytes)?,
                Err(error) => report.skipped(format!("the file {name}"), error.to_string()),
            }
        }
        Ok(())
    }
}

impl Resolver for Run {
    fn asset(&mut self, _page: &Page, asset: &Asset) -> Option<String> {
        let name = match self.asset_names.get(&asset.id) {
            Some(name) => name.clone(),
            None => {
                let original = if asset.name.is_empty() {
                    &asset.file
                } else {
                    &asset.name
                };
                let (stem, extension) = original.rsplit_once('.').unwrap_or((original, ""));
                let name = self
                    .namer
                    .unique(&sanitize_name(stem, "file"), &sanitize_name(extension, ""));
                self.asset_names.insert(asset.id, name.clone());
                self.pending.push((asset.clone(), name.clone()));
                name
            }
        };
        Some(relative_path(&self.dir, &["assets".to_owned(), name]))
    }

    fn page(&mut self, _from: PageId, to: PageId) -> Option<String> {
        self.pages.get(&to).map(|path| relative_path(&self.dir, path))
    }

    fn ink(&mut self, page: &Page, svg: Vec<u8>) -> Option<String> {
        let stem = sanitize_name(&format!("{} handwriting", page.title), "handwriting");
        let name = self.namer.unique(&stem, "svg");
        self.generated.push((name.clone(), svg));
        Some(relative_path(&self.dir, &["assets".to_owned(), name]))
    }
}
