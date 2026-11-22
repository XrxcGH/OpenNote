// checks-disable-file modifiability, length: OOXML element templates, one element to a line as the spec writes them
//! Writes one table as an Excel worksheet (ECMA-376 Part 1, 18.3): cells with formulas and cached values, styles,
//! sizes, panes, hidden rows, hidden columns, outline levels, merges, conditional formats, validation, a ListObject
//! table part, and notes as legacy comments.

use super::formula::{column_letters, to_excel, Context, TableRef};
use super::styles::{argb, escape, StyleSheet};
use super::{Merge, MergeIndex, Rule, Slot, TableSheet};
use opennote_core::format::page_json::inline::readable_text;
use opennote_core::model::TableData;
use serde_json::{Map, Value};

/// The relationship IDs a worksheet uses for its parts.
pub const TABLE_REL: &str = "rId1";
/// The relationship of the comments part.
pub const COMMENTS_REL: &str = "rId2";
/// The relationship of the drawing that shows the comments.
pub const VML_REL: &str = "rId3";

/// One table to write.
pub struct Input<'a> {
    /// The text each cell shows, by row and column, the header row included.
    pub texts: &'a [Vec<String>],
    /// The table block, for formulas and widths.
    pub table: Option<&'a TableData>,
    /// What its `data.sheet` adds.
    pub sheet: Option<&'a TableSheet>,
    /// Whether the first row is a header row.
    pub header: bool,
    /// The tables of its page, and its own place among them.
    pub book: &'a [TableRef],
    /// Its own place in `book`.
    pub own: usize,
    /// Drop-down lists from single-choice columns: the column and its choices.
    pub lists: &'a [(usize, Vec<String>)],
    /// The workbook-wide ID of its ListObject, when it has one.
    pub table_id: usize,
    /// The place of the sheet in the workbook, from 1, which numbers the comment shapes.
    pub sheet_number: usize,
}

/// The parts of one worksheet.
#[derive(Debug, Default)]
pub struct Written {
    /// `xl/worksheets/sheetN.xml`.
    pub sheet: String,
    /// The ListObject part, when the table has one.
    pub table: Option<String>,
    /// The comments part and the drawing that shows them, when the table has notes.
    pub comments: Option<(String, String)>,
}

const NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

/// The width in Excel's character units of a column `px` page units wide, by the conversion of ECMA-376 Part 1,
/// 18.3.1.13 with a maximum digit width of 7 pixels (Calibri 11): characters are `trunc((px - 5) / 7 * 100 + 0.5)
/// / 100`, and the stored width is `trunc((chars * 7 + 5) / 7 * 256) / 256`.
pub fn column_width(px: f64) -> f64 {
    const DIGIT: f64 = 7.0;
    let chars = (((px - 5.0) / DIGIT * 100.0 + 0.5).trunc() / 100.0).max(0.0);
    ((chars * DIGIT + 5.0) / DIGIT * 256.0).trunc() / 256.0
}

/// A cell address such as `B3`, from zero-based positions.
pub fn address(row: usize, col: usize) -> String {
    format!("{}{}", column_letters(col), row + 1)
}

fn box_ref(b: &Merge) -> String {
    if b.top == b.bottom && b.left == b.right {
        address(b.top, b.left)
    } else {
        format!("{}:{}", address(b.top, b.left), address(b.bottom, b.right))
    }
}

/// A number that Excel would keep exactly: digits with an optional sign and fraction, no leading zero, no more
/// than 15 digits. Phone numbers, codes with a leading zero, and long IDs stay text.
pub fn is_plain_number(text: &str) -> bool {
    let t = text.trim();
    let digits = t.strip_prefix('-').unwrap_or(t);
    let (whole, fraction) = digits.split_once('.').map_or((digits, None), |(w, f)| (w, Some(f)));
    let all = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    all(whole)
        && fraction.is_none_or(all)
        && (whole == "0" || !whole.starts_with('0'))
        && whole.len() + fraction.map_or(0, str::len) <= 15
}

/// Writes the worksheet of `input`, adding its looks to `styles`.
pub fn worksheet(input: &Input<'_>, styles: &mut StyleSheet) -> Written {
    let sheet = input.sheet;
    let rows = input.texts.len();
    let width = input.texts.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let merges = sheet.map_or(&[][..], |s| &s.merges[..]);
    let index = MergeIndex::new(merges, rows, width);
    let own = input.book.get(input.own);
    let list_object = own.and_then(|t| t.excel.clone());
    let mut data = String::new();
    let mut outline_rows = 0u8;
    for (r, line) in input.texts.iter().enumerate() {
        let axis = sheet.and_then(|s| s.rows.get(r));
        let mut attrs = format!(" r=\"{}\"", r + 1);
        if let Some(height) = axis.and_then(|a| a.height) {
            attrs.push_str(&format!(" ht=\"{}\" customHeight=\"1\"", height * 0.75));
        }
        if let Some(a) = axis {
            if a.hidden {
                attrs.push_str(" hidden=\"1\"");
            }
            if a.level > 0 {
                attrs.push_str(&format!(" outlineLevel=\"{}\"", a.level));
                outline_rows = outline_rows.max(a.level);
            }
            if a.collapsed {
                attrs.push_str(" collapsed=\"1\"");
            }
        }
        data.push_str(&format!("<row{attrs}>"));
        for c in 0..width {
            data.push_str(&cell_xml(
                input,
                styles,
                r,
                c,
                line.get(c).map_or("", String::as_str),
                &index,
            ));
        }
        data.push_str("</row>");
    }
    let mut out = format!("{HEADER}<worksheet xmlns=\"{NS}\" xmlns:r=\"{NS_R}\">");
    out.push_str(&format!(
        "<sheetViews><sheetView workbookViewId=\"0\">{}</sheetView></sheetViews>",
        pane(input)
    ));
    let outline_cols = sheet.map_or(0, |s| s.cols.iter().map(|a| a.level).max().unwrap_or(0));
    out.push_str("<sheetFormatPr defaultRowHeight=\"15\"");
    if outline_rows > 0 {
        out.push_str(&format!(" outlineLevelRow=\"{outline_rows}\""));
    }
    if outline_cols > 0 {
        out.push_str(&format!(" outlineLevelCol=\"{outline_cols}\""));
    }
    out.push_str("/>");
    out.push_str(&cols_xml(input, width));
    out.push_str(&format!("<sheetData>{data}</sheetData>"));
    if !merges.is_empty() {
        out.push_str(&format!("<mergeCells count=\"{}\">", merges.len()));
        for m in merges {
            out.push_str(&format!("<mergeCell ref=\"{}\"/>", box_ref(m)));
        }
        out.push_str("</mergeCells>");
    }
    if let Some(s) = sheet {
        out.push_str(&conditional_xml(input, s, styles));
    }
    out.push_str(&validations_xml(input));
    let notes = sheet.map_or(&[][..], |s| &s.notes[..]);
    if !notes.is_empty() {
        out.push_str(&format!("<legacyDrawing r:id=\"{VML_REL}\"/>"));
    }
    let table = list_object.as_deref().and_then(|name| table_part(input, name));
    if table.is_some() {
        out.push_str(&format!(
            "<tableParts count=\"1\"><tablePart r:id=\"{TABLE_REL}\"/></tableParts>"
        ));
    }
    out.push_str("</worksheet>");
    Written {
        sheet: out,
        table,
        comments: (!notes.is_empty()).then(|| (comments_xml(notes), vml_xml(notes, input.sheet_number))),
    }
}

/// The formula text of a cell, without `=`, when it holds one (`R-SHT-5`).
fn formula_of(table: Option<&TableData>, r: usize, c: usize) -> Option<String> {
    let table = table?;
    let column = table.columns.get(c)?;
    let cell = table.rows.get(r)?.cells.get(&column.id)?;
    let text = readable_text(&cell.markdown);
    text.strip_prefix('=').map(str::to_owned)
}

fn cell_xml(input: &Input<'_>, styles: &mut StyleSheet, r: usize, c: usize, text: &str, index: &MergeIndex) -> String {
    let sheet = input.sheet;
    let header_row = input.header && r == 0;
    let style = sheet.and_then(|s| s.styles.get(r)?.get(c)?.as_ref());
    let fmt = sheet.and_then(|s| s.formats.get(r)?.get(c)?.as_deref());
    let s = styles.cell(style, fmt, header_row, text.contains('\n'));
    let at = address(r, c);
    let s_attr = if s == 0 { String::new() } else { format!(" s=\"{s}\"") };
    if matches!(index.slot(r, c), Some(Slot::Covered(_))) {
        return if s == 0 {
            String::new()
        } else {
            format!("<c r=\"{at}\"{s_attr}/>")
        };
    }
    // A formula longer than Excel takes would make the file unreadable, so it goes as text. The export reports it.
    let fits = |f: &String| f.chars().count() <= super::formula::MAX_FORMULA_CHARS;
    if let Some(formula) = formula_of(input.table, r, c).filter(|f| !header_row && fits(f)) {
        let cx = Context {
            book: input.book,
            own: input.own,
            row: Some(r + 1),
        };
        let f = escape(&to_excel(&formula, &cx));
        let cached = sheet.and_then(|s| s.cached.get(r)?.get(c)?.as_ref());
        return match cached {
            Some(Value::Number(n)) if n.as_f64().is_some_and(f64::is_finite) => {
                format!(
                    "<c r=\"{at}\"{s_attr}><f>{f}</f><v>{}</v></c>",
                    n.as_f64().unwrap_or(0.0)
                )
            }
            Some(Value::String(t)) => format!("<c r=\"{at}\"{s_attr} t=\"str\"><f>{f}</f><v>{}</v></c>", escape(t)),
            Some(Value::Bool(b)) => format!("<c r=\"{at}\"{s_attr} t=\"b\"><f>{f}</f><v>{}</v></c>", u8::from(*b)),
            Some(Value::Object(o)) if o.get("e").and_then(Value::as_str).is_some() => format!(
                "<c r=\"{at}\"{s_attr} t=\"e\"><f>{f}</f><v>{}</v></c>",
                escape(o.get("e").and_then(Value::as_str).unwrap_or("#VALUE!"))
            ),
            _ => format!("<c r=\"{at}\"{s_attr}><f>{f}</f></c>"),
        };
    }
    if text.is_empty() {
        return if s == 0 {
            String::new()
        } else {
            format!("<c r=\"{at}\"{s_attr}/>")
        };
    }
    let as_text = header_row && input.book.get(input.own).is_some_and(|t| t.excel.is_some());
    if is_plain_number(text) && !as_text {
        format!("<c r=\"{at}\"{s_attr}><v>{}</v></c>", text.trim())
    } else {
        format!(
            "<c r=\"{at}\"{s_attr} t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            escape(text)
        )
    }
}

fn pane(input: &Input<'_>) -> String {
    let (rows, cols) = match input.sheet {
        Some(s) => s.freeze,
        None if input.header && input.texts.len() > 1 => (1, 0),
        None => (0, 0),
    };
    if rows == 0 && cols == 0 {
        return String::new();
    }
    let active = match (rows > 0, cols > 0) {
        (true, true) => "bottomRight",
        (true, false) => "bottomLeft",
        _ => "topRight",
    };
    let mut out = String::from("<pane");
    if cols > 0 {
        out.push_str(&format!(" xSplit=\"{cols}\""));
    }
    if rows > 0 {
        out.push_str(&format!(" ySplit=\"{rows}\""));
    }
    out.push_str(&format!(
        " topLeftCell=\"{}\" activePane=\"{active}\" state=\"frozen\"/>",
        address(rows, cols)
    ));
    out
}

fn cols_xml(input: &Input<'_>, width: usize) -> String {
    let mut out = String::from("<cols>");
    for c in 0..width {
        let set = input.table.and_then(|t| t.columns.get(c)?.width);
        let w = match set {
            Some(px) => column_width(px),
            None => {
                let longest = input
                    .texts
                    .iter()
                    .filter_map(|row| row.get(c))
                    .map(|t| t.split('\n').map(|l| l.chars().count()).max().unwrap_or(0))
                    .max()
                    .unwrap_or(0);
                (longest.min(60) + 2).max(8) as f64
            }
        };
        let mut attrs = format!(" min=\"{0}\" max=\"{0}\" width=\"{w}\" customWidth=\"1\"", c + 1);
        if let Some(a) = input.sheet.and_then(|s| s.cols.get(c)) {
            if a.hidden {
                attrs.push_str(" hidden=\"1\"");
            }
            if a.level > 0 {
                attrs.push_str(&format!(" outlineLevel=\"{}\"", a.level));
            }
            if a.collapsed {
                attrs.push_str(" collapsed=\"1\"");
            }
        }
        out.push_str(&format!("<col{attrs}/>"));
    }
    out.push_str("</cols>");
    out
}

fn text_of<'a>(rule: &'a Map<String, Value>, key: &str) -> &'a str {
    rule.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn flag_of(rule: &Map<String, Value>, key: &str, default: bool) -> bool {
    rule.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// A rule's operand in Excel's form: a formula translated relative to `cx`, a number as it is, an ISO date or time
/// as `DATE` or `TIME`, and other text quoted.
fn operand(text: &str, cx: &Context<'_>) -> String {
    let t = text.trim();
    if let Some(formula) = t.strip_prefix('=') {
        return to_excel(formula, cx);
    }
    if t.parse::<f64>().is_ok_and(f64::is_finite) {
        return t.to_owned();
    }
    let parts: Vec<&str> = t.split(['-', ':']).collect();
    let numeric = parts
        .iter()
        .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    if numeric && t.contains('-') && parts.len() == 3 && parts[0].len() == 4 {
        return format!(
            "DATE({},{},{})",
            parts[0],
            parts[1].trim_start_matches('0'),
            parts[2].trim_start_matches('0')
        );
    }
    if numeric && t.contains(':') && (2..=3).contains(&parts.len()) {
        let n = |s: &str| s.trim_start_matches('0').parse::<u32>().unwrap_or(0);
        return format!(
            "TIME({},{},{})",
            n(parts[0]),
            n(parts[1]),
            parts.get(2).map_or(0, |s| n(s))
        );
    }
    format!("\"{}\"", t.replace('"', "\"\""))
}

fn operator(op: &str) -> &'static str {
    match op {
        "notBetween" => "notBetween",
        "equal" => "equal",
        "notEqual" => "notEqual",
        "greater" => "greaterThan",
        "less" => "lessThan",
        "greaterOrEqual" => "greaterThanOrEqual",
        "lessOrEqual" => "lessThanOrEqual",
        _ => "between",
    }
}

fn sqref(boxes: &[Merge]) -> String {
    boxes.iter().map(box_ref).collect::<Vec<_>>().join(" ")
}

/// The context of a rule's formulas: relative to the top-left cell of its first range.
fn rule_context<'a>(input: &Input<'a>, rule: &Rule) -> Context<'a> {
    Context {
        book: input.book,
        own: input.own,
        row: Some(rule.boxes[0].top + 1),
    }
}

fn validations_xml(input: &Input<'_>) -> String {
    let mut items = Vec::new();
    for rule in input.sheet.map_or(&[][..], |s| &s.validation[..]) {
        if let Some(xml) = validation_xml(input, rule) {
            items.push(xml);
        }
    }
    let first = if input.header { 2 } else { 1 };
    for (column, names) in input.lists {
        let letters = column_letters(*column);
        let names = names
            .iter()
            .map(|n| n.replace('"', "\"\""))
            .collect::<Vec<_>>()
            .join(",");
        items.push(format!(
            "<dataValidation type=\"list\" allowBlank=\"1\" showErrorMessage=\"0\" sqref=\"{letters}{first}:{letters}1048576\"><formula1>{}</formula1></dataValidation>",
            escape(&format!("\"{names}\""))
        ));
    }
    if items.is_empty() {
        return String::new();
    }
    format!(
        "<dataValidations count=\"{}\">{}</dataValidations>",
        items.len(),
        items.concat()
    )
}

/// An inline list as Excel holds it: one quoted string of items split by commas, at most 255 characters. Items that
/// hold a comma cannot be written this way.
fn inline_list(r: &Map<String, Value>) -> Option<String> {
    let items: Vec<&str> = r
        .get("items")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let joined = items.join(",");
    let fits = !items.is_empty() && joined.chars().count() <= 255 && items.iter().all(|i| !i.contains(','));
    fits.then(|| format!("\"{}\"", joined.replace('"', "\"\"")))
}

/// The two values of a checkbox as an inline list. A quote is doubled inside the string; a comma would split a value
/// in two, so such a checkbox cannot be written.
fn checkbox_list(r: &Map<String, Value>) -> Option<String> {
    let on = r.get("checked").and_then(Value::as_str).unwrap_or("TRUE");
    let off = r.get("unchecked").and_then(Value::as_str).unwrap_or("FALSE");
    if on.contains(',') || off.contains(',') {
        return None;
    }
    Some(format!("\"{},{}\"", on.replace('"', "\"\""), off.replace('"', "\"\"")))
}

/// Whether a validation rule loses its check in Excel: a list with no inline items that fit and no source, or a
/// checkbox whose values hold a comma. The export reports these.
pub(crate) fn validation_is_lost(rule: &Rule) -> bool {
    let r = &rule.rule;
    match text_of(r, "kind") {
        "list" => inline_list(r).is_none() && text_of(r, "source").is_empty(),
        "checkbox" => checkbox_list(r).is_none(),
        _ => false,
    }
}

fn validation_xml(input: &Input<'_>, rule: &Rule) -> Option<String> {
    let r = &rule.rule;
    let cx = rule_context(input, rule);
    let kind = text_of(r, "kind");
    let op = text_of(r, "op");
    let two = matches!(op, "" | "between" | "notBetween");
    let (kind_attr, formula1, formula2) = match kind {
        "whole" | "decimal" | "date" | "time" | "textLength" => (
            format!(" type=\"{kind}\" operator=\"{}\"", operator(op)),
            Some(operand(text_of(r, "a"), &cx)),
            two.then(|| operand(text_of(r, "b"), &cx)),
        ),
        "list" => {
            let source = text_of(r, "source");
            let f = if let Some(inline) = inline_list(r) {
                inline
            } else if !source.is_empty() {
                to_excel(source.trim_start_matches('='), &cx)
            } else {
                return None;
            };
            (" type=\"list\"".to_owned(), Some(f), None)
        }
        "custom" => (
            " type=\"custom\"".to_owned(),
            Some(to_excel(text_of(r, "a").trim_start_matches('='), &cx)),
            None,
        ),
        "checkbox" => (" type=\"list\"".to_owned(), Some(checkbox_list(r)?), None),
        _ => (String::new(), None, None),
    };
    let mut attrs = kind_attr;
    if flag_of(r, "ignoreBlank", true) {
        attrs.push_str(" allowBlank=\"1\"");
    }
    if kind == "list" && !flag_of(r, "dropDown", true) {
        // The attribute hides the menu, despite its name (ECMA-376 Part 1, 18.3.1.32).
        attrs.push_str(" showDropDown=\"1\"");
    }
    match text_of(r, "alert") {
        "warning" => attrs.push_str(" errorStyle=\"warning\""),
        "information" => attrs.push_str(" errorStyle=\"information\""),
        _ => {}
    }
    let message = |key: &str| r.get(key).and_then(Value::as_object);
    if let Some(m) = message("input") {
        attrs.push_str(&format!(
            " showInputMessage=\"1\" promptTitle=\"{}\" prompt=\"{}\"",
            escape(text_of(m, "title")),
            escape(text_of(m, "text"))
        ));
    }
    if formula1.is_some() {
        attrs.push_str(" showErrorMessage=\"1\"");
    }
    if let Some(m) = message("error") {
        attrs.push_str(&format!(
            " errorTitle=\"{}\" error=\"{}\"",
            escape(text_of(m, "title")),
            escape(text_of(m, "text"))
        ));
    }
    if formula1.is_none() && message("input").is_none() {
        return None;
    }
    let mut out = format!("<dataValidation{attrs} sqref=\"{}\">", sqref(&rule.boxes));
    if let Some(f) = formula1 {
        out.push_str(&format!("<formula1>{}</formula1>", escape(&f)));
    }
    if let Some(f) = formula2 {
        out.push_str(&format!("<formula2>{}</formula2>", escape(&f)));
    }
    out.push_str("</dataValidation>");
    Some(out)
}

fn conditional_xml(input: &Input<'_>, sheet: &TableSheet, styles: &mut StyleSheet) -> String {
    let mut out = String::new();
    for (i, rule) in sheet.conditional.iter().enumerate() {
        if let Some(body) = cf_rule(input, rule, i + 1, styles) {
            out.push_str(&format!(
                "<conditionalFormatting sqref=\"{}\">{body}</conditionalFormatting>",
                sqref(&rule.boxes)
            ));
        }
    }
    out
}

/// The `cfvo` of a scale stop or a bar end.
fn cfvo(stop: &Value, cx: &Context<'_>, fallback: &str) -> String {
    let at = stop.get("at").and_then(Value::as_str).unwrap_or(fallback);
    let at = if at == "auto" { fallback } else { at };
    let value = stop.get("value").and_then(Value::as_str).unwrap_or_default();
    match at {
        "min" | "max" => format!("<cfvo type=\"{at}\"/>"),
        "formula" => format!(
            "<cfvo type=\"formula\" val=\"{}\"/>",
            escape(&operand(&format!("={value}"), cx))
        ),
        "num" | "percent" | "percentile" => format!("<cfvo type=\"{at}\" val=\"{}\"/>", escape(value)),
        _ => format!("<cfvo type=\"{fallback}\"/>"),
    }
}

fn color_xml(color: Option<&str>, fallback: &str) -> String {
    let rgb = color.and_then(argb).or_else(|| argb(fallback)).unwrap_or_default();
    format!("<color rgb=\"{rgb}\"/>")
}

fn cf_rule(input: &Input<'_>, rule: &Rule, priority: usize, styles: &mut StyleSheet) -> Option<String> {
    let r = &rule.rule;
    let cx = rule_context(input, rule);
    let first = &rule.boxes[0];
    let cell = address(first.top, first.left);
    let kind = text_of(r, "type");
    let mut attrs: String;
    let mut body = String::new();
    let formula = |f: String| format!("<formula>{}</formula>", escape(&f));
    match kind {
        "cell" => {
            let op = text_of(r, "op");
            attrs = format!(" type=\"cellIs\" operator=\"{}\"", operator(op));
            body.push_str(&formula(operand(text_of(r, "a"), &cx)));
            if matches!(op, "" | "between" | "notBetween") {
                body.push_str(&formula(operand(text_of(r, "b"), &cx)));
            }
        }
        "text" => {
            let text = text_of(r, "text");
            let quoted = format!("\"{}\"", text.replace('"', "\"\""));
            let (t, op, f) = match text_of(r, "op") {
                "notContains" => (
                    "notContainsText",
                    "notContains",
                    format!("ISERROR(SEARCH({quoted},{cell}))"),
                ),
                "begins" => (
                    "beginsWith",
                    "beginsWith",
                    format!("LEFT({cell},LEN({quoted}))={quoted}"),
                ),
                "ends" => ("endsWith", "endsWith", format!("RIGHT({cell},LEN({quoted}))={quoted}")),
                _ => (
                    "containsText",
                    "containsText",
                    format!("NOT(ISERROR(SEARCH({quoted},{cell})))"),
                ),
            };
            attrs = format!(" type=\"{t}\" operator=\"{op}\" text=\"{}\"", escape(text));
            body.push_str(&formula(f));
        }
        "date" => {
            let period = text_of(r, "period");
            let day = format!("FLOOR({cell},1)");
            let week = |shift: i32| {
                let start = format!("TODAY()-WEEKDAY(TODAY())+{}", 1 + shift);
                format!("AND({day}>={start},{day}<={start}+6)")
            };
            let month = |shift: i32| {
                format!("AND(MONTH({cell})=MONTH(EDATE(TODAY(),{shift})),YEAR({cell})=YEAR(EDATE(TODAY(),{shift})))")
            };
            let f = match period {
                "yesterday" => format!("{day}=TODAY()-1"),
                "today" => format!("{day}=TODAY()"),
                "tomorrow" => format!("{day}=TODAY()+1"),
                "last7Days" => format!("AND(TODAY()-{day}<=6,{day}<=TODAY())"),
                "lastWeek" => week(-7),
                "thisWeek" => week(0),
                "nextWeek" => week(7),
                "lastMonth" => month(-1),
                "thisMonth" => month(0),
                "nextMonth" => month(1),
                _ => return None,
            };
            attrs = format!(" type=\"timePeriod\" timePeriod=\"{period}\"");
            body.push_str(&formula(f));
        }
        "blank" | "noBlank" | "error" | "noError" => {
            let (t, f) = match kind {
                "blank" => ("containsBlanks", format!("LEN(TRIM({cell}))=0")),
                "noBlank" => ("notContainsBlanks", format!("LEN(TRIM({cell}))>0")),
                "error" => ("containsErrors", format!("ISERROR({cell})")),
                _ => ("notContainsErrors", format!("NOT(ISERROR({cell}))")),
            };
            attrs = format!(" type=\"{t}\"");
            body.push_str(&formula(f));
        }
        "duplicate" => attrs = " type=\"duplicateValues\"".to_owned(),
        "unique" => attrs = " type=\"uniqueValues\"".to_owned(),
        "top" => {
            let rank = r
                .get("rank")
                .and_then(Value::as_u64)
                .filter(|n| (1..=1000).contains(n))
                .unwrap_or(10);
            attrs = format!(" type=\"top10\" rank=\"{rank}\"");
            if flag_of(r, "percent", false) {
                attrs.push_str(" percent=\"1\"");
            }
            if flag_of(r, "bottom", false) {
                attrs.push_str(" bottom=\"1\"");
            }
        }
        "average" => {
            attrs = " type=\"aboveAverage\"".to_owned();
            if flag_of(r, "below", false) {
                attrs.push_str(" aboveAverage=\"0\"");
            }
            if flag_of(r, "equal", false) {
                attrs.push_str(" equalAverage=\"1\"");
            }
            if let Some(sd) = r.get("stdDev").and_then(Value::as_u64).filter(|n| (1..=3).contains(n)) {
                attrs.push_str(&format!(" stdDev=\"{sd}\""));
            }
        }
        "formula" => {
            attrs = " type=\"expression\"".to_owned();
            body.push_str(&formula(to_excel(text_of(r, "a").trim_start_matches('='), &cx)));
        }
        "scale" => {
            let stops = r.get("stops").and_then(Value::as_array)?;
            if !(2..=3).contains(&stops.len()) {
                return None;
            }
            attrs = " type=\"colorScale\"".to_owned();
            body.push_str("<colorScale>");
            for (i, stop) in stops.iter().enumerate() {
                let fallback = if i == 0 {
                    "min"
                } else if i + 1 == stops.len() {
                    "max"
                } else {
                    "percentile"
                };
                body.push_str(&cfvo(stop, &cx, fallback));
            }
            for stop in stops {
                body.push_str(&color_xml(stop.get("color").and_then(Value::as_str), "indigo"));
            }
            body.push_str("</colorScale>");
        }
        "bar" => {
            attrs = " type=\"dataBar\"".to_owned();
            let end = |key: &str, fallback: &str| {
                r.get(key)
                    .map_or_else(|| format!("<cfvo type=\"{fallback}\"/>"), |v| cfvo(v, &cx, fallback))
            };
            body.push_str("<dataBar");
            if flag_of(r, "barOnly", false) {
                body.push_str(" showValue=\"0\"");
            }
            body.push('>');
            body.push_str(&end("min", "min"));
            body.push_str(&end("max", "max"));
            body.push_str(&color_xml(r.get("color").and_then(Value::as_str), "indigo"));
            body.push_str("</dataBar>");
        }
        "icons" => {
            let set = text_of(r, "set");
            let count: usize = set
                .get(..1)
                .and_then(|n| n.parse().ok())
                .filter(|n| (3..=5).contains(n))?;
            attrs = " type=\"iconSet\"".to_owned();
            body.push_str(&format!("<iconSet iconSet=\"{}\"", escape(set)));
            if flag_of(r, "reverse", false) {
                body.push_str(" reverse=\"1\"");
            }
            if flag_of(r, "iconOnly", false) {
                body.push_str(" showValue=\"0\"");
            }
            body.push_str("><cfvo type=\"percent\" val=\"0\"/>");
            let given = r
                .get("thresholds")
                .and_then(Value::as_array)
                .filter(|t| t.len() == count - 1);
            for i in 1..count {
                match given.and_then(|t| t.get(i - 1)) {
                    Some(t) => {
                        let mut v = cfvo(t, &cx, "percent");
                        if t.get("gte").and_then(Value::as_bool) == Some(false) {
                            v = v.replacen("/>", " gte=\"0\"/>", 1);
                        }
                        body.push_str(&v);
                    }
                    None => body.push_str(&format!("<cfvo type=\"percent\" val=\"{}\"/>", i * 100 / count)),
                }
            }
            body.push_str("</iconSet>");
        }
        _ => return None,
    }
    let mut head = format!("<cfRule{attrs}");
    if !matches!(kind, "scale" | "bar" | "icons") {
        if let Some((style, fmt)) = &rule.style {
            head.push_str(&format!(" dxfId=\"{}\"", styles.dxf(style, fmt.as_deref())));
        }
    }
    head.push_str(&format!(" priority=\"{priority}\""));
    if flag_of(r, "stop", false) {
        head.push_str(" stopIfTrue=\"1\"");
    }
    Some(format!("{head}>{body}</cfRule>"))
}

/// The nearest built-in table style to a look name: medium styles 2 to 7 follow the six accent colors of the
/// default theme (ECMA-376 Part 1, 18.8.40), so each pen picks the accent closest to it.
fn table_style(look: Option<&str>) -> &'static str {
    let look = look.unwrap_or_default();
    let has = |word: &str| look.split('-').any(|w| w == word);
    if has("brick") || has("amber") || has("orange") {
        "TableStyleMedium3"
    } else if has("ink") || has("gray") || has("walnut") {
        "TableStyleMedium4"
    } else if has("honey") || has("gold") {
        "TableStyleMedium5"
    } else if has("fern") || has("mint") || has("green") {
        "TableStyleMedium7"
    } else if has("plain") || has("none") {
        "TableStyleLight1"
    } else {
        "TableStyleMedium2"
    }
}

fn table_part(input: &Input<'_>, name: &str) -> Option<String> {
    let own = input.book.get(input.own)?;
    let rows = input.texts.len();
    let width = own.columns.len();
    if rows < 2 || width == 0 {
        return None;
    }
    let range = format!("A1:{}", address(rows - 1, width - 1));
    let mut columns = String::new();
    for (c, column) in own.columns.iter().enumerate() {
        // A column whose body cells all hold the same formula is a calculated column.
        let formulas: Vec<Option<String>> = (1..rows).map(|r| formula_of(input.table, r, c)).collect();
        let calculated = match formulas.first() {
            Some(Some(f)) if formulas.iter().all(|x| x.as_deref() == Some(f)) => {
                let cx = Context {
                    book: input.book,
                    own: input.own,
                    row: Some(2),
                };
                format!(
                    "<calculatedColumnFormula>{}</calculatedColumnFormula>",
                    escape(&to_excel(f, &cx))
                )
            }
            _ => String::new(),
        };
        if calculated.is_empty() {
            columns.push_str(&format!("<tableColumn id=\"{}\" name=\"{}\"/>", c + 1, escape(column)));
        } else {
            columns.push_str(&format!(
                "<tableColumn id=\"{}\" name=\"{}\">{calculated}</tableColumn>",
                c + 1,
                escape(column)
            ));
        }
    }
    let look = input.sheet.map(|s| &s.look);
    let flag = |on: bool| u8::from(on);
    Some(format!(
        "{HEADER}<table xmlns=\"{NS}\" id=\"{id}\" name=\"{n}\" displayName=\"{n}\" ref=\"{range}\" totalsRowShown=\"0\">\
         <autoFilter ref=\"{range}\"/><tableColumns count=\"{width}\">{columns}</tableColumns>\
         <tableStyleInfo name=\"{style}\" showFirstColumn=\"{first}\" showLastColumn=\"{last}\" showRowStripes=\"{bands}\" showColumnStripes=\"{col_bands}\"/></table>",
        id = input.table_id,
        n = escape(name),
        style = table_style(look.and_then(|l| l.name.as_deref())),
        first = flag(look.is_some_and(|l| l.first_col)),
        last = flag(look.is_some_and(|l| l.last_col)),
        bands = flag(look.is_none_or(|l| l.band_rows || l.name.is_none())),
        col_bands = flag(look.is_some_and(|l| l.band_cols)),
    ))
}

fn comments_xml(notes: &[(usize, usize, String)]) -> String {
    let mut list = String::new();
    for (r, c, text) in notes {
        list.push_str(&format!(
            "<comment ref=\"{}\" authorId=\"0\"><text><r><t xml:space=\"preserve\">{}</t></r></text></comment>",
            address(*r, *c),
            escape(text)
        ));
    }
    format!("{HEADER}<comments xmlns=\"{NS}\"><authors><author>OpenNote</author></authors><commentList>{list}</commentList></comments>")
}

/// The VML drawing that Excel needs to show legacy comments: one hidden note shape for each comment.
fn vml_xml(notes: &[(usize, usize, String)], sheet_number: usize) -> String {
    let mut out = format!(
        "<xml xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\">\
         <o:shapelayout v:ext=\"edit\"><o:idmap v:ext=\"edit\" data=\"{sheet_number}\"/></o:shapelayout>\
         <v:shapetype id=\"_x0000_t202\" coordsize=\"21600,21600\" o:spt=\"202\" path=\"m,l,21600r21600,l21600,xe\">\
         <v:stroke joinstyle=\"miter\"/><v:path gradientshapeok=\"t\" o:connecttype=\"rect\"/></v:shapetype>"
    );
    for (i, (r, c, _)) in notes.iter().enumerate() {
        out.push_str(&format!(
            "<v:shape id=\"_x0000_s{id}\" type=\"#_x0000_t202\" style=\"position:absolute;width:108pt;height:59.25pt;z-index:{z};visibility:hidden\" fillcolor=\"#ffffe1\" o:insetmode=\"auto\">\
             <v:fill color2=\"#ffffe1\"/><v:shadow on=\"t\" color=\"black\" obscured=\"t\"/><v:path o:connecttype=\"none\"/>\
             <v:textbox style=\"mso-direction-alt:auto\"><div style=\"text-align:left\"></div></v:textbox>\
             <x:ClientData ObjectType=\"Note\"><x:MoveWithCells/><x:SizeWithCells/>\
             <x:Anchor>{a1}, 15, {r}, 10, {a2}, 15, {r4}, 4</x:Anchor><x:AutoFill>False</x:AutoFill>\
             <x:Row>{r}</x:Row><x:Column>{c}</x:Column></x:ClientData></v:shape>",
            id = sheet_number * 1024 + i + 1,
            z = i + 1,
            a1 = c + 1,
            a2 = c + 3,
            r4 = r + 4,
        ));
    }
    out.push_str("</xml>");
    out
}

#[cfg(test)]
pub(crate) mod tests;
