//! Exports: the interface's tree of a notebook or section, read from the pages of the core's notebooks.
//!
//! The interface sends the sections and pages it shows, and `TreeSource` answers the interop crate's `NoteSource`
//! from them: the tree gives the structure and the titles, and each page's files give its content. The page IDs
//! the interface sends are the core's, so each page is found in whichever open notebook holds it. A page that has
//! no files to read exports as an empty page with its title.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use opennote_core::{
    format::CanonicalCodec,
    model::{Asset, FormatInfo, JsonMap, NotebookFile, Page, PageEntry, SectionFile},
    seams::Codec,
    session::{notebook::NotebookHandle, page::read_page_dir},
    store::{assets::read_asset, fs::Fs, layout::NotebookLayout, std_fs::StdFs},
    Clock, Limits, NotebookId, OrderKey, PageId, SectionId, SystemClock, Timings,
};
use opennote_interop::{
    page_builder::PageBuilder, Control, Exported, Format, ImportEnv, InteropError, NoPdfRenderer, NoteSource, Result,
    Scope,
};
use serde::Deserialize;

use crate::core_bridge::Bridge;

/// Which files an export writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    /// A folder of Markdown files.
    Markdown,
    /// A folder of web pages with an index.
    Html,
    /// One web page file.
    HtmlSingle,
    /// One Word file.
    Docx,
    /// A folder of PDF files (needs the PDF writer of Phase 6).
    Pdf,
}

/// What the person exports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportScope {
    Notebook,
    Section,
    /// One page, sent as the only page of the only section.
    Page,
}

/// A page of the interface's tree.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportPage {
    /// The page's ID in the tree, which is the core's.
    pub ui: String,
    pub title: String,
    /// 0 for a page, 1 and 2 for subpages.
    pub level: u8,
}

/// A section of the interface's tree.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportSection {
    pub title: String,
    pub pages: Vec<ExportPage>,
}

/// What the interface asks for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub format: ExportFormat,
    pub scope: ExportScope,
    /// The notebook's title.
    pub title: String,
    /// All the notebook's sections, or just the one that is exported.
    pub sections: Vec<ExportSection>,
    /// The folder the export goes into.
    pub folder: String,
}

/// The notebook, sections, and pages of an export, read from the bridge's page files.
pub struct TreeSource {
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
    limits: Limits,
    notebook: NotebookFile,
    sections: Vec<SectionFile>,
    /// The folder of each page that has files.
    dirs: HashMap<PageId, PathBuf>,
    /// Pages with no files yet.
    empty: HashMap<PageId, Page>,
    /// The title the interface shows for each page. It wins over the title inside the page.
    titles: HashMap<PageId, String>,
}

/// The folder of every page in a notebook.
fn page_dirs(handle: &NotebookHandle) -> HashMap<PageId, PathBuf> {
    let layout = NotebookLayout::new(handle.path());
    let mut dirs = HashMap::new();
    for section in handle.tree().sections {
        for page in section.pages {
            dirs.insert(page.id, layout.page_dir(section.id, page.id));
        }
    }
    dirs
}

fn invalid(what: &str, error: impl std::fmt::Display) -> InteropError {
    InteropError::format(what, error.to_string())
}

impl TreeSource {
    /// Reads the tree the interface sent. Call after the core has saved its open pages.
    pub fn build(bridge: &Bridge, request: &ExportRequest) -> Result<TreeSource> {
        let clock = SystemClock::new();
        let now = clock.now();
        let env = ImportEnv::new(&clock, bridge.core.device());
        let fs: Arc<dyn Fs> = Arc::new(StdFs::new(&Timings::default()));
        let mut notebook_dirs: HashMap<PathBuf, HashMap<PageId, PathBuf>> = HashMap::new();
        let mut source = TreeSource {
            fs,
            codec: Arc::new(CanonicalCodec),
            limits: Limits::default(),
            notebook: NotebookFile::new(NotebookId::generate(&clock), request.title.clone(), now),
            sections: Vec::new(),
            dirs: HashMap::new(),
            empty: HashMap::new(),
            titles: HashMap::new(),
        };
        let orders = OrderKey::spread(None, None, request.sections.len()).map_err(|e| invalid("section order", e))?;
        for (section, order) in request.sections.iter().zip(orders) {
            let page_orders =
                OrderKey::spread(None, None, section.pages.len()).map_err(|e| invalid("page order", e))?;
            let mut entries = Vec::with_capacity(section.pages.len());
            // The last page at each level, so a subpage finds its parent.
            let mut last: [Option<PageId>; 3] = [None; 3];
            let mut previous_level = 0u8;
            for (page, page_order) in section.pages.iter().zip(page_orders) {
                let level = page.level.min(2).min(previous_level.saturating_add(1));
                let known = PageId::parse(&page.ui).ok();
                let dir = known.and_then(|id| {
                    let (notebook, _) = bridge.core.find_node(id.0)?;
                    notebook_dirs
                        .entry(notebook.path().to_path_buf())
                        .or_insert_with(|| page_dirs(&notebook))
                        .get(&id)
                        .cloned()
                });
                let id = match (known, dir) {
                    (Some(id), Some(dir)) => {
                        source.dirs.insert(id, dir);
                        id
                    }
                    _ => {
                        let id = PageId::generate(&clock);
                        let built = PageBuilder::with_id(&env, id, &page.title, now, now).finish()?;
                        source.empty.insert(id, built.page);
                        id
                    }
                };
                if !page.title.trim().is_empty() {
                    source.titles.insert(id, page.title.clone());
                }
                let parent = if level == 0 { None } else { last[usize::from(level) - 1] };
                last[usize::from(level)] = Some(id);
                previous_level = level;
                entries.push(PageEntry {
                    id,
                    title: page.title.clone(),
                    parent,
                    order: page_order,
                    pinned: false,
                    color: None,
                    changed: now,
                    moving: None,
                    extra: JsonMap::new(),
                });
            }
            source.sections.push(SectionFile {
                id: SectionId::generate(&clock),
                title: section.title.clone(),
                color: None,
                group: None,
                order,
                created: now,
                changed: now,
                defaults: None,
                encryption: None,
                pages: entries,
                extra: JsonMap::new(),
                format: FormatInfo::default(),
            });
        }
        Ok(source)
    }

    /// What the export covers: the first page or section that was sent, else the whole notebook.
    pub fn scope(&self, scope: ExportScope) -> Scope {
        match (scope, self.sections.first()) {
            (ExportScope::Section, Some(section)) => Scope::Section(section.id),
            (ExportScope::Page, Some(section)) => section
                .pages
                .first()
                .map_or(Scope::Section(section.id), |entry| Scope::Page(entry.id)),
            _ => Scope::Notebook,
        }
    }
}

impl NoteSource for TreeSource {
    fn notebook(&self) -> &NotebookFile {
        &self.notebook
    }

    fn sections(&self) -> &[SectionFile] {
        &self.sections
    }

    fn page(&self, id: PageId) -> Result<Page> {
        let mut page = match (self.dirs.get(&id), self.empty.get(&id)) {
            (Some(dir), _) => read_page_dir(self.fs.as_ref(), self.codec.as_ref(), dir, &self.limits)
                .map(|loaded| loaded.page)
                .map_err(|e| invalid(&format!("page {id}"), format!("{e:?}")))?,
            (None, Some(page)) => page.clone(),
            (None, None) => return Err(InteropError::Missing(format!("page {id}"))),
        };
        if let Some(title) = self.titles.get(&id) {
            page.title.clone_from(title);
        }
        Ok(page)
    }

    fn asset_bytes(&self, page: &Page, asset: &Asset) -> Result<Vec<u8>> {
        let dir = self
            .dirs
            .get(&page.id)
            .ok_or_else(|| InteropError::Missing(format!("files of page {}", page.id)))?;
        read_asset(self.fs.as_ref(), dir, asset, None).map_err(|e| invalid("asset", e))
    }
}

/// Runs the export the request names, into `folder`.
pub fn run(source: &TreeSource, request: &ExportRequest, control: &Control) -> Result<Exported> {
    let scope = source.scope(request.scope);
    let folder = Path::new(&request.folder);
    match request.format {
        ExportFormat::Markdown => opennote_interop::export_files_with(source, scope, Format::Markdown, folder, control),
        ExportFormat::Html => opennote_interop::export_files_with(source, scope, Format::Html, folder, control),
        ExportFormat::HtmlSingle => opennote_interop::export_html_single(source, scope, folder, control),
        ExportFormat::Docx => opennote_interop::export_docx_with(source, scope, folder, control),
        ExportFormat::Pdf => opennote_interop::export_pdf_bundle(source, scope, &NoPdfRenderer, folder, control),
    }
}
