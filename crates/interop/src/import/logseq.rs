//! Importing a Logseq graph: the `pages` and `journals` folders of outline notes.
//!
//! Logseq pages are Markdown outlines with their own marks. This import turns `TODO` and `DONE` into task list
//! items, `title::` and `tags::` properties into the page's title and tags, `#[[long tags]]` into tags, and
//! journal files named `2026_10_02` into pages titled `2026-10-02` with that date. Block references, embeds,
//! queries, scheduling, and logbook drawers have no home in OpenNote yet, so the report counts them.

use std::path::Path;

use opennote_core::Timestamp;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::markdown::{describe_parse, drop_leading_title};
use super::scan::NoteFile;
use super::tags::hashtags;
use crate::dates::parse_date;
use crate::doc::parse::{parse, SoftBreaks};
use crate::doc::Block;
use crate::error::Result;
use crate::frontmatter::FrontMatter;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// Imports a Logseq graph into a new notebook.
pub fn import_logseq_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(root, &LogseqReader, env, sink)
}

/// Reads Logseq pages.
pub(super) struct LogseqReader;

impl NoteReader for LogseqReader {
    fn label(&self, _root: &Path) -> String {
        "Logseq graph".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["md", "markdown"]
    }

    fn clean_name(&self, raw: &str) -> String {
        match raw {
            "pages" => "Pages".to_owned(),
            "journals" => "Journals".to_owned(),
            other => other.replace("___", "/").replace("%2F", "/"),
        }
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        let journal = journal_date(note);
        let mut counts = Counts::default();
        let (properties, body) = split_properties(text);
        let mut tags = Vec::new();
        let mut title = None;
        for (key, value) in &properties {
            match key.as_str() {
                "title" => title = Some(value.clone()),
                "tags" | "tag" => tags.extend(list_of(value)),
                "alias" | "aliases" => {}
                _ => counts.properties += 1,
            }
        }
        let cleaned = clean_body(&body, &mut tags, &mut counts);
        let mut parsed = parse(&cleaned, SoftBreaks::Hard);
        let title = title
            .filter(|t| !t.trim().is_empty())
            .or_else(|| journal.clone().map(|(label, _)| label))
            .unwrap_or_else(|| self.clean_name(&note.stem));
        drop_leading_title(&mut parsed.blocks, &title);
        let mut report = PageReport::default();
        describe_parse(&parsed.notes, &FrontMatter::default(), &mut report);
        counts.describe(&mut report);
        NoteContent {
            title,
            blocks: parsed.blocks,
            tags,
            created: journal.map(|(_, date)| date),
            modified: None,
            notes: report.entries,
            skip: None,
        }
    }

    fn find_tags(&self, blocks: &[Block]) -> Vec<String> {
        hashtags(blocks)
    }

    fn ignored_extensions(&self) -> &'static [&'static str] {
        &["edn"]
    }

    fn alias_names(&self, head: &str) -> Vec<String> {
        let (properties, _) = split_properties(head);
        let mut names = Vec::new();
        for (key, value) in properties {
            match key.as_str() {
                "title" => names.push(value),
                "alias" | "aliases" => names.extend(list_of(&value)),
                _ => {}
            }
        }
        names
    }
}

/// What the cleaning dropped, for the report.
#[derive(Default)]
struct Counts {
    properties: usize,
    block_refs: usize,
    macros: usize,
    scheduled: usize,
    logbook: usize,
}

impl Counts {
    fn describe(&self, report: &mut PageReport) {
        report.skipped_count(
            self.properties,
            ("page property", "page properties"),
            "OpenNote keeps only the title and tags.",
        );
        report.simplified_count(
            self.block_refs,
            ("block reference", "block references"),
            "OpenNote links to pages, so each became the words [block reference].",
        );
        report.skipped_count(
            self.macros,
            ("embed or query", "embeds and queries"),
            "They run inside Logseq, so they were left out.",
        );
        report.simplified_count(
            self.scheduled,
            ("scheduled or deadline date", "scheduled and deadline dates"),
            "Each became a line of text.",
        );
        report.skipped_count(
            self.logbook,
            ("logbook", "logbooks"),
            "The time tracking of a task was left out.",
        );
    }
}

/// The date of a journal page and its title: the file `2026_10_02.md` in `journals`.
fn journal_date(note: &NoteFile) -> Option<(String, Timestamp)> {
    if note.dir.last().map(String::as_str) != Some("journals") {
        return None;
    }
    let iso = note.stem.replace('_', "-");
    let date = parse_date(&iso)?;
    Some((iso, date))
}

/// Splits off the properties at the top of a page: lines like `title:: Name`, with or without a bullet.
fn split_properties(text: &str) -> (Vec<(String, String)>, String) {
    let mut properties = Vec::new();
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.peek() {
        let bare = line.trim().trim_start_matches("- ").trim();
        match bare.split_once(":: ") {
            Some((key, value)) if is_key(key) => {
                properties.push((key.trim().to_lowercase(), value.trim().to_owned()));
                lines.next();
            }
            _ if bare.is_empty() && !properties.is_empty() => {
                lines.next();
            }
            _ => break,
        }
    }
    (properties, lines.collect::<Vec<_>>().join("\n"))
}

fn is_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A list of names: comma separated, with or without `[[brackets]]`.
fn list_of(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|t| {
            t.trim()
                .trim_start_matches("[[")
                .trim_end_matches("]]")
                .trim_start_matches('#')
                .trim()
                .to_owned()
        })
        .filter(|t| !t.is_empty())
        .collect()
}

/// Rewrites Logseq's marks into Markdown that the parser understands.
fn clean_body(body: &str, tags: &mut Vec<String>, counts: &mut Counts) -> String {
    let mut out = String::with_capacity(body.len());
    let mut in_logbook = false;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case(":LOGBOOK:") {
            in_logbook = true;
            counts.logbook += 1;
            continue;
        }
        if in_logbook {
            in_logbook = !trimmed.eq_ignore_ascii_case(":END:");
            continue;
        }
        let bare = trimmed.trim_start_matches("- ");
        if let Some((key, _)) = bare.split_once(":: ") {
            if is_key(key) {
                counts.properties += usize::from(key != "id" && key != "collapsed");
                continue;
            }
        }
        let line = tasks(line);
        let line = scheduling(&line, counts);
        let line = long_tags(&line, tags);
        let line = block_refs(&line, counts);
        let line = macros(&line, counts);
        out.push_str(&line);
        out.push('\n');
    }
    out
}

/// `- TODO text` becomes `- [ ] text`, and `- DONE text` becomes `- [x] text`.
fn tasks(line: &str) -> String {
    let indent = line.len() - line.trim_start().len();
    let rest = &line[indent..];
    let (bullet, text) = match rest.strip_prefix("- ") {
        Some(text) => ("- ", text),
        None => ("", rest),
    };
    for marker in ["TODO", "DOING", "NOW", "LATER", "WAITING", "IN-PROGRESS"] {
        if let Some(task) = text.strip_prefix(marker).and_then(|t| t.strip_prefix(' ')) {
            return format!(
                "{}{}{}[ ] {task}",
                &line[..indent],
                bullet,
                if bullet.is_empty() { "- " } else { "" }
            );
        }
    }
    if let Some(task) = text.strip_prefix("DONE ") {
        return format!(
            "{}{}{}[x] {task}",
            &line[..indent],
            bullet,
            if bullet.is_empty() { "- " } else { "" }
        );
    }
    for marker in ["CANCELED ", "CANCELLED "] {
        if let Some(task) = text.strip_prefix(marker) {
            return format!(
                "{}{}{}[x] ~~{task}~~",
                &line[..indent],
                bullet,
                if bullet.is_empty() { "- " } else { "" }
            );
        }
    }
    line.to_owned()
}

/// `SCHEDULED: <2026-10-02 Fri>` becomes the line `Scheduled: 2026-10-02`.
fn scheduling(line: &str, counts: &mut Counts) -> String {
    let trimmed = line.trim();
    for (marker, label) in [("SCHEDULED:", "Scheduled"), ("DEADLINE:", "Deadline")] {
        if let Some(rest) = trimmed.strip_prefix(marker) {
            counts.scheduled += 1;
            let date = rest
                .trim()
                .trim_start_matches('<')
                .split_whitespace()
                .next()
                .unwrap_or("");
            let indent = &line[..line.len() - line.trim_start().len()];
            return format!("{indent}{label}: {date}");
        }
    }
    line.to_owned()
}

/// `#[[long tag]]` becomes the words `long tag`, and the tag is kept.
fn long_tags(line: &str, tags: &mut Vec<String>) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(at) = rest.find("#[[") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 3..];
        match after.find("]]") {
            Some(end) => {
                let tag = after[..end].trim();
                if !tag.is_empty() {
                    tags.push(tag.to_owned());
                    out.push_str(tag);
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[at..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `((uuid))` becomes `[block reference]`.
///
/// The position of the next `))` is kept for every `((` before it, so a line of many `((` is searched once. Once a
/// search fails, the rest of the line is copied as it is.
fn block_refs(line: &str, counts: &mut Counts) -> String {
    let mut out = String::new();
    let mut rest = line;
    let mut close: Option<usize> = None;
    while let Some(at) = rest.find("((") {
        let start = line.len() - rest.len() + at + 2;
        let end = match close.filter(|end| *end >= start) {
            Some(end) => end,
            None => match line[start..].find("))") {
                Some(found) => start + found,
                None => break,
            },
        };
        close = Some(end);
        let inner = &line[start..end];
        if inner.len() >= 8 && inner.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
            out.push_str(&rest[..at]);
            out.push_str("[block reference]");
            counts.block_refs += 1;
            rest = &line[end + 2..];
        } else {
            out.push_str(&rest[..at + 2]);
            rest = &line[start..];
        }
    }
    out.push_str(rest);
    out
}

/// Removes `{{embed ...}}`, `{{query ...}}`, and other macros.
fn macros(line: &str, counts: &mut Counts) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(at) = rest.find("{{") {
        out.push_str(&rest[..at]);
        match rest[at..].find("}}") {
            Some(end) => {
                counts.macros += 1;
                rest = &rest[at + end + 2..];
            }
            None => {
                out.push_str(&rest[at..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_references_are_found_in_one_pass() {
        let mut counts = Counts::default();
        let started = std::time::Instant::now();
        let open = "((".repeat(100_000);
        assert_eq!(block_refs(&open, &mut counts), open);
        let shared = format!("{open}))");
        assert_eq!(block_refs(&shared, &mut counts), shared);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(3),
            "{:?}",
            started.elapsed()
        );
        let line = "see ((6512bd43-d9ca-4f2b-a1c3-000000000001)) and ((x)) or ((((6512bd43))))";
        assert_eq!(
            block_refs(line, &mut counts),
            "see [block reference] and ((x)) or (([block reference]))"
        );
        assert_eq!(counts.block_refs, 2);
    }

    #[test]
    fn properties_at_the_top_give_the_title_and_tags() {
        let (props, body) = split_properties("title:: Cell biology\ntags:: [[bio]], exam\n\n- First block\n");
        assert_eq!(
            props,
            vec![
                ("title".to_owned(), "Cell biology".to_owned()),
                ("tags".to_owned(), "[[bio]], exam".to_owned())
            ]
        );
        assert_eq!(body.trim(), "- First block");
        assert_eq!(list_of("[[bio]], #exam, "), ["bio", "exam"]);
    }

    #[test]
    fn markers_become_markdown() {
        let mut counts = Counts::default();
        let mut tags = Vec::new();
        let text = [
            "- TODO write notes",
            "  - DONE read chapter",
            "- CANCELED skip it",
            "- see ((6501e0f2-1c3b-4f6f-9d7e-0123456789ab)) and #[[long tag]] {{embed [[x]]}}",
            "  SCHEDULED: <2026-10-02 Fri .+1w>",
            "  :LOGBOOK:",
            "  CLOCK: [2026-10-02 Fri 10:00]",
            "  :END:",
            "  id:: 6501e0f2-1c3b-4f6f-9d7e-0123456789ab",
            "",
        ]
        .join("\n");
        let text = text.as_str();
        let cleaned = clean_body(text, &mut tags, &mut counts);
        assert_eq!(
            cleaned,
            "- [ ] write notes\n  - [x] read chapter\n- [x] ~~skip it~~\n- see [block reference] and long tag \n  Scheduled: 2026-10-02\n"
        );
        assert_eq!(tags, ["long tag"]);
        assert_eq!(
            (counts.block_refs, counts.macros, counts.scheduled, counts.logbook),
            (1, 1, 1, 1)
        );
    }
}
