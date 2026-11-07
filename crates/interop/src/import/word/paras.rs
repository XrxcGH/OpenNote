//! Paragraph properties in OpenNote's terms: the keys of `data.paras` (spec 6.8), which named styles share
//! (`R-STY-1`). This is DESIGN 9.1 read in reverse.

use serde_json::{Map, Value};

use super::props::{Border, ParaProps};
use super::theme::Theme;
use super::values::{hex, num, twips};
use crate::doc::values as grammar;
use crate::palette::pen_name;

const BORDER_STYLES: &[&str] = &[
    "single",
    "double",
    "dotted",
    "dashed",
    "thick",
    "triple",
    "thinThickSmallGap",
    "thickThinSmallGap",
    "wave",
    "doubleWave",
    "dashDotStroked",
    "threeDEmboss",
    "threeDEngrave",
    "inset",
    "outset",
];

const SHADE_PATTERNS: &[&str] = &[
    "clear",
    "solid",
    "horzStripe",
    "vertStripe",
    "reverseDiagStripe",
    "diagStripe",
    "horzCross",
    "diagCross",
    "thinHorzStripe",
    "thinVertStripe",
    "thinReverseDiagStripe",
    "thinDiagStripe",
    "thinHorzCross",
    "thinDiagCross",
];

const LEADERS: &[&str] = &["none", "dot", "hyphen", "underscore", "heavy", "middleDot"];

/// Points from twips, when they lie in `lo..=hi`.
fn points(t: Option<i32>, lo: f64, hi: f64) -> Option<f64> {
    t.map(twips).filter(|p| (lo..=hi).contains(p))
}

/// Writes the keys that the properties set. Keys outside their ranges are left out, so the style's value holds.
pub(super) fn para_keys(p: &ParaProps, theme: &Theme, out: &mut Map<String, Value>) {
    align_and_indent(p, out);
    spacing_keys(p, out);
    flag_keys(p, out);
    tab_keys(p, out);
    border_keys(p, theme, out);
    shade_key(p, theme, out);
    other_keys(p, out);
}

/// Alignment and indents.
fn align_and_indent(p: &ParaProps, out: &mut Map<String, Value>) {
    let align = match p.jc.as_deref() {
        Some("left" | "start") => Some("start"),
        Some("center") => Some("center"),
        Some("right" | "end") => Some("end"),
        Some("both" | "lowKashida" | "mediumKashida" | "highKashida" | "thaiDistribute") => Some("justify"),
        Some("distribute") => Some("distribute"),
        _ => None,
    };
    if let Some(align) = align {
        out.insert("align".to_owned(), Value::from(align));
    }
    let [left, right, first_line, hanging] = p.ind;
    if p.ind.iter().any(Option::is_some) {
        let side = |t| points(t, -1584.0, 1584.0).unwrap_or(0.0);
        let first = match (hanging, first_line) {
            (Some(h), _) if h != 0 => -twips(h),
            (_, Some(f)) => twips(f),
            _ => 0.0,
        };
        let mut indent = Map::new();
        indent.insert("start".to_owned(), num(side(left)));
        indent.insert("end".to_owned(), num(side(right)));
        indent.insert("first".to_owned(), num(first.clamp(-1584.0, 1584.0)));
        out.insert("indent".to_owned(), Value::Object(indent));
    }
}

/// Space before and after, and line spacing.
fn spacing_keys(p: &ParaProps, out: &mut Map<String, Value>) {
    let spacing = |auto: Option<bool>, value: Option<i32>| {
        if auto == Some(true) {
            Some(Value::from("auto"))
        } else {
            points(value, 0.0, 1584.0).map(num)
        }
    };
    if let Some(before) = spacing(p.before_auto, p.before) {
        out.insert("before".to_owned(), before);
    }
    if let Some(after) = spacing(p.after_auto, p.after) {
        out.insert("after".to_owned(), after);
    }
    if let Some((value, rule)) = &p.line {
        let line = match rule.as_str() {
            "exact" | "atLeast" => {
                Some((rule.as_str(), twips(value.abs()))).filter(|(_, v)| (0.7..=1584.0).contains(v))
            }
            _ => Some(("multiple", (f64::from(*value) / 240.0 * 100.0).round() / 100.0))
                .filter(|(_, v)| (0.06..=132.0).contains(v)),
        };
        if let Some((rule, value)) = line {
            let mut obj = Map::new();
            obj.insert("rule".to_owned(), Value::from(rule));
            obj.insert("value".to_owned(), num(value));
            out.insert("line".to_owned(), Value::Object(obj));
        }
    }
}

/// The keep, break, and widow flags.
fn flag_keys(p: &ParaProps, out: &mut Map<String, Value>) {
    for (key, value) in [
        ("contextual", p.contextual),
        ("keepNext", p.keep_next),
        ("keepLines", p.keep_lines),
        ("breakBefore", p.break_before),
        ("widows", p.widows),
    ] {
        if let Some(value) = value {
            out.insert(key.to_owned(), Value::from(value));
        }
    }
}

/// Tab stops, sorted, each place once.
fn tab_keys(p: &ParaProps, out: &mut Map<String, Value>) {
    if let Some(tabs) = &p.tabs {
        let mut stops: Vec<(f64, Value)> = Vec::new();
        for tab in tabs.iter().take(64) {
            let Some(pos) = points(Some(tab.pos), 0.0, 1584.0) else {
                continue;
            };
            if stops.iter().any(|(p, _)| (*p - pos).abs() < f64::EPSILON) {
                continue;
            }
            let align = match tab.align.as_str() {
                "center" => "center",
                "right" | "end" => "end",
                "decimal" => "decimal",
                "bar" => "bar",
                "clear" => "clear",
                _ => "start",
            };
            let mut obj = Map::new();
            obj.insert("pos".to_owned(), num(pos));
            obj.insert("align".to_owned(), Value::from(align));
            if let Some(leader) = tab.leader.as_deref().filter(|l| LEADERS.contains(l) && *l != "none") {
                obj.insert("leader".to_owned(), Value::from(leader));
            }
            stops.push((pos, Value::Object(obj)));
        }
        stops.sort_by(|a, b| a.0.total_cmp(&b.0));
        if !stops.is_empty() {
            out.insert(
                "tabs".to_owned(),
                Value::Array(stops.into_iter().map(|(_, v)| v).collect()),
            );
        }
    }
}

/// Borders on each side.
fn border_keys(p: &ParaProps, theme: &Theme, out: &mut Map<String, Value>) {
    let mut border = Map::new();
    for (key, side) in ["top", "bottom", "start", "end", "between"].into_iter().zip(&p.borders) {
        if let Some(line) = side.as_ref().and_then(|b| border_line(b, theme)) {
            border.insert(key.to_owned(), line);
        }
    }
    if !border.is_empty() {
        out.insert("border".to_owned(), Value::Object(border));
    }
}

/// Shading.
fn shade_key(p: &ParaProps, theme: &Theme, out: &mut Map<String, Value>) {
    if let Some(shd) = &p.shade {
        let pattern = shd.pattern.as_str();
        let percent = pattern
            .strip_prefix("pct")
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| n <= 95);
        let fill = shd.fill.as_deref().map(pen_name);
        if (SHADE_PATTERNS.contains(&pattern) || percent) && pattern != "nil" && (fill.is_some() || pattern != "clear")
        {
            let mut obj = Map::new();
            if let Some(fill) = fill {
                obj.insert("fill".to_owned(), Value::from(fill));
            }
            obj.insert("pattern".to_owned(), Value::from(pattern));
            if let Some(color) = shd.color.as_ref().and_then(|c| theme.color(c)) {
                obj.insert("color".to_owned(), Value::from(hex(&color)));
            }
            out.insert("shade".to_owned(), Value::Object(obj));
        }
    }
}

/// Direction, language, outline level, drop cap, and hyphenation.
fn other_keys(p: &ParaProps, out: &mut Map<String, Value>) {
    if let Some(bidi) = p.bidi {
        out.insert("dir".to_owned(), Value::from(if bidi { "rtl" } else { "ltr" }));
    }
    if let Some(lang) = p.lang.as_deref().filter(|l| grammar::lang(l)) {
        out.insert("lang".to_owned(), Value::from(lang));
    }
    if let Some(level) = p.outline.filter(|l| *l < 9) {
        out.insert("outline".to_owned(), Value::from(level + 1));
    }
    if let Some((mode, lines, distance)) = &p.drop_cap {
        if matches!(mode.as_str(), "drop" | "margin") {
            let mut obj = Map::new();
            obj.insert("mode".to_owned(), Value::from(mode.as_str()));
            obj.insert("lines".to_owned(), Value::from(lines.unwrap_or(3).clamp(1, 10)));
            obj.insert(
                "distance".to_owned(),
                num(points(*distance, 0.0, 1584.0).unwrap_or(0.0)),
            );
            out.insert("dropCap".to_owned(), Value::Object(obj));
        }
    }
    if let Some(suppress) = p.suppress_hyphens {
        out.insert("hyphenate".to_owned(), Value::from(!suppress));
    }
}

fn border_line(b: &Border, theme: &Theme) -> Option<Value> {
    if matches!(b.style.as_str(), "none" | "nil") {
        return None;
    }
    let style = if BORDER_STYLES.contains(&b.style.as_str()) {
        b.style.as_str()
    } else {
        "single"
    };
    let mut obj = Map::new();
    obj.insert("style".to_owned(), Value::from(style));
    // `w:sz` is in eighths of a point; the width takes steps of 0.125 from 0.25 to 6.
    let width = b.size.map_or(0.5, |s| (f64::from(s) / 8.0).clamp(0.25, 6.0));
    obj.insert("width".to_owned(), num(width));
    obj.insert("space".to_owned(), Value::from(b.space.unwrap_or(1).min(31)));
    if let Some(color) = b.color.as_ref().and_then(|c| theme.color(c)) {
        obj.insert("color".to_owned(), Value::from(pen_name(&color)));
    }
    Some(Value::Object(obj))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    fn keys(xml: &str) -> Value {
        let mut out = Map::new();
        para_keys(&ParaProps::read(&parse(xml)), &Theme::default(), &mut out);
        Value::Object(out)
    }

    #[test]
    fn indents_spacing_and_lines_become_points() {
        // ind left 720 and hanging 360 twips: start 36 points, first line -18 (DESIGN 9.1 in reverse).
        assert_eq!(
            keys(r#"<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>"#),
            serde_json::json!({"indent": {"start": 36, "end": 0, "first": -18}})
        );
        assert_eq!(
            keys(
                r#"<w:pPr><w:jc w:val="both"/>
                    <w:spacing w:before="240" w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>"#
            ),
            serde_json::json!({
                "align": "justify", "before": 12, "after": 8, "line": {"rule": "multiple", "value": 1.15}
            })
        );
        assert_eq!(
            keys(r#"<w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>"#),
            serde_json::json!({"line": {"rule": "exact", "value": 18}})
        );
    }

    #[test]
    fn tabs_borders_and_shading_come_over() {
        let xml = r#"<w:pPr><w:tabs><w:tab w:val="decimal" w:leader="dot" w:pos="2880"/></w:tabs>
            <w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/></w:pBdr>
            <w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/><w:outlineLvl w:val="6"/></w:pPr>"#;
        assert_eq!(
            keys(xml),
            serde_json::json!({
                "tabs": [{"pos": 144, "align": "decimal", "leader": "dot"}],
                "border": {"bottom": {"style": "single", "width": 0.5, "space": 1, "color": "#000000"}},
                "shade": {"fill": "#d9e2f3", "pattern": "clear"},
                "outline": 7
            })
        );
    }
}
