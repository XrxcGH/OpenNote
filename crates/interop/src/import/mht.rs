//! Importing web page archives (`.mht` and `.mhtml`), including the single file web pages that OneNote saves.
//!
//! The archive is a message in the MIME format: one HTML part and the images it uses. Images are found by their
//! `Content-Location`, their `Content-ID`, or just their file name, because OneNote writes the paths of the
//! computer that saved the file. The page's title comes from the HTML, and OneNote's date and time lines under
//! the title become the created date.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use opennote_core::Timestamp;

use super::dateline::{looks_like_date, looks_like_time};
use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use super::html::describe;
use super::html_note;
use super::mime::{self, Part};
use crate::assets::{is_image, mime_from_extension};
use crate::dates::{parse_date, parse_long_date};
use crate::doc::{plain_text, visit_inlines_mut, Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};
use crate::text::decode_labelled;

/// The largest archive that is read into memory.
const MAX_BYTES: u64 = 512 << 20;

/// Imports a web page archive, or a folder of them, into a new notebook. Each file becomes a section.
pub fn import_mht(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_files(path, &MhtConverter, env, sink)
}

struct MhtConverter;

impl FileConverter for MhtConverter {
    fn label(&self) -> &'static str {
        "Web page archives"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["mht", "mhtml"]
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

/// Resources of a message, found by the names a page uses for them.
struct Resources<'a> {
    by_name: HashMap<String, &'a Part>,
    by_file: HashMap<String, &'a Part>,
}

impl<'a> Resources<'a> {
    fn new(parts: &'a [Part], main: &Part) -> Resources<'a> {
        let mut resources = Resources {
            by_name: HashMap::new(),
            by_file: HashMap::new(),
        };
        for part in parts.iter().filter(|p| !std::ptr::eq(*p, main)) {
            if let Some(location) = &part.location {
                resources.by_name.entry(normalize(location)).or_insert(part);
                if let Some(file) = file_of(location) {
                    resources.by_file.entry(file).or_insert(part);
                }
            }
            if let Some(id) = &part.id {
                resources
                    .by_name
                    .entry(format!("cid:{}", id.to_lowercase()))
                    .or_insert(part);
            }
            if let Some(name) = &part.file_name {
                resources.by_file.entry(name.to_lowercase()).or_insert(part);
            }
        }
        resources
    }

    /// The resource a page address names: the whole address first, then only the file name.
    fn find(&self, src: &str) -> Option<&'a Part> {
        let key = normalize(src);
        self.by_name
            .get(&key)
            .or_else(|| file_of(src).and_then(|f| self.by_file.get(&f)))
            .copied()
    }
}

fn normalize(address: &str) -> String {
    super::scan::percent_decode(address.trim())
        .to_lowercase()
        .replace('\\', "/")
}

fn file_of(address: &str) -> Option<String> {
    let cleaned = address.split(['#', '?']).next().unwrap_or("");
    let name = super::scan::percent_decode(cleaned).replace('\\', "/");
    let file = name.rsplit('/').next()?.to_lowercase();
    (!file.is_empty()).then_some(file)
}

/// Converts the bytes of an archive into a page. `name` stands in for a title the page does not give.
pub(super) fn convert_message(bytes: &[u8], name: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let message = mime::parse(bytes);
    let main = main_part(&message).ok_or_else(|| InteropError::format(name, "it holds no HTML page"))?;
    let html = decode_labelled(&main.body, main.charset.as_deref().unwrap_or("utf-8"));
    let resources = Resources::new(&message.parts, main);
    let used: RefCell<Vec<(String, &Part)>> = RefCell::new(Vec::new());
    let media: HashMap<String, String> = HashMap::new();
    let image_dest = |src: &str| -> Option<String> {
        let part = resources.find(src)?;
        let key = format!("{:p}", part);
        let mut used = used.borrow_mut();
        if !used.iter().any(|(k, _)| *k == key) {
            used.push((key.clone(), part));
        }
        Some(format!("media:{key}"))
    };
    let mut note = html_note::read(&html.text, &image_dest, &media);
    let now = env.clock.now();
    let title = note
        .title
        .clone()
        .or_else(|| message.subject.clone().filter(|s| !s.trim().is_empty()))
        .unwrap_or_else(|| name.to_owned());
    let header_date = strip_header(&mut note.blocks, &title);
    let created = note
        .created
        .or(header_date)
        .or_else(|| message.date.as_deref().and_then(parse_date))
        .unwrap_or(now);
    let modified = note.modified.unwrap_or(created).max(created);
    let mut report = PageReport {
        title: title.clone(),
        source: name.to_owned(),
        entries: Vec::new(),
    };
    let mut builder = PageBuilder::new(env, &title, created, modified);
    builder.set_tags(note.tags.clone());
    let (placed, lost) = place_images(&mut note.blocks, &mut builder, &used.borrow());
    let tables = note.blocks.iter().filter(|b| matches!(b, Block::Table { .. })).count();
    builder.push_blocks(note.blocks);
    report.came_over("text and formatting");
    report.came_over_count(tables, "table", "tables");
    report.came_over_count(placed, "image", "images");
    if header_date.is_some() {
        report.came_over("date and time under the title");
    }
    let missing = note.stats.missing_images + lost;
    report.skipped_count(
        missing,
        ("image that is not in the archive", "images that are not in the archive"),
        "The page refers to a picture that the file does not hold.",
    );
    describe(&note.stats, &mut report);
    Ok(Converted {
        pages: vec![ConvertedPage {
            section: None,
            page: builder.finish()?,
            report,
        }],
        general: Vec::new(),
    })
}

/// The part that holds the page: the one `start` names, else the first HTML part, else the first text part.
fn main_part(message: &mime::Message) -> Option<&Part> {
    let by_start = message
        .start
        .as_ref()
        .and_then(|start| message.parts.iter().find(|p| p.id.as_ref() == Some(start)));
    by_start
        .or_else(|| message.parts.iter().find(|p| p.content_type == "text/html"))
        .or_else(|| message.parts.iter().find(|p| p.content_type.starts_with("text/")))
}

/// Puts the pictures the page used into its assets. Returns how many were placed and how many could not be.
fn place_images(blocks: &mut [Block], builder: &mut PageBuilder<'_>, used: &[(String, &Part)]) -> (usize, usize) {
    let mut cache: HashMap<String, Option<String>> = HashMap::new();
    let (mut placed, mut lost) = (0, 0);
    visit_inlines_mut(blocks, &mut |inlines| {
        for inline in inlines.iter_mut() {
            let Inline::Image { dest, alt } = inline else {
                continue;
            };
            let Some(key) = dest.strip_prefix("media:").map(str::to_owned) else {
                continue;
            };
            let asset = cache
                .entry(key.clone())
                .or_insert_with(|| {
                    let part = used.iter().find(|(k, _)| *k == key).map(|(_, p)| *p)?;
                    let name = part
                        .file_name
                        .clone()
                        .or_else(|| part.location.as_deref().and_then(file_of))
                        .unwrap_or_else(|| "image".to_owned());
                    let mime = if part.content_type.starts_with("image/") {
                        part.content_type.clone()
                    } else {
                        mime_from_extension(name.rsplit_once('.').map_or("", |(_, e)| e)).to_owned()
                    };
                    is_image(&mime).then(|| builder.add_asset(&name, Some(&mime), part.body.clone()).to_string())
                })
                .clone();
            match asset {
                Some(id) => {
                    placed += 1;
                    *dest = format!("asset:{id}");
                }
                None => {
                    lost += 1;
                    let label = if alt.is_empty() { "image" } else { alt.as_str() };
                    *inline = Inline::marked(format!("[{label}]"), Marks::none());
                }
            }
        }
    });
    (placed, lost)
}

/// OneNote repeats the title as the first line, then writes the date and the time. Removes the lines and returns
/// the date they hold.
fn strip_header(blocks: &mut Vec<Block>, title: &str) -> Option<Timestamp> {
    let line = |block: &Block| match block {
        Block::Paragraph(inlines) | Block::Heading { content: inlines, .. } => {
            Some(plain_text(inlines).trim().to_owned())
        }
        _ => None,
    };
    let mut at = 0;
    if blocks
        .first()
        .and_then(line)
        .is_some_and(|l| l.eq_ignore_ascii_case(title.trim()))
    {
        at = 1;
    }
    let date = blocks.get(at).and_then(line).filter(|l| looks_like_date(l))?;
    let time = blocks.get(at + 1).and_then(line).filter(|l| looks_like_time(l));
    let combined = match &time {
        Some(time) => format!("{date} {time}"),
        None => date,
    };
    let created = parse_long_date(&combined)?;
    let remove = at + 1 + usize::from(time.is_some());
    blocks.drain(..remove);
    Some(created)
}
