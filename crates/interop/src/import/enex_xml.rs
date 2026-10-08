//! Reading the XML of an ENEX file, one note at a time.

use std::io::BufRead;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::doc::html_tags::decode_entities;
use crate::error::{InteropError, Result};

/// One attachment, as the file holds it.
#[derive(Default)]
pub struct RawResource {
    /// The data in base64, with line breaks.
    pub data: String,
    /// The media type.
    pub mime: String,
    /// The original file name, if the note has it.
    pub file_name: String,
}

/// One note, as the file holds it.
#[derive(Default)]
pub struct RawNote {
    /// The title.
    pub title: String,
    /// The created date, such as `20240105T143000Z`.
    pub created: String,
    /// The updated date.
    pub updated: String,
    /// The tags.
    pub tags: Vec<String>,
    /// The ENML text.
    pub content: String,
    /// The web address a clipped note came from.
    pub source_url: String,
    /// Whether the note has an author, a location, or other details that OpenNote does not keep.
    pub has_details: bool,
    /// The attachments.
    pub resources: Vec<RawResource>,
}

/// Reads the file and calls `on_note` for each note as its `note` element ends. A file that stops in the middle of
/// a note is an error, and the notes before it have been delivered.
pub fn read_notes<R: BufRead>(input: R, on_note: &mut dyn FnMut(RawNote) -> Result<()>) -> Result<()> {
    let mut reader = Reader::from_reader(input);
    let config = reader.config_mut();
    config.allow_dangling_amp = true;
    config.check_end_names = false;
    let mut scanner = Scanner::default();
    let mut buffer = Vec::new();
    loop {
        let event = reader.read_event_into(&mut buffer);
        match event.map_err(|e| InteropError::format("the ENEX file", e.to_string()))? {
            Event::Start(tag) => scanner.start(tag.name().as_ref().to_lowercase()),
            Event::Text(t) => scanner.text.push_str(&t.xml10_content()),
            Event::CData(c) => scanner.text.push_str(&c.xml10_content()),
            Event::GeneralRef(r) => scanner
                .text
                .push_str(&decode_entities(&format!("&{};", r.xml10_content()))),
            Event::End(_) => {
                if let Some(note) = scanner.end() {
                    on_note(note)?;
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    match scanner.note {
        Some(_) => Err(InteropError::format("the ENEX file", "it ends in the middle of a note")),
        None => Ok(()),
    }
}

/// Follows the open elements, and collects the text of the one being read.
#[derive(Default)]
struct Scanner {
    path: Vec<String>,
    text: String,
    note: Option<RawNote>,
    resource: Option<RawResource>,
}

impl Scanner {
    fn start(&mut self, name: String) {
        match name.as_str() {
            "note" => self.note = Some(RawNote::default()),
            "resource" => self.resource = Some(RawResource::default()),
            _ => {}
        }
        self.path.push(name);
        self.text.clear();
    }

    /// Closes an element. Returns the note when it is the `note` element that ended.
    fn end(&mut self) -> Option<RawNote> {
        let name = self.path.pop().unwrap_or_default();
        let parent = self.path.last().cloned().unwrap_or_default();
        let text = std::mem::take(&mut self.text);
        match name.as_str() {
            "resource" => {
                if let (Some(note), Some(resource)) = (self.note.as_mut(), self.resource.take()) {
                    note.resources.push(resource);
                }
            }
            "note" => return self.note.take(),
            _ => self.store(&name, &parent, text),
        }
        None
    }

    /// Keeps the text of a leaf element where the note or the resource holds it.
    fn store(&mut self, name: &str, parent: &str, text: String) {
        if matches!(parent, "resource" | "resource-attributes") {
            if let Some(resource) = self.resource.as_mut() {
                match name {
                    "data" => resource.data = text,
                    "mime" => resource.mime = text.trim().to_owned(),
                    "file-name" => resource.file_name = text.trim().to_owned(),
                    _ => {}
                }
            }
            return;
        }
        let Some(note) = self.note.as_mut() else {
            return;
        };
        match (parent, name) {
            ("note", "title") => note.title = text,
            ("note", "created") => note.created = text,
            ("note", "updated") => note.updated = text,
            ("note", "tag") => note.tags.push(text.trim().to_owned()),
            ("note", "content") => note.content = text,
            ("note-attributes", "source-url") => note.source_url = text.trim().to_owned(),
            ("note-attributes", "author" | "latitude" | "longitude" | "altitude" | "reminder-order") => {
                note.has_details |= !text.trim().is_empty();
            }
            _ => {}
        }
    }
}
