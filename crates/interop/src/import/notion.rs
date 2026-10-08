//! Importing a Notion export: Markdown pages and CSV databases.
//!
//! Notion names every file and folder `Title <32 hex digits>`, writes a page's title as its first heading, and
//! puts the folder of a page's subpages beside it under the same name. A database is a CSV file, and each row is
//! a Markdown page whose first lines hold the row's properties. The import drops the IDs from names, makes
//! subpages of the pages in a page's folder, reads dates and tags from properties, and turns databases into
//! tables.

use std::path::Path;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::markdown::{describe_parse, drop_leading_title};
use super::scan::{has_notion_id, NoteFile};
use super::sheet::{cell, table_content};
use crate::dates::parse_long_date;
use crate::doc::parse::{parse, SoftBreaks};
use crate::doc::{Block, Inline};
use crate::error::Result;
use crate::frontmatter::FrontMatter;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// Property names that mark the first lines of a page as a database row's properties.
const KNOWN_PROPERTIES: &[&str] = &[
    "created",
    "created time",
    "created by",
    "last edited",
    "last edited time",
    "last edited by",
    "updated",
    "tags",
    "tag",
    "status",
    "date",
    "due",
    "due date",
    "priority",
    "assignee",
    "owner",
    "type",
    "url",
    "category",
];

/// Imports an unpacked Notion export into a new notebook.
pub fn import_notion_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(root, &NotionReader, env, sink)
}

/// Reads the pages and databases of a Notion export.
pub(super) struct NotionReader;

/// A name without the ID that Notion adds before the extension.
pub(super) fn strip_id(name: &str) -> String {
    let name = name.strip_suffix("_all").unwrap_or(name);
    if has_notion_id(name) {
        name[..name.len() - 33].trim_end().to_owned()
    } else {
        name.to_owned()
    }
}

impl NoteReader for NotionReader {
    fn label(&self, _root: &Path) -> String {
        "Notion export".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["md", "markdown", "csv"]
    }

    fn nested(&self) -> bool {
        true
    }

    fn clean_name(&self, raw: &str) -> String {
        strip_id(raw)
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        let is_csv = note.path.extension().is_some_and(|e| e.eq_ignore_ascii_case("csv"));
        if is_csv {
            read_database(text, note)
        } else {
            read_page(text, note)
        }
    }
}

fn read_database(text: &str, note: &NoteFile) -> NoteContent {
    if note.stem.ends_with("_all") && sibling_exists(note) {
        return NoteContent {
            skip: Some("It repeats the database's own file with every column, so no second table was made.".to_owned()),
            ..NoteContent::default()
        };
    }
    let simplified = (
        "database",
        "A Notion database became a table. Its views, filters, formulas, and relations were not kept.",
    );
    table_content(text, strip_id(&note.stem), Some(simplified))
}

/// Whether the database's own CSV sits beside an `_all` file.
fn sibling_exists(note: &NoteFile) -> bool {
    let name = note.stem.strip_suffix("_all").unwrap_or(&note.stem);
    note.path.with_file_name(format!("{name}.csv")).is_file()
}

fn read_page(text: &str, note: &NoteFile) -> NoteContent {
    let prepared = callouts(text);
    let (title, rest) = split_title(&prepared);
    let title = title.unwrap_or_else(|| strip_id(&note.stem));
    let (properties, body) = split_properties(rest);
    let mut parsed = parse(body, SoftBreaks::Hard);
    drop_leading_title(&mut parsed.blocks, &title);
    let mut report = PageReport::default();
    describe_parse(&parsed.notes, &FrontMatter::default(), &mut report);
    let mut content = NoteContent {
        title,
        blocks: parsed.blocks,
        ..NoteContent::default()
    };
    apply_properties(&properties, &mut content, &mut report);
    content.notes = report.entries;
    content
}

/// The text of the first heading, and the text after it.
fn split_title(text: &str) -> (Option<String>, &str) {
    let trimmed = text.trim_start_matches(['\n', '\r']);
    match trimmed.strip_prefix("# ") {
        Some(after) => {
            let (line, rest) = after.split_once('\n').unwrap_or((after, ""));
            (Some(line.trim().to_owned()).filter(|t| !t.is_empty()), rest)
        }
        None => (None, text),
    }
}

/// Splits off the lines right after the title that are `Key: Value` properties of a database row. Returns the
/// properties and the rest of the text.
fn split_properties(text: &str) -> (Vec<(String, String)>, &str) {
    let text = text.trim_start_matches(['\n', '\r']);
    let end = text
        .find("\n\n")
        .or_else(|| text.find("\r\n\r\n"))
        .unwrap_or(text.len());
    let block = &text[..end];
    let lines: Vec<(String, String)> = block
        .lines()
        .filter_map(|line| {
            let (key, value) = line
                .split_once(": ")
                .or_else(|| line.strip_suffix(':').map(|k| (k, "")))?;
            let plausible =
                !key.is_empty() && key.chars().count() <= 40 && !key.contains(['.', '|', '`', '[', '*', '#']);
            plausible.then(|| (key.trim().to_owned(), value.trim().to_owned()))
        })
        .collect();
    let all_lines = block.lines().count();
    let known = lines
        .iter()
        .any(|(k, _)| KNOWN_PROPERTIES.contains(&k.to_lowercase().as_str()));
    if lines.len() == all_lines && all_lines > 0 && (known || all_lines >= 2) && !block.starts_with(['-', '>', '|']) {
        (lines, &text[end..])
    } else {
        (Vec::new(), text)
    }
}

/// Moves dates and tags from the properties into the note, and puts the rest in a table at the top.
fn apply_properties(properties: &[(String, String)], content: &mut NoteContent, report: &mut PageReport) {
    let mut table: Vec<Vec<Vec<Inline>>> = Vec::new();
    for (key, value) in properties {
        match key.to_lowercase().as_str() {
            "created" | "created time" | "created at" => content.created = parse_long_date(value),
            "last edited" | "last edited time" | "updated" | "last updated" => {
                content.modified = parse_long_date(value)
            }
            "tags" | "tag" => content
                .tags
                .extend(value.split(',').map(|t| t.trim().to_owned()).filter(|t| !t.is_empty())),
            _ => table.push(vec![vec![Inline::text(key.as_str())], cell(value)]),
        }
    }
    if table.is_empty() {
        return;
    }
    table.insert(0, vec![vec![Inline::text("Property")], vec![Inline::text("Value")]]);
    content.blocks.insert(
        0,
        Block::Table {
            header: true,
            rows: table,
        },
    );
    report.came_over(format!("{} database properties as a table", properties.len()));
}

/// Turns Notion's `<aside>` callouts into Markdown callouts, so the parser reads them as callouts.
fn callouts(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut inside = false;
    let mut first = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("<aside>") {
            inside = true;
            first = true;
        } else if trimmed.eq_ignore_ascii_case("</aside>") {
            inside = false;
            out.push('\n');
        } else if inside {
            if first {
                let (kind, rest) = callout_kind(trimmed);
                out.push_str(&format!("> [!{kind}]\n"));
                if !rest.is_empty() {
                    out.push_str(&format!("> {rest}\n"));
                }
                first = false;
            } else {
                out.push_str(&format!("> {line}\n"));
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// The callout type that a leading emoji stands for, and the text after the emoji.
fn callout_kind(line: &str) -> (&'static str, &str) {
    let first = line.chars().next();
    let is_symbol = first.is_some_and(|c| !c.is_alphanumeric() && !c.is_ascii());
    if !is_symbol {
        return ("note", line);
    }
    let rest = line
        .trim_start_matches(|c: char| !c.is_alphanumeric() && !c.is_ascii_punctuation() || c == '\u{fe0f}')
        .trim_start();
    let kind = match first {
        Some('\u{1f4a1}') => "tip",
        Some('\u{26a0}') => "warning",
        Some('\u{2757}' | '\u{203c}') => "important",
        Some('\u{2753}' | '\u{2754}') => "question",
        Some('\u{1f6a8}') => "danger",
        _ => "note",
    };
    (kind, rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_come_off_names_and_extensions_stay_out_of_it() {
        let id = "0123456789abcdef0123456789abcdef";
        assert_eq!(strip_id(&format!("Trip plan {id}")), "Trip plan");
        assert_eq!(strip_id(&format!("Tasks {id}_all")), "Tasks");
        assert_eq!(strip_id("Plain name"), "Plain name");
        assert_eq!(strip_id("Short 123"), "Short 123");
    }

    #[test]
    fn properties_split_off_only_when_they_look_like_properties() {
        let (props, rest) = split_properties("Created: October 1, 2026 9:30 AM\nTags: a, b\nStatus: Done\n\nBody");
        assert_eq!(props.len(), 3);
        assert_eq!(rest.trim(), "Body");
        let (props, rest) = split_properties("Note: remember to bring the book\n\nBody");
        assert!(props.is_empty(), "one unknown key is just a sentence");
        assert!(rest.starts_with("Note"));
        let (props, _) = split_properties("Status: Done\n\nBody");
        assert_eq!(props.len(), 1, "a known key is enough");
    }

    #[test]
    fn asides_become_callouts_with_a_kind_from_the_emoji() {
        let text = callouts("Before\n<aside>\n\u{1f4a1} Remember this\nSecond line\n</aside>\nAfter\n");
        assert_eq!(text, "Before\n> [!tip]\n> Remember this\n> Second line\n\nAfter\n");
    }
}
