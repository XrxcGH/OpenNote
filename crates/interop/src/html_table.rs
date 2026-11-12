//! A table of the document tree as HTML. Cells carry the look the table's sheet gives them (fill, borders,
//! alignment, padding, and font), merged cells carry `colspan` and `rowspan`, and the cells a merge covers are left
//! out. A table without sheet data is written as it always was.

use crate::doc::cell_style::{CellBorder, CellStyle, Fill};
use crate::doc::Inline;
use crate::html::{escape, inlines_html};
use crate::palette::color_hex;
use crate::sheet::Merge;

/// A color value as `#rrggbb`, or `None` outside the grammar.
fn color(value: &str) -> Option<String> {
    color_hex(value).map(|hex| format!("#{}", hex.trim_start_matches('#').to_lowercase()))
}

fn number(n: f64) -> String {
    let text = format!("{:.2}", (n * 100.0).round() / 100.0);
    text.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// The CSS width, line, and name of one of the 13 border styles.
fn line(style: &str) -> (f64, &'static str) {
    match style {
        "dotted" => (1.0, "dotted"),
        "dashed" | "dashDot" | "dashDotDot" => (1.0, "dashed"),
        "mediumDashed" | "mediumDashDot" | "mediumDashDotDot" | "slantDashDot" => (2.0, "dashed"),
        "medium" => (2.0, "solid"),
        "thick" => (3.0, "solid"),
        "double" => (3.0, "double"),
        _ => (1.0, "solid"),
    }
}

fn border(name: &str, side: &Option<CellBorder>, css: &mut Vec<String>) {
    let Some(side) = side else { return };
    if side.style == "none" {
        css.push(format!("border-{name}:none"));
        return;
    }
    let (width, kind) = line(&side.style);
    let size = side
        .width
        .map_or_else(|| format!("{}px", number(width)), |w| format!("{}pt", number(w)));
    let paint = side
        .color
        .as_deref()
        .and_then(color)
        .unwrap_or_else(|| "currentcolor".to_owned());
    css.push(format!("border-{name}:{size} {kind} {paint}"));
}

/// The CSS of a cell's resolved style, leaving out what the defaults already give.
pub fn cell_css(style: &CellStyle) -> String {
    let mut css = Vec::new();
    let font = &style.font;
    if let Some(family) = font
        .family
        .as_deref()
        .filter(|f| !f.starts_with('+') && !f.starts_with("theme:"))
    {
        let clean: String = family.chars().filter(|c| !";\"'<>{}".contains(*c)).collect();
        css.push(format!("font-family:{clean}"));
    }
    if let Some(size) = font.size {
        css.push(format!("font-size:{}pt", number(size)));
    }
    match (font.weight, font.bold) {
        (Some(weight), _) => css.push(format!("font-weight:{weight}")),
        (None, Some(bold)) => css.push(format!("font-weight:{}", if bold { 700 } else { 400 })),
        _ => {}
    }
    if let Some(italic) = font.italic {
        css.push(format!("font-style:{}", if italic { "italic" } else { "normal" }));
    }
    let mut lines = Vec::new();
    if font.underline.as_deref().is_some_and(|u| u != "none") {
        lines.push("underline");
    }
    if font.strike.as_deref().is_some_and(|s| s != "none") {
        lines.push("line-through");
    }
    if !lines.is_empty() {
        css.push(format!("text-decoration:{}", lines.join(" ")));
    }
    if let Some(text) = font.color.as_deref().and_then(color) {
        css.push(format!("color:{text}"));
    }
    match font.script.as_deref() {
        Some("super") => css.push("vertical-align:super;font-size:smaller".to_owned()),
        Some("sub") => css.push("vertical-align:sub;font-size:smaller".to_owned()),
        _ => {}
    }
    match &style.fill {
        Some(Fill::Color(value)) => {
            if let Some(c) = color(value) {
                css.push(format!("background-color:{c}"));
            }
        }
        Some(Fill::Pattern { color: front, back, .. }) => {
            if let Some(c) = back
                .as_deref()
                .and_then(color)
                .or_else(|| front.as_deref().and_then(color))
            {
                css.push(format!("background-color:{c}"));
            }
        }
        Some(Fill::Gradient { angle, stops }) => {
            let stops: Vec<String> = stops
                .iter()
                .filter_map(|(at, c)| Some(format!("{} {}%", color(c)?, number(at * 100.0))))
                .collect();
            if stops.len() >= 2 {
                css.push(format!(
                    "background-image:linear-gradient({angle}deg,{})",
                    stops.join(",")
                ));
            }
        }
        Some(Fill::None) | None => {}
    }
    border("top", &style.border.top, &mut css);
    border("right", &style.border.right, &mut css);
    border("bottom", &style.border.bottom, &mut css);
    border("left", &style.border.left, &mut css);
    let align = &style.align;
    if let Some(h @ ("left" | "center" | "right" | "justify")) = align.horizontal.as_deref() {
        css.push(format!("text-align:{h}"));
    }
    if let Some(v @ ("middle" | "bottom")) = align.vertical.as_deref() {
        css.push(format!("vertical-align:{v}"));
    }
    if matches!(align.wrap.as_deref(), Some("clip" | "overflow")) {
        css.push("white-space:nowrap".to_owned());
    }
    let pad = (
        style.pad.top.unwrap_or(2.0),
        style.pad.right.unwrap_or(4.0),
        style.pad.bottom.unwrap_or(2.0),
        style.pad.left.unwrap_or(4.0) + f64::from(align.indent.unwrap_or(0)) * 9.0,
    );
    if pad != (2.0, 4.0, 2.0, 4.0) {
        css.push(format!(
            "padding:{}pt {}pt {}pt {}pt",
            number(pad.0),
            number(pad.1),
            number(pad.2),
            number(pad.3)
        ));
    }
    css.join(";")
}

/// The table as HTML. `styles`, `merges`, and `widths` may be empty.
pub fn table_html(
    header: bool,
    rows: &[Vec<Vec<Inline>>],
    styles: &[Vec<Option<CellStyle>>],
    merges: &[Merge],
    widths: &[u32],
) -> String {
    let mut out = String::from("<table>\n");
    if !widths.is_empty() {
        out.push_str("<colgroup>");
        for width in widths {
            out.push_str(&format!("<col style=\"width:{width}px\">"));
        }
        out.push_str("</colgroup>\n");
    }
    for (r, row) in rows.iter().enumerate() {
        let head = header && r == 0;
        let tag = if head { "th" } else { "td" };
        out.push_str("<tr>");
        for (c, cell) in row.iter().enumerate() {
            if merges.iter().any(|m| m.covers(r, c)) {
                continue;
            }
            let mut attrs = String::new();
            if let Some(m) = merges.iter().find(|m| m.top == r && m.left == c) {
                if m.right > m.left {
                    attrs.push_str(&format!(" colspan=\"{}\"", m.right - m.left + 1));
                }
                if m.bottom > m.top {
                    attrs.push_str(&format!(" rowspan=\"{}\"", m.bottom - m.top + 1));
                }
            }
            let css = styles
                .get(r)
                .and_then(|row| row.get(c))
                .and_then(Option::as_ref)
                .map(cell_css)
                .unwrap_or_default();
            if !css.is_empty() {
                attrs.push_str(&format!(" style=\"{}\"", escape(&css)));
            }
            out.push_str(&format!("<{tag}{attrs}>{}</{tag}>", inlines_html(cell)));
        }
        out.push_str("</tr>\n");
    }
    out.push_str("</table>\n");
    out
}

#[cfg(test)]
mod tests;
