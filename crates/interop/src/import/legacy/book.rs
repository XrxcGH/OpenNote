//! A workbook read by any of the older spreadsheet readers, and the pages made from it.

use super::super::files::Converted;
use super::super::workbook::{sheet_page, Dates, Grid};
use crate::error::Result;
use crate::report::PageReport;
use crate::sink::ImportEnv;

/// The most sheets read from one workbook.
pub(super) const MAX_SHEETS: usize = 1_024;

/// One sheet of a workbook.
pub(super) struct Sheet {
    pub title: String,
    pub kind: SheetKind,
}

/// What a sheet holds.
pub(super) enum SheetKind {
    /// Cells.
    Cells(Grid),
    /// Nothing to import: the sheet is hidden.
    Hidden,
    /// A chart sheet or a macro sheet, which has no cells to import.
    NoCells,
}

/// The sheets of a workbook, and what the reader noticed about the file as a whole.
#[derive(Default)]
pub(super) struct Book {
    pub sheets: Vec<Sheet>,
    /// Whether the file holds charts or pictures, which are not imported.
    pub drawings: bool,
}

/// A table page for each sheet with cells, and report entries for the rest.
pub(super) fn book_pages(env: &ImportEnv<'_>, name: &str, book: Book) -> Result<Converted> {
    let now = env.clock.now();
    let dates = Dates {
        created: now,
        modified: now,
    };
    let mut converted = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let mut general = PageReport::default();
    for sheet in book.sheets {
        env.control.checkpoint()?;
        let title = if sheet.title.trim().is_empty() {
            "Sheet".to_owned()
        } else {
            sheet.title
        };
        match sheet.kind {
            SheetKind::Cells(grid) => converted.pages.push(sheet_page(env, &title, name, &dates, grid)?),
            SheetKind::Hidden => general.skipped(
                format!("hidden sheet \"{title}\""),
                "Hidden sheets stay hidden by staying out.",
            ),
            SheetKind::NoCells => general.skipped(
                format!("sheet \"{title}\""),
                "It is a chart or macro sheet, which has no cells to import.",
            ),
        }
    }
    if book.drawings {
        general.skipped(
            "charts and pictures",
            "OpenNote reads the cells of a sheet, not what is drawn on it.",
        );
    }
    converted.general = general.entries;
    if converted.pages.is_empty() && converted.general.is_empty() {
        return Err(crate::error::InteropError::format(name, "the workbook has no sheets"));
    }
    Ok(converted)
}
