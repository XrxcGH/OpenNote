//! Importing the notes of the Windows Sticky Notes app.
//!
//! The app keeps every note in one SQLite file, `plum.sqlite`, in its package folder. Each note becomes a page of
//! a section named "Sticky Notes". The page is titled by the note's first line. It has the note's created and
//! changed dates, and the note's color as the page's color chip.
//!
//! Notes in the app's trash are left out and reported. The reader works on the file alone, so it needs no account
//! and no network. The app can stay open, because the newest notes sit in the file's write-ahead log, which the
//! reader follows.
//!
//! A note's pictures come from the app's `Media` table. A picture is kept when its bytes are a PNG, JPEG, GIF, or
//! BMP file, and the rest are reported.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use opennote_core::model::{Color, NotebookFile};
use opennote_core::{NotebookId, Timestamp};

use crate::doc::{Block, Inline};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Phase, Unit};
use crate::sink::{with_sink, ImportEnv, ImportSink, ImportedPage};
use crate::sqlite::{Database, Row};
use crate::tree::{section_orders, SectionBuilder};

/// The file name of the app's database.
pub const DATABASE_NAME: &str = "plum.sqlite";

/// Ticks of 100 nanoseconds from the year 1 (the clock of .NET) to the Unix epoch, in milliseconds.
const UNIX_EPOCH_IN_DOTNET_MS: i64 = 62_135_596_800_000;

/// A title is cut to this many characters.
const TITLE_CHARS: usize = 80;

/// Where the Sticky Notes app keeps its database on this PC, if the file exists.
pub fn sticky_notes_database() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let path = PathBuf::from(base)
        .join("Packages")
        .join("Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe")
        .join("LocalState")
        .join(DATABASE_NAME);
    path.is_file().then_some(path)
}

/// Whether a database is the Sticky Notes app's: it has a `Note` table with text and a color.
pub fn is_sticky_notes_database(database: &Database) -> bool {
    database
        .table("Note")
        .is_some_and(|t| t.has_column("Text") && t.has_column("Theme"))
}

/// Imports the notes of a Sticky Notes database into a new notebook. `path` is the `plum.sqlite` file, or the
/// folder that holds it.
pub fn import_sticky_notes(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    let database = open_database(path)?;
    let (notes, pictures) = read_notes(&database)?;
    with_sink(sink, |sink| write_notes(notes, &pictures, env, sink))
}

/// Opens the database file, or the one in a folder, and checks that it holds Sticky Notes.
fn open_database(path: &Path) -> Result<Database> {
    let file = if path.is_dir() {
        path.join(DATABASE_NAME)
    } else {
        path.to_path_buf()
    };
    let database = Database::open(&file).map_err(|error| match error {
        InteropError::Io { source, .. } => InteropError::format(
            file.display().to_string(),
            format!("it could not be read ({source}). Close Sticky Notes and try again."),
        ),
        other => other,
    })?;
    if !is_sticky_notes_database(&database) {
        let shown = file.display().to_string();
        return Err(InteropError::format(shown, "the database does not hold Sticky Notes"));
    }
    Ok(database)
}

/// Writes the notes as the pages of one section.
fn write_notes(
    notes: Vec<Note>,
    pictures: &HashMap<String, Pictures>,
    env: &ImportEnv<'_>,
    sink: &mut dyn ImportSink,
) -> Result<Report> {
    env.control
        .begin(Phase::Converting, Unit::Items, Some(notes.len() as u64));
    let now = env.clock.now();
    sink.notebook(NotebookFile::new(NotebookId::generate(env.clock), "Sticky Notes", now))?;
    let mut report = Report::new(ReportKind::Import, "Windows Sticky Notes");
    let mut section = SectionBuilder::new(env, "Sticky Notes", now);
    for note in notes {
        env.control.checkpoint()?;
        let shown = note.title();
        let converted = match convert(&note, pictures.get(&note.id), env) {
            Err(error @ InteropError::TooBig(_)) => Converted::Skipped(error.to_string()),
            other => other?,
        };
        match converted {
            Converted::Page(done) => {
                section.add_colored_page(&done.imported.page, None, done.color);
                sink.page(section.id(), done.imported)?;
                report.add_page(done.report);
            }
            Converted::Skipped(why) => report.general.skipped(shown.clone(), why),
        }
        env.control.step(Phase::Converting, 1, &shown);
    }
    if !section.is_empty() {
        let order = section_orders(1)?.remove(0);
        sink.section(section.finish(order)?)?;
    }
    Ok(report)
}

/// One note, as the database holds it.
struct Note {
    id: String,
    text: String,
    theme: String,
    created: Option<Timestamp>,
    updated: Option<Timestamp>,
    /// Whether the note is in the app's trash.
    deleted: bool,
}

impl Note {
    /// The first line of the note, cut short.
    fn title(&self) -> String {
        let line = lines(&self.text).into_iter().find(|l| !l.trim().is_empty());
        line.map_or_else(
            || "Empty note".to_owned(),
            |l| l.trim().chars().take(TITLE_CHARS).collect(),
        )
    }
}

/// The notes in the order they were made, and how many pictures each one has.
fn read_notes(database: &Database) -> Result<(Vec<Note>, HashMap<String, Pictures>)> {
    let mut notes = Vec::new();
    if let Some(table) = database.table("Note") {
        database.for_each_row(table, &mut |row: &Row<'_>| {
            notes.push(Note {
                id: row.text("Id").to_owned(),
                text: row.text("Text").to_owned(),
                theme: row.text("Theme").to_owned(),
                created: row.get("CreatedAt").as_int().and_then(timestamp),
                updated: row.get("UpdatedAt").as_int().and_then(timestamp),
                deleted: row.get("DeletedAt").as_int().is_some_and(|d| d > 0),
            });
            Ok(())
        })?;
    }
    notes.sort_by_key(|n| n.created);
    let mut pictures: HashMap<String, Pictures> = HashMap::new();
    let mut total = 0usize;
    if let Some(table) = database.table("Media").filter(|t| t.has_column("ParentId")) {
        database.for_each_row(table, &mut |row: &Row<'_>| {
            let entry = pictures.entry(row.text("ParentId").to_owned()).or_default();
            let bytes = ["Data", "Content", "Image"].iter().find_map(|c| row.get(c).as_blob());
            match bytes.and_then(|b| image_extension(b).map(|ext| (ext, b))) {
                Some((ext, bytes)) if total + bytes.len() <= MAX_PICTURE_BYTES => {
                    total += bytes.len();
                    entry.found.push((ext, bytes.to_vec()));
                }
                _ => entry.unreadable += 1,
            }
            Ok(())
        })?;
    }
    Ok((notes, pictures))
}

/// The most picture bytes one import reads, so a database of huge pictures cannot fill the memory.
const MAX_PICTURE_BYTES: usize = 512 << 20;

/// The pictures of one note.
#[derive(Default)]
struct Pictures {
    /// The extension and bytes of each picture that can be shown.
    found: Vec<(&'static str, Vec<u8>)>,
    /// Pictures that were not a file type OpenNote shows, or that went past the size limit.
    unreadable: usize,
}

/// The file extension of image bytes, from their first bytes.
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

/// A note that became a page.
struct Done {
    imported: ImportedPage,
    color: Option<Color>,
    report: PageReport,
}

/// What became of a note.
enum Converted {
    /// A page, boxed because it is much bigger than a reason.
    Page(Box<Done>),
    /// The note was left out, for this reason.
    Skipped(String),
}

/// Converts one note to a page, or says why it was left out. An error is a failure of the whole import.
fn convert(note: &Note, pictures: Option<&Pictures>, env: &ImportEnv<'_>) -> Result<Converted> {
    let none = Pictures::default();
    let pictures = pictures.unwrap_or(&none);
    if note.deleted {
        return Ok(Converted::Skipped(
            "The note is in the trash of Sticky Notes.".to_owned(),
        ));
    }
    let text_lines: Vec<String> = lines(&note.text).into_iter().filter(|l| !l.trim().is_empty()).collect();
    if text_lines.is_empty() {
        if pictures.found.is_empty() {
            return Ok(Converted::Skipped(if pictures.unreadable > 0 {
                "The note holds only pictures that OpenNote cannot show.".to_owned()
            } else {
                "The note is empty.".to_owned()
            }));
        }
    }
    let created = note.created.or(note.updated).unwrap_or_else(|| env.clock.now());
    let modified = note.updated.unwrap_or(created);
    let title = if text_lines.is_empty() {
        "Picture note".to_owned()
    } else {
        note.title()
    };
    let mut builder = PageBuilder::new(env, &title, created, modified);
    builder.push_blocks(
        text_lines
            .into_iter()
            .map(|l| Block::Paragraph(vec![Inline::text(l)]))
            .collect(),
    );
    for (n, (ext, bytes)) in pictures.found.iter().enumerate() {
        let name = format!("picture-{}.{ext}", n + 1);
        let mime = crate::assets::mime_from_extension(ext);
        let id = builder.add_asset(&name, Some(mime), bytes.clone());
        builder.push_image(id, String::new());
    }
    let color = theme_color(&note.theme);
    Ok(Converted::Page(Box::new(Done {
        imported: builder.finish()?,
        report: page_report(note, &title, color.is_some(), pictures),
        color,
    })))
}

/// What came over, what was simplified, and what was skipped for one note.
fn page_report(note: &Note, title: &str, colored: bool, pictures: &Pictures) -> PageReport {
    let mut report = PageReport {
        title: title.to_owned(),
        ..PageReport::default()
    };
    report.came_over("text");
    if note.created.is_some() {
        report.came_over("original dates");
    } else {
        report.simplified("dates", "The note has no dates, so the date of the import was used.");
    }
    if colored {
        let why = "OpenNote has seven pen colors, so the note's color became the closest one.";
        report.simplified("color", why);
    } else if !note.theme.is_empty() {
        report.simplified("color", "OpenNote does not know this color, so the page has none.");
    }
    report.came_over_count(pictures.found.len(), "picture", "pictures");
    let why = "It is not a PNG, JPEG, GIF, or BMP file, or it went past the size limit of the import.";
    report.skipped_count(
        pictures.unreadable,
        ("picture that cannot be shown", "pictures that cannot be shown"),
        why,
    );
    report
}

/// The pen color closest to a Sticky Notes color.
fn theme_color(theme: &str) -> Option<Color> {
    let pen = match theme.trim().to_ascii_lowercase().as_str() {
        "yellow" => "amber",
        "green" => "fern",
        "blue" => "indigo",
        "purple" => "plum",
        "pink" => "brick",
        "gray" | "grey" | "charcoal" => "ink",
        _ => return None,
    };
    Color::parse(pen).ok()
}

/// A date stored by the app. That is .NET ticks, but a build that differs may store Unix milliseconds, or seconds.
fn timestamp(value: i64) -> Option<Timestamp> {
    let ms = match value {
        v if v <= 0 => return None,
        v if v < 100_000_000_000 => v.checked_mul(1_000)?,
        v if v < 100_000_000_000_000 => v,
        v => v / 10_000 - UNIX_EPOCH_IN_DOTNET_MS,
    };
    let time = Timestamp::from_unix_ms(ms);
    (time >= Timestamp::MIN && time <= Timestamp::MAX).then_some(time)
}

/// The lines of a note's text, without the `\id=` marks that begin each paragraph.
fn lines(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut line = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' | '\n' => {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push(std::mem::take(&mut line));
            }
            _ => line.push(c),
        }
    }
    out.push(line);
    out.into_iter().map(|l| strip_mark(&l)).collect()
}

/// Drops a leading `\id=<id>` mark and the space after it. The app writes one before each paragraph.
fn strip_mark(line: &str) -> String {
    match line.strip_prefix("\\id=") {
        Some(rest) => rest
            .split_once(char::is_whitespace)
            .map_or_else(String::new, |(_, after)| after.to_owned()),
        None => line.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraph_marks_and_line_breaks_are_dropped() {
        let text = concat!(
            "\\id=6f1d2c4e-0000-4000-8000-000000000001 Groceries\r",
            "\\id=6f1d2c4e-0000-4000-8000-000000000002 milk\r\n",
            "\\id=x\r\nplain",
        );
        assert_eq!(lines(text), ["Groceries", "milk", "", "plain"]);
        // A mark followed by a no-break space, which is more than one byte, does not split a character.
        assert_eq!(lines("\\id=a\u{a0}text"), ["text"]);
    }

    #[test]
    fn dates_in_the_apps_clock_become_timestamps() {
        // 2024-01-05T14:30:00Z as .NET ticks.
        let ticks = (1_704_465_000_000 + UNIX_EPOCH_IN_DOTNET_MS) * 10_000;
        assert_eq!(timestamp(ticks), Timestamp::parse("2024-01-05T14:30:00Z").ok());
        assert_eq!(
            timestamp(1_704_465_000_000),
            Timestamp::parse("2024-01-05T14:30:00Z").ok()
        );
        assert_eq!(timestamp(1_704_465_000), Timestamp::parse("2024-01-05T14:30:00Z").ok());
        assert_eq!(timestamp(0), None);
    }

    #[test]
    fn colors_map_to_pens() {
        assert_eq!(theme_color("Yellow"), Color::parse("amber").ok());
        assert_eq!(theme_color("Charcoal"), Color::parse("ink").ok());
        assert_eq!(theme_color("Chartreuse"), None);
    }
}
