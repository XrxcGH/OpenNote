//! The report's document-wide entries: how the document was cut into pages, what came over, and a count for
//! each kind of thing that was dropped or simplified (DESIGN 9.2).

use std::io::{Read, Seek};

use super::body::Stats;
use super::package::Package;
use super::pages::Cut;
use super::{Document, SetupReport, TrackedChanges};
use crate::report::PageReport;

/// How the document was cut into pages, for the report.
pub(super) fn cut_entries(cut: Cut, pages: usize, report: &mut PageReport) {
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
}

/// The document-wide things that came over, and the tracked changes the import settled.
pub(super) fn found_entries(doc: &Document, changes: TrackedChanges, report: &mut PageReport) {
    let (stats, setup) = (&doc.stats, &doc.setup_report);
    report.came_over_count(setup.styles, "style", "styles");
    if doc.setup.paper.is_some() {
        report.came_over("page size and margins");
    }
    report.came_over_count(setup.bands.kept, "header or footer", "headers and footers");
    report.came_over_count(stats.footnotes, "footnote", "footnotes");
    report.came_over_count(stats.endnotes, "endnote", "endnotes");
    report.came_over_count(doc.records.comments.len(), "comment", "comments");
    report.came_over_count(stats.suggestions, "suggested change", "suggested changes");
    let settled = match changes {
        TrackedChanges::Reject => "The import rejected it, as asked.",
        TrackedChanges::Accept => "The import accepted it, as asked.",
        TrackedChanges::Suggest => {
            "It was inside a table, note, or comment, which cannot hold suggestions, so it was accepted."
        }
    };
    report.simplified_count(stats.settled, ("tracked change", "tracked changes"), settled);
    report.simplified_count(
        stats.para_changes,
        (
            "tracked change to paragraph breaks or formatting",
            "tracked changes to paragraph breaks or formatting",
        ),
        "The paragraphs show as the document shows them now.",
    );
}

/// What the document lost or simplified: one count for each kind of thing.
pub(super) fn loss_entries<R: Read + Seek>(
    stats: &Stats,
    setup: &SetupReport,
    package: &Package<R>,
    report: &mut PageReport,
) {
    report.skipped_count(
        setup.further_sections,
        ("section after the first", "sections after the first"),
        "Only the first section's paper and margins became the page's.",
    );
    report.simplified_count(
        setup.bands.simplified,
        ("header or footer", "headers and footers"),
        "Only the text of the first line and its page fields came over.",
    );
    report.skipped_count(
        setup.styles_dropped,
        ("style past the 64 a page holds", "styles past the 64 a page holds"),
        "Their paragraphs show in the Normal style.",
    );
    format_losses(stats, report);
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
        "The file does not hold the footnote or endnote text.",
    );
    report.skipped_count(
        package.sources.dropped_comments,
        (
            "comment past the 10,000 an import reads",
            "comments past the 10,000 an import reads",
        ),
        "Their ranges show as plain text.",
    );
    report.simplified_count(
        stats.hidden_runs,
        ("piece of hidden text", "pieces of hidden text"),
        "Hidden text shows as visible text, so nothing is lost.",
    );
    for part in &package.unread_parts {
        report.skipped(
            (*part).to_owned(),
            "OpenNote does not import this part of a Word file yet.",
        );
    }
}

/// The run formatting that could not come over as it was.
fn format_losses(stats: &Stats, report: &mut PageReport) {
    report.skipped_count(
        stats.effects,
        (
            "run with glow, reflection, 3-D, or gradient text",
            "runs with glow, reflection, 3-D, or gradient text",
        ),
        "OpenNote does not draw these effects.",
    );
    report.simplified_count(
        stats.script_fonts,
        (
            "run with separate fonts for other scripts",
            "runs with separate fonts for other scripts",
        ),
        "OpenNote keeps one font per run: the font of the run's script.",
    );
    report.simplified_count(
        stats.style_overrides,
        (
            "run without its style's color, font, or size",
            "runs without their style's color, font, or size",
        ),
        "Text cannot take away such a value of its style, so the style's look shows.",
    );
    report.skipped_count(
        stats.table_marks,
        (
            "note, comment, or suggestion inside a table",
            "notes, comments, and suggestions inside tables",
        ),
        "Table cells keep their text only.",
    );
}
