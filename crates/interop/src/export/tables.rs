// checks-disable-file modifiability, length: OOXML part templates, one element to a line as the spec writes them
//! Exporting the tables of pages to Excel (`.xlsx`) and CSV.
//!
//! An Excel export is one workbook with a sheet for each table, named for its page. A CSV export is one file for a
//! single table, and a folder of files for several. Cells export as the text the page shows: formatting and
//! pictures in a cell are dropped, and line breaks stay. The first row of a table with a header is bold in Excel.

use std::fs;
use std::path::Path;

use opennote_core::model::{Asset, BlockData, Page, TableData};
use opennote_core::{BlockId, PageId};

use super::convert::{page_to_blocks_traced, Resolver};
use super::files::{new_folder, write_file, Exported};
use super::names::sanitize_name;
use super::plan::{self, Scope};
use crate::doc::{Block, Inline};
use crate::docx::zip::ZipWriter;
use crate::error::{InteropError, Result};
use crate::report::{PageReport, Report, ReportKind};
use crate::run::{Control, Phase, Unit};
use crate::sheet::formula::TableRef;
use crate::sheet::styles::{escape, StyleSheet};
use crate::sheet::xlsx::{self, Input, COMMENTS_REL, TABLE_REL, VML_REL};
use crate::sheet::TableSheet;
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

/// The options of a column that picks one choice, which Excel can offer as a drop-down list.
#[derive(Clone, Debug, PartialEq)]
struct ChoiceList {
    /// The column's place, counting from 0.
    column: usize,
    names: Vec<String>,
}

/// The most characters Excel allows in a list typed into a data validation.
const MAX_LIST_CHARS: usize = 255;

/// A table with its text.
struct Table {
    /// The page's title, with a number when the page has several tables.
    name: String,
    header: bool,
    rows: Vec<Vec<String>>,
    /// The columns that pick one of a set of choices.
    lists: Vec<ChoiceList>,
    /// The table block, for formulas, widths, and its sheet. `None` when its rows do not match the block's.
    data: Option<TableData>,
    /// What the block's `data.sheet` adds.
    sheet: Option<TableSheet>,
    /// The place of its page among the exported pages, so formulas find the tables of their own page.
    page: usize,
}

/// The table block a converted table came from.
fn table_data(page: &Page, id: Option<&BlockId>) -> Option<TableData> {
    match &page.blocks.get(*id?)?.data {
        BlockData::Table(table) => Some(table.clone()),
        _ => None,
    }
}

/// The single-choice columns of a table block, from the `smart` data the app keeps beside its cells. A column that
/// takes several choices has no list, because Excel's drop-down picks one. Names with a comma are left out, because the
/// list is written with commas between names.
fn choice_lists(page: &Page, id: Option<&BlockId>) -> Vec<ChoiceList> {
    let Some(block) = id.and_then(|id| page.blocks.get(*id)) else {
        return Vec::new();
    };
    let BlockData::Table(table) = &block.data else {
        return Vec::new();
    };
    let Some(columns) = table.extra.get("smart").and_then(|smart| smart.get("columns")) else {
        return Vec::new();
    };
    table
        .columns
        .iter()
        .enumerate()
        .filter_map(|(column, one)| {
            let own = columns.get(one.id.to_string())?;
            let single =
                own.get("type")?.as_str()? == "choice" && own.get("multi").and_then(|m| m.as_bool()) != Some(true);
            if !single {
                return None;
            }
            let names: Vec<String> = own
                .get("options")?
                .as_array()?
                .iter()
                .filter_map(|option| option.get("name")?.as_str())
                .filter(|name| !name.is_empty() && !name.contains(','))
                .map(str::to_owned)
                .collect();
            (!names.is_empty()).then_some(ChoiceList { column, names })
        })
        .collect()
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

const SHEET_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const MAIN_TYPE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/// Reads the tables of every planned page, noting in the report what a table export leaves out.
fn collect_tables(
    source: &dyn NoteSource,
    plan: &plan::Plan,
    control: &Control,
    report: &mut Report,
) -> Result<Vec<Table>> {
    let mut tables = Vec::new();
    for (page_at, planned) in plan.pages.iter().enumerate() {
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
        let (blocks, origins) = page_to_blocks_traced(&page, &mut Nothing, &mut page_report);
        type Found = (bool, Vec<Vec<String>>, Vec<ChoiceList>, Option<TableData>);
        let found: Vec<Found> = blocks
            .iter()
            .enumerate()
            .filter_map(|(at, b)| match b {
                Block::Table { header, rows, .. } => Some((
                    *header,
                    rows.iter().map(|r| r.iter().map(|c| cell_text(c)).collect()).collect(),
                    choice_lists(&page, origins.get(at)),
                    table_data(&page, origins.get(at)),
                )),
                _ => None,
            })
            .collect();
        let many = found.len() > 1;
        let mut page_report = PageReport {
            title: page.title.clone(),
            ..PageReport::default()
        };
        for (n, (header, rows, lists, data)) in found.into_iter().enumerate() {
            let (lists, too_long): (Vec<_>, Vec<_>) = lists
                .into_iter()
                .partition(|list| list.names.join(",").chars().count() <= MAX_LIST_CHARS);
            if !too_long.is_empty() {
                page_report.simplified(
                    "choices of a column",
                    "Excel's drop-down list holds 255 characters, so a column with more choices than that keeps its text only.",
                );
            }
            let name = if many {
                format!("{} {}", page.title, n + 1)
            } else {
                page.title.clone()
            };
            page_report.came_over(format!("table of {} rows", rows.len()));
            let data = data.filter(|d| d.rows.len() == rows.len());
            let sheet = data.as_ref().and_then(crate::sheet::read);
            if sheet.as_ref().is_some_and(|s| s.stale) {
                page_report.simplified(
                    "formula results",
                    "Some formula results were out of date, so those formulas go without results and Excel calculates them on opening. Open the page in OpenNote once to refresh them.",
                );
            }
            tables.push(Table {
                name,
                header,
                rows,
                lists,
                data,
                sheet,
                page: page_at,
            });
        }
        if !page_report.entries.is_empty() {
            page_report.simplified("text and pictures outside tables", "A table export holds only tables.");
            report.add_page(page_report);
        }
    }
    Ok(tables)
}

/// The files a table export writes: one workbook, one CSV, or a folder of CSVs.
fn planned_files(
    format: TableFormat,
    tables: &[Table],
    title: &str,
    out_dir: &Path,
) -> Result<Vec<(std::path::PathBuf, Vec<u8>)>> {
    let files = match format {
        TableFormat::Xlsx => {
            let bytes = workbook(tables)?;
            let path = unique_file(out_dir, title, "xlsx")?;
            vec![(path, bytes)]
        }
        TableFormat::Csv if tables.len() == 1 => {
            let path = unique_file(out_dir, &tables[0].name, "csv")?;
            vec![(path, csv_bytes(&tables[0].rows))]
        }
        TableFormat::Csv => {
            let root = new_folder(out_dir, title)?;
            let mut names = Vec::new();
            let mut files = Vec::new();
            for table in tables {
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
    Ok(files)
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
    let tables = collect_tables(source, &plan, control, &mut report)?;
    if tables.is_empty() {
        return Err(InteropError::NoTables(plan.title.clone()));
    }
    let files = planned_files(format, &tables, &plan.title, out_dir)?;
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
            Inline::Note { .. } => {}
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
const RELS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Unique sheet names for the tables, in their order.
fn sheet_names(tables: &[Table]) -> Vec<String> {
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
    names
}

/// Whether a table can be an Excel ListObject: a header row of distinct, plain, non-empty names over at least one
/// body row, and no merges, which a ListObject cannot hold.
fn fits_list_object(table: &Table) -> bool {
    let Some(head) = table.rows.first() else {
        return false;
    };
    let mut seen: Vec<String> = Vec::new();
    let distinct = head.iter().all(|h| {
        let key = h.to_lowercase();
        let ok = !h.trim().is_empty() && h.trim() == h && !h.contains('\n') && !seen.contains(&key);
        seen.push(key);
        ok
    });
    table.header && table.rows.len() > 1 && distinct && table.sheet.as_ref().is_none_or(|s| s.merges.is_empty())
}

/// The tables as formulas see them: each one's OpenNote name, ListObject, sheet, and column names.
fn table_refs(tables: &[Table], sheets: &[String]) -> Vec<TableRef> {
    let mut taken: Vec<String> = Vec::new();
    let mut places: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    tables
        .iter()
        .zip(sheets)
        .map(|(table, sheet)| {
            let place = places.entry(table.page).or_insert(0);
            *place += 1;
            let name = table
                .sheet
                .as_ref()
                .and_then(|s| s.name.clone())
                .unwrap_or_else(|| format!("Table{place}"));
            let width = table.rows.iter().map(Vec::len).max().unwrap_or(0);
            let columns = (0..width)
                .map(|c| {
                    let head = table.rows.first().and_then(|r| r.get(c)).map_or("", |h| h.trim());
                    if table.header && !head.is_empty() {
                        head.to_owned()
                    } else {
                        crate::sheet::formula::column_letters(c)
                    }
                })
                .collect();
            let excel = fits_list_object(table).then(|| {
                let mut unique = name.clone();
                let mut n = 2;
                while taken.iter().any(|t| t.eq_ignore_ascii_case(&unique)) {
                    unique = format!("{name}_{n}");
                    n += 1;
                }
                taken.push(unique.clone());
                unique
            });
            TableRef {
                name,
                excel,
                sheet: sheet.clone(),
                header: table.header,
                columns,
                rows: table.rows.len(),
            }
        })
        .collect()
}

/// The tables of the page of `tables[at]`, and its place among them.
fn page_book(tables: &[Table], refs: &[TableRef], at: usize) -> (Vec<TableRef>, usize) {
    let page: Vec<usize> = (0..tables.len())
        .filter(|&j| tables[j].page == tables[at].page)
        .collect();
    let own = page.iter().position(|&j| j == at).unwrap_or(0);
    (page.into_iter().map(|j| refs[j].clone()).collect(), own)
}

/// The defined names of the workbook: a table's names belong to its sheet, a page's to the workbook. A name that
/// repeats in one scope, or that a ListObject already holds, keeps its first entry.
fn defined_names(tables: &[Table], refs: &[TableRef]) -> String {
    let mut out = String::new();
    let mut seen: Vec<(Option<usize>, String)> = Vec::new();
    for (i, table) in tables.iter().enumerate() {
        let Some(sheet) = &table.sheet else {
            continue;
        };
        let (book, own) = page_book(tables, refs, i);
        for name in &sheet.names {
            let scope = name.table_scope.then_some(i);
            let key = (scope, name.name.to_lowercase());
            let list = refs
                .iter()
                .any(|r| r.excel.as_deref().is_some_and(|e| e.eq_ignore_ascii_case(&name.name)));
            if list || seen.contains(&key) {
                continue;
            }
            seen.push(key);
            let cx = crate::sheet::formula::Context {
                book: &book,
                own,
                row: None,
            };
            let text = crate::sheet::formula::to_excel(name.reference.trim_start_matches('='), &cx);
            let mut attrs = format!(" name=\"{}\"", escape(&name.name));
            if let Some(s) = scope {
                attrs.push_str(&format!(" localSheetId=\"{s}\""));
            }
            if !name.comment.is_empty() {
                attrs.push_str(&format!(" comment=\"{}\"", escape(&name.comment)));
            }
            out.push_str(&format!("<definedName{attrs}>{}</definedName>", escape(&text)));
        }
    }
    if out.is_empty() {
        out
    } else {
        format!("<definedNames>{out}</definedNames>")
    }
}

fn relationships(items: &[(String, &str, String)]) -> Vec<u8> {
    let body: String = items
        .iter()
        .map(|(id, kind, target)| format!("<Relationship Id=\"{id}\" Type=\"{REL_TYPE}/{kind}\" Target=\"{target}\"/>"))
        .collect();
    format!("{HEADER}<Relationships xmlns=\"{RELS_NS}\">{body}</Relationships>").into_bytes()
}

fn workbook(tables: &[Table]) -> Result<Vec<u8>> {
    let names = sheet_names(tables);
    let refs = table_refs(tables, &names);
    let mut styles = StyleSheet::default();
    let mut zip = ZipWriter::new();
    let mut overrides = String::new();
    let mut table_id = 0;
    let mut comments_id = 0;
    for (i, table) in tables.iter().enumerate() {
        let n = i + 1;
        let (book, own) = page_book(tables, &refs, i);
        let lists: Vec<(usize, Vec<String>)> = table.lists.iter().map(|l| (l.column, l.names.clone())).collect();
        let input = Input {
            texts: &table.rows,
            table: table.data.as_ref(),
            sheet: table.sheet.as_ref(),
            header: table.header,
            book: &book,
            own,
            lists: &lists,
            table_id: table_id + 1,
            sheet_number: n,
        };
        let written = xlsx::worksheet(&input, &mut styles);
        zip.add(&format!("xl/worksheets/sheet{n}.xml"), written.sheet.as_bytes())?;
        overrides.push_str(&format!(
            "<Override PartName=\"/xl/worksheets/sheet{n}.xml\" ContentType=\"{SHEET_TYPE}\"/>"
        ));
        let mut rels = Vec::new();
        if let Some(part) = written.table {
            table_id += 1;
            zip.add(&format!("xl/tables/table{table_id}.xml"), part.as_bytes())?;
            overrides.push_str(&format!(
                "<Override PartName=\"/xl/tables/table{table_id}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml\"/>"
            ));
            rels.push((TABLE_REL.to_owned(), "table", format!("../tables/table{table_id}.xml")));
        }
        if let Some((comments, vml)) = written.comments {
            comments_id += 1;
            zip.add(&format!("xl/comments{comments_id}.xml"), comments.as_bytes())?;
            zip.add(&format!("xl/drawings/vmlDrawing{comments_id}.vml"), vml.as_bytes())?;
            overrides.push_str(&format!(
                "<Override PartName=\"/xl/comments{comments_id}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml\"/>"
            ));
            rels.push((
                COMMENTS_REL.to_owned(),
                "comments",
                format!("../comments{comments_id}.xml"),
            ));
            rels.push((
                VML_REL.to_owned(),
                "vmlDrawing",
                format!("../drawings/vmlDrawing{comments_id}.vml"),
            ));
        }
        if !rels.is_empty() {
            zip.add(&format!("xl/worksheets/_rels/sheet{n}.xml.rels"), &relationships(&rels))?;
        }
    }
    zip.add(
        "[Content_Types].xml",
        format!("{HEADER}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
            <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
            <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
            <Default Extension=\"vml\" ContentType=\"application/vnd.openxmlformats-officedocument.vmlDrawing\"/>\
            <Override PartName=\"/xl/workbook.xml\" ContentType=\"{MAIN_TYPE}\"/>\
            <Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>\
            {overrides}</Types>").as_bytes(),
    )?;
    zip.add(
        "_rels/.rels",
        &relationships(&[("rId1".to_owned(), "officeDocument", "xl/workbook.xml".to_owned())]),
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
    // Excel recalculates on opening, so its results replace ours wherever the two differ.
    zip.add(
        "xl/workbook.xml",
        format!(
            "{HEADER}<workbook xmlns=\"{NS}\" xmlns:r=\"{NS_R}\"><sheets>{sheets}</sheets>{}<calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/></workbook>",
            defined_names(tables, &refs)
        )
        .as_bytes(),
    )?;
    let mut rels: Vec<(String, &str, String)> = (1..=tables.len())
        .map(|n| (format!("rId{n}"), "worksheet", format!("worksheets/sheet{n}.xml")))
        .collect();
    rels.push((format!("rId{}", tables.len() + 1), "styles", "styles.xml".to_owned()));
    zip.add("xl/_rels/workbook.xml.rels", &relationships(&rels))?;
    zip.add("xl/styles.xml", styles.xml().as_bytes())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The first worksheet of a workbook of one table.
    fn sheet_part(table: Table) -> String {
        let bytes = workbook(&[table]).expect("a workbook");
        let parts = crate::docx::read_parts(&bytes);
        let sheet = parts
            .iter()
            .find(|(n, _)| n == "xl/worksheets/sheet1.xml")
            .expect("a sheet");
        String::from_utf8_lossy(&sheet.1).into_owned()
    }

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
        assert!(
            xlsx::is_plain_number("12.5")
                && !xlsx::is_plain_number("007")
                && !xlsx::is_plain_number("1234567890123456")
        );
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
            lists: Vec::new(),
            data: None,
            sheet: None,
            page: 0,
        }];
        let bytes = workbook(&tables).expect("a workbook");
        let entries = crate::docx::read_parts(&bytes);
        let sheet = entries
            .iter()
            .find(|(n, _)| n == "xl/worksheets/sheet1.xml")
            .expect("a sheet");
        let xml = String::from_utf8_lossy(&sheet.1);
        assert!(xml.contains("Pens &amp; ink") && xml.contains("<v>12.5</v>"), "{xml}");
        assert!(!xml.contains("dataValidation"), "{xml}");
    }

    #[test]
    fn the_choices_of_a_page_s_table_block_are_found_through_the_converted_blocks() {
        use crate::testing::{sample_notebook, TestEnv};
        let world = TestEnv::new();
        let env = world.env();
        let sample = sample_notebook(&env);
        let mut page = sample.source.page(sample.photo).expect("the page");
        let block = page
            .blocks
            .iter()
            .find(|b| matches!(b.data, BlockData::Table(_)))
            .cloned()
            .expect("a table block");
        let mut changed = (*block).clone();
        let BlockData::Table(table) = &mut changed.data else {
            panic!("a table");
        };
        let (first, second) = (table.columns[0].id.to_string(), table.columns[1].id.to_string());
        table.extra.insert(
            "smart".to_owned(),
            serde_json::json!({ "columns": {
                second: { "type": "choice", "options": [
                    { "name": "Thylakoid", "color": "fern" },
                    { "name": "Stroma", "color": "plum" },
                    { "name": "A, B", "color": "ink" } ] },
                first: { "type": "choice", "multi": true, "options": [ { "name": "X", "color": "ink" } ] }
            } }),
        );
        page.blocks.replace(std::sync::Arc::new(changed)).expect("replaced");
        let mut report = PageReport::default();
        let (blocks, origins) = page_to_blocks_traced(&page, &mut Nothing, &mut report);
        let at = blocks
            .iter()
            .position(|b| matches!(b, Block::Table { .. }))
            .expect("a table");
        let lists = choice_lists(&page, origins.get(at));
        // The column that takes several has no list, and a name with a comma is left out.
        assert_eq!(
            lists,
            vec![ChoiceList {
                column: 1,
                names: vec!["Thylakoid".to_owned(), "Stroma".to_owned()]
            }]
        );
        assert!(choice_lists(&page, None).is_empty());
    }

    #[test]
    fn a_workbook_holds_names_and_a_list_object_and_recalculates_on_opening() {
        use crate::sheet::Name;
        let name = |name: &str, reference: &str, table_scope: bool, comment: &str| Name {
            name: name.to_owned(),
            reference: reference.to_owned(),
            table_scope,
            comment: comment.to_owned(),
        };
        let sheet = TableSheet {
            names: vec![
                name("Qtys", "[Qty]", true, "Every quantity"),
                name("TaxRate", "0.0825", false, ""),
            ],
            ..TableSheet::default()
        };
        let table = Table {
            name: "Prices".to_owned(),
            header: true,
            rows: vec![
                vec!["Item".to_owned(), "Qty".to_owned()],
                vec!["Pens".to_owned(), "2".to_owned()],
            ],
            lists: Vec::new(),
            data: None,
            sheet: Some(sheet),
            page: 0,
        };
        let bytes = workbook(&[table]).expect("a workbook");
        let parts = crate::docx::read_parts(&bytes);
        let part = |name: &str| {
            parts
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, b)| String::from_utf8_lossy(b).into_owned())
                .unwrap_or_else(|| panic!("no part {name}"))
        };
        let book = part("xl/workbook.xml");
        assert!(
            book.contains("<definedNames><definedName name=\"Qtys\" localSheetId=\"0\" comment=\"Every quantity\">Table1[Qty]</definedName><definedName name=\"TaxRate\">0.0825</definedName></definedNames>"),
            "{book}"
        );
        assert!(book.contains("fullCalcOnLoad=\"1\""), "{book}");
        assert!(part("[Content_Types].xml").contains("/xl/tables/table1.xml"));
        assert!(part("xl/worksheets/_rels/sheet1.xml.rels").contains("Target=\"../tables/table1.xml\""));
        let list = part("xl/tables/table1.xml");
        assert!(
            list.contains("name=\"Table1\"") && list.contains("TableStyleMedium2"),
            "{list}"
        );
        // A ListObject's header cells are text.
        assert!(part("xl/worksheets/sheet1.xml").contains("<c r=\"B1\" s=\"1\" t=\"inlineStr\">"));
    }

    #[test]
    fn our_importer_reads_back_the_cached_values_of_an_exported_workbook() {
        let data = crate::sheet::xlsx::tests::prices();
        let rows: Vec<Vec<String>> = data
            .rows
            .iter()
            .map(|r| data.columns.iter().map(|c| r.cells[&c.id].markdown.clone()).collect())
            .collect();
        let table = Table {
            name: "Prices".to_owned(),
            header: true,
            rows,
            lists: Vec::new(),
            sheet: crate::sheet::read(&data),
            data: Some(data),
            page: 0,
        };
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("Prices.xlsx");
        fs::write(&path, workbook(&[table]).expect("a workbook")).expect("written");
        let world = crate::testing::TestEnv::new();
        let mut sink = crate::MemorySink::default();
        crate::import_xlsx(&path, &world.env(), &mut sink).expect("imported");
        let page = &sink.pages[0].1.page;
        let back = page
            .blocks
            .iter()
            .find_map(|b| match &b.data {
                BlockData::Table(t) => Some(t.clone()),
                _ => None,
            })
            .expect("a table");
        let text: Vec<Vec<String>> = back
            .rows
            .iter()
            .map(|r| {
                back.columns
                    .iter()
                    .map(|c| r.cells[&c.id].markdown.replace('\\', ""))
                    .collect()
            })
            .collect();
        // The formulas' cached values come back as the values they showed.
        assert_eq!(text[0], ["Item", "Qty", "Price", "Total", "Check"]);
        assert_eq!(text[1], ["Pens", "2", "5", "10", "10"]);
        assert_eq!(text[2], ["Ink", "3", "4", "12", ""]);
    }

    #[test]
    fn a_single_choice_column_becomes_a_drop_down_list_below_the_header() {
        let table = Table {
            name: "Tasks".to_owned(),
            header: true,
            rows: vec![
                vec!["Task".to_owned(), "Status".to_owned()],
                vec!["Write".to_owned(), "Done".to_owned()],
            ],
            lists: vec![ChoiceList {
                column: 1,
                names: vec!["To do".to_owned(), "Say \"hi\" & go".to_owned(), "Done".to_owned()],
            }],
            data: None,
            sheet: None,
            page: 0,
        };
        let xml = sheet_part(table);
        assert!(xml.contains("</sheetData><dataValidations count=\"1\">"), "{xml}");
        assert!(
            xml.contains("type=\"list\"") && xml.contains("sqref=\"B2:B1048576\""),
            "{xml}"
        );
        assert!(
            xml.contains("<formula1>&quot;To do,Say &quot;&quot;hi&quot;&quot; &amp; go,Done&quot;</formula1>"),
            "{xml}"
        );
        // Without a header row the list starts at the first row.
        let bare = Table {
            header: false,
            name: "Tasks".to_owned(),
            rows: vec![vec!["Write".to_owned(), "Done".to_owned()]],
            lists: vec![ChoiceList {
                column: 1,
                names: vec!["Done".to_owned()],
            }],
            data: None,
            sheet: None,
            page: 0,
        };
        assert!(sheet_part(bare).contains("sqref=\"B1:B1048576\""));
    }
}
