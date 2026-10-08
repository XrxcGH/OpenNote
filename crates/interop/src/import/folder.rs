//! Importing a folder of notes, whatever the notes are written in.
//!
//! The driver here walks the folder, plans the sections, resolves links and attachments, and writes pages. A
//! [`NoteReader`] supplies the parts that depend on the format: which files are notes, and how one note's text
//! becomes blocks. Markdown folders (Obsidian, Joplin, Logseq, Notion), HTML folders, and plain text folders
//! all go through it.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::NotebookFile;
use opennote_core::{NotebookId, PageId, Timestamp};

use super::links::Links;
use super::scan::{NoteFile, Scan};
use crate::dates::from_system_time;
use crate::doc::Block;
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{Entry, PageReport, Report, ReportKind};
use crate::run::{Phase, Unit};
use crate::sink::{with_sink, ImportEnv, ImportSink, ImportedPage};
use crate::text::{self, Decoded};
use crate::tree::{section_orders, SectionBuilder};

/// The biggest note that is read. A text file bigger than this is not a note.
const MAX_NOTE_BYTES: u64 = 64 << 20;

/// What a reader found in one note.
#[derive(Debug, Default)]
pub(super) struct NoteContent {
    /// The page title.
    pub title: String,
    /// The content.
    pub blocks: Vec<Block>,
    /// Tags the note names itself, besides any `#tags` the reader looks for.
    pub tags: Vec<String>,
    /// The date the note was created, if the note says.
    pub created: Option<Timestamp>,
    /// The date the note last changed, if the note says.
    pub modified: Option<Timestamp>,
    /// What the reader dropped or simplified, to add to the page's report after the common entries.
    pub notes: Vec<Entry>,
    /// Set when the file is not a note after all, such as the index page of an HTML export. The reason is
    /// reported and no page is made.
    pub skip: Option<String>,
}

/// The format-specific part of a folder import.
pub(super) trait NoteReader {
    /// What the report calls the source, such as `Obsidian vault`.
    fn label(&self, root: &Path) -> String;

    /// The extensions of note files, in lowercase and without the dot.
    fn extensions(&self) -> &'static [&'static str];

    /// Whether a folder named like a note holds that note's subpages, as in a Notion export.
    fn nested(&self) -> bool {
        false
    }

    /// The extensions of files to leave out without a word, because they only repeat the notes.
    fn ignored_extensions(&self) -> &'static [&'static str] {
        &[]
    }

    /// The folder whose section a note belongs to. A format that wraps each note in a folder of its own, such
    /// as a TextBundle, puts the notes in the section of the folder around the wrappers.
    fn section_dir<'a>(&self, dir: &'a [String]) -> &'a [String] {
        dir
    }

    /// The name of a note, folder, or notebook as the person should see it.
    fn clean_name(&self, raw: &str) -> String {
        raw.to_owned()
    }

    /// Reads one note.
    fn read(&self, text: &str, note: &NoteFile) -> NoteContent;

    /// Other names the note answers to, read from the start of the file: aliases, or a title that differs
    /// from the file name. Links by those names find the note.
    fn alias_names(&self, _head: &str) -> Vec<String> {
        Vec::new()
    }

    /// Finds the tags in the blocks of a note, besides the ones the note lists.
    fn find_tags(&self, _blocks: &[Block]) -> Vec<String> {
        Vec::new()
    }
}

/// Imports a folder with a reader.
pub(super) fn import_folder(
    root: &Path,
    reader: &dyn NoteReader,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    with_sink(sink, |sink| run(root, reader, env, sink))
}

fn run(root: &Path, reader: &dyn NoteReader, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    env.control.begin(Phase::Scanning, Unit::Items, None);
    let scan = Scan::new(root, reader.extensions(), reader.ignored_extensions(), || {
        PageId::generate(env.clock)
    })?;
    let mut scan = scan;
    register_aliases(&mut scan, reader);
    env.control
        .begin(Phase::Converting, Unit::Items, Some(scan.notes.len() as u64));
    let title = notebook_title(root, reader);
    let mut report = Report::new(ReportKind::Import, format!("{} \"{title}\"", reader.label(root)));
    let now = env.clock.now();
    sink.notebook(NotebookFile::new(NotebookId::generate(env.clock), title.clone(), now))?;
    let plans = plan_sections(&scan, reader, &title);
    let orders = section_orders(plans.len())?;
    let mut used: HashSet<PathBuf> = HashSet::new();
    for (plan, order) in plans.into_iter().zip(orders) {
        let mut section = SectionBuilder::new(env, &plan.name, now);
        for planned in &plan.pages {
            env.control.checkpoint()?;
            let note = &scan.notes[planned.index];
            let outcome = import_note(&scan, reader, note, env, &mut used);
            env.control.step(Phase::Converting, 1, &note.stem);
            match outcome {
                Ok(Imported::Page(done)) => {
                    let (page, page_report) = *done;
                    section.add_page(&page.page, planned.parent);
                    sink.page(section.id(), page)?;
                    report.add_page(page_report);
                }
                Ok(Imported::Skipped(why)) => report.general.skipped(scan.display(&note.path), why),
                Err(error) => report.general.skipped(scan.display(&note.path), error.to_string()),
            }
        }
        if !section.is_empty() {
            sink.section(section.finish(order)?)?;
        }
    }
    describe_leftovers(&scan, &used, &mut report);
    Ok(report)
}

/// Reads the start of each note, so links by an alias or a title find it.
fn register_aliases(scan: &mut Scan, reader: &dyn NoteReader) {
    let notes = scan.notes.clone();
    for note in &notes {
        let Ok(mut file) = fs::File::open(&note.path) else {
            continue;
        };
        let mut head = vec![0u8; 8192];
        let n = std::io::Read::read(&mut file, &mut head).unwrap_or(0);
        let text = text::decode(&head[..n]).text;
        for name in reader.alias_names(&text) {
            scan.add_alias(note, &name);
        }
    }
}

fn notebook_title(root: &Path, reader: &dyn NoteReader) -> String {
    let part = if root.is_file() {
        root.file_stem()
    } else {
        root.file_name()
    };
    let raw = part.map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let name = reader.clean_name(&raw);
    if name.trim().is_empty() {
        "Imported notes".to_owned()
    } else {
        name
    }
}

/// A section to write: its name, and its pages in order with the parent of each.
struct SectionPlan {
    name: String,
    pages: Vec<Planned>,
}

struct Planned {
    index: usize,
    parent: Option<PageId>,
}

/// Groups notes into sections. Each folder is a section, except that in a nested format a note's folder holds
/// its subpages, which then sit under it in its own section.
fn plan_sections(scan: &Scan, reader: &dyn NoteReader, title: &str) -> Vec<SectionPlan> {
    let mut groups: BTreeMap<&[String], Vec<usize>> = BTreeMap::new();
    let parents = if reader.nested() {
        parent_notes(scan, reader)
    } else {
        vec![None; scan.notes.len()]
    };
    for (index, note) in scan.notes.iter().enumerate() {
        if parents[index].is_none() {
            groups.entry(reader.section_dir(&note.dir)).or_default().push(index);
        }
    }
    let mut plans = Vec::new();
    for (dir, roots) in groups {
        let name = if dir.is_empty() {
            title.to_owned()
        } else {
            dir.iter().map(|d| reader.clean_name(d)).collect::<Vec<_>>().join(" / ")
        };
        let mut pages = Vec::new();
        for root in roots {
            push_with_children(scan, &parents, root, None, &mut pages);
        }
        plans.push(SectionPlan { name, pages });
    }
    plans
}

fn push_with_children(
    scan: &Scan,
    parents: &[Option<usize>],
    index: usize,
    parent: Option<PageId>,
    out: &mut Vec<Planned>,
) {
    out.push(Planned { index, parent });
    let id = scan.notes[index].id;
    for (child, _) in parents.iter().enumerate().filter(|(_, p)| **p == Some(index)) {
        push_with_children(scan, parents, child, Some(id), out);
    }
}

/// For each note, the note whose folder it sits in: `A.md` is the parent of `A/B.md`. A folder matches a note
/// of the same name first, and then a note whose name matches once the reader cleans both.
fn parent_notes(scan: &Scan, reader: &dyn NoteReader) -> Vec<Option<usize>> {
    let mut exact: BTreeMap<(&[String], &str), usize> = BTreeMap::new();
    let mut cleaned: BTreeMap<(&[String], String), usize> = BTreeMap::new();
    for (index, note) in scan.notes.iter().enumerate() {
        exact.entry((note.dir.as_slice(), note.stem.as_str())).or_insert(index);
        let key = reader.clean_name(&note.stem).to_lowercase();
        cleaned.entry((note.dir.as_slice(), key)).or_insert(index);
    }
    scan.notes
        .iter()
        .enumerate()
        .map(|(index, note)| {
            let (folder, above) = note.dir.split_last()?;
            let found = exact
                .get(&(above, folder.as_str()))
                .or_else(|| cleaned.get(&(above, reader.clean_name(folder).to_lowercase())));
            found.copied().filter(|parent| *parent != index)
        })
        .collect()
}

/// Notes what the scan and the notes left behind.
fn describe_leftovers(scan: &Scan, used: &HashSet<PathBuf>, report: &mut Report) {
    for (name, why) in &scan.skipped {
        report.general.skipped(name.clone(), why.clone());
    }
    let unused = scan.file_paths().filter(|path| !used.contains(*path)).count();
    let what = ("file that no note uses", "files that no note uses");
    report
        .general
        .skipped_count(unused, what, "Imports bring in the images and files that notes use.");
}

enum Imported {
    /// A converted page and its report, boxed because they are much bigger than a skip.
    Page(Box<(ImportedPage, PageReport)>),
    Skipped(String),
}

fn import_note(
    scan: &Scan,
    reader: &dyn NoteReader,
    note: &NoteFile,
    env: &ImportEnv<'_>,
    used: &mut HashSet<PathBuf>,
) -> Result<Imported> {
    let size = fs::metadata(&note.path)
        .map_err(|e| InteropError::io(&note.path, e))?
        .len();
    if size > MAX_NOTE_BYTES {
        return Err(InteropError::TooBig(format!("the note {}", note.stem)));
    }
    let raw = fs::read(&note.path).map_err(|e| InteropError::io(&note.path, e))?;
    let decoded = text::decode(&raw);
    let mut content = reader.read(&decoded.text, note);
    if let Some(why) = content.skip.take() {
        return Ok(Imported::Skipped(why));
    }
    if content.title.trim().is_empty() {
        content.title = reader.clean_name(&note.stem);
    }
    let mut report = PageReport {
        title: content.title.clone(),
        source: scan.display(&note.path),
        entries: Vec::new(),
    };
    let (created, modified) = note_dates(&content, &note.path, env.clock.now(), &mut report);
    let mut tags = std::mem::take(&mut content.tags);
    tags.extend(reader.find_tags(&content.blocks));
    let mut builder = PageBuilder::with_id(env, note.id, &content.title, created, modified);
    builder.set_tags(tags);
    let tag_count = builder.tag_count();
    let tables = content
        .blocks
        .iter()
        .filter(|b| matches!(b, Block::Table { .. }))
        .count();
    let mut links = Links::new(scan, &note.dir, &mut builder, used);
    for mut block in std::mem::take(&mut content.blocks) {
        if !links.take_attachment_paragraph(&block) {
            links.resolve(std::slice::from_mut(&mut block));
            links.page().push_blocks(vec![block]);
        }
        for asset in links.take_attached() {
            links.page().push_file(asset);
        }
    }
    let stats = links.stats;
    report.came_over("text and formatting");
    report.came_over_count(tables, "table", "tables");
    report.came_over_count(tag_count, "tag", "tags");
    stats.describe(&mut report);
    report.entries.extend(content.notes);
    describe_encoding(&decoded, &mut report);
    Ok(Imported::Page(Box::new((builder.finish()?, report))))
}

fn describe_encoding(decoded: &Decoded, report: &mut PageReport) {
    if decoded.guessed {
        report.simplified(
            "text encoding",
            format!(
                "The file does not say how its text is encoded, so it was read as {}.",
                decoded.encoding
            ),
        );
    }
    if decoded.lossy {
        report.simplified("characters that were not valid text", "Each became a replacement mark.");
    }
}

/// The dates of a note: from the note itself, or else from the file.
fn note_dates(content: &NoteContent, path: &Path, now: Timestamp, report: &mut PageReport) -> (Timestamp, Timestamp) {
    let meta = fs::metadata(path).ok();
    let file_created = meta.as_ref().and_then(|m| m.created().ok()).and_then(from_system_time);
    let file_modified = meta.as_ref().and_then(|m| m.modified().ok()).and_then(from_system_time);
    if content.created.is_some() || content.modified.is_some() {
        report.came_over("original dates");
    } else {
        report.simplified("dates", "The note has no dates, so the dates of the file were used.");
    }
    let created = content.created.or(file_created).or(file_modified).unwrap_or(now);
    let modified = content.modified.or(file_modified).unwrap_or(created).max(created);
    (created, modified)
}
