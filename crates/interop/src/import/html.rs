//! Importing a folder of HTML pages: OpenNote's own HTML export, pages saved from a browser, or any website folder.
//!
//! Each folder becomes a section and each page a note. Links between pages become page links, and local images
//! and files are copied in, as with Markdown folders.

use std::collections::HashMap;
use std::path::Path;

use super::enml::EnmlStats;
use super::folder::{import_folder, NoteContent, NoteReader};
use super::html_note;
use super::scan::NoteFile;
use crate::error::Result;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// Imports a folder of HTML pages into a new notebook, and reports what came over.
pub fn import_html_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(root, &HtmlReader, env, sink)
}

/// Reads HTML pages.
pub(super) struct HtmlReader;

impl NoteReader for HtmlReader {
    fn label(&self, _root: &Path) -> String {
        "HTML folder".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["html", "htm"]
    }

    fn read(&self, text: &str, _note: &NoteFile) -> NoteContent {
        if text.contains("name=\"opennote:index\"") {
            return NoteContent {
                skip: Some("It is the index page that OpenNote's export writes, so no page was made.".to_owned()),
                ..NoteContent::default()
            };
        }
        let note = html_note::read(text, &|src| Some(src.to_owned()), &HashMap::new());
        let mut report = PageReport::default();
        describe(&note.stats, &mut report);
        NoteContent {
            title: note.title.unwrap_or_default(),
            blocks: note.blocks,
            tags: note.tags,
            created: note.created,
            modified: note.modified,
            notes: report.entries,
            skip: None,
            table_kinds: Vec::new(),
        }
    }
}

/// What reading the HTML dropped or simplified.
pub(super) fn describe(stats: &EnmlStats, report: &mut PageReport) {
    let styled = (
        "element with its own font or size",
        "elements with their own fonts or sizes",
    );
    report.simplified_count(
        stats.styled,
        styled,
        "OpenNote keeps bold, italic, underline, and color only.",
    );
    let anchors = ("link to a place in the same page", "links to places in the same page");
    report.simplified_count(stats.anchors, anchors, "Only the link text was kept.");
    let dropped = ("link that cannot be followed", "links that cannot be followed");
    report.simplified_count(
        stats.dropped_links,
        dropped,
        "Links to scripts, local files, and other apps were not kept. Their text stays.",
    );
}
