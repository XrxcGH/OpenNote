//! Fuzz entry points for the importers (A4-36).
//!
//! Each `cargo fuzz` target in `crates/interop/fuzz` calls one function here, and `tests/fuzz_entries.rs` runs
//! the same functions on stable Rust with generated and damaged inputs. An importer may refuse an input with an
//! error, but it must return, and it must never panic. A panic or a hang here is a finding.
//!
//! The Office formats are zip packages, so random bytes rarely get past the zip reader. When the input is not a
//! zip file, the entry wraps it as the main XML part of a small package, so the XML reader of each format gets
//! fuzzed too.

use std::fs;
use std::io::Cursor;
use std::path::Path;

use crate::archive::{ArchiveLimits, ZipArchive};
use crate::error::Result;
use crate::import::{
    import_csv, import_docx, import_enex, import_html_folder, import_markdown_folder, import_mht, import_pptx,
    import_xlsx,
};
use crate::report::Report;
use crate::sink::{ImportEnv, ImportSink, MemorySink};
use crate::sqlite::Database;
use crate::testing::{zip_bytes, TestEnv};

type Importer = fn(&Path, &ImportEnv<'_>, &mut dyn ImportSink) -> Result<Report>;

/// Limits small enough that no input can use much memory.
fn limits() -> ArchiveLimits {
    ArchiveLimits {
        entry_bytes: 8 << 20,
        total_bytes: 32 << 20,
        entries: 4_096,
    }
}

/// Writes the input to a file named `name` in a new temporary folder and imports it. The outcome is dropped.
fn run_file(importer: Importer, name: &str, data: &[u8]) {
    let Ok(dir) = tempfile::tempdir() else {
        return;
    };
    let file = dir.path().join(name);
    if fs::write(&file, data).is_err() {
        return;
    }
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let _ = importer(&file, &world.env(), &mut sink);
}

/// The input itself when it is a zip file, otherwise a package with the input as its part `main`.
fn package(data: &[u8], main: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    if data.starts_with(b"PK") {
        return data.to_vec();
    }
    let mut files: Vec<(&str, &[u8])> = vec![("[Content_Types].xml", b"<Types/>"), (main, data)];
    files.extend_from_slice(extra);
    zip_bytes(&files)
}

/// The zip reader: every entry of the archive is read, within small limits.
pub fn zip(data: &[u8]) {
    let Ok(mut archive) = ZipArchive::new(Cursor::new(data), limits()) else {
        return;
    };
    for index in 0..archive.entries().len() {
        let _ = archive.read(index);
    }
    let _ = archive.common_root();
}

/// An Evernote `.enex` file, which is XML with ENML notes inside.
pub fn enex(data: &[u8]) {
    run_file(import_enex, "notes.enex", data);
}

/// A Word file. Plain bytes become `word/document.xml`.
pub fn docx(data: &[u8]) {
    run_file(import_docx, "doc.docx", &package(data, "word/document.xml", &[]));
}

/// An OpenDocument text file. Plain bytes become `content.xml`.
pub fn odt(data: &[u8]) {
    let mime: &[u8] = b"application/vnd.oasis.opendocument.text";
    run_file(
        import_docx,
        "doc.odt",
        &package(data, "content.xml", &[("mimetype", mime)]),
    );
}

/// An Excel file. Plain bytes become the first sheet.
pub fn xlsx(data: &[u8]) {
    let workbook: &[u8] = br#"<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
    let rels: &[u8] = br#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"#;
    let extra = [("xl/workbook.xml", workbook), ("xl/_rels/workbook.xml.rels", rels)];
    run_file(
        import_xlsx,
        "book.xlsx",
        &package(data, "xl/worksheets/sheet1.xml", &extra),
    );
}

/// A PowerPoint file. Plain bytes become the first slide, which is also drawn as a picture.
pub fn pptx(data: &[u8]) {
    let deck: &[u8] = concat!(
        r#"<p:presentation xmlns:p="p" xmlns:r="r">"#,
        r#"<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>"#
    )
    .as_bytes();
    let rels: &[u8] = br#"<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>"#;
    let extra = [
        ("ppt/presentation.xml", deck),
        ("ppt/_rels/presentation.xml.rels", rels),
    ];
    run_file(
        import_pptx,
        "deck.pptx",
        &package(data, "ppt/slides/slide1.xml", &extra),
    );
}

/// A web page.
pub fn html(data: &[u8]) {
    run_file(import_html_folder, "page.html", data);
}

/// A web archive (`.mht`), which is MIME with HTML parts.
pub fn mht(data: &[u8]) {
    run_file(import_mht, "page.mht", data);
}

/// A Markdown note.
pub fn markdown(data: &[u8]) {
    run_file(import_markdown_folder, "note.md", data);
}

/// A CSV file: the reader, then the import that infers column types.
pub fn csv(data: &[u8]) {
    let _ = crate::csv::parse_bytes(data);
    run_file(import_csv, "table.csv", data);
}

/// The SQLite reader: every row of every table is visited.
pub fn sqlite(data: &[u8]) {
    let Ok(database) = Database::from_bytes(data.to_vec(), None) else {
        return;
    };
    for table in database.tables() {
        let mut rows = 0usize;
        let _ = database.for_each_row(table, &mut |row| {
            rows += 1;
            let _ = row.get("id");
            Ok(())
        });
    }
}
