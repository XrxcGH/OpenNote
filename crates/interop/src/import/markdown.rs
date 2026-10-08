//! Importing a folder of Markdown notes: an Obsidian vault, a Joplin export, or any other folder.
//!
//! Each folder becomes a section, and each note becomes a page. The import reads front matter for the title, the
//! dates, and the tags. It turns wiki links and relative links into page links, and copies the images and
//! attachments that notes use.

use std::path::Path;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::scan::{Flavor, NoteFile};
use super::tags::hashtags;
use crate::doc::parse::{parse, Notes, SoftBreaks};
use crate::doc::{plain_text, Block};
use crate::error::Result;
use crate::frontmatter::{self, FrontMatter};
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// Imports a folder of Markdown notes into a new notebook, and reports what came over.
pub fn import_markdown_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    match Flavor::detect(root) {
        Flavor::Notion => import_folder(root, &super::notion::NotionReader, env, sink),
        Flavor::Logseq => import_folder(root, &super::logseq::LogseqReader, env, sink),
        flavor => import_folder(root, &MarkdownReader::new(flavor), env, sink),
    }
}

/// Reads Markdown notes.
pub(super) struct MarkdownReader {
    flavor: Flavor,
}

impl MarkdownReader {
    pub fn new(flavor: Flavor) -> MarkdownReader {
        MarkdownReader { flavor }
    }
}

impl NoteReader for MarkdownReader {
    fn label(&self, _root: &Path) -> String {
        self.flavor.label().to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["md", "markdown"]
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        let (front, body) = frontmatter::split(text);
        let front = front.unwrap_or_default();
        let title = front.text(&["title"]).unwrap_or(&note.stem).to_owned();
        let created = front.date(&["created", "created_time", "created_at", "date"]);
        let modified = front.date(&["updated", "updated_time", "updated_at", "modified", "last_modified"]);
        let mut parsed = parse(body, SoftBreaks::Hard);
        drop_leading_title(&mut parsed.blocks, &title);
        let mut report = PageReport::default();
        describe_parse(&parsed.notes, &front, &mut report);
        NoteContent {
            title,
            tags: front.tags(),
            blocks: parsed.blocks,
            created,
            modified,
            notes: report.entries,
            skip: None,
        }
    }

    fn find_tags(&self, blocks: &[Block]) -> Vec<String> {
        hashtags(blocks)
    }

    fn alias_names(&self, head: &str) -> Vec<String> {
        let (front, _) = frontmatter::split(head);
        let Some(front) = front else {
            return Vec::new();
        };
        let mut names = front.aliases();
        names.extend(front.text(&["title"]).map(str::to_owned));
        names
    }
}

/// Drops a first heading that repeats the title, because the page already shows its title.
pub(super) fn drop_leading_title(blocks: &mut Vec<Block>, title: &str) {
    let repeats = match blocks.first() {
        Some(Block::Heading { level: 1, content }) => plain_text(content).trim().eq_ignore_ascii_case(title.trim()),
        _ => false,
    };
    if repeats {
        blocks.remove(0);
    }
}

/// What the Markdown parser dropped or simplified.
pub(super) fn describe_parse(notes: &Notes, front: &FrontMatter, report: &mut PageReport) {
    let tags = ("HTML tag", "HTML tags");
    report.simplified_count(
        notes.html_dropped,
        tags,
        "OpenNote keeps only a few HTML tags, so the others were dropped and their text kept.",
    );
    let tables = ("table inside a list or quote", "tables inside lists or quotes");
    report.simplified_count(notes.tables_flattened, tables, "Each became plain lines.");
    let keys = front.unused_keys();
    if !keys.is_empty() {
        report.skipped(
            format!("front matter keys: {}", keys.join(", ")),
            "OpenNote has no place for them yet.",
        );
    }
}
