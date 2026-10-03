//! One entry point for imports: detect the source, unpack it, run the right importer, and report.
//!
//! The app calls [`import`] with a path and an [`ImportSink`], or [`preview`] for a dry run that writes nothing.
//! Both send progress events through the control in the [`ImportEnv`] and stop when it is canceled.

use std::collections::HashMap;
use std::path::Path;

use opennote_core::model::{NotebookFile, SectionFile};
use opennote_core::store::layout::NotebookLayout;
use opennote_core::{OrderKey, SectionId};
use serde::Serialize;

use crate::detect::{detect, prepare, Detected, SourceKind};
use crate::doc::parse::{parse, SoftBreaks};
use crate::error::{InteropError, Result};
use crate::import::{
    import_csv, import_docx_with, import_eml, import_enex, import_html_folder, import_keep_folder,
    import_markdown_folder, import_mht, import_pptx, import_sticky_notes, import_text_folder, import_textbundle_folder,
    import_xlsx, WordPages,
};
use crate::page_builder::PageBuilder;
use crate::report::{LossGroup, Report};
use crate::run::{Phase, Unit};
use crate::sink::{with_sink, ImportEnv, ImportSink, ImportedPage};
use crate::tree::SectionBuilder;

/// What to import and how.
#[derive(Clone, Copy, Debug, Default)]
pub struct ImportOptions {
    /// The kind of source, when the person chose it. `None` detects it.
    pub kind: Option<SourceKind>,
    /// How to cut Word files into pages.
    pub word_pages: WordPages,
    /// Whether to add an "Import report" page to the notebook that summarizes what was lost.
    pub report_page: bool,
}

/// Imports a file, folder, or ZIP archive into a new notebook and returns the report.
///
/// The control in `env` gets `Started`, progress events, and then `Finished`, `Canceled`, or `Failed`.
pub fn import(path: &Path, options: &ImportOptions, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    let what = format!(
        "Import from {}",
        path.file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    );
    env.control.run(
        &what,
        |report: &Report| report.pages.len() as u64,
        |_| run(path, options, env, sink),
    )
}

fn run(path: &Path, options: &ImportOptions, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    env.control.begin(Phase::Scanning, Unit::Items, None);
    let found = match options.kind {
        Some(kind) => Detected {
            kind,
            ..detect(path).unwrap_or_else(|_| fallback(kind))
        },
        None => detect(path)?,
    };
    if !found.supported || found.kind == SourceKind::OneNoteFile {
        let why = found
            .advice
            .unwrap_or_else(|| "This version cannot import it.".to_owned());
        return Err(InteropError::unsupported(found.label, why));
    }
    env.control.checkpoint()?;
    let prepared = prepare(path, &env.control)?;
    with_sink(sink, |sink| {
        let mut deferred = Deferred {
            inner: sink,
            last: None,
        };
        let mut report = dispatch(found.kind, &prepared.root, options, env, &mut deferred)?;
        for (name, why) in &prepared.skipped {
            report.general.skipped(name.clone(), why.clone());
        }
        if options.report_page {
            add_report_page(&report, env, deferred.last.as_ref(), deferred.inner)?;
        }
        Ok(report)
    })
}

fn fallback(kind: SourceKind) -> Detected {
    Detected {
        kind,
        label: kind.label().to_owned(),
        supported: true,
        zipped: false,
        advice: None,
    }
}

fn dispatch(
    kind: SourceKind,
    root: &Path,
    options: &ImportOptions,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    match kind {
        SourceKind::Markdown | SourceKind::Notion => import_markdown_folder(root, env, sink),
        SourceKind::Evernote => import_enex(root, env, sink),
        SourceKind::Word => import_docx_with(root, options.word_pages, env, sink),
        SourceKind::WebArchive => import_mht(root, env, sink),
        SourceKind::Html => import_html_folder(root, env, sink),
        SourceKind::Text => import_text_folder(root, env, sink),
        SourceKind::Csv => import_csv(root, env, sink),
        SourceKind::Spreadsheet => import_xlsx(root, env, sink),
        SourceKind::Presentation => import_pptx(root, env, sink),
        SourceKind::Email => import_eml(root, env, sink),
        SourceKind::GoogleKeep => import_keep_folder(root, env, sink),
        SourceKind::TextBundle => import_textbundle_folder(root, env, sink),
        SourceKind::StickyNotes => import_sticky_notes(root, env, sink),
        SourceKind::OneNoteFile => Err(InteropError::unsupported(
            kind.label(),
            "This version cannot import it.",
        )),
    }
}

/// Passes pages on to a sink but keeps `finish` and `abort` for the caller, so the caller can still add pages
/// after the importer is done.
struct Deferred<'a> {
    inner: &'a mut dyn ImportSink,
    /// The order key of the last section written, so a section added afterwards sorts after it.
    last: Option<OrderKey>,
}

impl ImportSink for Deferred<'_> {
    fn notebook(&mut self, notebook: NotebookFile) -> Result<()> {
        self.inner.notebook(notebook)
    }

    fn page(&mut self, section: SectionId, page: ImportedPage) -> Result<()> {
        self.inner.page(section, page)
    }

    fn section(&mut self, section: SectionFile) -> Result<()> {
        if self.last.as_ref().is_none_or(|last| section.order > *last) {
            self.last = Some(section.order.clone());
        }
        self.inner.section(section)
    }
}

/// Adds a last section with one page that summarizes the report.
fn add_report_page(
    report: &Report,
    env: &ImportEnv<'_>,
    after: Option<&OrderKey>,
    sink: &mut dyn ImportSink,
) -> Result<()> {
    let now = env.clock.now();
    let mut builder = PageBuilder::new(env, "Import report", now, now);
    builder.push_blocks(parse(&report.summary_markdown(40), SoftBreaks::Hard).blocks);
    let page = builder.finish()?;
    let mut section = SectionBuilder::new(env, "Import report", now);
    section.add_page(&page.page, None);
    sink.page(section.id(), page)?;
    let order = OrderKey::between(after, None).map_err(|e| InteropError::format("section order", e.to_string()))?;
    sink.section(section.finish(order)?)?;
    Ok(())
}

/// A dry run: what an import would bring in and what it would lose.
#[derive(Clone, Debug, Serialize)]
pub struct Preview {
    /// What the source is.
    pub detected: Detected,
    /// The name of the notebook the import would make.
    pub notebook_title: String,
    /// The sections, with how many pages each would hold.
    pub sections: Vec<PreviewSection>,
    /// How many pages in all.
    pub pages: usize,
    /// How many blocks of content in all.
    pub blocks: usize,
    /// How many pictures and files in all.
    pub assets: usize,
    /// How many bytes the pictures and files take.
    pub asset_bytes: u64,
    /// What would be simplified or skipped, grouped by reason, worst first.
    pub losses: Vec<LossGroup>,
    /// The full report, page by page.
    pub report: Report,
}

/// A section of a preview.
#[derive(Clone, Debug, Serialize)]
pub struct PreviewSection {
    /// The title.
    pub title: String,
    /// How many pages it would hold.
    pub pages: usize,
}

/// Reads the source the way [`import`] would, and keeps only what the person needs to decide: the sections,
/// the counts, and the losses. Nothing is written. A preview does the same work as an import, so a large source
/// takes as long, and it reports progress and honors Cancel the same way.
pub fn preview(path: &Path, options: &ImportOptions, env: &ImportEnv<'_>) -> Result<Preview> {
    let mut sink = PreviewSink::default();
    let detected = match options.kind {
        Some(kind) => fallback(kind),
        None => detect(path)?,
    };
    let what = format!(
        "Check {}",
        path.file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    );
    let report = env.control.run(
        &what,
        |report: &Report| report.pages.len() as u64,
        |_| run(path, options, env, &mut sink),
    )?;
    let losses = report.loss_groups();
    Ok(Preview {
        detected,
        notebook_title: sink.title,
        sections: sink.sections,
        pages: sink.pages,
        blocks: sink.blocks,
        assets: sink.assets,
        asset_bytes: sink.asset_bytes,
        losses,
        report,
    })
}

/// A sink that counts and forgets.
#[derive(Default)]
struct PreviewSink {
    title: String,
    pages_by_section: HashMap<SectionId, usize>,
    sections: Vec<PreviewSection>,
    pages: usize,
    blocks: usize,
    assets: usize,
    asset_bytes: u64,
}

impl ImportSink for PreviewSink {
    fn notebook(&mut self, notebook: NotebookFile) -> Result<()> {
        self.title = notebook.title;
        Ok(())
    }

    fn page(&mut self, section: SectionId, page: ImportedPage) -> Result<()> {
        // The same check the disk sink makes before it writes an asset, so a dry run fails where an import would.
        for asset in page.page.assets.values() {
            NotebookLayout::asset_path(Path::new(""), asset).map_err(|e| InteropError::Sink(e.to_string()))?;
        }
        *self.pages_by_section.entry(section).or_default() += 1;
        self.pages += 1;
        self.blocks += page.page.blocks.len();
        self.assets += page.asset_bytes.len();
        self.asset_bytes += page.asset_bytes.values().map(|b| b.len() as u64).sum::<u64>();
        Ok(())
    }

    fn section(&mut self, section: SectionFile) -> Result<()> {
        let pages = self.pages_by_section.remove(&section.id).unwrap_or(0);
        self.sections.push(PreviewSection {
            title: section.title,
            pages,
        });
        Ok(())
    }

    fn abort(&mut self) {
        *self = PreviewSink::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{png_bytes, TestEnv};

    #[test]
    fn a_dry_run_refuses_an_asset_name_the_disk_sink_would_refuse() {
        let world = TestEnv::new();
        let env = world.env();
        let now = env.clock.now();
        let mut builder = PageBuilder::new(&env, "Page", now, now);
        let id = builder.add_asset("leaf.png", None, png_bytes());
        builder.push_image(id, String::new());
        let mut page = builder.finish().expect("a page");
        let section = SectionId::generate(env.clock);
        PreviewSink::default()
            .page(section, page.clone())
            .expect("a good name passes");
        if let Some(asset) = page.page.assets.get_mut(&id) {
            asset.file = format!("{id}-\u{e23}\u{e39}.png");
        }
        assert!(PreviewSink::default().page(section, page).is_err());
    }
}
