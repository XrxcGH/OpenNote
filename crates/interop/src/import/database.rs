//! Reading the column types of a database export, so a Notion database becomes a smart table.
//!
//! Notion writes every database as plain CSV text. This module looks at the cells under each header and decides
//! whether a column holds numbers, dates, checkboxes, or a short list of choices. A column only gets a type when
//! every non-empty cell fits it, so nothing is guessed from one odd value. Dates are rewritten in ISO form so the
//! smart table reads them in every region. The types go into the table block's `data.smart`, the key the smart
//! table reads (`app/src/features/tables/smart/data.ts`); older readers still see an ordinary table.

use serde_json::{json, Map, Value};

use crate::dates::parse_long_date;

/// What a column holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ColumnKind {
    /// Anything else. The table decides for itself.
    Text,
    /// Numbers, in the form `1234.5` or `1,234.5`.
    Number,
    /// Money with a symbol in front: `$12.00`. The code is the ISO 4217 code of the symbol.
    Currency(&'static str),
    /// Numbers with `%` after them.
    Percent,
    /// Dates, with or without a time.
    Date,
    /// `Yes` and `No`, as Notion writes a checkbox.
    Checkbox,
    /// A few short values that repeat, as a Notion select column. The choices are in first-seen order.
    Choice(Vec<String>),
}

impl ColumnKind {
    /// The word the import report uses.
    pub(crate) fn label(&self) -> &'static str {
        match self {
            ColumnKind::Text => "text",
            ColumnKind::Number => "number",
            ColumnKind::Currency(_) => "currency",
            ColumnKind::Percent => "percent",
            ColumnKind::Date => "date",
            ColumnKind::Checkbox => "checkbox",
            ColumnKind::Choice(_) => "choice",
        }
    }

    /// The column's entry in `data.smart.columns`, or `None` for a text column.
    pub(crate) fn smart(&self) -> Option<Value> {
        Some(match self {
            ColumnKind::Text => return None,
            ColumnKind::Number => json!({ "type": "number" }),
            ColumnKind::Currency(code) => json!({ "type": "currency", "currency": code, "decimals": 2 }),
            ColumnKind::Percent => json!({ "type": "percent" }),
            ColumnKind::Date => json!({ "type": "date" }),
            ColumnKind::Checkbox => json!({ "type": "checkbox" }),
            ColumnKind::Choice(choices) => json!({ "type": "text", "choices": choices }),
        })
    }
}

/// The most distinct values a choice column may have.
const MAX_CHOICES: usize = 12;
/// The longest value a choice may be.
const MAX_CHOICE_CHARS: usize = 40;
/// A column needs this many filled cells before it can be a choice column.
const MIN_CHOICE_CELLS: usize = 3;
/// How many rows the inference reads. A column that fits for this many rows is taken to fit.
const SAMPLE_ROWS: usize = 2_000;

const CHECKED: &[&str] = &["yes", "no", "true", "false", "[x]", "[ ]", "✓", "✔"];
const CURRENCIES: &[(char, &str)] = &[('$', "USD"), ('€', "EUR"), ('£', "GBP"), ('¥', "JPY"), ('₹', "INR")];

/// The kind of each column of `rows`, whose first row is the header.
pub(crate) fn infer_columns(rows: &[Vec<String>]) -> Vec<ColumnKind> {
    let width = rows.first().map_or(0, Vec::len);
    (0..width)
        .map(|c| {
            let cells: Vec<&str> = rows
                .iter()
                .skip(1)
                .take(SAMPLE_ROWS)
                .filter_map(|row| row.get(c))
                .map(|cell| cell.trim())
                .filter(|cell| !cell.is_empty())
                .collect();
            infer(&cells)
        })
        .collect()
}

fn infer(cells: &[&str]) -> ColumnKind {
    if cells.is_empty() {
        return ColumnKind::Text;
    }
    if cells.iter().all(|c| CHECKED.contains(&c.to_lowercase().as_str())) {
        return ColumnKind::Checkbox;
    }
    if cells.iter().all(|c| plain_number(c).is_some()) {
        return ColumnKind::Number;
    }
    if cells
        .iter()
        .all(|c| c.ends_with('%') && plain_number(&c[..c.len() - 1]).is_some())
    {
        return ColumnKind::Percent;
    }
    if let Some(code) = currency_of(cells) {
        return ColumnKind::Currency(code);
    }
    if cells.iter().all(|c| looks_like_date(c)) {
        return ColumnKind::Date;
    }
    choices(cells).map_or(ColumnKind::Text, ColumnKind::Choice)
}

/// A number written as digits, a sign, one decimal point, and commas between groups of three.
fn plain_number(text: &str) -> Option<f64> {
    let text = text.trim();
    let body = text.strip_prefix('-').unwrap_or(text);
    if body.is_empty() || !body.starts_with(|c: char| c.is_ascii_digit() || c == '.') {
        return None;
    }
    let (whole, fraction) = body.split_once('.').unwrap_or((body, ""));
    if !fraction.chars().all(|c| c.is_ascii_digit()) || (whole.is_empty() && fraction.is_empty()) {
        return None;
    }
    if whole.contains(',') {
        let mut groups = whole.split(',');
        let first = groups.next().unwrap_or("");
        let first_ok = (1..=3).contains(&first.len()) && first.chars().all(|c| c.is_ascii_digit());
        if !first_ok || !groups.all(|g| g.len() == 3 && g.chars().all(|c| c.is_ascii_digit())) {
            return None;
        }
    } else if !whole.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.replace(',', "").parse().ok().filter(|n: &f64| n.is_finite())
}

/// The currency code when every cell is a number after the same currency symbol.
fn currency_of(cells: &[&str]) -> Option<&'static str> {
    let first = cells.first()?.trim_start_matches('-').chars().next()?;
    let (symbol, code) = CURRENCIES.iter().find(|(s, _)| *s == first)?;
    cells
        .iter()
        .all(|c| {
            let c = c.trim();
            let (negative, rest) = c.strip_prefix('-').map_or((false, c), |r| (true, r));
            rest.strip_prefix(*symbol)
                .and_then(plain_number)
                .is_some_and(|n| !negative || n >= 0.0)
        })
        .then_some(*code)
}

/// Whether the text is a date that a person would read as one: it has a year and a month or digits in date form.
fn looks_like_date(text: &str) -> bool {
    let has_letters = text.chars().any(|c| c.is_alphabetic());
    let has_separator = text.contains('-') || text.contains('/') || has_letters;
    has_separator && text.chars().filter(char::is_ascii_digit).count() >= 4 && parse_long_date(text).is_some()
}

/// The distinct values when the column looks like a select: few, short, single-line values that repeat.
fn choices(cells: &[&str]) -> Option<Vec<String>> {
    if cells.len() < MIN_CHOICE_CELLS {
        return None;
    }
    let mut seen: Vec<String> = Vec::new();
    for cell in cells {
        if cell.chars().count() > MAX_CHOICE_CHARS || cell.contains('\n') {
            return None;
        }
        if !seen.iter().any(|s| s == cell) {
            seen.push((*cell).to_owned());
            if seen.len() > MAX_CHOICES {
                return None;
            }
        }
    }
    // A choice repeats: at least one value is used twice, and there are fewer values than cells.
    (seen.len() < cells.len()).then_some(seen)
}

/// The text a date cell gets: `2026-10-07`, or `2026-10-07 15:30` when it has a time.
pub(crate) fn iso_date(text: &str) -> Option<String> {
    let stamp = parse_long_date(text.trim())?;
    let full = stamp.to_rfc3339();
    let (date, time) = (full.get(..10)?, full.get(11..16)?);
    Some(if time == "00:00" {
        date.to_owned()
    } else {
        format!("{date} {time}")
    })
}

/// Rewrites the date cells of `rows` in ISO form, for the columns whose kind is a date. The header stays.
pub(crate) fn normalize_dates(rows: &mut [Vec<String>], kinds: &[ColumnKind]) {
    for row in rows.iter_mut().skip(1) {
        for (cell, kind) in row.iter_mut().zip(kinds) {
            if *kind == ColumnKind::Date {
                if let Some(iso) = iso_date(cell) {
                    *cell = iso;
                }
            }
        }
    }
}

/// The `data.smart` object for columns with the given IDs, or `None` when every column is text.
pub(crate) fn smart_data(column_ids: &[String], kinds: &[ColumnKind]) -> Option<Value> {
    let mut columns = Map::new();
    for (id, kind) in column_ids.iter().zip(kinds) {
        if let Some(entry) = kind.smart() {
            columns.insert(id.clone(), entry);
        }
    }
    (!columns.is_empty()).then(|| json!({ "columns": columns, "filters": [], "charts": [] }))
}

/// The report line that names each typed column: `Price (number), Done (checkbox)`.
pub(crate) fn describe(header: &[String], kinds: &[ColumnKind]) -> Option<String> {
    let typed: Vec<String> = header
        .iter()
        .zip(kinds)
        .filter(|(_, kind)| **kind != ColumnKind::Text)
        .map(|(name, kind)| format!("{} ({})", name.trim(), kind.label()))
        .collect();
    (!typed.is_empty()).then(|| format!("column types: {}", typed.join(", ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(text: &[&[&str]]) -> Vec<Vec<String>> {
        text.iter()
            .map(|r| r.iter().map(|c| (*c).to_owned()).collect())
            .collect()
    }

    #[test]
    fn each_kind_is_read_from_cells_that_all_fit() {
        let table = rows(&[
            &["Name", "Pages", "Price", "Share", "Due", "Done", "Status", "Notes"],
            &[
                "Dune",
                "412",
                "$12.50",
                "25%",
                "October 7, 2026",
                "Yes",
                "Done",
                "Great",
            ],
            &["Cosmos", "1,365", "$9.00", "50%", "2026-10-09", "No", "Reading", "Long"],
            &[
                "Emma",
                "",
                "$0.99",
                "5.5%",
                "Oct 12, 2026 3:30 PM",
                "No",
                "Done",
                "Fine",
            ],
            &["Ulysses", "-3.5", "-$1.00", "0%", "", "", "To read", "Hard"],
        ]);
        let kinds = infer_columns(&table);
        assert_eq!(
            kinds,
            [
                ColumnKind::Text,
                ColumnKind::Number,
                ColumnKind::Currency("USD"),
                ColumnKind::Percent,
                ColumnKind::Date,
                ColumnKind::Checkbox,
                ColumnKind::Choice(vec!["Done".into(), "Reading".into(), "To read".into()]),
                ColumnKind::Text,
            ]
        );
    }

    #[test]
    fn one_odd_cell_keeps_a_column_as_text() {
        let table = rows(&[
            &["N", "D"],
            &["1", "2026-01-01"],
            &["two", "soon"],
            &["3", "2026-01-03"],
        ]);
        assert_eq!(infer_columns(&table), [ColumnKind::Text, ColumnKind::Text]);
    }

    #[test]
    fn numbers_need_proper_groups_and_plain_digits() {
        for good in ["0", "12", "-4", "1,234", "1,234,567.25", ".5", "3."] {
            assert!(plain_number(good).is_some(), "{good}");
        }
        for bad in [
            "", "-", "1,23", "12,3456", "1e5", "NaN", "inf", "0x10", "1.2.3", "12a", ",123",
        ] {
            assert!(plain_number(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn dates_are_rewritten_in_iso_form() {
        assert_eq!(iso_date("October 7, 2026").as_deref(), Some("2026-10-07"));
        assert_eq!(iso_date("Oct 12, 2026 3:30 PM").as_deref(), Some("2026-10-12 15:30"));
        assert_eq!(iso_date("not a date"), None);
        let mut table = rows(&[&["Due"], &["October 7, 2026"], &["2026-10-09"]]);
        normalize_dates(&mut table, &[ColumnKind::Date]);
        assert_eq!(table[1][0], "2026-10-07");
        assert_eq!(table[0][0], "Due", "the header stays");
    }

    #[test]
    fn a_choice_needs_repeats_and_short_values() {
        assert_eq!(infer(&["a", "b", "c"]), ColumnKind::Text, "no value repeats");
        assert_eq!(infer(&["a", "a"]), ColumnKind::Text, "too few cells");
        let long = "x".repeat(41);
        assert_eq!(infer(&[&long, &long, "b"]), ColumnKind::Text);
        let many: Vec<String> = (0..14).map(|n| format!("v{n}")).chain(["v1".to_owned()]).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        assert_eq!(infer(&many), ColumnKind::Text, "too many values");
    }

    #[test]
    fn smart_data_names_columns_by_id_and_skips_text() {
        let ids = vec!["c1".to_owned(), "c2".to_owned()];
        let smart = smart_data(&ids, &[ColumnKind::Text, ColumnKind::Checkbox]).expect("a typed column");
        assert_eq!(smart["columns"]["c2"]["type"], "checkbox");
        assert!(smart["columns"].get("c1").is_none());
        assert!(smart_data(&ids, &[ColumnKind::Text, ColumnKind::Text]).is_none());
        let header = vec!["Name".to_owned(), "Done".to_owned()];
        assert_eq!(
            describe(&header, &[ColumnKind::Text, ColumnKind::Checkbox]).as_deref(),
            Some("column types: Done (checkbox)")
        );
    }
}
