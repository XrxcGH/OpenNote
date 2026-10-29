//! The state that turns converted blocks into LaTeX text. The parts live in `inline`, `blocks`, `table`, and `page`.

use std::collections::HashMap;

use super::escape::{self, Missing};
use super::{Citation, Engine};
use crate::doc::Inline;
use crate::report::PageReport;

/// How many blocks may nest before the rest is left out. LaTeX itself stops at six nested lists.
pub(super) const MAX_NEST: usize = 24;
/// How many lists and quotes may nest. Deeper ones are written as plain paragraphs.
pub(super) const MAX_LISTS: usize = 5;
/// The most columns of a table. More are left out.
pub(super) const MAX_COLUMNS: usize = 60;

/// What the writer changed or left out on one page, for its report.
#[derive(Default, Clone)]
pub(super) struct Stats {
    pub equations: usize,
    pub math_as_text: usize,
    pub cropped_images: usize,
    pub remote_images: usize,
    pub too_deep: usize,
    pub wide_tables: usize,
    pub footnotes: usize,
    pub citations: usize,
    pub extra_bibliographies: usize,
    pub links_as_text: usize,
}

impl Stats {
    /// Adds what happened on the page to its report.
    pub(super) fn describe(&self, missing: &Missing, report: &mut PageReport) {
        report.came_over_count(self.equations, "equation", "equations");
        report.came_over_count(self.footnotes, "footnote", "footnotes");
        report.came_over_count(self.citations, "citation", "citations");
        let math = ("equation shown as text", "equations shown as text");
        let why = "Its TeX is not one that LaTeX can set safely, so it stays as typed.";
        report.simplified_count(self.math_as_text, math, why);
        let crop = ("cropped image shown whole", "cropped images shown whole");
        report.simplified_count(self.cropped_images, crop, "LaTeX shows the whole picture.");
        let remote = (
            "image on the web shown as its description",
            "images on the web shown as their descriptions",
        );
        report.simplified_count(self.remote_images, remote, "A LaTeX file cannot fetch pictures.");
        let links = ("link kept as text", "links kept as text");
        report.simplified_count(self.links_as_text, links, "Only web and mail addresses become links.");
        let deep = ("block nested too deeply", "blocks nested too deeply");
        report.skipped_count(self.too_deep, deep, "LaTeX cannot nest this far.");
        let wide = ("table with too many columns", "tables with too many columns");
        report.simplified_count(self.wide_tables, wide, "The columns past the sixtieth were left out.");
        let extra = ("extra bibliography", "extra bibliographies");
        report.simplified_count(self.extra_bibliographies, extra, "A document has one bibliography.");
        if !missing.chars.is_empty() {
            let shown: String = missing.chars.iter().take(8).collect();
            report.simplified(
                format!("{} characters pdfLaTeX cannot show, such as {shown}", missing.chars.len()),
                "They are question marks. Choose the Unicode setting and compile with XeLaTeX or LuaLaTeX to keep them.",
            );
        }
    }
}

/// The citation library, looked up by source ID.
pub(super) struct Library {
    pub entries: Vec<Citation>,
    by_id: HashMap<String, usize>,
}

impl Library {
    pub(super) fn new(entries: Vec<Citation>) -> Library {
        let by_id = entries
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.id.clone(), index))
            .collect();
        Library { entries, by_id }
    }

    pub(super) fn find(&self, id: &str) -> Option<&Citation> {
        self.by_id.get(id).map(|index| &self.entries[*index])
    }
}

/// Turns blocks into LaTeX.
pub(super) struct Writer<'a> {
    pub engine: Engine,
    pub missing: Missing,
    pub stats: Stats,
    pub library: &'a Library,
    /// The footnotes of the page being written.
    pub notes: Vec<Vec<Inline>>,
    /// Whether a footnote may be written here, which it may not in headings, tables, and other footnotes.
    pub allow_notes: bool,
    /// The notes met so far in the cells of the table being written, as LaTeX; `None` outside a table that may carry
    /// notes. A cell cannot hold `\footnote`, so the cell gets a `\footnotemark` and the table is followed by the text.
    pub table_notes: Option<Vec<String>>,
    /// Whether the text is for a heading, which keeps only what a table of contents and a PDF outline can hold.
    pub simple: bool,
    /// The pages of the document, by their number, that a link can jump to.
    pub pages: usize,
    /// The heading level of the page being written. A heading of level `n` in the page is level `base + n`.
    pub base: usize,
    /// The keys cited, in the order of their first citation.
    pub cited: Vec<String>,
    /// The keys the bibliography lists, including keys that nothing cites.
    pub listed: Vec<String>,
    /// Whether a bibliography has been written.
    pub bibliography: bool,
}

impl<'a> Writer<'a> {
    pub(super) fn new(engine: Engine, library: &'a Library, pages: usize) -> Writer<'a> {
        Writer {
            engine,
            missing: Missing::default(),
            stats: Stats::default(),
            library,
            notes: Vec::new(),
            allow_notes: true,
            table_notes: None,
            simple: false,
            pages,
            base: 0,
            cited: Vec::new(),
            listed: Vec::new(),
            bibliography: false,
        }
    }

    /// Escaped text.
    pub(super) fn esc(&mut self, text: &str) -> String {
        escape::text(
            &crate::export::footnotes::strip_markers(text),
            self.engine,
            &mut self.missing,
        )
    }
}
