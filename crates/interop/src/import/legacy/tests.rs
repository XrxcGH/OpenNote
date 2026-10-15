//! The legacy readers against files saved by Word and Excel, and a short mutation fuzz run on stable Rust.
//!
//! The fixtures in `tests/data/legacy` were saved by Microsoft Word and Excel from the same content, so each
//! format must give the same text. The fuzz run below mutates them, and small synthetic files, a few thousand
//! times and checks only that every reader returns. `crates/interop/fuzz` runs the same readers under libFuzzer.

use std::io::Cursor;

use super::book::{Book, SheetKind};
use super::flow::Flow;
use super::*;
use crate::doc::{plain_text, Block, Inline};
use crate::testing::{unzip, zip_bytes};

fn fixture(name: &str) -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/data/legacy")
        .join(name);
    std::fs::read(&path).expect("the fixture exists")
}

fn text_of(blocks: &[Block]) -> Vec<String> {
    blocks
        .iter()
        .map(|b| match b {
            Block::Heading { level, content } => format!("h{level} {}", plain_text(content)),
            Block::Paragraph(content) => plain_text(content),
            Block::List { ordered, items, .. } => {
                let texts: Vec<String> = items.iter().map(|i| text_of(&i.blocks).join("/")).collect();
                format!("{} {}", if *ordered { "ol" } else { "ul" }, texts.join("|"))
            }
            Block::Table { rows, .. } => {
                let rows: Vec<String> = rows
                    .iter()
                    .map(|r| r.iter().map(|c| plain_text(c)).collect::<Vec<_>>().join(","))
                    .collect();
                format!("table {}", rows.join(";"))
            }
            other => format!("{other:?}"),
        })
        .collect()
}

fn check_document(flow: Flow) {
    let (blocks, losses, tables) = flow.finish();
    let text = text_of(&blocks);
    assert_eq!(text[0], "h1 Lab notes");
    assert!(
        text[1].starts_with("Plain then bold and italic and under and struck. Café – 日本. See the site."),
        "{}",
        text[1]
    );
    assert_eq!(text[2], "ul First bullet|Second bullet");
    assert_eq!(text[3], "ol Step one|Step two");
    assert_eq!(text[4], "h2 Results");
    assert_eq!(text[5], "table Sample,Mass;A,;B,4.2 g");
    assert_eq!(text[6], "After the table.");
    assert_eq!(tables, 1);
    assert_eq!(losses.notes, 1);
    let Block::Paragraph(inlines) = &blocks[1] else {
        panic!("a paragraph")
    };
    let marked = |f: &dyn Fn(&crate::doc::Marks) -> bool, word: &str| {
        inlines
            .iter()
            .any(|i| matches!(i, Inline::Text { text, marks } if f(marks) && text.contains(word)))
    };
    assert!(marked(&|m| m.strong, "bold"));
    assert!(marked(&|m| m.emphasis, "italic"));
    assert!(marked(&|m| m.underline, "under"));
    assert!(marked(&|m| m.strike, "struck"));
    assert!(marked(
        &|m| m.link.as_deref() == Some("https://example.com/"),
        "the site"
    ));
}

#[test]
fn a_word_97_document_brings_its_structure() {
    let file = cfb::Compound::parse(fixture("notes.doc")).expect("a compound file");
    check_document(doc::read(&file).expect("reads"));
}

#[test]
fn the_same_document_as_rtf_reads_the_same() {
    check_document(rtf::read(&fixture("notes.rtf")).expect("reads"));
}

#[test]
fn locked_files_say_why_they_cannot_be_read() {
    let file = cfb::Compound::parse(fixture("locked.doc")).expect("a compound file");
    assert!(matches!(doc::read(&file), Err(Problem::Unsupported(why)) if why.contains("password")));
    let file = cfb::Compound::parse(fixture("locked.xls")).expect("a compound file");
    assert!(matches!(xls::read(&file), Err(Problem::Unsupported(why)) if why.contains("password")));
}

fn sheets(book: Book) -> Vec<(String, Option<Vec<Vec<String>>>)> {
    book.sheets
        .into_iter()
        .map(|s| {
            let rows = match s.kind {
                SheetKind::Cells(grid) => Some(grid.rows),
                _ => None,
            };
            (s.title, rows)
        })
        .collect()
}

fn check_book(book: Book, percent: &str) {
    let got = sheets(book);
    assert_eq!(got.len(), 3);
    assert_eq!(got[1], ("Old".to_owned(), None), "the hidden sheet stays out");
    let (title, rows) = &got[0];
    assert_eq!(title, "Budget");
    let rows = rows.as_ref().expect("cells");
    assert_eq!(rows[0], ["Item", "Cost", "Due"]);
    assert_eq!(rows[1], ["Pens", "12.5", "2023-03-15"]);
    assert_eq!(rows[2], ["Ink", "25", percent]);
    assert_eq!(rows[3], ["Café", "TRUE", "123456789"]);
    assert_eq!(rows[4][0], "Total 25");
    assert_eq!(rows[5][0], "Merged");
    let notes = got[2].1.as_ref().expect("cells");
    assert_eq!(notes[0][0], "Only");
    assert_eq!(notes[2][1], "-7");
}

#[test]
fn an_excel_97_workbook_brings_values_formulas_and_dates() {
    let file = cfb::Compound::parse(fixture("budget.xls")).expect("a compound file");
    check_book(xls::read(&file).expect("reads"), "25%");
}

#[test]
fn an_excel_binary_workbook_reads_the_same() {
    let mut parts = Parts::from_reader(Cursor::new(fixture("budget.xlsb"))).expect("a zip");
    check_book(xlsb::read(&mut parts, "budget").expect("reads"), "25%");
}

#[test]
fn an_opendocument_spreadsheet_reads_the_same() {
    let mut parts = Parts::from_reader(Cursor::new(fixture("budget.ods"))).expect("a zip");
    check_book(ods::read(&mut parts, "budget").expect("reads"), "25%");
}

/// A small, fast, repeatable random source for the mutations.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// A copy of `data` with a few random changes: flipped bytes, a field set to an extreme, a cut, or a repeat.
fn mutate(data: &[u8], rng: &mut Rng) -> Vec<u8> {
    let mut out = data.to_vec();
    for _ in 0..=rng.below(4) {
        if out.is_empty() {
            break;
        }
        let at = rng.below(out.len());
        match rng.below(5) {
            0 => out[at] ^= 1 << rng.below(8),
            1 => {
                let value = [0u32, 1, 0x7FFF_FFFF, 0xFFFF_FFFE, 0xFFFF_FFFF][rng.below(5)].to_le_bytes();
                for (i, b) in value.iter().enumerate() {
                    if let Some(slot) = out.get_mut(at + i) {
                        *slot = *b;
                    }
                }
            }
            2 => out.truncate(at),
            3 => {
                let len = rng.below(64).min(out.len() - at);
                let chunk = out[at..at + len].to_vec();
                out.splice(at..at, chunk.iter().copied().cycle().take(len * rng.below(8)));
            }
            _ => out[at] = rng.next() as u8,
        }
    }
    out
}

fn read_any_compound(data: Vec<u8>) {
    if let Ok(file) = cfb::Compound::parse(data) {
        let _ = doc::read(&file).map(Flow::finish);
        let _ = xls::read(&file);
    }
}

fn read_zipped(data: Vec<u8>) {
    if let Ok(mut parts) = Parts::from_reader(Cursor::new(data)) {
        let _ = xlsb::read(&mut parts, "fuzz");
        let _ = ods::read(&mut parts, "fuzz");
    }
}

#[test]
fn mutated_compound_files_never_panic() {
    let mut rng = Rng(0x5EED_1234_ABCD_0001);
    let seeds = [fixture("notes.doc"), fixture("budget.xls"), fixture("locked.doc")];
    for seed in &seeds {
        for _ in 0..300 {
            read_any_compound(mutate(seed, &mut rng));
        }
    }
    // Damage the streams inside a well-formed container, so the readers past the container see it.
    let file = cfb::Compound::parse(fixture("notes.doc")).expect("parses");
    let word = file.stream("WordDocument").expect("found").expect("reads");
    let table = file.stream("1Table").expect("found").expect("reads");
    for _ in 0..400 {
        let rebuilt = cfb::tests::build(&[
            ("WordDocument", &mutate(&word, &mut rng)),
            ("1Table", &mutate(&table, &mut rng)),
        ]);
        read_any_compound(rebuilt);
    }
    let file = cfb::Compound::parse(fixture("budget.xls")).expect("parses");
    let book = file.stream("Workbook").expect("found").expect("reads");
    for _ in 0..400 {
        read_any_compound(cfb::tests::build(&[("Workbook", &mutate(&book, &mut rng))]));
    }
}

#[test]
fn mutated_rtf_never_panics() {
    let mut rng = Rng(0x5EED_1234_ABCD_0002);
    let seed = fixture("notes.rtf");
    for _ in 0..400 {
        let _ = rtf::read(&mutate(&seed, &mut rng)).map(Flow::finish);
    }
}

#[test]
fn mutated_zipped_sheets_never_panic() {
    let mut rng = Rng(0x5EED_1234_ABCD_0003);
    for name in ["budget.xlsb", "budget.ods"] {
        let entries = unzip(&fixture(name));
        for _ in 0..200 {
            let victim = rng.below(entries.len());
            let changed: Vec<(String, Vec<u8>)> = entries
                .iter()
                .enumerate()
                .map(|(i, (n, b))| (n.clone(), if i == victim { mutate(b, &mut rng) } else { b.clone() }))
                .collect();
            let refs: Vec<(&str, &[u8])> = changed.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
            read_zipped(zip_bytes(&refs));
        }
    }
}
