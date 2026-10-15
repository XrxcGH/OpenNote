// checks-disable-file modifiability: convert_parts reads the sheets in order; split it when it grows again
//! Importing Excel workbooks (`.xlsx`, `.xlsm`) as tables: one page for each sheet.
//!
//! A workbook is a ZIP archive of XML parts. This reader takes each visible sheet's cells in a grid, with the first
//! row as the table's header. Text, numbers, truth values, and errors come over as their shown text. A number with a
//! date format becomes an ISO date, and a percentage format shows a percent sign. A formula shows its last
//! calculated value, or its own text when the file holds none. Merged cells, charts, pictures, and other number
//! formats are reported.

use std::collections::HashMap;
use std::path::Path;

use super::files::{import_files, Converted, ConvertedPage, FileConverter};
use super::sheet::{cell, rows_that_fit, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS};
use super::xmltree::Element;
use super::zipxml::{first_text, read_rels, resolve, ElementExt, Parts};
use crate::dates::parse_date;
use crate::doc::{Block, Inline};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// Imports an Excel file, or a folder of them, into a new notebook. Each file becomes a section.
pub fn import_xlsx(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_files(path, &ExcelConverter, env, sink)
}

struct ExcelConverter;

impl FileConverter for ExcelConverter {
    fn label(&self) -> &'static str {
        "Excel workbooks"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["xlsx", "xlsm"]
    }

    fn convert(&self, path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
        let mut parts = Parts::open(path)?;
        let stem = path
            .file_stem()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        convert_parts(&mut parts, &stem, env)
    }
}

fn convert_parts<R: std::io::Read + std::io::Seek>(
    parts: &mut Parts<R>,
    name: &str,
    env: &ImportEnv<'_>,
) -> Result<Converted> {
    let workbook = parts
        .xml("xl/workbook.xml")?
        .ok_or_else(|| InteropError::format(name, "it is not an Excel workbook: the file has no xl/workbook.xml"))?;
    let rels = parts
        .xml("xl/_rels/workbook.xml.rels")?
        .map(|r| read_rels(&r))
        .unwrap_or_default();
    let strings = parts
        .xml("xl/sharedStrings.xml")?
        .map(|s| shared_strings(&s))
        .unwrap_or_default();
    let formats = parts
        .xml("xl/styles.xml")?
        .map(|s| Formats::read(&s))
        .unwrap_or_default();
    let date1904 = workbook
        .first("workbookpr")
        .and_then(|p| p.attr("date1904"))
        .is_some_and(|v| v == "1" || v == "true");
    let now = env.clock.now();
    let (created, modified) = match parts.xml("docProps/core.xml")? {
        Some(core) => (
            first_text(&core, "dcterms:created").and_then(|d| parse_date(&d)),
            first_text(&core, "dcterms:modified").and_then(|d| parse_date(&d)),
        ),
        None => (None, None),
    };
    let created = created.unwrap_or(now);
    let modified = modified.unwrap_or(created).max(created);

    let mut converted = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let mut general = PageReport::default();
    let sheets: Vec<&Element> = workbook
        .first("sheets")
        .map(|s| s.elements("sheet").collect())
        .unwrap_or_default();
    for sheet in sheets {
        env.control.checkpoint()?;
        let title = sheet.attr("name").unwrap_or("Sheet").to_owned();
        if sheet.attr("state").is_some_and(|s| s == "hidden" || s == "veryhidden") {
            general.skipped(
                format!("hidden sheet \"{title}\""),
                "Hidden sheets stay hidden by staying out.",
            );
            continue;
        }
        let Some(target) = sheet.attr("r:id").and_then(|id| rels.get(id)) else {
            general.skipped(
                format!("sheet \"{title}\""),
                "The workbook does not say where its data is.",
            );
            continue;
        };
        let part = resolve("xl", &target.0);
        let root = match parts.xml(&part) {
            Ok(Some(root)) => root,
            Ok(None) => continue,
            Err(InteropError::TooBig(what)) => {
                general.skipped(
                    format!("sheet \"{title}\""),
                    format!("It is too large to read ({what})."),
                );
                continue;
            }
            Err(error) => return Err(error),
        };
        let grid = read_grid(&root, &strings, &formats, date1904);
        let mut report = PageReport {
            title: title.clone(),
            source: name.to_owned(),
            entries: Vec::new(),
        };
        let mut builder = PageBuilder::new(env, &title, created, modified);
        if grid.rows.is_empty() {
            report.skipped("sheet", "The sheet has no cells with values.");
            builder.push_blocks(vec![Block::Paragraph(vec![Inline::text("This sheet was empty.")])]);
        } else {
            let kept = grid.rows.len();
            let rows: Vec<Vec<Vec<Inline>>> = grid.rows.iter().map(|r| r.iter().map(|c| cell(c)).collect()).collect();
            report.came_over(format!("{} rows and {} columns", kept.saturating_sub(1), grid.width));
            let (one, many, why) = if kept > MAX_TABLE_ROWS {
                (
                    "row beyond the first 10,000",
                    "rows beyond the first 10,000",
                    "A page holds one table of at most that size.",
                )
            } else {
                (
                    "row that did not fit on the page",
                    "rows that did not fit on the page",
                    "A page holds one table of at most about 32 MiB.",
                )
            };
            report.skipped_count(grid.total_rows - kept, (one, many), why);
            builder.push_blocks(vec![Block::Table { header: true, rows }]);
        }
        report.simplified_count(
            grid.formulas,
            ("formula", "formulas"),
            "A formula shows its last calculated value, or its text when the file holds no value.",
        );
        report.simplified_count(
            grid.merged,
            ("merged range", "merged ranges"),
            "Each merged range became its first cell and empty cells.",
        );
        report.simplified_count(
            grid.other_formats,
            ("cell with a number format", "cells with number formats"),
            "Only date and percentage formats are kept. The others show the plain number.",
        );
        report.skipped_count(
            grid.cut_columns,
            ("column beyond the first 1,000", "columns beyond the first 1,000"),
            "A table holds at most that many columns.",
        );
        converted.pages.push(ConvertedPage {
            section: None,
            page: builder.finish()?,
            report,
        });
    }
    if !parts.names_under("xl/drawings/").is_empty() || !parts.names_under("xl/charts/").is_empty() {
        general.skipped(
            "charts and pictures",
            "OpenNote reads the cells of a sheet, not what is drawn on it.",
        );
    }
    converted.general = general.entries;
    if converted.pages.is_empty() && converted.general.is_empty() {
        return Err(InteropError::format(name, "the workbook has no sheets"));
    }
    Ok(converted)
}

/// The cells of a sheet as text.
#[derive(Default)]
struct Grid {
    /// The rows that become the table, from the first row with a value: at most what [`rows_that_fit`] keeps.
    rows: Vec<Vec<String>>,
    /// How many rows the sheet spans, from its first row with a value to its last, kept or not.
    total_rows: usize,
    width: usize,
    formulas: usize,
    merged: usize,
    other_formats: usize,
    cut_columns: usize,
}

/// Reads a sheet's cells. Row and column numbers come from the file and can be anything up to `usize::MAX`, so the
/// grid is sized by the rows that will be kept, never by the numbers: a cell in row 4,000,000,000 is counted, not
/// allocated for.
fn read_grid(root: &Element, strings: &[String], formats: &Formats, date1904: bool) -> Grid {
    let mut grid = Grid::default();
    let mut cells: Vec<(usize, usize, String)> = Vec::new();
    let mut next_row = 0usize;
    if let Some(data) = root.first("sheetdata") {
        for row in data.elements("row") {
            let r = row
                .attr("r")
                .and_then(|r| r.parse::<usize>().ok())
                .map_or(next_row, |r| r.saturating_sub(1));
            next_row = r.saturating_add(1);
            let mut next_col = 0usize;
            for c in row.elements("c") {
                let col = c.attr("r").and_then(column_of).unwrap_or(next_col);
                next_col = col.saturating_add(1);
                if col >= MAX_TABLE_COLUMNS {
                    grid.cut_columns += 1;
                    continue;
                }
                let (text, formula, formatted) = cell_text(c, strings, formats, date1904);
                grid.formulas += usize::from(formula);
                grid.other_formats += usize::from(formatted);
                if !text.is_empty() {
                    cells.push((r, col, text));
                }
            }
        }
    }
    grid.merged = root.first("mergecells").map_or(0, |m| m.elements("mergecell").count());
    let (Some(first_row), Some(last_row)) = (cells.iter().map(|c| c.0).min(), cells.iter().map(|c| c.0).max()) else {
        return grid;
    };
    grid.total_rows = (last_row - first_row).saturating_add(1);
    // Only rows up to the table's row limit can be kept, so only they are measured, and only the rows that fit
    // are built.
    let span = grid.total_rows.min(MAX_TABLE_ROWS + 1);
    let within = |r: usize| r - first_row < span;
    grid.width = cells.iter().filter(|c| within(c.0)).map(|c| c.1 + 1).max().unwrap_or(0);
    let mut text = vec![0usize; span];
    for (r, _, t) in cells.iter().filter(|c| within(c.0)) {
        text[r - first_row] += t.len();
    }
    let kept = rows_that_fit(text, grid.width);
    let mut rows = vec![vec![String::new(); grid.width]; kept];
    for (r, c, t) in cells {
        if let Some(row) = rows.get_mut(r - first_row) {
            row[c] = t;
        }
    }
    grid.rows = rows;
    grid
}

/// The text of one cell, whether it holds a formula, and whether it had a number format that was not kept.
fn cell_text(c: &Element, strings: &[String], formats: &Formats, date1904: bool) -> (String, bool, bool) {
    let kind = c.attr("t").unwrap_or("n");
    let value = c.first("v").map(|v| v.all_text());
    let formula = c.first("f").map(|f| f.all_text());
    let style = c.attr("s").and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
    let mut formatted = false;
    let text = match (kind, value.as_deref()) {
        ("s", Some(v)) => v
            .trim()
            .parse::<usize>()
            .ok()
            .and_then(|i| strings.get(i))
            .cloned()
            .unwrap_or_default(),
        ("inlineStr", _) => c.first("is").map(shared_text).unwrap_or_default(),
        ("b", Some(v)) => if v.trim() == "1" { "TRUE" } else { "FALSE" }.to_owned(),
        ("e" | "str", Some(v)) => v.to_owned(),
        ("d", Some(v)) => v.trim().to_owned(),
        (_, Some(v)) => match v.trim().parse::<f64>() {
            Ok(number) => match formats.kind(style) {
                Kind::Date => date_text(number, date1904),
                Kind::Percent(decimals) => format!("{}%", trim_float(number * 100.0, decimals.max(0) as usize)),
                Kind::Other => {
                    formatted = true;
                    trim_float(number, 10)
                }
                Kind::General => trim_float(number, 10),
            },
            Err(_) => v.to_owned(),
        },
        _ => String::new(),
    };
    let has_formula = formula.is_some();
    if text.is_empty() {
        if let Some(f) = formula.filter(|f| !f.trim().is_empty()) {
            return (format!("={}", f.trim()), true, false);
        }
    }
    (text, has_formula, formatted && !has_formula)
}

/// The text of a shared string or inline string: its text runs, without phonetic hints.
fn shared_text(si: &Element) -> String {
    let mut out = String::new();
    for child in si.kids() {
        match child.name.as_str() {
            "t" => out.push_str(&child.all_text()),
            "r" => {
                if let Some(t) = child.first("t") {
                    out.push_str(&t.all_text());
                }
            }
            _ => {}
        }
    }
    out
}

fn shared_strings(root: &Element) -> Vec<String> {
    root.elements("si").map(shared_text).collect()
}

/// `B3` is column 1; `AA1` is column 26.
fn column_of(reference: &str) -> Option<usize> {
    let letters: String = reference.chars().take_while(char::is_ascii_alphabetic).collect();
    if letters.is_empty() {
        return None;
    }
    let n = letters.to_ascii_uppercase().bytes().fold(0usize, |n, b| {
        n.saturating_mul(26).saturating_add(usize::from(b - b'A') + 1)
    });
    Some(n - 1)
}

/// A number with trailing zeros removed, to at most `decimals` places.
fn trim_float(number: f64, decimals: usize) -> String {
    if !number.is_finite() {
        return number.to_string();
    }
    if number.fract() == 0.0 && number.abs() < 1e15 {
        return format!("{number:.0}");
    }
    let text = format!("{number:.decimals$}");
    if text.contains('.') {
        text.trim_end_matches('0').trim_end_matches('.').to_owned()
    } else {
        text
    }
}

/// A date serial as `2024-03-05`, with the time when the serial has a fraction.
fn date_text(serial: f64, date1904: bool) -> String {
    let days = serial.floor();
    let seconds = ((serial - days) * 86_400.0).round() as i64;
    // Excel counts 1900 as a leap year, so serials past 59 are one day late in the 1900 system.
    let epoch_offset = if date1904 {
        24_107
    } else if days >= 61.0 {
        25_569
    } else {
        25_568
    };
    let (y, m, d) = civil_from_days(days as i64 - epoch_offset);
    if seconds == 0 {
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        format!(
            "{y:04}-{m:02}-{d:02} {:02}:{:02}",
            seconds / 3600 % 24,
            seconds / 60 % 60
        )
    }
}

/// The year, month, and day of a count of days since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// What a cell's number format means to this reader.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    General,
    Date,
    Percent(i32),
    Other,
}

#[derive(Default)]
struct Formats {
    /// The format of each cell style (`cellXfs`), by position.
    cell: Vec<Kind>,
}

impl Formats {
    fn read(styles: &Element) -> Formats {
        let custom: HashMap<u32, String> = styles
            .first("numfmts")
            .map(|n| {
                n.elements("numfmt")
                    .filter_map(|f| Some((f.attr("numfmtid")?.parse().ok()?, f.attr("formatcode")?.to_owned())))
                    .collect()
            })
            .unwrap_or_default();
        let cell = styles
            .first("cellxfs")
            .map(|x| {
                x.elements("xf")
                    .map(|xf| {
                        let id: u32 = xf.attr("numfmtid").and_then(|i| i.parse().ok()).unwrap_or(0);
                        classify(id, custom.get(&id).map(String::as_str))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Formats { cell }
    }

    fn kind(&self, style: usize) -> Kind {
        self.cell.get(style).copied().unwrap_or(Kind::General)
    }
}

fn classify(id: u32, code: Option<&str>) -> Kind {
    match id {
        0 => return Kind::General,
        9 => return Kind::Percent(0),
        10 => return Kind::Percent(2),
        14..=22 | 45..=47 => return Kind::Date,
        _ => {}
    }
    let Some(code) = code else {
        return if id < 164 { Kind::Other } else { Kind::General };
    };
    // Quoted text and escaped characters do not count: a format "0 \"days\"" is not a date.
    let mut plain = String::new();
    let (mut quoted, mut escaped, mut bracket) = (false, false, false);
    for c in code.chars() {
        match c {
            _ if escaped => escaped = false,
            '\\' | '_' => escaped = true,
            '"' => quoted = !quoted,
            '[' if !quoted => bracket = true,
            ']' if !quoted => bracket = false,
            _ if quoted || bracket => {}
            other => plain.push(other.to_ascii_lowercase()),
        }
    }
    if plain.contains('%') {
        let decimals = plain
            .split('.')
            .nth(1)
            .map_or(0, |d| d.chars().take_while(|c| *c == '0').count());
        return Kind::Percent(decimals as i32);
    }
    if plain.chars().any(|c| matches!(c, 'd' | 'y' | 'h' | 's')) || plain.contains('m') && !plain.contains('0') {
        return Kind::Date;
    }
    if plain.trim() == "general" || plain.is_empty() {
        Kind::General
    } else {
        Kind::Other
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::testing::{zip_bytes, TestEnv};

    const WORKBOOK: &str = r#"<workbook xmlns:r="r"><sheets>
        <sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Old" sheetId="2" state="hidden" r:id="rId2"/>
        </sheets></workbook>"#;
    const RELS: &str = r#"<Relationships>
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
        </Relationships>"#;
    const SHEET: &str = r#"<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
        <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>12.5</v></c><c r="C2" s="1"><v>45000</v></c></row>
        <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><f>B2*2</f><v>25</v></c><c r="C3"><f>A9+1</f></c></row>
        </sheetData><mergeCells count="1"><mergeCell ref="A5:B5"/></mergeCells></worksheet>"#;
    const STRINGS: &str = "<sst><si><t>Item</t></si><si><t>Cost</t></si><si><t>Due</t></si>\
        <si><t>Pens</t></si><si><r><t>Ink</t></r></si></sst>";
    const STYLES: &str = r#"<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>"#;

    #[test]
    fn a_workbook_becomes_a_table_page_for_each_visible_sheet() {
        let bytes = zip_bytes(&[
            ("xl/workbook.xml", WORKBOOK.as_bytes()),
            ("xl/_rels/workbook.xml.rels", RELS.as_bytes()),
            ("xl/worksheets/sheet1.xml", SHEET.as_bytes()),
            ("xl/worksheets/sheet2.xml", b"<worksheet/>"),
            ("xl/sharedStrings.xml", STRINGS.as_bytes()),
            ("xl/styles.xml", STYLES.as_bytes()),
        ]);
        let mut parts = Parts::from_reader(Cursor::new(bytes)).expect("opens");
        let world = TestEnv::new();
        let env = world.env();
        let done = convert_parts(&mut parts, "budget", &env).expect("converts");
        assert_eq!(done.pages.len(), 1);
        assert!(done.general.iter().any(|e| e.what.contains("hidden sheet")));
        let page = &done.pages[0].page.page;
        assert_eq!(page.title, "Budget");
        let table = page
            .blocks
            .iter()
            .find_map(|b| match &b.data {
                opennote_core::model::BlockData::Table(t) => Some(t.clone()),
                _ => None,
            })
            .expect("a table");
        let text: Vec<Vec<String>> = table
            .rows
            .iter()
            .map(|r| {
                table
                    .columns
                    .iter()
                    .map(|c| r.cells[&c.id].markdown.replace("\\", ""))
                    .collect()
            })
            .collect();
        assert_eq!(text[0], ["Item", "Cost", "Due"]);
        assert_eq!(text[1], ["Pens", "12.5", "2023-03-15"]);
        assert_eq!(text[2], ["Ink", "25", "=A9+1"]);
    }

    #[test]
    fn dates_columns_and_floats_read_like_excel() {
        assert_eq!(date_text(45000.0, false), "2023-03-15");
        assert_eq!(date_text(1.0, false), "1900-01-01");
        assert_eq!(date_text(45000.5, false), "2023-03-15 12:00");
        assert_eq!(column_of("AA10"), Some(26));
        assert_eq!(trim_float(0.1 + 0.2, 10), "0.3");
        assert_eq!(classify(164, Some("yyyy-mm-dd")), Kind::Date);
        assert_eq!(classify(165, Some("0.00\" days\"")), Kind::Other);
        assert_eq!(classify(10, None), Kind::Percent(2));
    }

    #[test]
    fn a_cell_in_a_far_row_is_counted_not_allocated_for() {
        // A1 and a cell in row 4,000,000,000: sizing the grid by row numbers would take terabytes. Rows with numbers
        // as large as a usize, and a row without a number after them, must not overflow either.
        let sheet = r#"<worksheet><sheetData>
            <row r="1"><c r="A1" t="inlineStr"><is><t>Head</t></is></c></row>
            <row r="2"><c r="B2"><v>1</v></c></row>
            <row r="4000000000"><c r="ALL4000000000"><v>2</v></c></row>
            <row r="18446744073709551615"><c><v>3</v></c></row>
            <row><c><v>4</v></c></row>
            </sheetData></worksheet>"#;
        let workbook =
            r#"<workbook xmlns:r="r"><sheets><sheet name="Far" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
        let rels = r#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"#;
        let bytes = zip_bytes(&[
            ("xl/workbook.xml", workbook.as_bytes()),
            ("xl/_rels/workbook.xml.rels", rels.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ]);
        let mut parts = Parts::from_reader(Cursor::new(bytes)).expect("opens");
        let world = TestEnv::new();
        let env = world.env();
        let done = convert_parts(&mut parts, "far", &env).expect("converts");
        let page = &done.pages[0];
        let table = page
            .page
            .page
            .blocks
            .iter()
            .find_map(|b| match &b.data {
                opennote_core::model::BlockData::Table(t) => Some(t.clone()),
                _ => None,
            })
            .expect("a table");
        assert_eq!(table.rows.len(), MAX_TABLE_ROWS + 1);
        assert_eq!(table.columns.len(), 2);
        assert!(
            page.report
                .entries
                .iter()
                .any(|e| e.what.contains("rows beyond the first 10,000")),
            "{:?}",
            page.report.entries
        );
    }
}
