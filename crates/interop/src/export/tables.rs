//! Exporting the tables of pages to Excel (`.xlsx`) and CSV.
//!
//! An Excel export is one workbook with a sheet for each table, named for its page. A CSV export is one file for a
//! single table, and a folder of files for several. Cells export as the text the page shows: formatting and
//! pictures in a cell are dropped, and line breaks stay. The first row of a table with a header is bold in Excel.

use std::fs;
use std::path::Path;

use opennote_core::model::{Asset, Page};
use opennote_core::PageId;

use super::convert::{page_to_blocks, Resolver};
use super::files::{new_folder, write_file, Exported};
use super::names::sanitize_name;
use super::plan::{self, Scope};
use crate::doc::{Block, Inline};
use crate::docx::zip::ZipWriter;
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::source::NoteSource;

/// The file kind of a table export.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableFormat {
    /// One workbook with a sheet for each table.
    Xlsx,
    /// A comma separated file for each table.
    Csv,
}

impl TableFormat {
    fn extension(self) -> &'static str {
        match self {
            TableFormat::Xlsx => "xlsx",
            TableFormat::Csv => "csv",
        }
    }
}

/// A table with its text.
struct Table {
    /// The page's title, with a number when the page has several tables.
    name: String,
    header: bool,
    rows: Vec<Vec<String>>,
}

/// A resolver that keeps no pictures or links, because a table export has none.
struct Nothing;

impl Resolver for Nothing {
    fn asset(&mut self, _page: &Page, _asset: &Asset) -> Option<String> {
        None
    }

    fn page(&mut self, _from: PageId, _to: PageId) -> Option<String> {
        None
    }
}

/// Exports every table in scope into `out_dir`. It fails with a plain message when there are none.
pub fn export_tables(
    source: &dyn NoteSource,
    scope: Scope,
    format: TableFormat,
    out_dir: &Path,
    control: &Control,
) -> Result<Exported> {
    let plan = plan::build(source, scope, format.extension())?;
    control.begin(Phase::Writing, Unit::Items, Some(plan.pages.len() as u64));
    let label = match format {
        TableFormat::Xlsx => "Excel",
        TableFormat::Csv => "CSV",
    };
    let mut report = Report::new(ReportKind::Export, format!("tables of {} as {label}", plan.title));
    let mut tables = Vec::new();
    for planned in &plan.pages {
        control.checkpoint()?;
        control.step(Phase::Writing, 1, &planned.title);
        let page = match source.page(planned.id) {
            Ok(page) => page,
            Err(error) => {
                report
                    .general
                    .skipped(format!("page {:?}", planned.title), error.to_string());
                continue;
            }
        };
        let mut page_report = PageReport {
            title: page.title.clone(),
            ..PageReport::default()
        };
        let blocks = page_to_blocks(&page, &mut Nothing, &mut page_report);
        let found: Vec<(bool, Vec<Vec<String>>)> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Table { header, rows } => Some((
                    *header,
                    rows.iter().map(|r| r.iter().map(|c| cell_text(c)).collect()).collect(),
                )),
                _ => None,
            })
            .collect();
        let many = found.len() > 1;
        let mut page_report = PageReport {
            title: page.title.clone(),
            ..PageReport::default()
        };
        for (n, (header, rows)) in found.into_iter().enumerate() {
            let name = if many {
                format!("{} {}", page.title, n + 1)
            } else {
                page.title.clone()
            };
            page_report.came_over(format!("table of {} rows", rows.len()));
            tables.push(Table { name, header, rows });
        }
        if !page_report.entries.is_empty() {
            page_report.simplified("text and pictures outside tables", "A table export holds only tables.");
            report.add_page(page_report);
        }
    }
    if tables.is_empty() {
        return Err(InteropError::Missing(format!("table in {}", plan.title)));
    }
    let files = match format {
        TableFormat::Xlsx => {
            let bytes = workbook(&tables)?;
            let path = unique_file(out_dir, &plan.title, "xlsx")?;
            vec![(path, bytes)]
        }
        TableFormat::Csv if tables.len() == 1 => {
            let path = unique_file(out_dir, &tables[0].name, "csv")?;
            vec![(path, csv_bytes(&tables[0].rows))]
        }
        TableFormat::Csv => {
            let root = new_folder(out_dir, &plan.title)?;
            let mut names = Vec::new();
            let mut files = Vec::new();
            for table in &tables {
                let stem = sanitize_name(&table.name, "table");
                let mut file = format!("{stem}.csv");
                let mut n = 2;
                while names.contains(&file.to_lowercase()) {
                    file = format!("{stem} ({n}).csv");
                    n += 1;
                }
                names.push(file.to_lowercase());
                files.push((root.join(file), csv_bytes(&table.rows)));
            }
            files
        }
    };
    let mut written = Vec::new();
    for (path, bytes) in files {
        write_file(&path, &bytes)?;
        written.push(path);
    }
    let root = if written.len() > 1 {
        written[0]
            .parent()
            .map_or_else(|| out_dir.to_path_buf(), Path::to_path_buf)
    } else {
        out_dir.to_path_buf()
    };
    Ok(Exported {
        root,
        files: written,
        report,
    })
}

fn unique_file(out_dir: &Path, title: &str, extension: &str) -> Result<std::path::PathBuf> {
    fs::create_dir_all(out_dir).map_err(|e| InteropError::io(out_dir, e))?;
    let name = sanitize_name(title, "OpenNote export");
    let mut path = out_dir.join(format!("{name}.{extension}"));
    let mut n = 2;
    while path.exists() {
        path = out_dir.join(format!("{name} ({n}).{extension}"));
        n += 1;
    }
    Ok(path)
}

fn cell_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            Inline::Text { text, .. } => out.push_str(text),
            Inline::HardBreak => out.push('\n'),
            Inline::SoftBreak => out.push(' '),
            Inline::Image { alt, .. } => out.push_str(alt),
        }
    }
    out
}

/// CSV with a byte order mark, so Excel reads the text as UTF-8. A cell that a spreadsheet would run as a formula
/// gets a leading apostrophe.
fn csv_bytes(rows: &[Vec<String>]) -> Vec<u8> {
    let mut out = String::from('\u{feff}');
    for row in rows {
        let line: Vec<String> = row.iter().map(|c| csv_cell(c)).collect();
        out.push_str(&line.join(","));
        out.push_str("\r\n");
    }
    out.into_bytes()
}

fn csv_cell(text: &str) -> String {
    let guarded = if runs_as_formula(text) {
        format!("'{text}")
    } else {
        text.to_owned()
    };
    if guarded.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

fn runs_as_formula(text: &str) -> bool {
    matches!(text.chars().next(), Some('=' | '+' | '-' | '@' | '\t' | '\r')) && text.trim().parse::<f64>().is_err()
}

// Excel.

const NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

fn workbook(tables: &[Table]) -> Result<Vec<u8>> {
    let mut names: Vec<String> = Vec::new();
    for table in tables {
        let base = sheet_name(&table.name);
        let mut name = base.clone();
        let mut n = 2;
        while names.iter().any(|x| x.eq_ignore_ascii_case(&name)) {
            let suffix = format!(" {n}");
            name = format!(
                "{}{suffix}",
                base.chars().take(31 - suffix.chars().count()).collect::<String>()
            );
            n += 1;
        }
        names.push(name);
    }
    let mut zip = ZipWriter::new();
    let overrides: String = (1..=tables.len())
        .map(|n| format!("<Override PartName=\"/xl/worksheets/sheet{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"))
        .collect();
    zip.add(
        "[Content_Types].xml",
        format!("{HEADER}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
            <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
            <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
            <Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
            <Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>\
            {overrides}</Types>").as_bytes(),
    )?;
    zip.add(
        "_rels/.rels",
        format!("{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
            </Relationships>").as_bytes(),
    )?;
    let sheets: String = names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            format!(
                "<sheet name=\"{}\" sheetId=\"{}\" r:id=\"rId{}\"/>",
                escape(name),
                i + 1,
                i + 1
            )
        })
        .collect();
    zip.add(
        "xl/workbook.xml",
        format!("{HEADER}<workbook xmlns=\"{NS}\" xmlns:r=\"{NS_R}\"><sheets>{sheets}</sheets></workbook>").as_bytes(),
    )?;
    let mut rels = String::new();
    for n in 1..=tables.len() {
        rels.push_str(&format!(
            "<Relationship Id=\"rId{n}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{n}.xml\"/>"
        ));
    }
    let style_id = tables.len() + 1;
    rels.push_str(&format!(
        "<Relationship Id=\"rId{style_id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
    ));
    zip.add(
        "xl/_rels/workbook.xml.rels",
        format!("{HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{rels}</Relationships>").as_bytes(),
    )?;
    zip.add(
        "xl/styles.xml",
        format!("{HEADER}<styleSheet xmlns=\"{NS}\"><fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>\
            <font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>\
            <fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>\
            <borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
            <cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\
            <cellXfs count=\"3\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>\
            <xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>\
            <xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyAlignment=\"1\"><alignment wrapText=\"1\" vertical=\"top\"/></xf>\
            </cellXfs></styleSheet>").as_bytes(),
    )?;
    for (i, table) in tables.iter().enumerate() {
        zip.add(
            &format!("xl/worksheets/sheet{}.xml", i + 1),
            sheet_xml(table).as_bytes(),
        )?;
    }
    zip.finish()
}

/// A sheet name Excel accepts: at most 31 characters, none of `[]:*?/\`, and no apostrophe at either end.
fn sheet_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if "[]:*?/\\".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('\'').trim();
    let name: String = trimmed.chars().take(31).collect();
    let name = name.trim_end().to_owned();
    if name.is_empty() || name.eq_ignore_ascii_case("history") {
        "Table".to_owned()
    } else {
        name
    }
}

fn sheet_xml(table: &Table) -> String {
    let width = table.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let mut widths = vec![8usize; width];
    for row in &table.rows {
        for (c, text) in row.iter().enumerate() {
            let longest = text.split('\n').map(|l| l.chars().count()).max().unwrap_or(0);
            widths[c] = widths[c].max(longest.min(60) + 2);
        }
    }
    let cols: String = widths
        .iter()
        .enumerate()
        .map(|(i, w)| format!("<col min=\"{0}\" max=\"{0}\" width=\"{w}\" customWidth=\"1\"/>", i + 1))
        .collect();
    let freeze = if table.header && table.rows.len() > 1 {
        "<pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>"
    } else {
        ""
    };
    let mut data = String::new();
    for (r, row) in table.rows.iter().enumerate() {
        data.push_str(&format!("<row r=\"{}\">", r + 1));
        for (c, text) in row.iter().enumerate() {
            if text.is_empty() {
                continue;
            }
            let at = format!("{}{}", column_letters(c), r + 1);
            let bold = table.header && r == 0;
            let style = if bold {
                1
            } else if text.contains('\n') {
                2
            } else {
                0
            };
            if is_plain_number(text) {
                data.push_str(&format!("<c r=\"{at}\" s=\"{style}\"><v>{}</v></c>", text.trim()));
            } else {
                data.push_str(&format!(
                    "<c r=\"{at}\" s=\"{style}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                    escape(text)
                ));
            }
        }
        data.push_str("</row>");
    }
    format!(
        "{HEADER}<worksheet xmlns=\"{NS}\"><sheetViews><sheetView workbookViewId=\"0\">{freeze}</sheetView></sheetViews>\
         <cols>{cols}</cols><sheetData>{data}</sheetData></worksheet>"
    )
}

/// A number that Excel would keep exactly: digits with an optional sign and fraction, no leading zero, no more
/// than 15 digits. Phone numbers, codes with a leading zero, and long IDs stay text.
fn is_plain_number(text: &str) -> bool {
    let t = text.trim();
    let digits = t.strip_prefix('-').unwrap_or(t);
    let (whole, fraction) = digits.split_once('.').map_or((digits, None), |(w, f)| (w, Some(f)));
    let all = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    all(whole)
        && fraction.is_none_or(all)
        && (whole == "0" || !whole.starts_with('0'))
        && whole.len() + fraction.map_or(0, str::len) <= 15
}

fn column_letters(mut index: usize) -> String {
    let mut out = Vec::new();
    loop {
        out.push(b'A' + (index % 26) as u8);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_quotes_and_guards_cells() {
        let bytes = csv_bytes(&[vec![
            "a,b".to_owned(),
            "say \"hi\"".to_owned(),
            "=1+2".to_owned(),
            "-5".to_owned(),
        ]]);
        let text = String::from_utf8(bytes).expect("utf8");
        assert_eq!(text, "\u{feff}\"a,b\",\"say \"\"hi\"\"\",'=1+2,-5\r\n");
    }

    #[test]
    fn sheet_names_and_columns_follow_excel_rules() {
        assert_eq!(sheet_name("Plan: Q1/Q2 [draft]?"), "Plan- Q1-Q2 -draft--");
        assert_eq!(sheet_name(&"x".repeat(40)).len(), 31);
        assert_eq!(column_letters(0), "A");
        assert_eq!(column_letters(26), "AA");
        assert!(is_plain_number("12.5") && !is_plain_number("007") && !is_plain_number("1234567890123456"));
    }

    #[test]
    fn a_workbook_reads_back_through_the_importer_parts() {
        let tables = vec![Table {
            name: "Budget".to_owned(),
            header: true,
            rows: vec![
                vec!["Item".to_owned(), "Cost".to_owned()],
                vec!["Pens & ink".to_owned(), "12.5".to_owned()],
            ],
        }];
        let bytes = workbook(&tables).expect("a workbook");
        let entries = crate::docx::read_parts(&bytes);
        let sheet = entries
            .iter()
            .find(|(n, _)| n == "xl/worksheets/sheet1.xml")
            .expect("a sheet");
        let xml = String::from_utf8_lossy(&sheet.1);
        assert!(xml.contains("Pens &amp; ink") && xml.contains("<v>12.5</v>"), "{xml}");
    }
}
