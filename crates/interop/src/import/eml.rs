//! Importing email files (`.eml`): one page for each message.
//!
//! The page is titled with the subject. A table at the top holds From, To, Cc, and Date, then comes the body. The
//! body is the message's HTML part with its inline pictures, else its plain text. Attached files follow as file
//! blocks, and attached pictures as images. Nothing is fetched from the web: a picture the message links to
//! stays a link.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use super::html::describe;
use super::html_note;
use super::mht::{place_images, Resources};
use super::mime::{self, Part};
use crate::assets::{is_image, mime_from_extension};
use crate::dates::parse_date;
use crate::doc::{Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};
use crate::text::decode_labelled;

/// The largest message that is read into memory.
const MAX_BYTES: u64 = 256 << 20;

/// Imports an email file, or a folder of them, into a new notebook. Each file becomes a section.
pub fn import_eml(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_files(path, &EmlConverter, env, sink)
}

struct EmlConverter;

impl FileConverter for EmlConverter {
    fn label(&self) -> &'static str {
        "Email files"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["eml"]
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let size = fs::metadata(path).map_err(|e| InteropError::io(path, e))?.len();
        if size > MAX_BYTES {
            return Err(InteropError::TooBig(path.display().to_string()));
        }
        let bytes = fs::read(path).map_err(|e| InteropError::io(path, e))?;
        let stem = path
            .file_stem()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        convert_message(&bytes, &stem, env)
    }
}

/// The body part: the first HTML part that is not an attachment, else the first plain text part.
fn body_part(message: &mime::Message) -> Option<&Part> {
    let inline = |p: &&Part| p.file_name.is_none();
    message
        .parts
        .iter()
        .filter(inline)
        .find(|p| p.content_type == "text/html")
        .or_else(|| {
            message
                .parts
                .iter()
                .filter(inline)
                .find(|p| p.content_type.starts_with("text/"))
        })
}

fn convert_message(bytes: &[u8], name: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let message = mime::parse(bytes);
    let main = body_part(&message);
    let now = env.clock.now();
    let title = message
        .subject
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| name.to_owned());
    let created = message.date.as_deref().and_then(parse_date).unwrap_or(now);
    let mut report = PageReport {
        title: title.clone(),
        source: name.to_owned(),
        entries: Vec::new(),
    };
    let mut blocks = vec![header_table(&message)];
    let used: RefCell<Vec<(String, &Part)>> = RefCell::new(Vec::new());
    let mut stats = None;
    if let Some(main) = main {
        let text = decode_labelled(&main.body, main.charset.as_deref().unwrap_or("utf-8"));
        if main.content_type == "text/html" {
            let resources = Resources::new(&message.parts, main);
            let image_dest = |src: &str| -> Option<String> {
                let part = resources.find(src)?;
                let key = format!("{:p}", part);
                let mut used = used.borrow_mut();
                if !used.iter().any(|(k, _)| *k == key) {
                    used.push((key.clone(), part));
                }
                Some(format!("media:{key}"))
            };
            let note = html_note::read(&text.text, &image_dest, &HashMap::new());
            blocks.extend(note.blocks);
            stats = Some(note.stats);
        } else {
            blocks.extend(plain_blocks(&text.text));
        }
    } else {
        report.skipped("message text", "The message has no text part.");
    }
    let mut builder = PageBuilder::new(env, &title, created, created);
    let used_parts = used.borrow().clone();
    let (placed, lost) = place_images(&mut blocks, &mut builder, &used_parts);
    builder.push_blocks(blocks);
    // Attached files and pictures, except the pictures the body already shows.
    let shown: Vec<*const Part> = used_parts.iter().map(|(_, p)| *p as *const Part).collect();
    let (mut files, mut images, mut too_big) = (0usize, 0usize, 0usize);
    let mut total = 0usize;
    for part in &message.parts {
        let is_body = main.is_some_and(|m| std::ptr::eq(m, part));
        let duplicate_text = part.file_name.is_none() && part.content_type.starts_with("text/");
        if is_body || duplicate_text || shown.contains(&(part as *const Part)) || part.body.is_empty() {
            continue;
        }
        total = total.saturating_add(part.body.len());
        if total > MAX_BYTES as usize {
            too_big += 1;
            continue;
        }
        let file = part
            .file_name
            .clone()
            .unwrap_or_else(|| format!("attachment-{}", files + images + 1));
        let mime = if part.content_type.is_empty() || part.content_type == "application/octet-stream" {
            mime_from_extension(file.rsplit_once('.').map_or("", |(_, e)| e)).to_owned()
        } else {
            part.content_type.clone()
        };
        let id = builder.add_asset(&file, Some(&mime), part.body.clone());
        if is_image(&mime) {
            builder.push_image(id, file);
            images += 1;
        } else {
            builder.push_file(id);
            files += 1;
        }
    }
    report.came_over("subject, sender, recipients, and date");
    if main.is_some() {
        report.came_over("message text");
    }
    report.came_over_count(placed, "inline picture", "inline pictures");
    report.came_over_count(images, "attached picture", "attached pictures");
    report.came_over_count(files, "attached file", "attached files");
    report.skipped_count(
        lost,
        (
            "inline picture that is not in the message",
            "inline pictures that are not in the message",
        ),
        "The message refers to a picture that the file does not hold.",
    );
    report.skipped_count(
        too_big,
        ("attachment past the size limit", "attachments past the size limit"),
        "Attachments together are limited to 256 MiB.",
    );
    if let Some(stats) = &stats {
        describe(stats, &mut report);
    }
    Ok(Converted {
        pages: vec![ConvertedPage {
            section: None,
            page: builder.finish()?,
            report,
        }],
        general: Vec::new(),
    })
}

/// A table of the headers that the message has, with bold names.
fn header_table(message: &mime::Message) -> Block {
    let bold = Marks {
        strong: true,
        ..Marks::none()
    };
    let rows: Vec<Vec<Vec<Inline>>> = [
        ("From", &message.from),
        ("To", &message.to),
        ("Cc", &message.cc),
        ("Date", &message.date),
    ]
    .into_iter()
    .filter_map(|(label, value)| {
        let value = value.as_deref()?.trim();
        (!value.is_empty()).then(|| vec![vec![Inline::marked(label, bold.clone())], vec![Inline::text(value)]])
    })
    .collect();
    Block::Table { header: false, rows }
}

/// Plain text as paragraphs: a blank line starts a new one, and a line break inside one stays.
fn plain_blocks(text: &str) -> Vec<Block> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    normalized
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|paragraph| {
            let mut inlines = Vec::new();
            for (n, line) in paragraph.trim_matches('\n').split('\n').enumerate() {
                if n > 0 {
                    inlines.push(Inline::HardBreak);
                }
                inlines.push(Inline::text(line.trim_end()));
            }
            Block::Paragraph(inlines)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestEnv;

    const MAIL: &str = "From: =?UTF-8?Q?Ren=C3=A9e?= <renee@example.org>\r\n\
        To: me@example.org\r\n\
        Subject: Lab times\r\n\
        Date: Tue, 5 Mar 2024 10:00:00 +0000\r\n\
        MIME-Version: 1.0\r\n\
        Content-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n\
        --b1\r\n\
        Content-Type: text/plain; charset=utf-8\r\n\r\n\
        See you at nine.\r\nBring the notes.\r\n\r\nThanks\r\n\
        --b1\r\n\
        Content-Type: application/pdf; name=\"times.pdf\"\r\n\
        Content-Disposition: attachment; filename=\"times.pdf\"\r\n\
        Content-Transfer-Encoding: base64\r\n\r\n\
        JVBERi0xLjQK\r\n\
        --b1--\r\n";

    #[test]
    fn a_message_becomes_a_page_with_headers_text_and_attachments() {
        let world = TestEnv::new();
        let env = world.env();
        let done = convert_message(MAIL.as_bytes(), "mail", &env).expect("converts");
        let page = &done.pages[0].page.page;
        assert_eq!(page.title, "Lab times");
        let kinds: Vec<&'static str> = page
            .blocks
            .iter()
            .map(|b| match &b.data {
                opennote_core::model::BlockData::Table(_) => "table",
                opennote_core::model::BlockData::Text(_) => "text",
                opennote_core::model::BlockData::File(_) => "file",
                _ => "other",
            })
            .collect();
        assert_eq!(kinds, ["table", "text", "file"]);
        assert!(done.pages[0]
            .report
            .entries
            .iter()
            .any(|e| e.what.contains("attached file")));
    }
}
