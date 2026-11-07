//! The page style sheet (`R-STY-7`) and theme (`R-THM-1`) of an imported Word file: the document defaults,
//! Normal, and every paragraph style the document uses, each with the values Word resolves for it. Runs then
//! carry only what differs from their style (DESIGN 9.2).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use super::marks::{plain_style, plain_style_name, style_keys};
use super::paras::para_keys;
use super::props::{resolve, RunProps};
use super::styles::Styles;
use super::theme::Theme;
use super::values::{hex, num};
use crate::doc::values as grammar;

/// The most styles a page's style sheet holds (`R-STY-5`).
const MAX_STYLES: usize = 64;

/// Paragraph keys that a named style can hold (`R-STY-1`).
const STYLE_PARA_KEYS: &[&str] = &[
    "align",
    "indent",
    "before",
    "after",
    "line",
    "contextual",
    "keepNext",
    "keepLines",
    "widows",
    "tabs",
    "border",
    "shade",
    "outline",
    "dir",
    "lang",
];

/// One style of the sheet: the run keys and paragraph keys Word resolves for a paragraph style, with what it
/// inherits from the document defaults and its `basedOn` chain.
fn style_values(styles: &Styles, id: Option<&str>, theme: &Theme) -> Map<String, Value> {
    let chain = id.map(|id| styles.run_chain(id)).unwrap_or_default();
    let run = resolve(&styles.defaults_run, &[&RunProps::default(), &chain], None);
    let mut para = styles.defaults_para.clone();
    if let Some(id) = id {
        para.set_over(&styles.para_chain(id));
    }
    let mut out = Map::new();
    style_keys(&run, theme, &mut out);
    let mut keys = Map::new();
    para_keys(&para, theme, &mut keys);
    for (key, value) in keys {
        if STYLE_PARA_KEYS.contains(&key.as_str()) {
            out.insert(key, value);
        }
    }
    add_v1_spacing(&mut out);
    out
}

/// The version 1 keys `R-STY-2` asks for next to `before`, `after`, and `line`.
fn add_v1_spacing(out: &mut Map<String, Value>) {
    for (v2, v1) in [("before", "spaceBefore"), ("after", "spaceAfter")] {
        if let Some(points) = out.get(v2).and_then(Value::as_f64) {
            let units = (points * 4.0 / 3.0 * 100.0).round() / 100.0;
            if (0.0..=1000.0).contains(&units) {
                out.insert(v1.to_owned(), num(units));
            }
        }
    }
    let multiple = out
        .get("line")
        .filter(|l| l.get("rule").and_then(Value::as_str) == Some("multiple"))
        .and_then(|l| l.get("value"))
        .and_then(Value::as_f64)
        .filter(|v| (0.5..=10.0).contains(v));
    if let Some(value) = multiple {
        out.insert("lineHeight".to_owned(), num(value));
    }
}

/// The style sheet: `normal` from the defaults and the default paragraph style, then each used paragraph style
/// by its OpenNote name. Returns the sheet and how many styles did not fit.
pub(super) fn style_sheet(
    styles: &Styles,
    used: &BTreeSet<String>,
    plain: &BTreeSet<u8>,
    theme: &Theme,
) -> (Map<String, Value>, usize) {
    let mut sheet: BTreeMap<String, Value> = BTreeMap::new();
    let normal_id = styles.paragraph_style(None);
    sheet.insert(
        "normal".to_owned(),
        Value::Object(style_values(styles, normal_id, theme)),
    );
    let mut dropped = 0;
    for id in used {
        let name = styles.sheet_name(id);
        if sheet.contains_key(&name) {
            continue;
        }
        if sheet.len() >= MAX_STYLES {
            dropped += 1;
            continue;
        }
        let mut values = style_values(styles, Some(id), theme);
        if name.starts_with("u-") {
            let label: String = styles.name(id).unwrap_or(id).chars().take(60).collect();
            if !label.trim().is_empty() {
                values.insert("label".to_owned(), Value::from(label));
            }
            let parent = styles
                .based_on(id)
                .map(|p| styles.sheet_name(p))
                .filter(|p| *p != name && grammar::style_name(p))
                .unwrap_or_else(|| "normal".to_owned());
            values.insert("basedOn".to_owned(), Value::from(parent));
        }
        sheet.insert(name, Value::Object(values));
    }
    for bits in plain {
        if sheet.len() >= MAX_STYLES {
            dropped += 1;
            continue;
        }
        sheet.insert(plain_style_name(*bits), plain_style(*bits));
    }
    (sheet.into_iter().collect(), dropped)
}

/// The page theme: the major and minor Latin fonts as the heading and body fonts, and the scheme's colors.
pub(super) fn theme_json(theme: &Theme) -> Option<Value> {
    let mut fonts = Map::new();
    for (key, face) in [("heading", &theme.major.latin), ("body", &theme.minor.latin)] {
        if let Some(face) = face.as_deref().filter(|f| grammar::font_name(f) && !f.starts_with('+')) {
            fonts.insert(key.to_owned(), Value::from(face));
        }
    }
    let mut colors = Map::new();
    for (key, slot) in [
        ("accent1", "accent1"),
        ("accent2", "accent2"),
        ("accent3", "accent3"),
        ("accent4", "accent4"),
        ("accent5", "accent5"),
        ("accent6", "accent6"),
        ("text", "dk1"),
        ("background", "lt1"),
    ] {
        if let Some(rgb) = theme.colors.get(slot) {
            colors.insert(key.to_owned(), Value::from(hex(rgb)));
        }
    }
    let mut out = Map::new();
    if !fonts.is_empty() {
        out.insert("fonts".to_owned(), Value::Object(fonts));
    }
    if !colors.is_empty() {
        out.insert("colors".to_owned(), Value::Object(colors));
    }
    (!out.is_empty()).then_some(Value::Object(out))
}
