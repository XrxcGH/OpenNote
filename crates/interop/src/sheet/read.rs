//! Reads `data.sheet` of a table block: layers the styles (spec R-SHT-9, without looks and conditional formats),
//! finds merges (R-SHT-12), and checks the value cache against the fingerprint of the cells (R-SHT-17, R-SHT-18).

use super::{Merge, TableSheet};
use crate::doc::cell_style::{CellAlign, CellBorder, CellBorders, CellFont, CellStyle, Fill, Pad};
use opennote_core::model::TableData;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

type Obj = Map<String, Value>;

/// Reads the sheet of a table. `None` when the table has no `data.sheet`.
pub fn read(table: &TableData) -> Option<TableSheet> {
    let sheet = table.extra.get("sheet")?.as_object()?;
    let rows = table.rows.len();
    let columns = table.columns.len();
    let fresh = sheet.get("valuesOf").and_then(Value::as_str) == Some(fingerprint(table).as_str());
    let settings = obj(sheet.get("table"));
    let mut out = TableSheet {
        styles: vec![vec![None; columns]; rows],
        results: vec![vec![None; columns]; rows],
        name: settings
            .and_then(|t| t.get("name"))
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .map(str::to_owned),
        ..TableSheet::default()
    };
    let styles = obj(sheet.get("styles"));
    let col_settings = obj(sheet.get("cols"));
    let row_settings = obj(sheet.get("rows"));
    let cells = obj(sheet.get("cells"));
    let values = obj(sheet.get("values"));
    let col_ids: Vec<String> = table.columns.iter().map(|c| c.id.to_string()).collect();
    for (r, row) in table.rows.iter().enumerate() {
        let row_id = row.id.to_string();
        for (c, column) in table.columns.iter().enumerate() {
            let column_id = col_ids[c].as_str();
            let layers = [
                settings.and_then(|t| t.get("style")),
                col_settings.and_then(|m| m.get(column_id)).and_then(|s| s.get("style")),
                row_settings
                    .and_then(|m| m.get(row_id.as_str()))
                    .and_then(|s| s.get("style")),
                cells
                    .and_then(|m| m.get(row_id.as_str()))
                    .and_then(|m| m.get(column_id)),
            ];
            let mut merged = Obj::new();
            let mut any = false;
            for id in layers.iter().flatten().filter_map(|v| v.as_str()) {
                if let Some(style) = styles.and_then(|s| s.get(id)).and_then(Value::as_object) {
                    layer_over(&mut merged, style);
                    any = true;
                }
            }
            if any {
                out.styles[r][c] = Some(style_of(&merged));
            }
            let markdown = row.cells.get(&column.id).map_or("", |cell| cell.markdown.as_str());
            let stored = values
                .and_then(|v| v.get(row_id.as_str()))
                .and_then(|v| v.get(column_id));
            if markdown.starts_with('=') {
                if fresh {
                    out.results[r][c] = Some(stored.map_or_else(String::new, result_text));
                } else {
                    out.stale = true;
                }
            } else if fresh && markdown.is_empty() {
                out.results[r][c] = stored.map(result_text);
            }
        }
    }
    out.merges = merges(sheet, table);
    Some(out)
}

fn obj(value: Option<&Value>) -> Option<&Obj> {
    value?.as_object()
}

/// Lays `upper` over `lower`: `font`, `align`, `pad`, and `border` merge key by key. Everything else, such as `fill`,
/// replaces.
fn layer_over(lower: &mut Obj, upper: &Obj) {
    for (key, value) in upper {
        let keyed = matches!(key.as_str(), "font" | "align" | "pad" | "border");
        match (keyed, lower.get_mut(key), value.as_object()) {
            (true, Some(Value::Object(below)), Some(above)) => {
                for (k, v) in above {
                    below.insert(k.clone(), v.clone());
                }
            }
            _ => {
                lower.insert(key.clone(), value.clone());
            }
        }
    }
}

fn text(value: Option<&Value>) -> Option<String> {
    value?.as_str().map(str::to_owned)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value?.as_f64().filter(|n| n.is_finite())
}

fn side(value: Option<&Value>) -> Option<CellBorder> {
    let side = value?.as_object()?;
    Some(CellBorder {
        style: text(side.get("style"))?,
        color: text(side.get("color")),
        width: number(side.get("width")),
    })
}

fn get<'a>(m: Option<&'a Obj>, k: &str) -> Option<&'a Value> {
    m?.get(k)
}

fn style_of(style: &Obj) -> CellStyle {
    let font = obj(style.get("font"));
    let align = obj(style.get("align"));
    let border = obj(style.get("border"));
    let pad = obj(style.get("pad"));
    CellStyle {
        font: CellFont {
            family: text(get(font, "family")),
            size: number(get(font, "size")),
            weight: number(get(font, "weight")).map(|w| w as u16),
            bold: get(font, "bold").and_then(Value::as_bool),
            italic: get(font, "italic").and_then(Value::as_bool),
            underline: text(get(font, "underline")),
            strike: match get(font, "strike") {
                Some(Value::Bool(true)) => Some("single".to_owned()),
                Some(Value::Bool(false)) => Some("none".to_owned()),
                other => text(other),
            },
            color: text(get(font, "color")),
            script: text(get(font, "script")),
        },
        fill: style.get("fill").and_then(fill_of),
        border: CellBorders {
            top: side(get(border, "t")),
            right: side(get(border, "r")),
            bottom: side(get(border, "b")),
            left: side(get(border, "l")),
            diagonal_up: side(get(border, "du")),
            diagonal_down: side(get(border, "dd")),
        },
        align: CellAlign {
            horizontal: text(get(align, "h")),
            vertical: text(get(align, "v")),
            wrap: text(get(align, "wrap")),
            shrink: get(align, "shrink").and_then(Value::as_bool),
            rotate: match get(align, "rotate") {
                Some(Value::Number(n)) => n.as_f64().map(|n| n as i16),
                _ => None,
            },
            stacked: get(align, "rotate").and_then(Value::as_str) == Some("stacked"),
            indent: number(get(align, "indent")).map(|n| n as u8),
            dir: text(get(align, "dir")),
        },
        pad: Pad {
            top: number(get(pad, "t")),
            right: number(get(pad, "r")),
            bottom: number(get(pad, "b")),
            left: number(get(pad, "l")),
        },
    }
}

fn fill_of(value: &Value) -> Option<Fill> {
    match value {
        Value::String(s) if s == "none" => Some(Fill::None),
        Value::String(s) => Some(Fill::Color(s.clone())),
        Value::Object(o) => {
            if let Some(pattern) = o.get("pattern").and_then(Value::as_str) {
                return Some(Fill::Pattern {
                    pattern: pattern.to_owned(),
                    color: text(o.get("color")),
                    back: text(o.get("back")),
                });
            }
            let gradient = o.get("gradient")?.as_object()?;
            let stops = gradient
                .get("stops")?
                .as_array()?
                .iter()
                .filter_map(|s| Some((number(s.get("at"))?, text(s.get("color"))?)))
                .collect();
            Some(Fill::Gradient {
                angle: number(gradient.get("angle")).map_or(0, |a| a as u16),
                stops,
            })
        }
        _ => None,
    }
}

/// The active merges (R-SHT-12): in ID order, covering more than one cell, naming rows, columns that exist, and
/// not overlapping a merge with a lower ID.
fn merges(sheet: &Obj, table: &TableData) -> Vec<Merge> {
    let Some(list) = obj(sheet.get("merges")) else {
        return Vec::new();
    };
    let row_at = |id: &Value| {
        table
            .rows
            .iter()
            .position(|r| Some(r.id.to_string().as_str()) == id.as_str())
    };
    let col_at = |id: &Value| {
        table
            .columns
            .iter()
            .position(|c| Some(c.id.to_string().as_str()) == id.as_str())
    };
    let sorted: BTreeMap<&String, &Value> = list.iter().collect();
    let mut taken = BTreeSet::new();
    let mut out = Vec::new();
    for value in sorted.values() {
        let corner = |key: &str| {
            let pair = value.get(key)?.as_array()?;
            Some((row_at(pair.first()?)?, col_at(pair.get(1)?)?))
        };
        let (Some(a), Some(b)) = (corner("from"), corner("to")) else {
            continue;
        };
        let merge = Merge {
            top: a.0.min(b.0),
            left: a.1.min(b.1),
            bottom: a.0.max(b.0),
            right: a.1.max(b.1),
        };
        if merge.top == merge.bottom && merge.left == merge.right {
            continue;
        }
        let cells: Vec<(usize, usize)> = (merge.top..=merge.bottom)
            .flat_map(|r| (merge.left..=merge.right).map(move |c| (r, c)))
            .collect();
        if cells.iter().any(|cell| taken.contains(cell)) {
            continue;
        }
        taken.extend(cells);
        out.push(merge);
    }
    out
}

fn result_text(value: &Value) -> String {
    match value {
        Value::Null | Value::Array(_) => String::new(),
        Value::Bool(true) => "TRUE".to_owned(),
        Value::Bool(false) => "FALSE".to_owned(),
        Value::Number(n) => number_text(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => s.clone(),
        Value::Object(o) => o.get("e").and_then(Value::as_str).unwrap_or_default().to_owned(),
    }
}

/// A number the way JavaScript writes it: no exponent from 1e-6 up to 1e21.
fn number_text(n: f64) -> String {
    if n == 0.0 {
        return "0".to_owned();
    }
    if n.abs() >= 1e-6 && n.abs() < 1e21 {
        return format!("{n}");
    }
    let text = format!("{n:e}");
    match text.split_once('e') {
        Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
        _ => text,
    }
}

/// The fingerprint of a table's cells (R-SHT-18): `fnv1a:` and 16 hexadecimal digits of the FNV-1a 64 hash of the
/// compact canonical JSON of `[header, column IDs, [[row ID, [Markdown per column]] per row], smart]`.
pub fn fingerprint(table: &TableData) -> String {
    let columns: Vec<Value> = table.columns.iter().map(|c| Value::from(c.id.to_string())).collect();
    let rows: Vec<Value> = table
        .rows
        .iter()
        .map(|row| {
            let cells = table
                .columns
                .iter()
                .map(|c| Value::from(row.cells.get(&c.id).map_or("", |cell| cell.markdown.as_str())))
                .collect::<Vec<_>>();
            Value::Array(vec![Value::from(row.id.to_string()), Value::Array(cells)])
        })
        .collect();
    let smart = table.extra.get("smart").cloned().unwrap_or(Value::Null);
    let all = Value::Array(vec![
        Value::Bool(table.header),
        Value::Array(columns),
        Value::Array(rows),
        smart,
    ]);
    let mut json = String::new();
    canonical(&all, &mut json);
    format!("fnv1a:{:016x}", fnv1a64(json.as_bytes()))
}

/// FNV-1a 64 with the offset basis `cbf29ce484222325` and prime `100000001b3` (R-SHT-6).
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => match n.as_i64() {
            Some(i) => out.push_str(&i.to_string()),
            None => out.push_str(&number_text(n.as_f64().unwrap_or(0.0))),
        },
        Value::String(s) => quote(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let sorted: BTreeMap<&String, &Value> = map.iter().collect();
            out.push('{');
            for (i, (key, item)) in sorted.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                quote(key, out);
                out.push(':');
                canonical(item, out);
            }
            out.push('}');
        }
    }
}

/// A string as the canonical form writes it: `"`, `\`, and U+0000 to U+001F are escaped, and the rest is raw UTF-8.
fn quote(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}
