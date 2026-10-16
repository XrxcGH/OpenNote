//! Turning a stream of styled text into blocks, for the `.doc` and `.rtf` readers.
//!
//! Both formats are a run of characters with paragraph, cell, and row marks between them. A reader calls
//! [`Flow::text`] for each run and [`Flow::end_paragraph`] at each paragraph mark, with the paragraph's
//! properties. The flow gathers list paragraphs into lists, table paragraphs into tables, and the rest into
//! headings and paragraphs, and it stops taking text past a fixed size.

use super::super::files::{Converted, ConvertedPage};
use crate::dest::{self, ImportLink};
use crate::doc::{plain_text, push_text, Block, Inline, Item, Marks};
use crate::error::Result;
use crate::page_builder::PageBuilder;
use crate::report::PageReport;
use crate::sink::ImportEnv;

/// The most text a document brings in, in bytes. A page holds less, so this only bounds memory.
const MAX_TEXT_BYTES: usize = 48 << 20;
/// The deepest list level kept. Deeper items join this level.
const MAX_LIST_LEVEL: u8 = 8;
/// The widest table kept, and the most rows.
const MAX_TABLE_COLUMNS: usize = 64;
const MAX_TABLE_ROWS: usize = 10_000;

/// A list paragraph's place.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct ListProps {
    pub ordered: bool,
    pub level: u8,
    pub start: u64,
}

/// What a paragraph mark says about the paragraph before it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ParaProps {
    /// A heading level, 1 to 6.
    pub heading: Option<u8>,
    pub list: Option<ListProps>,
    /// Whether the paragraph is in a table cell.
    pub in_table: bool,
}

/// What a reader saw but did not bring over.
#[derive(Default)]
pub(super) struct Losses {
    pub pictures: usize,
    pub drawings: usize,
    pub notes: usize,
    pub comments: usize,
    pub nested_tables: usize,
    pub cut_cells: usize,
    pub cut_text: bool,
}

struct ListState {
    ordered: bool,
    start: u64,
    items: Vec<Item>,
}

/// Builds blocks from text and marks.
#[derive(Default)]
pub(super) struct Flow {
    blocks: Vec<Block>,
    line: Vec<Inline>,
    cell: Vec<Inline>,
    row: Vec<Vec<Inline>>,
    rows: Vec<Vec<Vec<Inline>>>,
    list: Option<ListState>,
    bytes: usize,
    pub losses: Losses,
    pub tables: usize,
}

impl Flow {
    /// Adds a run of text with its marks.
    pub fn text(&mut self, text: &str, marks: &Marks) {
        if text.is_empty() {
            return;
        }
        if self.bytes.saturating_add(text.len()) > MAX_TEXT_BYTES {
            self.losses.cut_text = true;
            return;
        }
        self.bytes += text.len();
        push_text(&mut self.line, text, marks);
    }

    /// Adds a line break inside the paragraph.
    pub fn line_break(&mut self) {
        if !self.line.is_empty() {
            self.line.push(Inline::HardBreak);
        }
    }

    /// Ends a paragraph.
    pub fn end_paragraph(&mut self, props: &ParaProps) {
        let content = trim_breaks(std::mem::take(&mut self.line));
        if props.in_table {
            if !content.is_empty() {
                if !self.cell.is_empty() {
                    self.cell.push(Inline::HardBreak);
                }
                self.cell.extend(content);
            }
            return;
        }
        self.close_table();
        match (props.heading, props.list) {
            (Some(level), _) if !content.is_empty() => {
                self.close_list();
                self.blocks.push(Block::Heading {
                    level: level.clamp(1, 6),
                    content,
                });
            }
            (None, Some(list)) if !content.is_empty() => self.list_item(list, content),
            _ if content.is_empty() => {}
            _ => {
                self.close_list();
                self.blocks.push(Block::Paragraph(content));
            }
        }
    }

    /// Ends a table cell. Text since the last paragraph mark belongs to the cell.
    pub fn end_cell(&mut self) {
        self.end_paragraph(&ParaProps {
            in_table: true,
            ..ParaProps::default()
        });
        let cell = std::mem::take(&mut self.cell);
        if self.row.len() < MAX_TABLE_COLUMNS {
            self.row.push(cell);
        } else {
            self.losses.cut_cells += 1;
        }
    }

    /// Ends a table row.
    pub fn end_row(&mut self) {
        if !self.line.is_empty() || !self.cell.is_empty() {
            self.end_cell();
        }
        let row = std::mem::take(&mut self.row);
        if row.is_empty() {
            return;
        }
        self.close_list();
        if self.rows.len() < MAX_TABLE_ROWS {
            self.rows.push(row);
        } else {
            self.losses.cut_cells += row.len();
        }
    }

    /// The blocks, with any open list or table closed.
    pub fn finish(mut self) -> (Vec<Block>, Losses, usize) {
        if !self.line.is_empty() {
            self.end_paragraph(&ParaProps::default());
        }
        if !self.row.is_empty() || !self.cell.is_empty() {
            self.end_row();
        }
        self.close_table();
        self.close_list();
        (self.blocks, self.losses, self.tables)
    }

    fn list_item(&mut self, props: ListProps, content: Vec<Inline>) {
        let restart = self
            .list
            .as_ref()
            .is_some_and(|list| props.level == 0 && list.ordered != props.ordered);
        if restart {
            self.close_list();
        }
        let list = self.list.get_or_insert_with(|| ListState {
            ordered: props.ordered,
            start: props.start.max(1),
            items: Vec::new(),
        });
        add_item(&mut list.items, props.level.min(MAX_LIST_LEVEL), props.ordered, content);
    }

    fn close_list(&mut self) {
        if let Some(list) = self.list.take() {
            self.blocks.push(Block::List {
                ordered: list.ordered,
                start: list.start,
                items: list.items,
            });
        }
    }

    fn close_table(&mut self) {
        if !self.row.is_empty() || !self.cell.is_empty() {
            self.end_row();
        }
        let mut rows = std::mem::take(&mut self.rows);
        if rows.is_empty() {
            return;
        }
        self.close_list();
        let width = rows.iter().map(Vec::len).max().unwrap_or(0);
        for row in &mut rows {
            row.resize(width, Vec::new());
        }
        self.tables += 1;
        self.blocks.push(Block::Table { header: true, rows });
    }
}

/// Adds an item at a list level, under the last item of the level above.
fn add_item(items: &mut Vec<Item>, level: u8, ordered: bool, content: Vec<Inline>) {
    let Some(last) = items.last_mut().filter(|_| level > 0) else {
        items.push(Item {
            task: None,
            blocks: vec![Block::Paragraph(content)],
        });
        return;
    };
    if let Some(Block::List { items: sub, .. }) = last.blocks.last_mut() {
        add_item(sub, level - 1, ordered, content);
        return;
    }
    let mut sub = Vec::new();
    add_item(&mut sub, level - 1, ordered, content);
    last.blocks.push(Block::List {
        ordered,
        start: 1,
        items: sub,
    });
}

/// Inlines without line breaks or blank text at either end.
fn trim_breaks(mut content: Vec<Inline>) -> Vec<Inline> {
    while matches!(content.last(), Some(Inline::HardBreak)) {
        content.pop();
    }
    while matches!(content.first(), Some(Inline::HardBreak)) {
        content.remove(0);
    }
    let blank = content.iter().all(|i| match i {
        Inline::Text { text, .. } => text.trim().is_empty(),
        _ => false,
    });
    if blank {
        content.clear();
    }
    content
}

/// The address in a field instruction such as `HYPERLINK "https://example.org"`, when it is a web or mail
/// address.
pub(super) fn hyperlink(instruction: &str) -> Option<String> {
    let rest = instruction.trim_start().strip_prefix("HYPERLINK")?.trim_start();
    let url = match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => rest.split_whitespace().next()?,
    };
    match dest::for_import(url) {
        ImportLink::Keep(kept) if dest::has_scheme(&kept, &["http", "https", "mailto"]) => Some(kept),
        _ => None,
    }
}

/// One page from a text document's blocks, with the report of what did not come over.
pub(super) fn text_page(env: &ImportEnv<'_>, name: &str, flow: Flow) -> Result<Converted> {
    let (blocks, losses, tables) = flow.finish();
    let title = blocks
        .iter()
        .find_map(|b| match b {
            Block::Heading { content, .. } => Some(plain_text(content)),
            _ => None,
        })
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| name.to_owned());
    let now = env.clock.now();
    let mut builder = PageBuilder::new(env, &title, now, now);
    builder.push_blocks(blocks);
    let mut report = PageReport {
        title,
        source: name.to_owned(),
        entries: Vec::new(),
    };
    report.came_over("text and formatting");
    report.came_over_count(tables, "table", "tables");
    report_losses(&mut report, &losses);
    Ok(Converted {
        pages: vec![ConvertedPage {
            section: None,
            page: builder.finish()?,
            report,
        }],
        general: Vec::new(),
    })
}

fn report_losses(report: &mut PageReport, losses: &Losses) {
    report.skipped_count(
        losses.pictures,
        ("picture", "pictures"),
        "OpenNote reads the text of this older format. Save the file as .docx to bring pictures over.",
    );
    report.skipped_count(
        losses.drawings,
        ("drawing or object", "drawings and objects"),
        "OpenNote reads pictures only, and not from this older format.",
    );
    report.skipped_count(
        losses.notes,
        ("footnote or endnote", "footnotes and endnotes"),
        "The footnote and endnote text is not imported.",
    );
    report.skipped_count(losses.comments, ("comment", "comments"), "Comments are not imported.");
    report.simplified_count(
        losses.nested_tables,
        ("table inside a table", "tables inside tables"),
        "Each became lines of text in its cell.",
    );
    report.skipped_count(
        losses.cut_cells,
        ("table cell past the size limit", "table cells past the size limit"),
        "A table keeps at most 64 columns and 10,000 rows.",
    );
    if losses.cut_text {
        report.skipped("text past 48 MiB", "A page holds less than that.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn para(flow: &mut Flow, text: &str, props: ParaProps) {
        flow.text(text, &Marks::none());
        flow.end_paragraph(&props);
    }

    #[test]
    fn lists_and_tables_group_their_paragraphs() {
        let mut flow = Flow::default();
        let item = |level| ParaProps {
            list: Some(ListProps {
                ordered: false,
                level,
                start: 1,
            }),
            ..ParaProps::default()
        };
        para(&mut flow, "one", item(0));
        para(&mut flow, "one.a", item(1));
        para(&mut flow, "two", item(0));
        flow.text("a", &Marks::none());
        flow.end_cell();
        flow.text("b", &Marks::none());
        flow.end_cell();
        flow.end_row();
        flow.text("c", &Marks::none());
        flow.end_cell();
        flow.end_row();
        para(&mut flow, "after", ParaProps::default());
        let (blocks, _, tables) = flow.finish();
        assert_eq!(tables, 1);
        assert_eq!(blocks.len(), 3);
        let Block::List { items, .. } = &blocks[0] else {
            panic!("a list")
        };
        assert_eq!(items.len(), 2);
        assert!(matches!(items[0].blocks.last(), Some(Block::List { .. })));
        let Block::Table { rows, .. } = &blocks[1] else {
            panic!("a table")
        };
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].len(), 2, "short rows are padded");
    }

    #[test]
    fn only_web_and_mail_links_are_kept() {
        assert_eq!(
            hyperlink(r#"HYPERLINK "https://example.com/" \o "tip""#).as_deref(),
            Some("https://example.com/")
        );
        assert_eq!(hyperlink("HYPERLINK mailto:a@b.c").as_deref(), Some("mailto:a@b.c"));
        assert_eq!(hyperlink(r#"HYPERLINK "file:///c:/x""#), None);
        assert_eq!(hyperlink(r#"HYPERLINK "javascript:alert(1)""#), None);
        assert_eq!(hyperlink("PAGE"), None);
    }
}
