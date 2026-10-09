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
    store::{
        assets::read_asset,
        fs::Fs,
        history::{list_versions, open_version},
        layout::NotebookLayout,
        std_fs::StdFs,
        PageFiles,
    },
    Clock, Limits, NotebookId, OrderKey, PageId, SectionId, SystemClock, Timings,
};
use opennote_interop::{
    page_builder::PageBuilder, Control, Exported, Format, ImportEnv, InteropError, NoteSource, PdfRenderer, Result,
    Scope, TableFormat,
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
    /// A folder of PDF files, which the interface printed page by page, with an index.
    Pdf,
    /// One PowerPoint file with a slide for each page, or part of a page.
    Pptx,
    /// One Excel workbook with a sheet for each table.
    Xlsx,
    /// One CSV file for a table, or a folder of them.
    Csv,
    /// One `.opennote` file that opens in OpenNote as a new notebook (ADR 0035), with a password if one is given.
    Share,
}

/// A password the person typed. It is never printed: its debug form hides it, so a logged request can't show it.
#[derive(Clone, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// The password, or `None` when it is empty.
    pub fn get(&self) -> Option<&str> {
        Some(self.0.as_str()).filter(|p| !p.is_empty())
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(..)")
    }
}

/// The longest password a shared file takes.
pub const MAX_PASSWORD_CHARS: usize = 1_024;

/// The most earlier versions of each page a shared file holds.
const HISTORY_PER_PAGE: usize = 20;

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
    /// A file sent earlier that this export replaces ("Update the copy"). Only the formats that make one file.
    #[serde(default)]
    pub replace: Option<String>,
    /// Share as a file: the password that locks the file.
    #[serde(default)]
    pub password: Option<Secret>,
    /// Share as a file: put each page's earlier versions in the file, as pages of a "Page history" section.
    #[serde(default)]
    pub history: bool,
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
    /// Earlier versions of pages, under IDs of their own. Their assets are read from `dirs`.
    versions: HashMap<PageId, Page>,
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
            versions: HashMap::new(),
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

    /// The earlier versions of the pages in `scope`, as one "Page history" section of a source of their own, each
    /// titled with its page and the time it was saved. The newest come first, at most [`HISTORY_PER_PAGE`] of each
    /// page, and the version that is the page as it is now is left out. `None` when no page has an earlier version.
    pub fn history_source(&self, scope: Scope) -> Result<Option<TreeSource>> {
        let clock = SystemClock::new();
        let now = clock.now();
        let mut history = TreeSource {
            fs: Arc::clone(&self.fs),
            codec: Arc::clone(&self.codec),
            limits: self.limits.clone(),
            notebook: self.notebook.clone(),
            sections: Vec::new(),
            dirs: HashMap::new(),
            empty: HashMap::new(),
            titles: HashMap::new(),
            versions: HashMap::new(),
        };
        let mut entries = Vec::new();
        for section in &self.sections {
            if matches!(scope, Scope::Section(id) if id != section.id) {
                continue;
            }
            for entry in &section.pages {
                if matches!(scope, Scope::Page(id) if id != entry.id) {
                    continue;
                }
                let Some(dir) = self.dirs.get(&entry.id) else { continue };
                for (id, page) in self.versions_of(entry, dir, &clock) {
                    history.dirs.insert(id, dir.clone());
                    entries.push(PageEntry {
                        id,
                        title: page.title.clone(),
                        parent: None,
                        order: entry.order.clone(),
                        pinned: false,
                        color: None,
                        changed: now,
                        moving: None,
                        extra: JsonMap::new(),
                    });
                    history.versions.insert(id, page);
                }
            }
        }
        if entries.is_empty() {
            return Ok(None);
        }
        let orders = OrderKey::spread(None, None, entries.len() + 1).map_err(|e| invalid("page order", e))?;
        let mut orders = orders.into_iter();
        for entry in &mut entries {
            entry.order = orders.next().ok_or_else(|| invalid("page order", "too few keys"))?;
        }
        let order = orders.next().ok_or_else(|| invalid("section order", "too few keys"))?;
        history.sections.push(SectionFile {
            id: SectionId::generate(&clock),
            title: "Page history".to_owned(),
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
        Ok(Some(history))
    }

    /// A page's earlier versions, newest first, each under a new ID and titled with its page and time. History is
    /// best effort: a list or a version that can't be read is left out.
    fn versions_of(&self, entry: &PageEntry, dir: &Path, clock: &SystemClock) -> Vec<(PageId, Page)> {
        let files = PageFiles {
            fs: self.fs.as_ref(),
            codec: self.codec.as_ref(),
            dir,
        };
        let Ok(list) = list_versions(&files, &self.limits) else {
            return Vec::new();
        };
        let current = self.page(entry.id).ok().map(|p| p.revision.id);
        let mut listed: Vec<_> = list
            .versions
            .into_iter()
            .filter(|v| Some(v.revision) != current)
            .collect();
        listed.sort_by_key(|v| std::cmp::Reverse(v.saved_at));
        let title = self.titles.get(&entry.id).unwrap_or(&entry.title);
        let mut out = Vec::new();
        for version in listed.into_iter().take(HISTORY_PER_PAGE) {
            let Ok(read) = open_version(&files, version.revision, &self.limits) else {
                continue;
            };
            let mut page = read.page;
            let id = PageId::generate(clock);
            let when = version.saved_at.to_rfc3339();
            let shown = when.get(..16).unwrap_or(&when).replace('T', " ");
            page.id = id;
            page.title = match &version.name {
                Some(name) => format!("{title} ({name}, {shown})"),
                None => format!("{title} ({shown})"),
            };
            out.push((id, page));
        }
        out
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
        if let Some(version) = self.versions.get(&id) {
            return Ok(version.clone());
        }
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

/// Runs the export the request names, into `folder`. With `replace`, the new file takes the place of that file.
/// A PDF export draws nothing here: it writes the pages that `pdf` holds, which the interface printed.
pub fn run(source: &TreeSource, request: &ExportRequest, pdf: &dyn PdfRenderer, control: &Control) -> Result<Exported> {
    let Some(target) = request.replace.as_deref().map(Path::new) else {
        return run_into(source, request, pdf, Path::new(&request.folder), control);
    };
    let parent = target
        .parent()
        .filter(|p| p.is_dir())
        .ok_or_else(|| InteropError::Missing("folder of the copy".to_owned()))?;
    // The export writes into a folder of its own beside the copy, so the copy changes only when the export is whole.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let staging = parent.join(format!(".opennote-update-{}-{stamp}", std::process::id()));
    std::fs::create_dir(&staging).map_err(|e| InteropError::io(&staging, e))?;
    let result = run_into(source, request, pdf, &staging, control).and_then(|mut exported| {
        let made = exported
            .files
            .first()
            .cloned()
            .ok_or_else(|| InteropError::Missing("file in the export".to_owned()))?;
        std::fs::rename(&made, target).map_err(|e| InteropError::io(target, e))?;
        exported.root = parent.to_path_buf();
        exported.files = vec![target.to_path_buf()];
        Ok(exported)
    });
    let _ = std::fs::remove_dir_all(&staging);
    result
}

fn run_into(
    source: &TreeSource,
    request: &ExportRequest,
    pdf: &dyn PdfRenderer,
    folder: &Path,
    control: &Control,
) -> Result<Exported> {
    let scope = source.scope(request.scope);
    match request.format {
        ExportFormat::Markdown => opennote_interop::export_files_with(source, scope, Format::Markdown, folder, control),
        ExportFormat::Html => opennote_interop::export_files_with(source, scope, Format::Html, folder, control),
        ExportFormat::HtmlSingle => opennote_interop::export_html_single(source, scope, folder, control),
        ExportFormat::Docx => opennote_interop::export_docx_with(source, scope, folder, control),
        ExportFormat::Pdf => opennote_interop::export_pdf_bundle(source, scope, pdf, folder, control),
        ExportFormat::Pptx => opennote_interop::export_pptx(source, scope, folder, control),
        ExportFormat::Xlsx => opennote_interop::export_tables(source, scope, TableFormat::Xlsx, folder, control),
        ExportFormat::Csv => opennote_interop::export_tables(source, scope, TableFormat::Csv, folder, control),
        ExportFormat::Share => {
            let password = request.password.as_ref().and_then(Secret::get);
            if password.is_some_and(|p| p.chars().count() > MAX_PASSWORD_CHARS) {
                return Err(InteropError::unsupported("password", "That password is too long."));
            }
            let history = if request.history {
                source.history_source(scope)?
            } else {
                None
            };
            let history = history.as_ref().map(|h| h as &dyn NoteSource);
            opennote_interop::export_share_with(source, scope, password, history, folder, control)
        }
    }
}
