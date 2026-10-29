//! Importing the files of handwriting apps: Goodnotes (`.goodnotes`), Notability (`.note`), and Samsung Notes
//! (`.sdocx`). See ADR 0053.
//!
//! Each file becomes a section, and a folder of them, such as a Goodnotes backup, keeps its folders in the section
//! names, through the driver in `files.rs`. All three formats are ZIP packages that their makers do not document.
//! What OpenNote reads comes from public descriptions of the containers and from what the packages show:
//!
//! - Notability keeps its writing in `Session.plist`, a binary property list from NSKeyedArchiver. Its curves come
//!   over as strokes with their colors, widths, and pressure. Typed text, pictures, recordings, and PDF files
//!   come over too.
//! - Goodnotes keeps each page in `notes/` and its PDF files and pictures in `attachments/`. The pages come over
//!   in the order its index gives, with their attachments. Its handwriting layer is private and stays behind,
//!   and the report says so.
//! - Samsung Notes keeps each page in a `.page` file and its pictures and recordings in `media/`. The pages come
//!   over in order with their media and any text the package holds as XML. Its handwriting stays behind too.
//!
//! What cannot be read is named in the report as not imported, with the dependable route: each app's PDF export,
//! which the PDF import brings in as pages to write on.

mod bplist;
mod container;
#[cfg(any(feature = "fuzzing", feature = "testing", test))]
pub mod fixtures;
mod goodnotes;
mod ink;
mod keyed;
mod media;
mod notability;
mod protobuf;
mod samsung;
#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::path::Path;

use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use crate::doc::{push_text, Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

use ink::Curve;
use media::Media;

/// Fuzz entry points and fixture writers.
#[cfg(any(feature = "fuzzing", feature = "testing", test))]
pub mod fuzzing {
    pub use super::bplist::write as plist_write;
    pub use super::bplist::Plist;
    pub use super::fixtures;
    pub use super::keyed::Keyed;
    pub use super::protobuf::{fields as protobuf_fields, strings as protobuf_strings, write as protobuf_write};
}

/// The apps whose files this module reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotesApp {
    /// Goodnotes.
    Goodnotes,
    /// Notability.
    Notability,
    /// Samsung Notes.
    SamsungNotes,
}

impl NotesApp {
    /// The app that saves files with this extension, in lowercase.
    pub fn from_extension(extension: &str) -> Option<NotesApp> {
        match extension {
            "goodnotes" => Some(NotesApp::Goodnotes),
            "note" => Some(NotesApp::Notability),
            "sdocx" => Some(NotesApp::SamsungNotes),
            _ => None,
        }
    }

    /// What the file is called, for the dialog and the report.
    pub fn label(self) -> &'static str {
        match self {
            NotesApp::Goodnotes => "Goodnotes document",
            NotesApp::Notability => "Notability note",
            NotesApp::SamsungNotes => "Samsung Notes note",
        }
    }

    /// The app's name.
    pub fn name(self) -> &'static str {
        match self {
            NotesApp::Goodnotes => "Goodnotes",
            NotesApp::Notability => "Notability",
            NotesApp::SamsungNotes => "Samsung Notes",
        }
    }

    /// How to make the PDF export that always imports.
    pub fn pdf_route(self) -> &'static str {
        match self {
            NotesApp::Goodnotes => {
                "To keep it, export the notebook as a PDF in Goodnotes (Share, then Export, then PDF) and import that PDF."
            }
            NotesApp::Notability => {
                "To keep it, export the note as a PDF in Notability (Share, then PDF) and import that PDF."
            }
            NotesApp::SamsungNotes => {
                "To keep it, save the note as a PDF in Samsung Notes (Share, then PDF file) and import that PDF."
            }
        }
    }
}

/// The extensions this module reads.
pub const EXTENSIONS: [&str; 3] = ["goodnotes", "note", "sdocx"];

/// Imports a Goodnotes, Notability, or Samsung Notes file, or a folder of them, into a new notebook.
pub fn import_notes_apps(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_files(path, &NotesConverter, env, sink)
}

struct NotesConverter;

impl FileConverter for NotesConverter {
    fn label(&self) -> &'static str {
        "Goodnotes, Notability, and Samsung Notes files"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &EXTENSIONS
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let extension = path
            .extension()
            .map_or_else(String::new, |e| e.to_string_lossy().to_ascii_lowercase());
        let stem = path
            .file_stem()
            .map_or_else(|| "Imported note".to_owned(), |n| n.to_string_lossy().into_owned());
        match NotesApp::from_extension(&extension) {
            Some(NotesApp::Goodnotes) => goodnotes::convert(path, &stem, env),
            Some(NotesApp::Notability) => notability::convert(path, &stem, env),
            Some(NotesApp::SamsungNotes) => samsung::convert(path, &stem, env),
            None => Err(InteropError::unsupported(
                stem,
                "OpenNote does not know this kind of file.",
            )),
        }
    }
}

/// A file found in a package, to put on a page.
#[derive(Clone, Debug)]
pub(crate) struct Attachment {
    /// Its name, with an extension.
    pub name: String,
    /// What it is.
    pub kind: Media,
    /// Its bytes.
    pub bytes: Vec<u8>,
}

/// What one page will hold.
#[derive(Debug, Default)]
pub(crate) struct PageParts {
    pub title: String,
    pub text: Vec<String>,
    pub curves: Vec<Curve>,
    /// Curves left out while reading, before conversion: those with no point and those past the page's limits.
    pub dropped: usize,
    pub attachments: Vec<Attachment>,
}

/// Makes a page from its parts, and notes in the report what came over.
pub(crate) fn build_page(
    parts: PageParts,
    app: NotesApp,
    env: &ImportEnv<'_>,
    report: &mut PageReport,
) -> Result<ConvertedPage> {
    let now = env.clock.now();
    let mut builder = PageBuilder::new(env, &parts.title, now, now);
    let paragraphs: Vec<Block> = parts
        .text
        .iter()
        .filter(|t| !t.trim().is_empty())
        .map(|t| paragraph(t))
        .collect();
    report.came_over_count(paragraphs.len(), "text box", "text boxes");
    builder.push_blocks(paragraphs);
    let (mut pictures, mut pdfs, mut recordings, mut other) = (0, 0, 0, 0);
    for attachment in parts.attachments {
        match attachment.kind {
            Media::Image(mime, _) => {
                let asset = builder.add_asset(&attachment.name, Some(mime), attachment.bytes);
                builder.push_image(asset, String::new());
                pictures += 1;
            }
            Media::Pdf => {
                let asset = builder.add_asset(&attachment.name, Some("application/pdf"), attachment.bytes);
                builder.push_file(asset);
                pdfs += 1;
            }
            Media::Audio(mime, _) => {
                let asset = builder.add_asset(&attachment.name, Some(mime), attachment.bytes);
                builder.push_file(asset);
                recordings += 1;
            }
            Media::Other => {
                let asset = builder.add_asset(&attachment.name, None, attachment.bytes);
                builder.push_file(asset);
                other += 1;
            }
        }
    }
    report.came_over_count(pictures, "picture", "pictures");
    report.simplified_count(
        pdfs,
        ("PDF background", "PDF backgrounds"),
        &format!(
            "It is attached to the page as a file. To write on its pages, import the PDF that {} exports.",
            app.name()
        ),
    );
    report.simplified_count(
        recordings,
        ("audio recording", "audio recordings"),
        "It is attached to the page as a file you can play. Its timing with the writing did not come over.",
    );
    report.came_over_count(other, "attached file", "attached files");
    if !parts.curves.is_empty() || parts.dropped > 0 {
        let layer = builder.ink_layer();
        let (strokes, mut stats) = ink::strokes(&parts.curves, layer, now, env);
        stats.dropped += parts.dropped;
        for stroke in strokes {
            builder.add_stroke(stroke);
        }
        report.came_over_count(stats.strokes - stats.highlighter, "pen stroke", "pen strokes");
        report.came_over_count(stats.highlighter, "highlighter stroke", "highlighter strokes");
        report.skipped_count(
            stats.dropped,
            ("stroke", "strokes"),
            "It had no usable points, or the page already held as much ink as one page takes.",
        );
    }
    let page = builder.finish()?;
    Ok(ConvertedPage {
        section: None,
        page,
        report: std::mem::take(report),
    })
}

/// A paragraph block of plain text, with its line breaks kept.
fn paragraph(text: &str) -> Block {
    let mut inlines = Vec::new();
    for (n, line) in text.lines().enumerate() {
        if n > 0 {
            inlines.push(Inline::HardBreak);
        }
        push_text(&mut inlines, line, &Marks::default());
    }
    Block::Paragraph(inlines)
}

/// The most text runs [`text_runs`] collects.
const MAX_RUNS: usize = 100_000;

/// The runs of printable ASCII, and of printable UTF-16 in little-endian order, at least `min` characters long,
/// with the names inside each run (split at characters that do not appear in file names and IDs). Binary page
/// files name their pictures this way, so a picture can go on the page that names it.
pub(crate) fn text_runs(bytes: &[u8], min: usize) -> HashSet<String> {
    let mut found = HashSet::new();
    let printable = |b: u8| (0x20..0x7f).contains(&b);
    let mut add = |run: &mut String| {
        if run.len() >= min && found.len() < MAX_RUNS {
            for piece in run.split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))) {
                if piece.len() >= min {
                    found.insert(piece.to_owned());
                }
            }
            found.insert(std::mem::take(run));
        }
        run.clear();
    };
    let mut run = String::new();
    for &byte in bytes {
        if printable(byte) {
            run.push(char::from(byte));
        } else {
            add(&mut run);
        }
    }
    add(&mut run);
    for offset in 0..2 {
        for &[low, high] in bytes.get(offset..).unwrap_or_default().as_chunks::<2>().0 {
            if high == 0 && printable(low) {
                run.push(char::from(low));
            } else {
                add(&mut run);
            }
        }
        add(&mut run);
    }
    found
}

/// Whether the runs name `name`, alone or as a part of a path.
pub(crate) fn names(runs: &HashSet<String>, name: &str) -> bool {
    !name.is_empty() && runs.contains(name)
}

/// An attachment read from a package, with the ID or name a page uses for it. `None` once it is placed.
pub(crate) type Named = (String, Option<Attachment>);

/// Past this many attachments, they all go on the first page instead of being matched to pages.
const MATCH_LIMIT: usize = 500;

/// Reads attachments, telling each kind by its first bytes. Entries that cannot be read are noted and skipped.
pub(crate) fn read_attachments(
    package: &mut container::Package,
    members: &[container::Member],
    env: &ImportEnv<'_>,
    general: &mut PageReport,
) -> Result<Vec<Named>> {
    let mut out = Vec::new();
    for member in members {
        env.control.checkpoint()?;
        match package.read(member)? {
            Ok(bytes) => {
                let kind = media::sniff(&bytes, &member.extension());
                let extension = match kind {
                    Media::Image(_, e) | Media::Audio(_, e) => e,
                    Media::Pdf => "pdf",
                    Media::Other => "bin",
                };
                let id = member.file_name().to_owned();
                let name = media::file_name(&id, extension);
                out.push((id, Some(Attachment { name, kind, bytes })));
            }
            Err(why) => general.skipped(member.name.clone(), why),
        }
    }
    Ok(out)
}

/// Puts each attachment on the first page whose data names it (in runs of at least `min` characters), and the
/// rest on the first page. There is always at least one page.
pub(crate) fn place(
    package: &mut container::Package,
    pages: &[container::Member],
    mut attachments: Vec<Named>,
    min: usize,
    env: &ImportEnv<'_>,
) -> Result<Vec<Vec<Attachment>>> {
    let mut placed: Vec<Vec<Attachment>> = (0..pages.len().max(1)).map(|_| Vec::new()).collect();
    if attachments.len() <= MATCH_LIMIT {
        for (n, page) in pages.iter().enumerate() {
            env.control.checkpoint()?;
            package.check_time()?;
            let Ok(bytes) = package.read(page)? else {
                continue;
            };
            let runs = text_runs(&bytes, min);
            for (id, slot) in &mut attachments {
                if slot.is_some() && names(&runs, id) {
                    if let (Some(found), Some(list)) = (slot.take(), placed.get_mut(n)) {
                        list.push(found);
                    }
                }
            }
        }
    }
    if let Some(first) = placed.first_mut() {
        first.extend(attachments.into_iter().filter_map(|(_, a)| a));
    }
    Ok(placed)
}

/// The pages of a package whose handwriting stays behind.
pub(crate) struct PrivatePages<'a> {
    pub app: NotesApp,
    /// The file, for the report.
    pub path: &'a Path,
    /// The attachments of each page, in order.
    pub pages: Vec<Vec<Attachment>>,
    /// Text for the first page.
    pub text: Vec<String>,
    /// What stays behind on each page, named in its report.
    pub left: Option<&'static str>,
}

/// Makes one page for each list of attachments, titled by `titles`.
pub(crate) fn private_pages(
    plan: PrivatePages<'_>,
    titles: impl Fn(usize) -> String,
    env: &ImportEnv<'_>,
    general: &mut PageReport,
) -> Result<Converted> {
    let PrivatePages {
        app,
        path,
        pages,
        mut text,
        left,
    } = plan;
    let mut out = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    for (n, attachments) in pages.into_iter().enumerate() {
        env.control.checkpoint()?;
        let title = titles(n);
        let mut page = PageReport {
            title: title.clone(),
            source: format!("{} › {title}", path.display()),
            entries: Vec::new(),
        };
        if let Some(what) = left {
            let why = format!(
                "{} keeps them in a private format that OpenNote cannot read yet. {}",
                app.name(),
                app.pdf_route()
            );
            page.skipped(what, why);
        }
        let parts = PageParts {
            title: title.clone(),
            text: std::mem::take(&mut text),
            attachments,
            ..PageParts::default()
        };
        let made = build_page(parts, app, env, &mut page);
        keep_page(made, &title, &mut out, general)?;
    }
    out.general = std::mem::take(&mut general.entries);
    Ok(out)
}

/// Notes the entries a package refused in a file's general report.
pub(crate) fn note_refused(refused: &[(String, String)], general: &mut PageReport) {
    for (name, why) in refused {
        general.skipped(name.clone(), why.clone());
    }
}

/// The page's result: the page, or an entry saying why it was left out. Cancel goes through.
pub(crate) fn keep_page(
    made: Result<ConvertedPage>,
    title: &str,
    out: &mut Converted,
    general: &mut PageReport,
) -> Result<()> {
    match made {
        Ok(page) => out.pages.push(page),
        Err(InteropError::Canceled) => return Err(InteropError::Canceled),
        Err(error) => general.skipped(title.to_owned(), format!("It could not be made into a page ({error}).")),
    }
    Ok(())
}
