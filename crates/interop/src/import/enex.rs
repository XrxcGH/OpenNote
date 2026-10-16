//! Importing Evernote export files (ENEX): each note becomes a page, with its dates, tags, and attachments.
//!
//! An ENEX file is XML with one `note` element for each note. The text is ENML inside a CDATA section, and each
//! attachment is a base64 `resource`. The file is read note by note, so a large export never sits in memory.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use opennote_core::model::NotebookFile;
use opennote_core::NotebookId;

use super::enex_xml::{read_notes, RawNote};
use super::enml::Converter;
use super::placement::{decode_resources, Placement};
use super::xmltree;
use crate::dates::parse_date;
use crate::doc::{Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Phase, Unit};
use crate::sink::{with_sink, ImportEnv, ImportSink};
use crate::tree::{section_orders, SectionBuilder};

/// Imports an ENEX file into a new notebook. A folder imports every `.enex` file in it, each as a section.
pub fn import_enex(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    if path.is_dir() {
        return import_enex_folder(path, env, sink);
    }
    let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
    let total = file.metadata().map(|m| m.len()).ok();
    let name = path
        .file_stem()
        .map_or_else(|| "Evernote".to_owned(), |n| n.to_string_lossy().into_owned());
    import_counted(BufReader::new(file), &name, total, env, sink)
}

/// Imports the `.enex` files of a folder into one notebook, with a section for each file.
fn import_enex_folder(dir: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .and_then(|iter| iter.collect::<std::io::Result<Vec<_>>>())
        .map_err(|e| InteropError::io(dir, e))?
        .into_iter()
        .map(|entry| entry.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("enex")))
        .collect();
    files.sort();
    if files.is_empty() {
        return Err(InteropError::format(
            dir.display().to_string(),
            "no Evernote export files were found",
        ));
    }
    let sizes: Vec<u64> = files
        .iter()
        .map(|f| std::fs::metadata(f).map_or(0, |m| m.len()))
        .collect();
    let name = dir
        .file_name()
        .map_or_else(|| "Evernote".to_owned(), |n| n.to_string_lossy().into_owned());
    with_sink(sink, |sink| {
        env.control
            .begin(Phase::Converting, Unit::Bytes, Some(sizes.iter().sum()));
        let now = env.clock.now();
        sink.notebook(NotebookFile::new(NotebookId::generate(env.clock), name.clone(), now))?;
        let mut report = Report::new(ReportKind::Import, format!("Evernote exports \"{name}\""));
        let mut sections = Vec::new();
        let mut offset = 0;
        for (path, size) in files.iter().zip(&sizes) {
            let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
            let stem = path
                .file_stem()
                .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
            let read = Arc::new(AtomicU64::new(0));
            let counted = Counting {
                inner: BufReader::new(file),
                read: Arc::clone(&read),
            };
            let (section, part) = read_section(counted, &stem, offset, &read, env, sink)?;
            report.pages.extend(part.pages);
            report.general.entries.extend(part.general.entries);
            sections.extend(section);
            offset += size;
        }
        let orders = section_orders(sections.len())?;
        for (section, order) in sections.into_iter().zip(orders) {
            sink.section(section.finish(order)?)?;
        }
        Ok(report)
    })
}

/// Imports ENEX text into a new notebook named `name`.
pub fn import_enex_reader<R: BufRead>(
    input: R,
    name: &str,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    import_counted(input, name, None, env, sink)
}

/// Counts the bytes that the XML reader takes from the input, so progress can follow the file.
struct Counting<R> {
    inner: R,
    read: Arc<AtomicU64>,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

impl<R: BufRead> BufRead for Counting<R> {
    fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
        self.inner.fill_buf()
    }

    fn consume(&mut self, amt: usize) {
        self.read.fetch_add(amt as u64, Ordering::Relaxed);
        self.inner.consume(amt);
    }
}

fn import_counted<R: BufRead>(
    input: R,
    name: &str,
    total: Option<u64>,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    with_sink(sink, |sink| {
        let read = Arc::new(AtomicU64::new(0));
        let counted = Counting {
            inner: input,
            read: Arc::clone(&read),
        };
        env.control.begin(Phase::Converting, Unit::Bytes, total);
        import_notes(counted, name, &read, env, sink)
    })
}

fn import_notes<R: BufRead>(
    input: R,
    name: &str,
    read: &Arc<AtomicU64>,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    let now = env.clock.now();
    sink.notebook(NotebookFile::new(NotebookId::generate(env.clock), name, now))?;
    let (section, mut report) = read_section(input, "Notes", 0, read, env, sink)?;
    report.source = format!("Evernote export \"{name}\"");
    if let Some(section) = section {
        let order = section_orders(1)?.remove(0);
        sink.section(section.finish(order)?)?;
    }
    Ok(report)
}

/// Reads the notes of one ENEX file into pages of a section. Returns the section, which the caller finishes
/// once it knows the section's place among the others, and the report of the file.
fn read_section<R: BufRead>(
    input: R,
    section_name: &str,
    offset: u64,
    read: &Arc<AtomicU64>,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<(Option<SectionBuilder>, Report)> {
    let now = env.clock.now();
    let mut importer = Importer {
        env,
        read,
        offset,
        sink,
        section: SectionBuilder::new(env, section_name, now),
        report: Report::new(ReportKind::Import, section_name.to_owned()),
    };
    match read_notes(input, &mut |raw| importer.import_note(raw)) {
        Ok(()) => {}
        Err(error @ InteropError::Format { .. }) => {
            importer
                .report
                .general
                .skipped("the rest of the file", error.to_string());
        }
        Err(other) => return Err(other),
    }
    let Importer { section, report, .. } = importer;
    Ok(((!section.is_empty()).then_some(section), report))
}

struct Importer<'a, 'e> {
    env: &'a ImportEnv<'e>,
    read: &'a Arc<AtomicU64>,
    /// The bytes of the files before this one, so progress follows all files together.
    offset: u64,
    sink: &'a mut dyn ImportSink,
    section: SectionBuilder,
    report: Report,
}

impl Importer<'_, '_> {
    fn import_note(&mut self, raw: RawNote) -> Result<()> {
        let env = self.env;
        env.control.checkpoint()?;
        env.control.set_done(
            Phase::Converting,
            self.offset + self.read.load(Ordering::Relaxed),
            raw.title.trim(),
        );
        let title = if raw.title.trim().is_empty() {
            "Untitled"
        } else {
            raw.title.trim()
        };
        if raw.too_big {
            self.report
                .general
                .skipped(title.to_owned(), "Its text is too big to import.");
            return Ok(());
        }
        let now = env.clock.now();
        let created = parse_date(&raw.created).unwrap_or(now);
        let modified = parse_date(&raw.updated).unwrap_or(created);
        let mut report = PageReport {
            title: title.to_owned(),
            ..PageReport::default()
        };
        if parse_date(&raw.created).is_some() {
            report.came_over("original dates");
        } else {
            report.simplified("dates", "The note has no dates, so the date of the import was used.");
        }
        let resources = decode_resources(raw.resources, &mut report);
        let media: HashMap<String, String> = resources.iter().map(|r| (r.hash.clone(), r.mime.clone())).collect();
        let mut converter = Converter::new(&media);
        let pieces = converter.convert(&xmltree::parse(&raw.content));
        let mut builder = PageBuilder::new(env, title, created, modified);
        builder.set_tags(raw.tags);
        report.came_over("text and formatting");
        report.came_over_count(builder.tag_count(), "tag", "tags");
        let mut placement = Placement::new(&mut builder, resources);
        placement.place(pieces);
        placement.finish(&mut report);
        add_source(&mut builder, &raw.source_url, &mut report);
        describe_converter(&converter.stats, raw.has_details, &mut report);
        let imported = match builder.finish() {
            Ok(imported) => imported,
            Err(error @ (InteropError::TooBig(_) | InteropError::Format { .. })) => {
                self.report.general.skipped(title.to_owned(), error.to_string());
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        self.section.add_page(&imported.page, None);
        self.sink.page(self.section.id(), imported)?;
        self.report.add_page(report);
        Ok(())
    }
}

/// Adds the web address a clipped note came from, as a link at the end.
fn add_source(builder: &mut PageBuilder<'_>, url: &str, report: &mut PageReport) {
    if url.starts_with("http://") || url.starts_with("https://") {
        let line = vec![Inline::text("Source: "), Inline::marked(url, Marks::link(url))];
        builder.push_blocks(vec![Block::Paragraph(line)]);
        report.came_over("source web address");
    }
}

fn describe_converter(stats: &super::enml::EnmlStats, has_details: bool, report: &mut PageReport) {
    let styled = (
        "element with its own font or size",
        "elements with their own fonts or sizes",
    );
    report.simplified_count(
        stats.styled,
        styled,
        "OpenNote keeps bold, italic, underline, and color only.",
    );
    let remote = ("image on the web", "images on the web");
    report.simplified_count(
        stats.remote_images,
        remote,
        "Imports do not go online, so each became a link.",
    );
    let internal = ("link to another Evernote note", "links to other Evernote notes");
    report.simplified_count(stats.internal_links, internal, "Only the link text was kept.");
    report.skipped_count(
        stats.encrypted,
        ("encrypted passage", "encrypted passages"),
        "It cannot be decrypted here.",
    );
    report.skipped_count(
        stats.data_images,
        ("image inside the text", "images inside the text"),
        "Only attachments come over.",
    );
    if has_details {
        report.skipped(
            "note details, such as author and location",
            "OpenNote has no place for them yet.",
        );
    }
}
