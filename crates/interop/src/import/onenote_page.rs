//! One OneNote page as an OpenNote page (A3-17): paragraphs, headings, lists, to-do tags, tables, pictures, and
//! attached files, with a report of what did not come over.

use std::collections::HashMap;
use std::path::Path;

use opennote_core::Timestamp;

use super::onenote::read_capped;
use crate::doc::{Block, Inline, Item as ListItem, Marks, Script};
use crate::error::Result;
use crate::onenote::{is_onefiles_name, limits, Attached, Blob, Item, ListKind, Page, Paragraph, Run};
use crate::page_builder::PageBuilder;
use crate::report::PageReport;
use crate::sink::{ImportEnv, ImportedPage};
use opennote_core::AssetId;

/// What one page held, for its report.
#[derive(Default)]
struct Counts {
    tables: usize,
    pictures: usize,
    files: usize,
    odd_pictures: usize,
    lost_data: usize,
    over_budget: usize,
    bare_links: usize,
    tags: usize,
}

/// How many more bytes of pictures and files one section may copy ([`limits::COPIED_BYTES`]).
pub(super) struct Budget {
    left: u64,
}

impl Budget {
    pub(super) fn new(bytes: u64) -> Budget {
        Budget { left: bytes }
    }

    /// Takes `len` bytes from the budget, or says there are not that many left.
    fn take(&mut self, len: usize) -> bool {
        match self.left.checked_sub(len as u64) {
            Some(left) => {
                self.left = left;
                true
            }
            None => false,
        }
    }
}

/// Where a picture or file's bytes came from and how it is placed, so a page that places the same bytes the same
/// way again reuses its asset.
#[derive(PartialEq, Eq, Hash)]
enum Source {
    Inside { picture: bool, ptr: usize, len: usize },
    Outside { picture: bool, name: String },
}

/// Converts a page and says what came over.
pub(super) fn convert_page(
    page: &Page<'_>,
    section: &str,
    onefiles: &Path,
    env: &ImportEnv<'_>,
    budget: &mut Budget,
) -> Result<(ImportedPage, PageReport)> {
    let created = page.created.map_or_else(|| env.clock.now(), Timestamp::from_unix_ms);
    let modified = page.modified.map_or(created, Timestamp::from_unix_ms).max(created);
    let title = if page.title.trim().is_empty() {
        "Untitled page".to_owned()
    } else {
        page.title.trim().to_owned()
    };
    let mut builder = PageBuilder::new(env, &title, created, modified);
    let mut counts = Counts::default();
    let mut added: HashMap<Source, (AssetId, bool)> = HashMap::new();
    let mut labels = Vec::new();
    let mut blocks = Vec::new();
    for item in &page.items {
        match item {
            Item::Text(para) => {
                for tag in &para.tags {
                    counts.tags += 1;
                    if !tag.label.is_empty() && !labels.contains(&tag.label) {
                        labels.push(tag.label.clone());
                    }
                }
                push_paragraph(&mut blocks, para, &mut counts);
            }
            Item::Table(rows) => {
                counts.tables += 1;
                blocks.push(table(rows, &mut counts));
            }
            Item::Picture(picture) | Item::File(picture) => {
                builder.push_blocks(std::mem::take(&mut blocks));
                let is_picture = matches!(item, Item::Picture(_));
                let mut sink = Attach {
                    builder: &mut builder,
                    onefiles,
                    counts: &mut counts,
                    added: &mut added,
                    budget,
                };
                sink.attach(picture, is_picture);
            }
        }
    }
    builder.push_blocks(blocks);
    builder.set_tags(labels);
    let mut report = PageReport {
        title,
        source: section.to_owned(),
        entries: Vec::new(),
    };
    report.came_over("text");
    report.came_over_count(counts.tables, "table", "tables");
    report.came_over_count(counts.pictures, "picture", "pictures");
    report.came_over_count(counts.files, "attached file", "attached files");
    report.came_over_count(counts.tags, "note tag", "note tags");
    report.simplified_count(
        counts.odd_pictures,
        ("picture", "pictures"),
        "It is in a format screens cannot show, such as EMF or TIFF, so it is attached as a file.",
    );
    report.simplified_count(
        counts.bare_links,
        ("link", "links"),
        "The file keeps the linked text but not where it points, so it is plain text.",
    );
    report.skipped_count(
        counts.lost_data,
        ("picture or file", "pictures or files"),
        "Its data is missing from the section file and its onefiles folder.",
    );
    report.skipped_count(
        counts.over_budget,
        ("picture or file", "pictures or files"),
        "The section holds more picture and file data than OpenNote copies from one section file.",
    );
    report.skipped_count(
        page.missed.unknown,
        (
            "item of a kind OpenNote cannot read",
            "items of kinds OpenNote cannot read",
        ),
        "Microsoft's published description of the format does not cover it. Handwriting (ink) is one of these.",
    );
    report.skipped_count(
        page.missed.damaged,
        ("damaged item", "damaged items"),
        "Its data is damaged.",
    );
    report.skipped_count(
        page.missed.too_deep,
        ("item", "items"),
        "The page holds more content, or deeper indents, than OpenNote reads.",
    );
    Ok((builder.finish()?, report))
}

/// Adds a paragraph as a heading, a paragraph, or a list item. To-do tags become task list items.
fn push_paragraph(blocks: &mut Vec<Block>, para: &Paragraph, counts: &mut Counts) {
    let content = inlines(&para.runs, counts);
    let task = para.tags.iter().find(|t| t.checkable).map(|t| t.done);
    if para.heading > 0 && task.is_none() && para.list.is_none() {
        blocks.push(Block::Heading {
            level: para.heading,
            content,
        });
        return;
    }
    let ordered = match (task, para.list) {
        (Some(_), _) | (None, Some(ListKind::Bullet)) => false,
        (None, Some(ListKind::Number)) => true,
        (None, None) => {
            blocks.push(Block::Paragraph(content));
            return;
        }
    };
    let item = ListItem {
        task,
        blocks: vec![Block::Paragraph(content)],
    };
    push_list_item(blocks, para.depth.min(limits::DEPTH), ordered, item);
}

/// Adds a list item at an indent level, inside the last item of the level above when there is one.
fn push_list_item(blocks: &mut Vec<Block>, depth: usize, ordered: bool, item: ListItem) {
    if depth > 0 {
        if let Some(Block::List { items, .. }) = blocks.last_mut() {
            if let Some(last) = items.last_mut() {
                return push_list_item(&mut last.blocks, depth - 1, ordered, item);
            }
        }
    }
    match blocks.last_mut() {
        Some(Block::List { ordered: o, items, .. }) if *o == ordered => items.push(item),
        _ => blocks.push(Block::List {
            ordered,
            start: 1,
            items: vec![item],
        }),
    }
}

/// The runs of a paragraph as inlines. A vertical tab, which OneNote uses for a line break, becomes one.
fn inlines(runs: &[Run], counts: &mut Counts) -> Vec<Inline> {
    let mut out = Vec::new();
    for run in runs {
        let mut marks = Marks {
            strong: run.bold,
            emphasis: run.italic,
            underline: run.underline,
            strike: run.strike,
            script: if run.superscript {
                Some(Script::Sup)
            } else if run.subscript {
                Some(Script::Sub)
            } else {
                None
            },
            ..Marks::default()
        };
        if run.hyperlink {
            let target = run.text.trim();
            if ["http://", "https://", "mailto:"].iter().any(|p| target.starts_with(p)) {
                marks.link = Some(target.to_owned());
            } else {
                counts.bare_links += 1;
            }
        }
        for (i, line) in run.text.split(['\u{000B}', '\r', '\n']).enumerate() {
            if i > 0 {
                out.push(Inline::HardBreak);
            }
            if !line.is_empty() {
                out.push(Inline::marked(line, marks.clone()));
            }
        }
    }
    out
}

/// A table of text. Pictures and files inside cells come over as their names.
fn table(rows: &[Vec<Vec<Item<'_>>>], counts: &mut Counts) -> Block {
    let rows = rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| {
                    let mut out = Vec::new();
                    for item in cell {
                        if !out.is_empty() {
                            out.push(Inline::HardBreak);
                        }
                        match item {
                            Item::Text(para) => out.extend(inlines(&para.runs, counts)),
                            Item::Picture(a) | Item::File(a) => out.push(Inline::text(format!("[{}]", a.name))),
                            Item::Table(_) => out.push(Inline::text("[table]")),
                        }
                    }
                    out
                })
                .collect()
        })
        .collect();
    Block::Table { header: false, rows }
}

/// Where a page's pictures and files go, and what it has added so far.
struct Attach<'p, 'b, 'e> {
    builder: &'p mut PageBuilder<'e>,
    onefiles: &'p Path,
    counts: &'p mut Counts,
    /// The assets added from each source, and whether each is a picture screens show.
    added: &'p mut HashMap<Source, (AssetId, bool)>,
    budget: &'b mut Budget,
}

impl Attach<'_, '_, '_> {
    /// Adds a picture as an image block, or as a file when screens cannot show it; adds a file as a file block.
    /// Bytes the page already placed are reused, not copied again; new bytes are copied while the section's
    /// budget lasts.
    fn attach(&mut self, attached: &Attached<'_>, picture: bool) {
        let source = match &attached.data {
            Blob::Inside(bytes) => Source::Inside {
                picture,
                ptr: bytes.as_ptr() as usize,
                len: bytes.len(),
            },
            Blob::Outside(name) if is_onefiles_name(name) => Source::Outside {
                picture,
                name: name.clone(),
            },
            _ => {
                self.counts.lost_data += 1;
                return;
            }
        };
        let (asset, shown) = match self.added.get(&source) {
            Some(known) => *known,
            None => {
                // The budget is checked before the bytes are copied or read, so a page that places a large
                // blob many more times than the budget allows does not copy it once per placement.
                let len = match &attached.data {
                    Blob::Inside(bytes) => Some(bytes.len() as u64),
                    Blob::Outside(name) => std::fs::symlink_metadata(self.onefiles.join(name))
                        .ok()
                        .map(|m| m.len()),
                    Blob::Missing => None,
                };
                if len.is_some_and(|len| len > self.budget.left) {
                    self.counts.over_budget += 1;
                    return;
                }
                let bytes = match &attached.data {
                    Blob::Inside(bytes) => Some(bytes.to_vec()),
                    Blob::Outside(name) => read_capped(&self.onefiles.join(name), 256 << 20).ok(),
                    Blob::Missing => None,
                };
                let Some(bytes) = bytes else {
                    self.counts.lost_data += 1;
                    return;
                };
                if !self.budget.take(bytes.len()) {
                    self.counts.over_budget += 1;
                    return;
                }
                let mime = if picture { image_type(&bytes) } else { None };
                let name = if attached.name.trim().is_empty() {
                    let n = self.counts.pictures + self.counts.files + 1;
                    match mime {
                        Some((_, ext)) => format!("picture-{n}.{ext}"),
                        None if picture => format!("picture-{n}.bin"),
                        None => format!("file-{n}"),
                    }
                } else {
                    attached.name.clone()
                };
                let asset = self.builder.add_asset(&name, mime.map(|(m, _)| m), bytes);
                self.added.insert(source, (asset, mime.is_some()));
                (asset, mime.is_some())
            }
        };
        if picture && shown {
            self.counts.pictures += 1;
            self.builder.push_image(asset, attached.alt.clone());
        } else {
            if picture {
                self.counts.odd_pictures += 1;
            } else {
                self.counts.files += 1;
            }
            self.builder.push_file(asset);
        }
    }
}

/// The type of a picture that screens show, from its first bytes.
fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF8") {
        Some(("image/gif", "gif"))
    } else if bytes.starts_with(b"BM") {
        Some(("image/bmp", "bmp"))
    } else {
        None
    }
}

#[cfg(test)]
mod budget_tests {
    use super::*;
    use crate::testing::{png_bytes, TestEnv};

    fn page_of(bytes: &[u8], times: usize) -> Page<'_> {
        let picture = Attached {
            name: String::new(),
            alt: String::new(),
            data: Blob::Inside(bytes),
        };
        Page {
            title: "Pictures".into(),
            items: vec![Item::Picture(picture); times],
            ..Page::default()
        }
    }

    /// A picture placed many times is copied once (R3-2).
    #[test]
    fn a_picture_placed_many_times_is_copied_once() {
        let test = TestEnv::new();
        let png = png_bytes();
        let mut budget = Budget::new(png.len() as u64);
        let (page, report) =
            convert_page(&page_of(&png, 50), "S", Path::new("."), &test.env(), &mut budget).expect("the page converts");
        assert_eq!(page.asset_bytes.len(), 1);
        assert!(report.entries.iter().any(|e| e.what == "50 pictures"));
    }

    /// Pictures past the section's budget are left out and reported, however many times they are placed (R3-2).
    #[test]
    fn pictures_past_the_budget_are_left_out() {
        let test = TestEnv::new();
        let png = png_bytes();
        let mut budget = Budget::new(png.len() as u64 - 1);
        let (page, report) =
            convert_page(&page_of(&png, 50), "S", Path::new("."), &test.env(), &mut budget).expect("the page converts");
        assert!(page.asset_bytes.is_empty());
        assert_eq!(budget.left, png.len() as u64 - 1, "nothing was taken");
        assert!(
            report.entries.iter().any(|e| e.what == "50 pictures or files"),
            "{:?}",
            report.entries
        );
        assert!(report.entries.iter().any(|e| e
            .why
            .as_deref()
            .is_some_and(|w| w.contains("more picture and file data"))));
    }
}
