//! Importing Word files (`.docx`), including the ones OneNote exports.
//!
//! A Word file is a ZIP archive of XML parts. This reader resolves run and paragraph formatting through the
//! document defaults and the style chains in ECMA-376 Part 1, 17.7.2 order, with the toggle properties of 17.7.3.
//! The used styles become the page's style sheet, and runs carry only what differs from their style. It reads
//! theme fonts and colors, list definitions, notes, comments with replies, tracked changes as suggestions, the
//! first section's paper, and simple headers and footers. A document with several Title
//! paragraphs, or with page breaks that each start a short line, becomes several pages, as OneNote writes a
//! section. OneNote's date and time lines under a title become the page's created date.

mod assemble;
mod body;
mod entries;
mod marks;
mod notes;
mod numbering;
mod package;
mod pages;
mod paras;
mod props;
mod section;
mod sheet;
mod styles;
mod theme;
mod values;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_gaps;
#[cfg(test)]
mod tests_more;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use serde_json::{Map, Value};

use self::assemble::Formatted;
use self::body::{Fmt, Reader, Records, Stats};
use self::numbering::Numbering;
use self::package::Package;
pub use self::pages::WordPages;
use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use super::pictures;
use crate::archive::ZipArchive;
use crate::doc::data::TextData as DocTextData;
use crate::doc::write::to_markdown;
use crate::doc::{visit_inlines, visit_inlines_mut, Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};
use entries::{cut_entries, found_entries, loss_entries};
use opennote_core::model::{JsonMap, Paper};
use opennote_core::{Clock, ElementId, PageId};

/// A text block holds at most about this much Markdown, as the page builder's own text blocks do.
const TEXT_CHUNK_BYTES: usize = 32 << 10;

/// What an import does with tracked changes (DESIGN 9.2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TrackedChanges {
    /// Keep them as suggestions, with their authors and times.
    #[default]
    Suggest,
    /// Accept every change. Insertions and the new formatting stay, and deletions go.
    Accept,
    /// Reject every change. Insertions go, and deletions and the old formatting stay.
    Reject,
}

/// How to import Word files.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WordImport {
    /// How each file is cut into pages.
    pub pages: WordPages,
    /// What to do with tracked changes.
    pub changes: TrackedChanges,
}

/// Imports a Word file, or a folder of them, into a new notebook. Each file becomes a section.
pub fn import_docx(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_docx_options(path, &WordImport::default(), env, sink)
}

/// Imports Word files and says how to cut each into pages.
pub fn import_docx_with(
    path: &Path,
    pages: WordPages,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    let options = WordImport {
        pages,
        ..WordImport::default()
    };
    import_docx_options(path, &options, env, sink)
}

/// Imports Word files with every choice of [`WordImport`].
pub fn import_docx_options(
    path: &Path,
    options: &WordImport,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    import_files(path, &WordConverter { options: *options }, env, sink)
}

/// Reads `.docx` files.
pub(super) struct WordConverter {
    pub options: WordImport,
}

impl FileConverter for WordConverter {
    fn label(&self) -> &'static str {
        "Word and OpenDocument documents"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["docx", "docm", "odt", "ott", "doc", "dot", "rtf"]
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase());
        if matches!(ext.as_deref(), Some("odt" | "ott")) {
            return super::odt::convert(path, env);
        }
        // An older document, unless it is really a .docx file under an older name.
        if ext
            .as_deref()
            .is_some_and(|e| super::legacy::DOCUMENT_EXTENSIONS.contains(&e))
            && !starts_like_zip(path)
        {
            return super::legacy::convert_document(path, env);
        }
        let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
        let archive = ZipArchive::new(BufReader::new(file), package::limits()).map_err(|e| relabel(e, path))?;
        let stem = path
            .file_stem()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        convert_archive(archive, &stem, &self.options, env)
    }
}

fn starts_like_zip(path: &Path) -> bool {
    let mut head = [0u8; 4];
    File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && super::legacy::is_zip(&head)
}

fn relabel(error: InteropError, path: &Path) -> InteropError {
    match error {
        InteropError::Format { detail, .. } => InteropError::format(path.display().to_string(), detail),
        other => other,
    }
}

/// What the whole document gives every page: the style sheet, the theme, the paper, the print bands, and the
/// text settings.
#[derive(Default)]
struct PageSetup {
    styles: Map<String, Value>,
    theme: Option<Value>,
    paper: Option<Paper>,
    print: Map<String, Value>,
    text: Map<String, Value>,
}

impl PageSetup {
    fn apply(&self, builder: &mut PageBuilder<'_>) {
        let page = builder.page_mut();
        if self.styles.len() > 1
            || self
                .styles
                .get("normal")
                .is_some_and(|n| n.as_object().is_some_and(|o| !o.is_empty()))
        {
            page.extra
                .insert("styles".to_owned(), Value::Object(self.styles.clone()));
        }
        if let Some(theme) = &self.theme {
            page.extra.insert("theme".to_owned(), theme.clone());
        }
        if let Some(paper) = &self.paper {
            page.view.paper = paper.clone();
        }
        if !self.print.is_empty() {
            page.view
                .extra
                .insert("print".to_owned(), Value::Object(self.print.clone()));
        }
        if !self.text.is_empty() {
            page.view
                .extra
                .insert("text".to_owned(), Value::Object(self.text.clone()));
        }
    }
}

/// What the document-wide parts gave, for the report.
#[derive(Default)]
struct SetupReport {
    further_sections: usize,
    bands: section::BandReport,
    styles: usize,
    styles_dropped: usize,
}

/// Reads the first section's paper, margins, header, and footer, and the document's settings.
fn page_setup<R: Read + Seek>(
    package: &mut Package<R>,
    styles_sheet: (Map<String, Value>, usize),
) -> (PageSetup, SetupReport) {
    let mut setup = PageSetup {
        theme: sheet::theme_json(&package.theme),
        ..PageSetup::default()
    };
    let mut report = SetupReport {
        styles: styles_sheet.0.len(),
        styles_dropped: styles_sheet.1,
        ..SetupReport::default()
    };
    setup.styles = styles_sheet.0;
    if let Some(settings) = &package.settings {
        setup.text = section::text_settings(settings);
    }
    let body = styles::child(&package.document, "w:body").cloned();
    let Some(body) = body else {
        return (setup, report);
    };
    let (first, further) = section::first_section(&body);
    report.further_sections = further;
    let Some(sect) = first else {
        return (setup, report);
    };
    setup.paper = section::paper(sect);
    if let Some(numbers) = section::page_numbers(sect) {
        setup.text.insert("pageNumbers".to_owned(), numbers);
    }
    let first_page = section::title_page(sect);
    for (name, key) in [("w:headerreference", "header"), ("w:footerreference", "footer")] {
        let refs = section::references(sect, name);
        let target = |kind: &str| {
            refs.iter()
                .find(|(t, _)| *t == kind)
                .and_then(|(_, id)| package.rels.get(*id))
                .map(|rel| rel.target.clone())
        };
        let (default, first) = (target("default"), target("first"));
        let mut band = match default.and_then(|t| package.part(&t)) {
            Some(root) => {
                let (band, lost) = section::band(&root);
                report.bands.kept += 1;
                report.bands.simplified += usize::from(lost);
                band
            }
            None => Value::Null,
        };
        if first_page {
            let first_band = match first.and_then(|t| package.part(&t)) {
                Some(root) => {
                    let (band, lost) = section::band(&root);
                    report.bands.kept += 1;
                    report.bands.simplified += usize::from(lost);
                    band
                }
                // A first page without its own header shows none.
                None => serde_json::json!({"left": "", "center": "", "right": ""}),
            };
            if band.is_null() {
                band = serde_json::json!({"left": "", "center": "", "right": ""});
            }
            if let Some(obj) = band.as_object_mut() {
                obj.insert("firstPage".to_owned(), first_band);
            }
        }
        if has_text(&band) {
            setup.print.insert(key.to_owned(), band);
        }
    }
    (setup, report)
}

/// Whether a band, or its first-page band, shows any text.
fn has_text(band: &Value) -> bool {
    match band {
        Value::String(s) => !s.is_empty(),
        Value::Object(o) => o.values().any(has_text),
        _ => false,
    }
}

/// What the reading of a whole document gives its pages.
struct Document {
    items: Vec<body::Item>,
    stats: Stats,
    records: Records,
    setup: PageSetup,
    setup_report: SetupReport,
}

/// Reads the body, the style sheet, and the page setup of an opened file.
fn read_document<R: Read + Seek>(package: &mut Package<R>, options: &WordImport, env: &ImportEnv<'_>) -> Document {
    let file_time = package.props.modified.unwrap_or_else(|| env.clock.now()).to_string();
    let (items, stats, records, used, plain) = {
        let mut reader = Reader::new(&package.rels, &package.styles, &package.numbering).with(
            package.theme.clone(),
            &package.sources,
            env.clock,
            options.changes,
            file_time,
        );
        let items = reader.document(&package.document);
        let parts = (reader.stats, reader.records, reader.used_styles, reader.plain_styles);
        (items, parts.0, parts.1, parts.2, parts.3)
    };
    let sheet = sheet::style_sheet(&package.styles, &used, &plain, &package.theme);
    let (setup, setup_report) = page_setup(package, sheet);
    Document {
        items,
        stats,
        records,
        setup,
        setup_report,
    }
}

/// Converts an opened Word file. `name` stands in for a title the file does not give.
pub(super) fn convert_archive<R: Read + Seek>(
    archive: ZipArchive<R>,
    name: &str,
    options: &WordImport,
    env: &ImportEnv<'_>,
) -> Result<Converted> {
    let mut package = Package::open(archive, name)?;
    let mut doc = read_document(&mut package, options, env);
    let (raw_pages, cut) = pages::split(std::mem::take(&mut doc.items), options.pages);
    let mut general = PageReport::default();
    cut_entries(cut, raw_pages.len(), &mut general);
    found_entries(&doc, options.changes, &mut general);
    loss_entries(&doc.stats, &doc.setup_report, &package, &mut general);
    let mut converted = Converted {
        pages: Vec::new(),
        general: general.entries,
    };
    let ids: Vec<PageId> = raw_pages.iter().map(|_| PageId::generate(env.clock)).collect();
    let bookmarks: HashMap<String, PageId> = raw_pages
        .iter()
        .zip(&ids)
        .flat_map(|(raw, id)| raw.bookmarks.iter().map(|b| (b.clone(), *id)))
        .collect();
    let count = raw_pages.len();
    for (n, raw) in raw_pages.into_iter().enumerate() {
        env.control.checkpoint()?;
        let title = raw
            .title
            .clone()
            .or_else(|| (count == 1).then(|| package.props.title.clone()).flatten())
            .unwrap_or_else(|| {
                if count == 1 {
                    name.to_owned()
                } else {
                    format!("{name} {}", n + 1)
                }
            });
        let page = PageInput {
            raw,
            id: ids[n],
            title,
            name,
            bookmarks: &bookmarks,
        };
        converted.pages.push(convert_page(page, &mut package, &doc, env)?);
    }
    Ok(converted)
}

/// One page to build.
struct PageInput<'p> {
    raw: pages::RawPage,
    id: PageId,
    title: String,
    name: &'p str,
    bookmarks: &'p HashMap<String, PageId>,
}

fn convert_page<R: Read + Seek>(
    input: PageInput<'_>,
    package: &mut Package<R>,
    doc: &Document,
    env: &ImportEnv<'_>,
) -> Result<ConvertedPage> {
    let PageInput {
        raw,
        id,
        title,
        name,
        bookmarks,
    } = input;
    let created = raw.created.or(package.props.created).unwrap_or_else(|| env.clock.now());
    let modified = package.props.modified.unwrap_or(created).max(created);
    let (mut blocks, fmts): (Vec<Block>, Vec<Vec<Option<Fmt>>>) = assemble::formatted(raw.items).into_iter().unzip();
    let mut report = PageReport {
        title: title.clone(),
        source: name.to_owned(),
        entries: Vec::new(),
    };
    let mut builder = PageBuilder::with_id(env, id, &title, created, modified);
    builder.set_tags(package.props.keywords.clone());
    doc.setup.apply(&mut builder);
    let (linked, unresolved) = resolve_anchors(&mut blocks, bookmarks);
    let over_before = package.over_budget;
    let (placed, lost) = place_images(&mut blocks, &mut builder, package);
    let too_big = package.over_budget - over_before;
    let tables = blocks.iter().filter(|b| matches!(b, Block::Table { .. })).count();
    let formatted: Vec<Formatted> = blocks.into_iter().zip(fmts).collect();
    push_formatted(&mut builder, formatted, &doc.records, &package.numbering, env.clock);
    report.came_over("text and formatting");
    report.came_over_count(tables, "table", "tables");
    report.came_over_count(placed, "image", "images");
    report.came_over_count(linked, "link to another page", "links to other pages");
    report.simplified_count(
        unresolved,
        (
            "link to a place in the same document",
            "links to places in the same document",
        ),
        "Only the link text was kept.",
    );
    report.skipped_count(
        too_big,
        ("image past the size limit", "images past the size limit"),
        "The file's pictures together unpack to more than an import reads from one Word file (512 MiB).",
    );
    report.skipped_count(
        lost - too_big,
        ("image that could not be read", "images that could not be read"),
        "Its data is missing, damaged, or in a format that screens cannot show.",
    );
    if raw.created.is_some() {
        report.came_over("date and time under the title");
    }
    Ok(ConvertedPage {
        section: raw.section,
        page: builder.finish()?,
        report,
    })
}

/// Whether a block is a paragraph that holds nothing but one placed picture, which becomes an image block.
fn image_only(block: &Block) -> bool {
    matches!(block, Block::Paragraph(inlines)
        if matches!(inlines.as_slice(), [Inline::Image { dest, .. }] if dest.starts_with("asset:")))
}

/// Adds the blocks of a page. Tables and lone pictures become their own blocks. The rest becomes text blocks of
/// about [`TEXT_CHUNK_BYTES`], each with its element IDs, styles, `paras`, and the lists, notes, comments, and
/// suggestions it names.
fn push_formatted(
    builder: &mut PageBuilder<'_>,
    formatted: Vec<Formatted>,
    records: &Records,
    numbering: &Numbering,
    clock: &dyn Clock,
) {
    let mut group: Vec<Formatted> = Vec::new();
    let mut size = 0;
    for (block, fmts) in formatted {
        if matches!(block, Block::Table { .. }) || image_only(&block) {
            flush(builder, std::mem::take(&mut group), records, numbering, clock);
            size = 0;
            builder.push_blocks(vec![block]);
            continue;
        }
        let len = to_markdown(std::slice::from_ref(&block)).len() + 2;
        if !group.is_empty() && size + len > TEXT_CHUNK_BYTES {
            flush(builder, std::mem::take(&mut group), records, numbering, clock);
            size = 0;
        }
        size += len;
        group.push((block, fmts));
    }
    flush(builder, group, records, numbering, clock);
}

/// The IDs of the notes, comments, and suggestions that the blocks name.
fn named_records(blocks: &[Block]) -> (BTreeSet<String>, BTreeSet<String>, BTreeSet<String>) {
    let (mut notes, mut comments, mut suggestions) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    let marks_of = |marks: &Marks, comments: &mut BTreeSet<String>, suggestions: &mut BTreeSet<String>| {
        comments.extend(marks.comments.iter().cloned());
        for id in [&marks.insertion, &marks.deletion, &marks.format_change]
            .into_iter()
            .flatten()
        {
            suggestions.insert(id.clone());
        }
    };
    visit_inlines(blocks, &mut |inlines| {
        for inline in inlines {
            match inline {
                Inline::Text { marks, .. } => marks_of(marks, &mut comments, &mut suggestions),
                Inline::Note { id, marks } => {
                    notes.insert(id.clone());
                    marks_of(marks, &mut comments, &mut suggestions);
                }
                _ => {}
            }
        }
    });
    (notes, comments, suggestions)
}

fn flush(
    builder: &mut PageBuilder<'_>,
    group: Vec<Formatted>,
    records: &Records,
    numbering: &Numbering,
    clock: &dyn Clock,
) {
    if group.is_empty() {
        return;
    }
    let (blocks, fmts): (Vec<Block>, Vec<Vec<Option<Fmt>>>) = group.into_iter().unzip();
    let mut fmts: Vec<Option<Fmt>> = fmts.into_iter().flatten().collect();
    let elements = DocTextData::default().elements(&blocks).len();
    if fmts.len() != elements {
        // The formatting cannot be matched to the elements, so it is left out rather than put on the wrong ones.
        fmts = vec![None; elements];
    }
    let (notes, comments, suggestions) = named_records(&blocks);
    if fmts.iter().all(Option::is_none) && notes.is_empty() && comments.is_empty() && suggestions.is_empty() {
        builder.push_blocks(blocks);
        return;
    }
    let ids: Vec<ElementId> = (0..elements).map(|_| ElementId::generate(clock)).collect();
    let mut styles = BTreeMap::new();
    let mut paras = Map::new();
    let mut lists = BTreeSet::new();
    for (id, fmt) in ids.iter().zip(fmts) {
        let Some(fmt) = fmt else {
            continue;
        };
        if let Some(style) = fmt.style {
            styles.insert(*id, style);
        }
        if let Some(list) = fmt.para.get("list").and_then(|l| l.get("id")).and_then(Value::as_str) {
            lists.insert(list.to_owned());
        }
        if !fmt.para.is_empty() {
            paras.insert(id.to_string(), Value::Object(fmt.para));
        }
    }
    let mut extra = JsonMap::new();
    if !paras.is_empty() {
        extra.insert("paras".to_owned(), Value::Object(paras));
    }
    let lists: Map<String, Value> = lists
        .into_iter()
        .filter_map(|id| Some((id.clone(), numbering.definition(&id)?)))
        .collect();
    if !lists.is_empty() {
        extra.insert("lists".to_owned(), Value::Object(lists));
    }
    for (key, named, all) in [
        ("notes", &notes, &records.notes),
        ("comments", &comments, &records.comments),
        ("suggestions", &suggestions, &records.suggestions),
    ] {
        let picked: Map<String, Value> = named
            .iter()
            .filter_map(|id| Some((id.clone(), all.get(id)?.clone())))
            .collect();
        if !picked.is_empty() {
            extra.insert(key.to_owned(), Value::Object(picked));
        }
    }
    builder.push_text_block(&blocks, ids, styles, extra);
}

/// Points links to a bookmark on a page's title at that page, and drops the others. Returns how many links
/// were resolved and how many were dropped.
fn resolve_anchors(blocks: &mut [Block], bookmarks: &HashMap<String, PageId>) -> (usize, usize) {
    let (mut linked, mut dropped) = (0, 0);
    visit_inlines_mut(blocks, &mut |inlines| {
        for inline in inlines.iter_mut() {
            let Inline::Text { marks, .. } = inline else {
                continue;
            };
            let Some(anchor) = marks.link.as_deref().and_then(|l| l.strip_prefix('#')) else {
                continue;
            };
            marks.link = bookmarks.get(anchor).map(|id| format!("opennote:page/{id}"));
            if marks.link.is_some() {
                linked += 1;
            } else {
                dropped += 1;
            }
        }
    });
    (linked, dropped)
}

/// Puts the pictures into the page's assets and points the images at them. Returns how many images were placed
/// and how many could not be.
fn place_images<R: Read + Seek>(
    blocks: &mut [Block],
    builder: &mut PageBuilder<'_>,
    package: &mut Package<R>,
) -> (usize, usize) {
    let mut cache: HashMap<String, Option<String>> = HashMap::new();
    let (mut placed, mut lost) = (0, 0);
    visit_inlines_mut(blocks, &mut |inlines| {
        for inline in inlines.iter_mut() {
            let Inline::Image { dest, alt } = inline else {
                continue;
            };
            let Some(target) = dest.strip_prefix("docx:").map(str::to_owned) else {
                continue;
            };
            let resolved = cache
                .entry(target.clone())
                .or_insert_with(|| picture(package, builder, &target))
                .clone();
            match resolved {
                Some(asset) => {
                    placed += 1;
                    *dest = format!("asset:{asset}");
                }
                None => {
                    lost += 1;
                    let label = if alt.is_empty() { "image" } else { alt.as_str() };
                    *inline = Inline::marked(format!("[{label}]"), Marks::none());
                }
            }
        }
    });
    (placed, lost)
}

fn picture<R: Read + Seek>(package: &mut Package<R>, builder: &mut PageBuilder<'_>, target: &str) -> Option<String> {
    pictures::picture(builder, target, &mut |path| package.media(path))
}
