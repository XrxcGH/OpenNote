//! Reads the parts of `data.sheet` that a workbook export carries besides styles and merges (format spec 6.3): the
//! column and row settings (`R-SHT-11`), the table settings (`R-SHT-10`), names (`R-SHT-13`), validation and
//! conditional formats (`R-SHT-14`, `R-SHT-15`, `R-SHT-22`), and notes (`R-SHT-16`).

use super::read::style_of;
use super::{Merge, TableSheet};
use crate::doc::cell_style::CellStyle;
use opennote_core::format::page_json::inline::readable_text;
use opennote_core::model::TableData;
use serde_json::{Map, Value};
use std::collections::HashMap;

type Obj = Map<String, Value>;

/// The settings of one column or row.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Axis {
    /// Hidden from view.
    pub hidden: bool,
    /// The outline depth, 0 to 7.
    pub level: u8,
    /// Whether the outline group ending here is collapsed.
    pub collapsed: bool,
    /// A row's height in page units, when set.
    pub height: Option<f64>,
}

/// A defined name.
#[derive(Clone, Debug, PartialEq)]
pub struct Name {
    /// The name.
    pub name: String,
    /// Its formula text without `=`.
    pub reference: String,
    /// Whether it belongs to the table (`true`) or the page.
    pub table_scope: bool,
    /// Its comment.
    pub comment: String,
}

/// A validation rule or a conditional format with the boxes its ranges cover.
#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    /// The rule ID.
    pub id: String,
    /// The boxes of its valid ranges.
    pub boxes: Vec<Merge>,
    /// The rule as the sheet holds it.
    pub rule: Obj,
    /// For a conditional format, the style it applies, with that style's number format.
    pub style: Option<(CellStyle, Option<String>)>,
}

/// The table settings a workbook carries.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Look {
    /// The look name, when it is a name.
    pub name: Option<String>,
    /// Banded rows.
    pub band_rows: bool,
    /// Banded columns.
    pub band_cols: bool,
    /// Emphasis of the first column.
    pub first_col: bool,
    /// Emphasis of the last column.
    pub last_col: bool,
}

fn obj(value: Option<&Value>) -> Option<&Obj> {
    value?.as_object()
}

fn flag(o: Option<&Obj>, key: &str) -> bool {
    o.and_then(|o| o.get(key)).and_then(Value::as_bool) == Some(true)
}

fn axis(o: Option<&Obj>) -> Axis {
    let level = o
        .and_then(|o| o.get("level"))
        .and_then(Value::as_u64)
        .filter(|l| *l <= 7)
        .unwrap_or(0) as u8;
    Axis {
        hidden: flag(o, "hidden"),
        level,
        collapsed: flag(o, "collapsed"),
        height: o
            .and_then(|o| o.get("height"))
            .and_then(Value::as_f64)
            .filter(|h| (1.0..=10_000.0).contains(h)),
    }
}

/// Fills the export parts of `out` from `sheet`.
pub(super) fn fill(out: &mut TableSheet, sheet: &Obj, table: &TableData) {
    let col_settings = obj(sheet.get("cols"));
    let row_settings = obj(sheet.get("rows"));
    out.cols = table
        .columns
        .iter()
        .map(|c| axis(col_settings.and_then(|m| obj(m.get(c.id.to_string().as_str())))))
        .collect();
    out.rows = table
        .rows
        .iter()
        .map(|r| axis(row_settings.and_then(|m| obj(m.get(r.id.to_string().as_str())))))
        .collect();
    let settings = obj(sheet.get("table"));
    let freeze = settings.and_then(|t| obj(t.get("freeze")));
    let count = |key: &str, most: usize| {
        freeze
            .and_then(|f| f.get(key))
            .and_then(Value::as_u64)
            .map_or(0, |n| (n as usize).min(most))
    };
    out.freeze = (count("rows", table.rows.len()), count("cols", table.columns.len()));
    let band = settings.and_then(|t| obj(t.get("band")));
    let emphasis = settings.and_then(|t| obj(t.get("emphasis")));
    out.look = Look {
        name: settings
            .and_then(|t| t.get("look"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        band_rows: flag(band, "rows"),
        band_cols: flag(band, "cols"),
        first_col: flag(emphasis, "firstCol"),
        last_col: flag(emphasis, "lastCol"),
    };
    out.names = names(sheet);
    let index = Index::new(table);
    let styles = obj(sheet.get("styles"));
    out.validation = rules(sheet, "validation", &index, styles);
    let mut conditional = rules(sheet, "conditional", &index, styles);
    let order = |r: &Rule| {
        r.rule
            .get("order")
            .and_then(Value::as_u64)
            .filter(|o| (1..=256).contains(o))
            .unwrap_or(257)
    };
    conditional.sort_by(|a, b| order(a).cmp(&order(b)).then_with(|| a.id.cmp(&b.id)));
    out.conditional = conditional;
    out.notes = notes(sheet, &index);
}

fn names(sheet: &Obj) -> Vec<Name> {
    let Some(map) = obj(sheet.get("names")) else {
        return Vec::new();
    };
    let mut out: Vec<Name> = map
        .iter()
        .filter_map(|(name, entry)| {
            let reference = entry.get("ref")?.as_str()?;
            (!reference.is_empty() && !name.is_empty() && name.chars().count() <= 255).then(|| Name {
                name: name.clone(),
                reference: reference.to_owned(),
                table_scope: entry.get("scope").and_then(Value::as_str) != Some("page"),
                comment: entry
                    .get("comment")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Row and column positions by ID.
struct Index {
    rows: HashMap<String, usize>,
    cols: HashMap<String, usize>,
}

impl Index {
    fn new(table: &TableData) -> Self {
        Self {
            rows: table
                .rows
                .iter()
                .enumerate()
                .map(|(i, r)| (r.id.to_string(), i))
                .collect(),
            cols: table
                .columns
                .iter()
                .enumerate()
                .map(|(i, c)| (c.id.to_string(), i))
                .collect(),
        }
    }

    fn corner(&self, pair: Option<&Value>) -> Option<(usize, usize)> {
        let pair = pair?.as_array()?;
        Some((
            *self.rows.get(pair.first()?.as_str()?)?,
            *self.cols.get(pair.get(1)?.as_str()?)?,
        ))
    }

    /// The box of a range of `R-SHT-22`, or `None` for one that names a missing row or column.
    fn range(&self, range: &Value) -> Option<Merge> {
        let last_row = self.rows.len().checked_sub(1)?;
        let last_col = self.cols.len().checked_sub(1)?;
        if let Some(col) = range.get("col").and_then(Value::as_str) {
            let c = *self.cols.get(col)?;
            return Some(Merge {
                top: 0,
                left: c,
                bottom: last_row,
                right: c,
            });
        }
        if let Some(row) = range.get("row").and_then(Value::as_str) {
            let r = *self.rows.get(row)?;
            return Some(Merge {
                top: r,
                left: 0,
                bottom: r,
                right: last_col,
            });
        }
        let a = self.corner(range.get("from"))?;
        let b = self.corner(range.get("to"))?;
        Some(Merge {
            top: a.0.min(b.0),
            left: a.1.min(b.1),
            bottom: a.0.max(b.0),
            right: a.1.max(b.1),
        })
    }
}

fn rules(sheet: &Obj, kind: &str, index: &Index, styles: Option<&Obj>) -> Vec<Rule> {
    let Some(map) = obj(sheet.get(kind)) else {
        return Vec::new();
    };
    let mut out: Vec<Rule> = map
        .iter()
        .take(256)
        .filter_map(|(id, value)| {
            let rule = value.as_object()?;
            let boxes: Vec<Merge> = rule
                .get("ranges")?
                .as_array()?
                .iter()
                .take(64)
                .filter_map(|r| index.range(r))
                .collect();
            if boxes.is_empty() {
                return None;
            }
            let style = rule
                .get("style")
                .and_then(Value::as_str)
                .and_then(|s| styles?.get(s)?.as_object())
                .map(|s| {
                    let fmt = s.get("fmt").and_then(Value::as_str).map(str::to_owned);
                    (style_of(s), fmt)
                });
            Some(Rule {
                id: id.clone(),
                boxes,
                rule: rule.clone(),
                style,
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn notes(sheet: &Obj, index: &Index) -> Vec<(usize, usize, String)> {
    let Some(map) = obj(sheet.get("notes")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (row, cols) in map {
        let Some(&r) = index.rows.get(row) else {
            continue;
        };
        for (col, note) in cols.as_object().into_iter().flatten() {
            let Some(&c) = index.cols.get(col) else {
                continue;
            };
            let Some(markdown) = note.get("markdown").and_then(Value::as_str) else {
                continue;
            };
            let text: Vec<String> = markdown.split("\n\n").map(readable_text).collect();
            out.push((r, c, text.join("\n")));
        }
    }
    out.sort_by_key(|n| (n.0, n.1));
    out.truncate(10_000);
    out
}
