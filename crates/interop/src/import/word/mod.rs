//! Importing Word files (`.docx`), including the ones OneNote exports.
//!
//! A Word file is a ZIP archive of XML parts. This reader takes headings, lists, tables, links, pictures,
//! colors, highlights, and code fonts, and turns shaded title blocks into callouts. A document with several
//! Title paragraphs, or with page breaks that each start a short line, becomes several pages, as OneNote writes
//! a section. OneNote's date and time lines under a title become the page's created date.

mod assemble;
mod body;
mod package;
mod pages;
mod styles;

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use self::body::{Reader, Stats};
use self::package::Package;
use self::pages::Cut;
pub use self::pages::WordPages;
use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use crate::archive::ZipArchive;
use crate::assets::{is_image, mime_from_extension};
use crate::doc::{visit_inlines_mut, Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{Entry, PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};
use opennote_core::PageId;

/// Imports a Word file, or a folder of them, into a new notebook. Each file becomes a section.
pub fn import_docx(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_docx_with(path, WordPages::Auto, env, sink)
}

/// Imports Word files and says how to cut each into pages.
pub fn import_docx_with(
    path: &Path,
    pages: WordPages,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    import_files(path, &WordConverter { pages }, env, sink)
}

/// Reads `.docx` files.
pub(super) struct WordConverter {
    pub pages: WordPages,
}

impl FileConverter for WordConverter {
    fn label(&self) -> &'static str {
        "Word documents"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["docx", "docm"]
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
        let archive = ZipArchive::new(BufReader::new(file), package::limits()).map_err(|e| relabel(e, path))?;
        let stem = path
            .file_stem()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        convert_archive(archive, &stem, self.pages, env)
    }
}

fn relabel(error: InteropError, path: &Path) -> InteropError {
    match error {
        InteropError::Format { detail, .. } => InteropError::format(path.display().to_string(), detail),
        other => other,
    }
}

/// Converts an opened Word file. `name` stands in for a title the file does not give.
pub(super) fn convert_archive<R: Read + Seek>(
    archive: ZipArchive<R>,
    name: &str,
    how: WordPages,
    env: &ImportEnv<'_>,
) -> Result<Converted> {
    let mut package = Package::open(archive, name)?;
    let (items, stats) = {
        let mut reader = Reader::new(&package.rels, &package.styles, &package.numbering);
        let items = reader.document(&package.document);
        (items, reader.stats)
    };
    let (raw_pages, cut) = pages::split(items, how);
    let now = env.clock.now();
    let mut converted = Converted {
        pages: Vec::new(),
        general: general_entries(&stats, &package, cut, raw_pages.len()),
    };
    let count = raw_pages.len();
    let ids: Vec<PageId> = raw_pages.iter().map(|_| PageId::generate(env.clock)).collect();
    let bookmarks: HashMap<String, PageId> = raw_pages
        .iter()
        .zip(&ids)
        .flat_map(|(raw, id)| raw.bookmarks.iter().map(|b| (b.clone(), *id)))
        .collect();
    for (n, raw) in raw_pages.into_iter().enumerate() {
        env.control.checkpoint()?;
        let title = raw
            .title
            .or_else(|| (count == 1).then(|| package.props.title.clone()).flatten())
            .unwrap_or_else(|| {
                if count == 1 {
                    name.to_owned()
                } else {
                    format!("{name} {}", n + 1)
                }
            });
        let created = raw.created.or(package.props.created).unwrap_or(now);
        let modified = package.props.modified.unwrap_or(created).max(created);
        let mut blocks = assemble::blocks(raw.items);
        let mut report = PageReport {
            title: title.clone(),
            source: name.to_owned(),
            entries: Vec::new(),
        };
        let mut builder = PageBuilder::with_id(env, ids[n], &title, created, modified);
        builder.set_tags(package.props.keywords.clone());
        let (linked, unresolved) = resolve_anchors(&mut blocks, &bookmarks);
        let over_before = package.over_budget;
        let (placed, lost) = place_images(&mut blocks, &mut builder, &mut package);
        let too_big = package.over_budget - over_before;
        let tables = blocks.iter().filter(|b| matches!(b, Block::Table { .. })).count();
        builder.push_blocks(blocks);
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
            "Its data is missing, damaged, or in a format that screens cannot show, such as EMF.",
        );
        if raw.created.is_some() {
            report.came_over("date and time under the title");
        }
        converted.pages.push(ConvertedPage {
            section: raw.section,
            page: builder.finish()?,
            report,
        });
    }
    Ok(converted)
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
    let name = target.rsplit('/').next().unwrap_or(target);
    let mime = mime_from_extension(name.rsplit_once('.').map_or("", |(_, ext)| ext));
    if !is_image(mime) {
        return None;
    }
    let bytes = package.media(target)?;
    Some(builder.add_asset(name, Some(mime), bytes).to_string())
}

/// What the whole document lost or simplified.
fn general_entries<R: Read + Seek>(stats: &Stats, package: &Package<R>, cut: Cut, pages: usize) -> Vec<Entry> {
    let mut report = PageReport::default();
    match cut {
        Cut::Titles => report.simplified(
            format!("{pages} pages"),
            "The document has several Title paragraphs, so each started a page.",
        ),
        Cut::Breaks => report.simplified(
            format!("{pages} pages"),
            "Each page break was followed by a short line, so each started a page.",
        ),
        Cut::Whole => {}
    }
    let merged = ("merged table cell", "merged table cells");
    report.simplified_count(
        stats.merged_cells,
        merged,
        "Each merged cell became one cell and empty cells.",
    );
    let nested = ("table inside a table", "tables inside tables");
    report.simplified_count(stats.nested_tables, nested, "Each became a line of text in its cell.");
    let boxes = ("text box", "text boxes");
    report.simplified_count(
        stats.text_boxes,
        boxes,
        "Each became ordinary paragraphs after its place in the text.",
    );
    let lettered = (
        "list with letters or Roman numerals",
        "lists with letters or Roman numerals",
    );
    report.simplified_count(stats.lettered_lists, lettered, "OpenNote numbers lists with digits.");
    report.skipped_count(
        stats.shapes,
        ("drawing, chart, or shape", "drawings, charts, and shapes"),
        "OpenNote reads pictures only.",
    );
    report.skipped_count(
        stats.objects,
        ("embedded object", "embedded objects"),
        "Objects from other programs cannot be opened here.",
    );
    report.skipped_count(
        stats.note_marks,
        (
            "footnote, endnote, or comment mark",
            "footnote, endnote, and comment marks",
        ),
        "The notes themselves are not imported.",
    );
    report.skipped_count(
        stats.hidden_runs,
        ("piece of hidden text", "pieces of hidden text"),
        "Hidden text stays hidden by staying out.",
    );
    for part in &package.unread_parts {
        report.skipped(
            (*part).to_owned(),
            "OpenNote does not import this part of a Word file yet.",
        );
    }
    report.entries
}
