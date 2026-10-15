//! Importing older and binary office formats: Word 97-2003 (`.doc`), Rich Text Format (`.rtf`), Excel 97-2003
//! (`.xls`), Excel binary (`.xlsb`), and OpenDocument spreadsheets (`.ods`).
//!
//! These readers parse files from anywhere, so they are written to fail safely. Every size, count, and offset
//! that comes from a file is checked before it is used or allocated, every read goes through a bounds check, and
//! loops that follow links in the file have a limit. A damaged file becomes an import error or a shorter page,
//! never a crash. The crate's README lists the limits.
//!
//! The text readers hand their text to a shared [`flow::Flow`], and the spreadsheet readers fill a
//! [`book::Book`] of grids, so each format maps to OpenNote pages and tables the same way.

#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing,
        clippy::unreachable,
        clippy::todo
    )
)]

mod book;
mod bytes;
mod cfb;
mod doc;
mod doc_props;
mod flow;
mod ods;
mod rtf;
mod rtf_words;
mod xls;
mod xls_strings;
mod xlsb;

use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;

use super::files::Converted;
use super::zipxml::Parts;
use crate::error::{InteropError, Result};
use crate::sink::ImportEnv;

/// The largest file these readers open. Older Office files are rarely over a few megabytes.
pub(crate) const MAX_FILE_BYTES: u64 = 128 << 20;

/// Why a binary reader stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Problem {
    /// The file is damaged or is not what its name says, with the detail for the error message.
    Damaged(&'static str),
    /// A part of the file is larger than the readers take.
    TooBig,
    /// The file is valid but this version cannot read it, with what to do instead.
    Unsupported(&'static str),
}

fn problem(name: &str, problem: Problem) -> InteropError {
    match problem {
        Problem::Damaged(detail) => InteropError::format(name, detail),
        Problem::TooBig => InteropError::TooBig(format!("a part of {name} over 64 MiB")),
        Problem::Unsupported(why) => InteropError::unsupported(name, why),
    }
}

/// The extensions of the older document formats.
pub(super) const DOCUMENT_EXTENSIONS: [&str; 3] = ["doc", "dot", "rtf"];
/// The extensions of the older and binary spreadsheet formats.
pub(super) const SHEET_EXTENSIONS: [&str; 5] = ["xls", "xlt", "xlsb", "ods", "ots"];

/// Reads a whole file, refusing one over [`MAX_FILE_BYTES`] before reading it.
fn read_file(path: &Path) -> Result<Vec<u8>> {
    let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
    let size = file.metadata().map_err(|e| InteropError::io(path, e))?.len();
    if size > MAX_FILE_BYTES {
        return Err(InteropError::TooBig(format!(
            "{}, which is over 128 MiB",
            file_name(path)
        )));
    }
    let mut data = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| InteropError::io(path, e))?;
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err(InteropError::TooBig(format!(
            "{}, which is over 128 MiB",
            file_name(path)
        )));
    }
    Ok(data)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
}

/// Whether bytes start like a ZIP archive, as a `.docx`, `.xlsx`, or `.ods` file does.
pub(super) fn is_zip(data: &[u8]) -> bool {
    data.starts_with(b"PK\x03\x04")
}

/// Whether bytes start like markup: a web page or an XML file saved under an older Office name.
fn is_markup(data: &[u8]) -> bool {
    let start = data
        .iter()
        .position(|b| !b.is_ascii_whitespace() && *b != 0xEF && *b != 0xBB && *b != 0xBF);
    start.and_then(|s| data.get(s)) == Some(&b'<')
}

/// Reads a `.doc` or `.rtf` file into one page. The file's first bytes, not its name, pick the reader.
pub(super) fn convert_document(path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
    let name = stem(path);
    let data = read_file(path)?;
    let flow = if cfb::is_compound(&data) {
        cfb::Compound::parse(data).and_then(|file| doc::read(&file))
    } else if rtf::is_rtf(&data) {
        rtf::read(&data)
    } else if is_markup(&data) {
        Err(Problem::Unsupported(
            "This file is a web page with a Word name. Change its extension to .htm and import it as HTML.",
        ))
    } else {
        Err(Problem::Damaged("it is not a Word 97-2003 or RTF document"))
    };
    let flow = flow.map_err(|p| problem(&name, p))?;
    env.control.checkpoint()?;
    flow::text_page(env, &name, flow)
}

/// Reads an `.xls`, `.xlsb`, or `.ods` file, a table page for each sheet. The file's first bytes and parts, not
/// its name, pick the reader. `xlsx` reads a workbook that is really an `.xlsx` file.
pub(super) fn convert_sheet(
    path: &Path,
    env: &ImportEnv<'_>,
    xlsx: &dyn Fn(&mut Parts<Cursor<Vec<u8>>>, &str) -> Result<Converted>,
) -> Result<Converted> {
    let name = stem(path);
    let data = read_file(path)?;
    let book = if cfb::is_compound(&data) {
        let file = cfb::Compound::parse(data).map_err(|p| problem(&name, p))?;
        xls::read(&file).map_err(|p| problem(&name, p))?
    } else if is_zip(&data) {
        let mut parts = Parts::from_reader(Cursor::new(data))?;
        if !parts.names_under("xl/workbook.bin").is_empty() {
            xlsb::read(&mut parts, &name)?
        } else if !parts.names_under("xl/workbook.xml").is_empty() {
            return xlsx(&mut parts, &name);
        } else {
            ods::read(&mut parts, &name)?
        }
    } else if is_markup(&data) {
        return Err(problem(
            &name,
            Problem::Unsupported(
                "This file is an Excel 2003 XML or web page file. Open it in Excel, save it as .xlsx, and import that.",
            ),
        ));
    } else {
        return Err(problem(
            &name,
            Problem::Damaged("it is not an Excel or OpenDocument workbook"),
        ));
    };
    book::book_pages(env, &name, book)
}

#[cfg(feature = "fuzzing")]
pub mod fuzzing {
    //! Entry points for the fuzz targets in `crates/interop/fuzz`. Each reads untrusted bytes and must return.

    /// Reads bytes as a `.doc` file.
    pub fn doc(data: &[u8]) {
        if let Ok(file) = super::cfb::Compound::parse(data.to_vec()) {
            let _ = super::doc::read(&file).map(super::flow::Flow::finish);
        }
    }

    /// Reads bytes as an `.rtf` file.
    pub fn rtf(data: &[u8]) {
        let _ = super::rtf::read(data).map(super::flow::Flow::finish);
    }

    /// Reads bytes as an `.xls` file.
    pub fn xls(data: &[u8]) {
        if let Ok(file) = super::cfb::Compound::parse(data.to_vec()) {
            let _ = super::xls::read(&file);
        }
    }

    /// Reads bytes as the parts of an `.xlsb` or `.ods` file.
    pub fn zipped_sheet(data: &[u8]) {
        if let Ok(mut parts) = super::Parts::from_reader(std::io::Cursor::new(data.to_vec())) {
            let _ = super::xlsb::read(&mut parts, "fuzz");
            let _ = super::ods::read(&mut parts, "fuzz");
        }
    }
}

#[cfg(test)]
mod tests;
