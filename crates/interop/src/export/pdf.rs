//! Exporting to a bundle of PDF files: one PDF for each page, in folders that follow the notebook.
//!
//! This module does everything except draw. It plans the folders and file names, asks a [`PdfRenderer`] for the
//! bytes of each page, writes an `index.html` that links the files, reports page by page, and stops when the
//! person cancels. The drawing is Phase 6's: the app prints each page in its hidden print window (ADR 0006) and
//! hands the files over, and [`PreparedPdfRenderer`] serves them here. [`NoPdfRenderer`] is for hosts that cannot
//! draw at all, and the export then says so before it makes anything.

use std::collections::HashMap;

use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::Page;
use opennote_core::PageId;

use super::files::{new_folder, write_file, Exported};
use super::plan::{self, Scope};
use crate::error::{InteropError, Result};
use crate::html;
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;

/// Draws pages as PDF. The app implements it with the Phase 6 PDF writer.
pub trait PdfRenderer {
    /// Whether this renderer can draw at all. A bundle export checks this before it creates anything.
    fn available(&self) -> bool {
        true
    }

    /// Draws one page and returns the bytes of its PDF file. The renderer reads the page's pictures and ink
    /// through `source`, and notes anything it simplified in `report`.
    fn render_page(&self, page: &Page, source: &dyn NoteSource, report: &mut PageReport) -> Result<Vec<u8>>;
}

/// The renderer to use while no PDF writer is available.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoPdfRenderer;

impl PdfRenderer for NoPdfRenderer {
    fn available(&self) -> bool {
        false
    }

    fn render_page(&self, _page: &Page, _source: &dyn NoteSource, _report: &mut PageReport) -> Result<Vec<u8>> {
        Err(unavailable())
    }
}

/// The renderer for pages the app has already drawn: the PDF file of each page, by page ID. A page without one, or
/// with bytes that are not a PDF file, is skipped and reported, and the rest still export.
#[derive(Clone, Debug, Default)]
pub struct PreparedPdfRenderer {
    pages: HashMap<PageId, Vec<u8>>,
}

impl PreparedPdfRenderer {
    /// A renderer that serves these files.
    pub fn new(pages: HashMap<PageId, Vec<u8>>) -> PreparedPdfRenderer {
        PreparedPdfRenderer { pages }
    }

    /// Whether the renderer holds the file of a page.
    pub fn has_page(&self, id: PageId) -> bool {
        self.pages.contains_key(&id)
    }

    /// Whether the file looks like a PDF file: it starts with `%PDF-` and ends with an `%%EOF` marker near its end.
    pub fn looks_like_pdf(bytes: &[u8]) -> bool {
        let tail = &bytes[bytes.len().saturating_sub(1024)..];
        bytes.starts_with(b"%PDF-") && tail.windows(5).any(|w| w == b"%%EOF")
    }
}

impl PdfRenderer for PreparedPdfRenderer {
    fn render_page(&self, page: &Page, _source: &dyn NoteSource, _report: &mut PageReport) -> Result<Vec<u8>> {
        let bytes = self
            .pages
            .get(&page.id)
            .ok_or_else(|| InteropError::Missing("the drawn page, as it could not be printed".to_owned()))?;
        if !Self::looks_like_pdf(bytes) {
            return Err(InteropError::format("PDF", "the printed page is not a whole PDF file"));
        }
        Ok(bytes.clone())
    }
}

fn unavailable() -> InteropError {
    InteropError::unsupported(
        "PDF export",
        "This copy of OpenNote can't draw pages as PDF. Export to HTML or Markdown instead.",
    )
}

/// Exports to a new folder inside `out_dir`. A page that fails is skipped and reported, and the rest still
/// export. A canceled export deletes the folder it made.
pub fn export_pdf_bundle(
    source: &dyn NoteSource,
    scope: Scope,
    renderer: &dyn PdfRenderer,
    out_dir: &Path,
    control: &Control,
) -> Result<Exported> {
    if !renderer.available() {
        return Err(unavailable());
    }
    let plan = plan::build(source, scope, "pdf")?;
    let root = new_folder(out_dir, &plan.title)?;
    let result = write_bundle(source, scope, renderer, &plan, &root, control);
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

fn write_bundle(
    source: &dyn NoteSource,
    scope: Scope,
    renderer: &dyn PdfRenderer,
    plan: &plan::Plan,
    root: &Path,
    control: &Control,
) -> Result<Exported> {
    let mut exported = Exported {
        root: root.to_path_buf(),
        files: Vec::new(),
        report: Report::new(ReportKind::Export, format!("{} as PDF", plan.title)),
    };
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let mut written: Vec<(String, String, u8)> = Vec::new();
    for planned in &plan.pages {
        control.checkpoint()?;
        let mut report = PageReport {
            title: planned.title.clone(),
            ..PageReport::default()
        };
        let outcome = source
            .page(planned.id)
            .and_then(|page| renderer.render_page(&page, source, &mut report));
        match outcome {
            Ok(bytes) => {
                let path: PathBuf = planned.path().iter().fold(root.to_path_buf(), |p, part| p.join(part));
                write_file(&path, &bytes)?;
                report.came_over("PDF file");
                written.push((planned.path().join("/"), planned.title.clone(), planned.level));
                exported.files.push(path);
                exported.report.add_page(report);
            }
            Err(InteropError::Canceled) => return Err(InteropError::Canceled),
            Err(error) => {
                exported
                    .report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
            }
        }
        control.step(Phase::Writing, 1, &planned.title);
    }
    if !matches!(scope, Scope::Page(_)) {
        let index = root.join("index.html");
        write_file(&index, html::index_document(&plan.title, &written).as_bytes())?;
        exported.files.push(index);
    }
    Ok(exported)
}
