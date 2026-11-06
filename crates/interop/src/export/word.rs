//! Exporting to a Word file: one `.docx` for a page, a section, or a notebook.
//!
//! Each page is a section of the document with its own paper, header, and footer. Text blocks bring their
//! paragraph formatting, lists, notes, comments, and suggestions; the notebook's styles and theme become the
//! document's (ADR 0083).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use opennote_core::model::{Asset, BlockData, Named, Orientation, Page};
use opennote_core::{BlockId, PageId, Timestamp};
use serde_json::{Map, Value};

use super::convert::{page_to_document, Resolver};
use super::files::Exported;
use super::names::sanitize_name;
use super::plan::{self, PlannedPage, Scope};
use crate::assets::image_size;
use crate::doc::Block as DocBlock;
use crate::docx::{
    self, sheet_from_json, Band, BandFields, Bands, Media, PageSetup, Part, Setup, StyleSheet, TextSettings, Theme,
    WordInput, WordOptions,
};
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;

/// Exports to `out_dir/<title>.docx`, or `out_dir/<title> (2).docx` and so on, so nothing is overwritten.
pub fn export_docx(source: &dyn NoteSource, scope: Scope, out_dir: &Path) -> Result<Exported> {
    export_docx_with(source, scope, out_dir, &Control::none())
}

/// Exports to a Word file. It reports progress, and it stops when the control is canceled. Nothing is written
/// until every page has been read, so a canceled export leaves no file.
pub fn export_docx_with(source: &dyn NoteSource, scope: Scope, out_dir: &Path, control: &Control) -> Result<Exported> {
    export_docx_options(source, scope, out_dir, control, &WordOptions::default())
}

/// Exports to a Word file with choices: the device's font faces, fonts to embed, and whether personal
/// information is removed.
pub fn export_docx_options(
    source: &dyn NoteSource,
    scope: Scope,
    out_dir: &Path,
    control: &Control,
    options: &WordOptions,
) -> Result<Exported> {
    let plan = plan::build(source, scope, "docx")?;
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let mut resolver = WordResolver {
        source,
        pages: plan.pages.iter().map(|p| p.id).collect(),
        media: HashMap::new(),
        unsupported: Vec::new(),
        attachments: 0,
    };
    let mut report = Report::new(ReportKind::Export, format!("{} as Word", plan.title));
    let notebook = source.notebook();
    let mut body = Body {
        notebook: notebook.title.clone(),
        ..Body::default()
    };
    let mut page_sheets: Vec<StyleSheet> = Vec::new();
    let mut page_theme: Option<Map<String, Value>> = None;
    for planned in &plan.pages {
        control.checkpoint()?;
        control.step(Phase::Writing, 1, &planned.title);
        match source.page(planned.id) {
            Ok(page) => {
                let mut page_report = PageReport {
                    title: page.title.clone(),
                    ..PageReport::default()
                };
                let document = page_to_document(&page, &mut resolver, &mut page_report);
                report.add_page(page_report);
                if let Some(styles) = page.extra.get("styles") {
                    page_sheets.push(sheet_from_json(styles));
                }
                if page_theme.is_none() {
                    page_theme = page.extra.get("theme").and_then(Value::as_object).cloned();
                }
                body.add(planned, &page, document, scope == Scope::Notebook);
            }
            Err(error) => {
                report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
            }
        }
    }
    resolver.describe(&mut report);
    // A page's own style sheet and theme apply when it is the only page. Word has one set of styles per file, so
    // an export of several pages uses the notebook's.
    let single = plan.pages.len() == 1;
    let notebook_sheet: StyleSheet = notebook
        .styles
        .iter()
        .filter_map(|(name, spec)| Some((name.clone(), serde_json::to_value(spec).ok()?.as_object()?.clone())))
        .collect();
    let mut styles = notebook_sheet;
    if single {
        for sheet in &page_sheets {
            styles = docx::merge_styles(styles, &[sheet]);
        }
    } else if !page_sheets.is_empty() {
        report.general.simplified(
            "page style sheets".to_owned(),
            "Word files hold one set of styles, so the notebook's styles are used.",
        );
    }
    let mut theme = Theme::default();
    if let Some(notebook_theme) = notebook.extra.get("theme").and_then(Value::as_object) {
        theme.read(notebook_theme);
    }
    if let (true, Some(page_theme)) = (single, &page_theme) {
        theme.read(page_theme);
    }
    let input = WordInput {
        title: plan.title.clone(),
        created: body.created.unwrap_or(Timestamp::EPOCH),
        modified: body.modified.unwrap_or(Timestamp::EPOCH),
        parts: body.parts,
        media: resolver.media,
        setup: Setup {
            styles,
            theme,
            text: body.text.unwrap_or_default(),
            options: options.clone(),
        },
    };
    let bytes = docx::build(&input)?;
    let path = unique_file(out_dir, &plan.title)?;
    fs::write(&path, bytes).map_err(|e| InteropError::io(&path, e))?;
    Ok(Exported {
        root: out_dir.to_path_buf(),
        files: vec![path],
        report,
    })
}

/// The body of the document so far, and the dates it covers.
#[derive(Default)]
struct Body {
    parts: Vec<Part>,
    created: Option<Timestamp>,
    modified: Option<Timestamp>,
    last_section: Option<String>,
    notebook: String,
    /// The text settings of the first page.
    text: Option<TextSettings>,
}

impl Body {
    /// Adds a page as a section of its own, with its section's name when that changes.
    fn add(&mut self, planned: &PlannedPage, page: &Page, document: super::Document, show_section: bool) {
        if show_section && self.last_section.as_deref() != Some(planned.section.as_str()) {
            self.parts.push(Part::Subtitle(planned.section.clone()));
            self.last_section = Some(planned.section.clone());
        }
        self.parts.push(Part::Title {
            text: page.title.clone(),
            bookmark: Some(bookmark(page.id)),
        });
        self.parts.extend(page_parts(page, document));
        self.parts.push(Part::Section {
            setup: Box::new(page_setup(page)),
            fields: BandFields {
                title: page.title.clone(),
                notebook: self.notebook.clone(),
                section: planned.section.clone(),
            },
        });
        if self.text.is_none() {
            self.text = Some(text_settings(page));
        }
        self.created = Some(self.created.map_or(page.created, |t| t.min(page.created)));
        self.modified = Some(self.modified.map_or(page.modified, |t| t.max(page.modified)));
    }
}

/// The parts of a page: each text block's blocks with its records, break blocks as breaks, and other blocks as
/// they converted.
fn page_parts(page: &Page, document: super::Document) -> Vec<Part> {
    let super::Document {
        blocks,
        origins,
        mut texts,
    } = document;
    let mut parts = Vec::new();
    let mut run: Vec<DocBlock> = Vec::new();
    let mut run_origin: Option<BlockId> = None;
    let flush = |parts: &mut Vec<Part>,
                 run: &mut Vec<DocBlock>,
                 origin: Option<BlockId>,
                 texts: &mut std::collections::BTreeMap<BlockId, crate::doc::data::TextData>| {
        if run.is_empty() {
            return;
        }
        let blocks = std::mem::take(run);
        match origin.and_then(|id| texts.remove(&id)) {
            Some(data) => parts.push(Part::Text {
                blocks,
                data: Box::new(data),
            }),
            None => parts.push(Part::Blocks(blocks)),
        }
    };
    for (block, origin) in blocks.into_iter().zip(origins) {
        if let Some(kind) = break_kind(page, origin) {
            flush(&mut parts, &mut run, run_origin, &mut texts);
            run_origin = None;
            parts.push(if kind == "column" {
                Part::ColumnBreak
            } else {
                Part::PageBreak
            });
            continue;
        }
        if run_origin != Some(origin) {
            flush(&mut parts, &mut run, run_origin, &mut texts);
            run_origin = Some(origin);
        }
        run.push(block);
    }
    flush(&mut parts, &mut run, run_origin, &mut texts);
    parts
}

/// The kind of a break block (spec 6.12): `page` or `column`.
fn break_kind(page: &Page, id: BlockId) -> Option<&str> {
    match &page.blocks.get(id)?.data {
        BlockData::Other(other) if &*other.type_name == "break" => {
            Some(match other.data.get("kind").and_then(Value::as_str) {
                Some("column") => "column",
                _ => "page",
            })
        }
        _ => None,
    }
}

/// The page setup of a page's paper, with its saved header and footer.
fn page_setup(page: &Page) -> PageSetup {
    let paper = &page.view.paper;
    let print = page.view.extra.get("print").and_then(Value::as_object);
    let bands = |key: &str| {
        print
            .and_then(|p| p.get(key))
            .and_then(Value::as_object)
            .map(read_bands)
    };
    let text = page.view.extra.get("text").and_then(Value::as_object);
    let page_numbers = text
        .and_then(|t| t.get("pageNumbers"))
        .and_then(Value::as_object)
        .map(|numbers| {
            // A format outside the ST_NumberFormat values would make the file unreadable in Word: decimal.
            let format = numbers
                .get("format")
                .and_then(Value::as_str)
                .filter(|f| docx::NUMBER_FORMATS.contains(f))
                .unwrap_or("decimal");
            let start = numbers
                .get("start")
                .and_then(Value::as_u64)
                .and_then(|s| u32::try_from(s).ok());
            (format.to_owned(), start)
        });
    PageSetup {
        width: paper.width,
        height: paper.height,
        margins: paper.margins,
        landscape: paper.orientation == Named::Known(Orientation::Landscape) || paper.width > paper.height,
        header: bands("header"),
        footer: bands("footer"),
        page_numbers,
    }
}

/// A band and its first-sheet variant (`R-PRN-1`). Each part is at most 200 characters.
fn read_bands(value: &Map<String, Value>) -> Bands {
    let band = |v: &Map<String, Value>| {
        let part = |key: &str| {
            v.get(key)
                .and_then(Value::as_str)
                .map(|s| s.chars().take(200).collect())
                .unwrap_or_default()
        };
        Band {
            left: part("left"),
            center: part("center"),
            right: part("right"),
        }
    };
    Bands {
        all: band(value),
        first: value.get("firstPage").and_then(Value::as_object).map(band),
    }
}

/// The text settings of a page (`view.text`).
fn text_settings(page: &Page) -> TextSettings {
    let text = page.view.extra.get("text").and_then(Value::as_object);
    TextSettings {
        default_tab: text
            .and_then(|t| t.get("defaultTab"))
            .and_then(Value::as_f64)
            .filter(|v| (0.0..=1584.0).contains(v)),
        hyphenate: text.and_then(|t| t.get("hyphenate")).and_then(Value::as_bool),
    }
}

fn bookmark(id: PageId) -> String {
    format!("page_{id}")
}

fn unique_file(out_dir: &Path, title: &str) -> Result<std::path::PathBuf> {
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let name = sanitize_name(title, "OpenNote export");
    let mut path = out_dir.join(format!("{name}.docx"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{name} ({n}).docx"));
        n += 1;
    }
    Ok(path)
}

/// Collects the pictures of the document, and points links at the bookmarks of pages.
struct WordResolver<'a> {
    source: &'a dyn NoteSource,
    pages: HashSet<PageId>,
    media: HashMap<String, Media>,
    unsupported: Vec<String>,
    attachments: usize,
}

impl WordResolver<'_> {
    fn describe(&self, report: &mut Report) {
        for name in &self.unsupported {
            report
                .general
                .skipped(format!("the image {name}"), "Word cannot show this image type.");
        }
        if self.attachments > 0 {
            let what = crate::report::counted(self.attachments, "attachment", "attachments");
            report
                .general
                .simplified(what, "Word files hold the names of attachments, not the files.");
        }
    }
}

impl Resolver for WordResolver<'_> {
    fn asset(&mut self, page: &Page, asset: &Asset) -> Option<String> {
        let dest = format!("media:{}", asset.id);
        if self.media.contains_key(&dest) {
            return Some(dest);
        }
        if !asset.mime.starts_with("image/") {
            self.attachments += 1;
            return Some(format!("attachment:{}", asset.name));
        }
        let ext = match asset.mime.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpeg",
            "image/gif" => "gif",
            "image/bmp" => "bmp",
            _ => {
                if !self.unsupported.contains(&asset.name) {
                    self.unsupported.push(asset.name.clone());
                }
                return None;
            }
        };
        let bytes = self.source.asset_bytes(page, asset).ok()?;
        let (width, height) = match (asset.width, asset.height) {
            (Some(w), Some(h)) => (w, h),
            _ => image_size(&bytes).unwrap_or((480, 320)),
        };
        self.media.insert(
            dest.clone(),
            Media {
                bytes,
                ext: ext.to_owned(),
                width,
                height,
            },
        );
        Some(dest)
    }

    fn page(&mut self, _from: PageId, to: PageId) -> Option<String> {
        self.pages.contains(&to).then(|| format!("#{}", bookmark(to)))
    }
}
