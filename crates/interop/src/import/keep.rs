//! Importing Google Keep notes from a Takeout export.
//!
//! Takeout writes a `Keep` folder with one JSON file for each note, an HTML copy of the same note, and the
//! pictures and audio the notes use. Each JSON file becomes a page. Labels become tags, checklists stay
//! checklists, pictures and files are copied from beside the note, and notes in the Archive go to a section of
//! their own. Notes in the Trash are left out.

use std::path::Path;

use opennote_core::Timestamp;
use serde_json::Value;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::scan::NoteFile;
use crate::assets::is_image;
use crate::doc::{Block, Inline, Item, Marks};
use crate::error::Result;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// Imports a Takeout export of Google Keep into a new notebook.
pub fn import_keep_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(root, &KeepReader, env, sink)
}

/// Whether a JSON file looks like a Keep note, from its first bytes.
pub fn looks_like_keep(first_bytes: &str) -> bool {
    first_bytes.contains("\"isTrashed\"") || first_bytes.contains("\"userEditedTimestampUsec\"")
}

/// Reads Keep notes.
pub(super) struct KeepReader;

impl NoteReader for KeepReader {
    fn label(&self, _root: &Path) -> String {
        "Google Keep export".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["json"]
    }

    fn ignored_extensions(&self) -> &'static [&'static str] {
        &["html", "htm"]
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        let Ok(json) = serde_json::from_str::<Value>(text) else {
            return skip("The file is not a Keep note.");
        };
        if json.get("isTrashed").and_then(Value::as_bool) == Some(true) {
            return skip("The note is in the Trash.");
        }
        if json.get("textContent").is_none() && json.get("listContent").is_none() && json.get("title").is_none() {
            return skip("The file is not a Keep note.");
        }
        read_note(&json, note)
    }
}

fn skip(why: &str) -> NoteContent {
    NoteContent {
        skip: Some(why.to_owned()),
        ..NoteContent::default()
    }
}

fn read_note(json: &Value, note: &NoteFile) -> NoteContent {
    let text = json.get("textContent").and_then(Value::as_str).unwrap_or("");
    let mut blocks = Vec::new();
    if !text.trim().is_empty() {
        for paragraph in text.split("\n\n") {
            blocks.push(Block::Paragraph(lines(paragraph)));
        }
    }
    let mut checked = 0;
    if let Some(list) = json.get("listContent").and_then(Value::as_array) {
        let items: Vec<Item> = list
            .iter()
            .filter_map(|entry| {
                let text = entry.get("text").and_then(Value::as_str)?.trim().to_owned();
                let done = entry.get("isChecked").and_then(Value::as_bool).unwrap_or(false);
                checked += usize::from(done);
                Some(Item {
                    task: Some(done),
                    blocks: vec![Block::Paragraph(vec![Inline::text(text)])],
                })
            })
            .collect();
        if !items.is_empty() {
            blocks.push(Block::List {
                ordered: false,
                start: 1,
                items,
            });
        }
    }
    let mut report = PageReport::default();
    add_annotations(json, &mut blocks);
    add_attachments(json, &mut blocks);
    let title = json
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let title = if title.is_empty() {
        title_from(&blocks, note)
    } else {
        title
    };
    let mut tags: Vec<String> = json
        .get("labels")
        .and_then(Value::as_array)
        .map(|labels| {
            labels
                .iter()
                .filter_map(|l| l.get("name").and_then(Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let archived = json.get("isArchived").and_then(Value::as_bool) == Some(true);
    if archived {
        tags.push("archived".to_owned());
    }
    if json.get("isPinned").and_then(Value::as_bool) == Some(true) {
        tags.push("pinned".to_owned());
    }
    let color = json.get("color").and_then(Value::as_str).unwrap_or("DEFAULT");
    if color != "DEFAULT" {
        report.simplified(
            "note color",
            "OpenNote pages do not have a background color for a note.",
        );
    }
    NoteContent {
        title,
        blocks,
        tags,
        created: usec(json, "createdTimestampUsec"),
        modified: usec(json, "userEditedTimestampUsec"),
        notes: report.entries,
        skip: None,
        table_kinds: Vec::new(),
    }
}

/// The lines of a paragraph, joined by line breaks.
fn lines(paragraph: &str) -> Vec<Inline> {
    let mut inlines = Vec::new();
    for (n, line) in paragraph.split('\n').enumerate() {
        if n > 0 {
            inlines.push(Inline::HardBreak);
        }
        inlines.push(Inline::text(line.trim_end()));
    }
    inlines
}

/// The first line of the note, cut at 60 characters, for notes that have no title; else the file name.
fn title_from(blocks: &[Block], note: &NoteFile) -> String {
    let first = blocks.iter().find_map(|b| match b {
        Block::Paragraph(inlines) => Some(crate::doc::plain_text(inlines)),
        Block::List { items, .. } => items.first().and_then(|i| match i.blocks.first() {
            Some(Block::Paragraph(p)) => Some(crate::doc::plain_text(p)),
            _ => None,
        }),
        _ => None,
    });
    match first.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()) {
        Some(text) => {
            let line = text.lines().next().unwrap_or("");
            let cut: String = line.chars().take(60).collect();
            if line.chars().count() > 60 {
                format!("{cut}...")
            } else {
                cut
            }
        }
        None => note.stem.clone(),
    }
}

fn usec(json: &Value, key: &str) -> Option<Timestamp> {
    let micros = json.get(key).and_then(Value::as_i64).filter(|v| *v > 0)?;
    Some(Timestamp::from_unix_ms(micros / 1000))
}

/// Links that Keep saved from the web become a list at the end of the note.
fn add_annotations(json: &Value, blocks: &mut Vec<Block>) {
    let Some(annotations) = json.get("annotations").and_then(Value::as_array) else {
        return;
    };
    let items: Vec<Item> = annotations
        .iter()
        .filter_map(|a| {
            let url = a.get("url").and_then(Value::as_str)?;
            let title = a
                .get("title")
                .and_then(Value::as_str)
                .filter(|t| !t.is_empty())
                .unwrap_or(url);
            Some(Item {
                task: None,
                blocks: vec![Block::Paragraph(vec![Inline::marked(title, Marks::link(url))])],
            })
        })
        .collect();
    if !items.is_empty() {
        blocks.push(Block::List {
            ordered: false,
            start: 1,
            items,
        });
    }
}

/// Pictures become images and other files become links that the folder import turns into attachments. The
/// paths are relative to the note, so the folder import finds the files.
fn add_attachments(json: &Value, blocks: &mut Vec<Block>) {
    let Some(attachments) = json.get("attachments").and_then(Value::as_array) else {
        return;
    };
    for attachment in attachments {
        let Some(path) = attachment.get("filePath").and_then(Value::as_str) else {
            continue;
        };
        let mime = attachment.get("mimetype").and_then(Value::as_str).unwrap_or("");
        if is_image(mime) {
            blocks.push(Block::Paragraph(vec![Inline::Image {
                dest: path.to_owned(),
                alt: String::new(),
            }]));
        } else {
            blocks.push(Block::Paragraph(vec![Inline::marked(path, Marks::link(path))]));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_notes_are_recognized_by_their_first_bytes() {
        assert!(looks_like_keep("{\"color\":\"DEFAULT\",\"isTrashed\":false"));
        assert!(!looks_like_keep("{\"name\":\"package\",\"version\":\"1.0\"}"));
    }
}
