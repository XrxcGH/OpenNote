// checks-disable-file modifiability: books builds each book's page in one pass; split it when it grows again
//! Importing reading highlights from files: the Kindle `My Clippings.txt` and a Readwise CSV export.
//!
//! Each book becomes a page named for the book, with its author under the title. Every highlight is a quote, with
//! its page or location and date in a line below, and a note on it as a paragraph that follows. The Readwise
//! service itself is not read, only the file it exports. The Kindle file is read in English only.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use opennote_core::Timestamp;

use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use super::sheet::MAX_TABLE_COLUMNS;
use crate::csv;
use crate::dates::parse_long_date;
use crate::doc::{Block, Inline, Marks};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};
use crate::text;

/// The largest file that is read.
const MAX_BYTES: u64 = 64 << 20;

/// The line that ends each entry of `My Clippings.txt`.
const SEPARATOR: &str = "==========";

/// Imports a clippings file or a Readwise export, or a folder of them, into a new notebook.
pub fn import_highlights(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_files(path, &HighlightConverter, env, sink)
}

struct HighlightConverter;

impl FileConverter for HighlightConverter {
    fn label(&self) -> &'static str {
        "Kindle and Readwise highlights"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["txt", "csv"]
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let size = fs::metadata(path).map_err(|e| InteropError::io(path, e))?.len();
        if size > MAX_BYTES {
            return Err(InteropError::TooBig(path.display().to_string()));
        }
        let bytes = fs::read(path).map_err(|e| InteropError::io(path, e))?;
        let decoded = text::decode(&bytes).text;
        let name = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let entries = if is_readwise(&decoded) {
            readwise(&decoded)
        } else {
            kindle(&decoded)
        };
        if entries.is_empty() {
            return Err(InteropError::format(
                name,
                "it holds no highlights. OpenNote reads the English My Clippings.txt of a Kindle and the CSV export of Readwise",
            ));
        }
        books(entries, &name, env)
    }
}

/// What an entry is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Highlight,
    Note,
}

/// One highlight or note.
#[derive(Clone, Debug)]
struct Entry {
    book: String,
    author: Option<String>,
    kind: Kind,
    text: String,
    /// "page 12", "location 345-346", or both, as the line below the quote shows them.
    place: String,
    /// The first number of the location, to match highlights that were extended.
    start: Option<u32>,
    added: Option<Timestamp>,
    /// A note the reader wrote on a highlight (Readwise).
    note: String,
    tags: String,
}

/// Whether the text is a Readwise export: its first row names the Readwise columns.
pub(crate) fn is_readwise(text: &str) -> bool {
    let first = text.trim_start_matches('\u{feff}').lines().next().unwrap_or("");
    first.contains("Highlight") && first.contains("Book Title") && first.contains("Book Author")
}

/// Whether the text is a Kindle clippings file.
pub(crate) fn is_kindle(text: &str) -> bool {
    text.contains("\n- Your Highlight") || text.contains("\n- Your Note") || text.contains("\n- Your Bookmark")
}

fn readwise(text: &str) -> Vec<Entry> {
    // One row at a time, each cut to the table column limit: a file of commas never becomes a grid in memory.
    let mut rows = csv::rows(text, MAX_TABLE_COLUMNS);
    let Some(header) = rows.next() else {
        return Vec::new();
    };
    let column = |name: &str| header.iter().position(|h| h.trim().eq_ignore_ascii_case(name));
    let (Some(highlight), Some(title)) = (column("Highlight"), column("Book Title")) else {
        return Vec::new();
    };
    let (author, note, tags) = (column("Book Author"), column("Note"), column("Tags"));
    let (kind, location, at) = (column("Location Type"), column("Location"), column("Highlighted at"));
    let cell = |row: &Vec<String>, index: Option<usize>| -> String {
        index
            .and_then(|i| row.get(i))
            .map(|c| c.trim().to_owned())
            .unwrap_or_default()
    };
    rows.filter_map(|row| {
        let row = &row;
        let text = cell(row, Some(highlight));
        let note = cell(row, note);
        if text.is_empty() && note.is_empty() {
            return None;
        }
        let location_type = cell(row, kind);
        let place = cell(row, location);
        let place = if place.is_empty() {
            String::new()
        } else if location_type.is_empty() {
            format!("location {place}")
        } else {
            format!("{} {place}", location_type.to_lowercase())
        };
        Some(Entry {
            book: cell(row, Some(title)),
            author: Some(cell(row, author)).filter(|a| !a.is_empty()),
            kind: Kind::Highlight,
            start: place.rsplit(' ').next().and_then(leading_number),
            text,
            place,
            added: parse_long_date(&cell(row, at)),
            note,
            tags: cell(row, tags),
        })
    })
    .collect()
}

fn kindle(text: &str) -> Vec<Entry> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    text.split(SEPARATOR)
        .filter_map(|block| {
            let mut lines = block.trim_matches('\n').lines().map(str::trim_end);
            let title_line = lines.by_ref().find(|l| !l.trim().is_empty())?.trim();
            let meta = lines.next()?.trim();
            let body = lines.collect::<Vec<_>>().join("\n").trim().to_owned();
            let rest = meta.strip_prefix("- ")?;
            let kind = if rest.starts_with("Your Highlight") {
                Kind::Highlight
            } else if rest.starts_with("Your Note") {
                Kind::Note
            } else {
                return None;
            };
            if body.is_empty() {
                return None;
            }
            let (book, author) = split_title(title_line);
            let segments: Vec<&str> = rest.split('|').map(str::trim).collect();
            let page = segments
                .iter()
                .find_map(|s| find_after(s, "page "))
                .map(|p| format!("page {p}"));
            let location = segments.iter().find_map(|s| find_after(s, "ocation "));
            let place = [page, location.map(|l| format!("location {l}"))]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(", ");
            let added = segments
                .iter()
                .find_map(|s| s.strip_prefix("Added on "))
                .and_then(parse_long_date);
            Some(Entry {
                book,
                author,
                kind,
                start: location.and_then(leading_number),
                text: body,
                place,
                added,
                note: String::new(),
                tags: String::new(),
            })
        })
        .collect()
}

/// `Title (Author)` as the title and the author.
fn split_title(line: &str) -> (String, Option<String>) {
    let line = line.trim_start_matches('\u{feff}').trim();
    if let Some(open) = line.rfind(" (").filter(|_| line.ends_with(')')) {
        let author = line[open + 2..line.len() - 1].trim();
        if !author.is_empty() {
            return (line[..open].trim().to_owned(), Some(author.to_owned()));
        }
    }
    (line.to_owned(), None)
}

/// The word after `marker` in a segment such as `Your Highlight on page 12`, up to the next space.
fn find_after<'a>(segment: &'a str, marker: &str) -> Option<&'a str> {
    let at = segment.find(marker)?;
    let rest = &segment[at + marker.len()..];
    let word = rest.split_whitespace().next()?;
    Some(word.trim_end_matches(','))
}

fn leading_number(text: &str) -> Option<u32> {
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// One page for each book, in the order the books first appear.
fn books(entries: Vec<Entry>, name: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let mut order: Vec<String> = Vec::new();
    let mut by_book: HashMap<String, Vec<Entry>> = HashMap::new();
    let mut duplicates = 0usize;
    for (index, entry) in entries.iter().enumerate() {
        // A highlight the reader extended is written again at the same place, so the shorter one is dropped.
        let extended = entry.kind == Kind::Highlight
            && entry.start.is_some()
            && entries[index + 1..].iter().any(|later| {
                later.book == entry.book
                    && later.kind == Kind::Highlight
                    && later.start == entry.start
                    && later.text.len() > entry.text.len()
                    && later.text.contains(entry.text.as_str())
            });
        if extended {
            duplicates += 1;
            continue;
        }
        let key = if entry.book.is_empty() {
            "Untitled".to_owned()
        } else {
            entry.book.clone()
        };
        if !by_book.contains_key(&key) {
            order.push(key.clone());
        }
        by_book.entry(key).or_default().push(entry.clone());
    }
    let now = env.clock.now();
    let mut converted = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let mut general = PageReport::default();
    general.skipped_count(
        duplicates,
        ("repeated highlight", "repeated highlights"),
        "The Kindle writes a highlight again when it is extended, so the shorter one was left out.",
    );
    for title in order {
        env.control.checkpoint()?;
        let entries = by_book.remove(&title).unwrap_or_default();
        let dates: Vec<Timestamp> = entries.iter().filter_map(|e| e.added).collect();
        let created = dates.iter().copied().min().unwrap_or(now);
        let modified = dates.iter().copied().max().unwrap_or(created);
        let mut builder = PageBuilder::new(env, &title, created, modified);
        let mut blocks = Vec::new();
        if let Some(author) = entries.iter().find_map(|e| e.author.clone()) {
            blocks.push(Block::Paragraph(vec![Inline::marked(
                format!("by {author}"),
                Marks {
                    emphasis: true,
                    ..Marks::none()
                },
            )]));
        }
        let (mut highlights, mut notes) = (0usize, 0usize);
        for entry in &entries {
            let quote = |text: &str| Block::Quote(vec![Block::Paragraph(lines(text))]);
            match entry.kind {
                Kind::Highlight => {
                    highlights += 1;
                    if !entry.text.is_empty() {
                        blocks.push(quote(&entry.text));
                    }
                    let meta = meta_line(entry);
                    if !meta.is_empty() {
                        blocks.push(Block::Paragraph(vec![Inline::marked(
                            meta,
                            Marks {
                                emphasis: true,
                                ..Marks::none()
                            },
                        )]));
                    }
                    if !entry.note.is_empty() {
                        notes += 1;
                        blocks.push(Block::Paragraph(note_inlines(&entry.note)));
                    }
                }
                Kind::Note => {
                    notes += 1;
                    blocks.push(Block::Paragraph(note_inlines(&entry.text)));
                    let meta = meta_line(entry);
                    if !meta.is_empty() {
                        blocks.push(Block::Paragraph(vec![Inline::marked(
                            meta,
                            Marks {
                                emphasis: true,
                                ..Marks::none()
                            },
                        )]));
                    }
                }
            }
        }
        builder.push_blocks(blocks);
        let mut report = PageReport {
            title: title.clone(),
            source: name.to_owned(),
            entries: Vec::new(),
        };
        report.came_over_count(highlights, "highlight", "highlights");
        report.came_over_count(notes, "note", "notes");
        if dates.is_empty() {
            report.simplified("dates", "The file gives no dates, so the date of the import was used.");
        }
        converted.pages.push(ConvertedPage {
            section: None,
            page: builder.finish()?,
            report,
        });
    }
    converted.general = general.entries;
    Ok(converted)
}

/// The line under a quote: where it is and when it was highlighted, and any tags.
fn meta_line(entry: &Entry) -> String {
    let mut parts = Vec::new();
    if !entry.place.is_empty() {
        let mut place = entry.place.clone();
        if let Some(first) = place.get(..1) {
            place = format!("{}{}", first.to_uppercase(), &place[1..]);
        }
        parts.push(place);
    }
    if let Some(added) = entry.added {
        parts.push(added.to_string().chars().take(10).collect());
    }
    if !entry.tags.is_empty() {
        parts.push(format!("Tags: {}", entry.tags));
    }
    parts.join(" \u{b7} ")
}

fn note_inlines(text: &str) -> Vec<Inline> {
    let mut inlines = vec![Inline::marked(
        "Note: ",
        Marks {
            strong: true,
            ..Marks::none()
        },
    )];
    inlines.extend(lines(text));
    inlines
}

/// Text with its line breaks kept.
fn lines(text: &str) -> Vec<Inline> {
    let mut out = Vec::new();
    for (n, line) in text.lines().enumerate() {
        if n > 0 {
            out.push(Inline::HardBreak);
        }
        out.push(Inline::text(line));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestEnv;

    const CLIPPINGS: &str = "\u{feff}Walden (Henry David Thoreau)\r\n\
        - Your Highlight on page 12 | Location 345-346 | Added on Monday, March 4, 2024 10:30:15 AM\r\n\r\n\
        I went to the woods\r\n\
        ==========\r\n\
        Walden (Henry David Thoreau)\r\n\
        - Your Highlight on page 12 | Location 345-347 | Added on Monday, March 4, 2024 10:31:00 AM\r\n\r\n\
        I went to the woods because I wished to live deliberately\r\n\
        ==========\r\n\
        Walden (Henry David Thoreau)\r\n\
        - Your Note on page 12 | Location 347 | Added on Monday, March 4, 2024 10:32:00 AM\r\n\r\n\
        Remember this for the essay\r\n\
        ==========\r\n\
        Dune (Frank Herbert)\r\n\
        - Your Bookmark on Location 10 | Added on Monday, March 4, 2024 10:40:00 AM\r\n\r\n\
        ==========\r\n";

    #[test]
    fn clippings_become_a_page_for_each_book_without_repeated_highlights() {
        let entries = kindle(CLIPPINGS);
        assert_eq!(entries.len(), 3, "{entries:?}");
        assert_eq!(entries[0].author.as_deref(), Some("Henry David Thoreau"));
        assert_eq!(entries[0].place, "page 12, location 345-346");
        let world = TestEnv::new();
        let env = world.env();
        let done = books(entries, "My Clippings.txt", &env).expect("converts");
        assert_eq!(done.pages.len(), 1);
        assert_eq!(done.pages[0].page.page.title, "Walden");
        assert!(done.general.iter().any(|e| e.what.contains("repeated highlight")));
        assert!(done.pages[0].report.entries.iter().any(|e| e.what == "1 highlight"));
        assert!(done.pages[0].report.entries.iter().any(|e| e.what == "1 note"));
    }

    #[test]
    fn a_readwise_export_keeps_notes_places_and_tags() {
        let csv = "Highlight,Book Title,Book Author,Amazon Book ID,Note,Color,Tags,Location Type,Location,Highlighted at,Document tags\n\
            \"A line, with a comma\",Dune,Frank Herbert,B1,Fear is the mind-killer,yellow,\"quote,fear\",page,33,2024-03-04 10:30:00,\n";
        assert!(is_readwise(csv));
        let entries = readwise(csv);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].note, "Fear is the mind-killer");
        assert_eq!(entries[0].place, "page 33");
        assert!(meta_line(&entries[0]).contains("Page 33") && meta_line(&entries[0]).contains("Tags: quote,fear"));
    }
}
