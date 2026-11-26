//! A table as WordprocessingML: the grid, merged cells (`w:gridSpan` and `w:vMerge`), and the look the table's
//! sheet gives each cell: shading (`w:shd`), borders (`w:tcBorders`), vertical alignment (`w:vAlign`), margins
//! (`w:tcMar`), alignment of the paragraph, and the font of the runs.

use super::runs::State;
use super::units::{eighths, page_twips, twips};
use crate::doc::cell_style::{CellBorder, CellStyle, Fill};
use crate::doc::{Inline, Marks};
use crate::palette::color_hex;
use crate::sheet::{Merge, MergeIndex, Slot};

/// The width of the text area of a Letter page, in twentieths of a point.
pub(super) const TEXT_WIDTH: usize = 9_360;

/// A color as six hexadecimal digits in capitals.
fn hex(value: &str) -> Option<String> {
    color_hex(value).map(|h| h.trim_start_matches('#').to_uppercase())
}

/// The `w:val`, `w:sz` in eighths of a point, and the color of a Word border for a border of the sheet.
fn word_border(side: &CellBorder) -> (&'static str, i64) {
    match side.style.as_str() {
        "none" => ("nil", 0),
        "hair" => ("single", 2),
        "dotted" => ("dotted", 4),
        "dashed" => ("dashed", 4),
        "dashDot" => ("dotDash", 4),
        "dashDotDot" => ("dotDotDash", 4),
        "medium" => ("single", 12),
        "mediumDashed" => ("dashed", 12),
        "mediumDashDot" => ("dotDash", 12),
        "mediumDashDotDot" => ("dotDotDash", 12),
        "slantDashDot" => ("dashDotStroked", 12),
        "thick" => ("single", 18),
        "double" => ("double", 6),
        _ => ("single", 4),
    }
}

fn border_xml(tag: &str, side: &Option<CellBorder>) -> String {
    let Some(side) = side else { return String::new() };
    let (val, size) = word_border(side);
    if val == "nil" {
        return format!("<w:{tag} w:val=\"nil\"/>");
    }
    let size = side.width.map_or(size, |w| eighths(w).clamp(2, 96));
    let paint = side.color.as_deref().and_then(hex).unwrap_or_else(|| "auto".to_owned());
    format!("<w:{tag} w:val=\"{val}\" w:sz=\"{size}\" w:space=\"0\" w:color=\"{paint}\"/>")
}

/// The shading color of a fill, when it has one.
fn shade(fill: &Fill) -> Option<String> {
    match fill {
        Fill::Color(c) => hex(c),
        Fill::Pattern { back, color, .. } => back.as_deref().and_then(hex).or_else(|| color.as_deref().and_then(hex)),
        Fill::Gradient { stops, .. } => stops.first().and_then(|(_, c)| hex(c)),
        Fill::None => None,
    }
}

/// The cell's `w:tcPr` children after the width, grid span, and vertical merge, in schema order.
fn cell_props(style: &CellStyle) -> String {
    let mut out = String::new();
    let b = &style.border;
    let sides = [
        border_xml("top", &b.top),
        border_xml("left", &b.left),
        border_xml("bottom", &b.bottom),
        border_xml("right", &b.right),
        border_xml("tl2br", &b.diagonal_down),
        border_xml("tr2bl", &b.diagonal_up),
    ]
    .concat();
    if !sides.is_empty() {
        out.push_str(&format!("<w:tcBorders>{sides}</w:tcBorders>"));
    }
    if let Some(fill) = style.fill.as_ref().and_then(shade) {
        out.push_str(&format!("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{fill}\"/>"));
    }
    if matches!(style.align.wrap.as_deref(), Some("clip" | "overflow")) {
        out.push_str("<w:noWrap/>");
    }
    let pad = [style.pad.top, style.pad.left, style.pad.bottom, style.pad.right];
    if pad.iter().any(Option::is_some) {
        let side = |tag: &str, v: Option<f64>, default: f64| {
            format!("<w:{tag} w:w=\"{}\" w:type=\"dxa\"/>", twips(v.unwrap_or(default)))
        };
        out.push_str(&format!(
            "<w:tcMar>{}{}{}{}</w:tcMar>",
            side("top", style.pad.top, 2.0),
            side("left", style.pad.left, 4.0),
            side("bottom", style.pad.bottom, 2.0),
            side("right", style.pad.right, 4.0)
        ));
    }
    match style.align.vertical.as_deref() {
        Some("middle") => out.push_str("<w:vAlign w:val=\"center\"/>"),
        Some("bottom") => out.push_str("<w:vAlign w:val=\"bottom\"/>"),
        _ => {}
    }
    out
}

/// The paragraph properties of a cell: alignment and indent.
fn para_props(style: &CellStyle) -> String {
    let indent = style.align.indent.filter(|n| *n > 0).map_or(String::new(), |n| {
        format!("<w:ind w:left=\"{}\"/>", twips(f64::from(n) * 9.0))
    });
    let jc = match style.align.horizontal.as_deref() {
        Some("left") => "<w:jc w:val=\"left\"/>",
        Some("center") => "<w:jc w:val=\"center\"/>",
        Some("right") => "<w:jc w:val=\"right\"/>",
        Some("justify") => "<w:jc w:val=\"both\"/>",
        _ => "",
    };
    if indent.is_empty() && jc.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{indent}{jc}</w:pPr>")
    }
}

/// The cell's runs with the font of its style under their own marks (`R-SHT-9`: the marks of the runs win).
fn styled(content: &[Inline], style: Option<&CellStyle>) -> Vec<Inline> {
    let Some(font) = style.map(|s| &s.font) else {
        return content.to_vec();
    };
    content
        .iter()
        .map(|inline| match inline {
            Inline::Text { text, marks } => {
                let mut m: Marks = marks.clone();
                if font.weight.is_some_and(|w| w >= 600) || font.bold == Some(true) {
                    m.strong = true;
                }
                if font.italic == Some(true) {
                    m.emphasis = true;
                }
                if font.strike.as_deref().is_some_and(|s| s != "none") {
                    m.strike = true;
                }
                if font.underline.as_deref().is_some_and(|u| u != "none") {
                    m.underline = true;
                }
                if m.color.is_none() {
                    m.color.clone_from(&font.color);
                }
                if m.font.is_none() {
                    m.font = font
                        .family
                        .clone()
                        .filter(|f| !f.starts_with('+') && !f.starts_with("theme:"));
                }
                if m.size.is_none() {
                    m.size = font.size.map(|s| format!("{s}"));
                }
                Inline::Text {
                    text: text.clone(),
                    marks: m,
                }
            }
            other => other.clone(),
        })
        .collect()
}

impl State<'_> {
    /// A table. Without styles, merges, and widths it is the plain table it always was.
    pub(super) fn table(
        &mut self,
        header: bool,
        rows: &[Vec<Vec<Inline>>],
        styles: &[Vec<Option<CellStyle>>],
        merges: &[Merge],
        widths: &[u32],
    ) -> String {
        let columns = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let even = TEXT_WIDTH / columns;
        let mut grid: Vec<usize> = (0..columns)
            .map(|c| {
                widths
                    .get(c)
                    .map_or(even, |w| usize::try_from(page_twips(f64::from(*w))).unwrap_or(even))
            })
            .collect();
        let total: usize = grid.iter().sum();
        if total > TEXT_WIDTH {
            grid = grid.iter().map(|w| w * TEXT_WIDTH / total).collect();
        }
        let border = |side: &str| format!("<w:{side} w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"C9C2B8\"/>");
        let borders: String = ["top", "left", "bottom", "right", "insideH", "insideV"]
            .iter()
            .map(|s| border(s))
            .collect();
        let mut out = format!(
            "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>\
             <w:tblGrid>"
        );
        for w in &grid {
            out.push_str(&format!("<w:gridCol w:w=\"{w}\"/>"));
        }
        out.push_str("</w:tblGrid>");
        let index = MergeIndex::new(merges, rows.len(), columns);
        for (r, row) in rows.iter().enumerate() {
            let head = header && r == 0;
            out.push_str(if head {
                "<w:tr><w:trPr><w:tblHeader/></w:trPr>"
            } else {
                "<w:tr>"
            });
            for c in 0..columns {
                let slot = index.slot(r, c);
                // A cell below an anchor continues its vertical merge; one beside it is inside the grid span.
                if let Some(Slot::Covered(m)) = slot {
                    if c != m.left {
                        continue;
                    }
                    let span = span_of(&m, &grid);
                    out.push_str(&format!(
                        "<w:tc><w:tcPr><w:tcW w:w=\"{}\" w:type=\"dxa\"/>{}<w:vMerge/></w:tcPr><w:p/></w:tc>",
                        span.0, span.1
                    ));
                    continue;
                }
                let anchor = match slot {
                    Some(Slot::Anchor(m)) => Some(m),
                    _ => None,
                };
                let (width, grid_span) = anchor.map_or((grid[c], String::new()), |m| span_of(&m, &grid));
                let restart = anchor
                    .filter(|m| m.bottom > m.top)
                    .map_or("", |_| "<w:vMerge w:val=\"restart\"/>");
                let style = styles.get(r).and_then(|row| row.get(c)).and_then(Option::as_ref);
                let props = style.map(cell_props).unwrap_or_default();
                let para = style.map(para_props).unwrap_or_default();
                let cell = row.get(c).map_or(&[][..], Vec::as_slice);
                let runs = self.runs(&styled(cell, style), head);
                out.push_str(&format!(
                    "<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/>{grid_span}{restart}{props}</w:tcPr>\
                     <w:p>{para}{runs}</w:p></w:tc>"
                ));
            }
            out.push_str("</w:tr>");
        }
        out.push_str("</w:tbl><w:p/>");
        out
    }
}

/// The width of a merge's columns and its `w:gridSpan`, which is empty for a merge one column wide.
fn span_of(m: &Merge, grid: &[usize]) -> (usize, String) {
    let width = grid[m.left..=m.right.min(grid.len() - 1)].iter().sum();
    let span = if m.right > m.left {
        format!("<w:gridSpan w:val=\"{}\"/>", m.right - m.left + 1)
    } else {
        String::new()
    };
    (width, span)
}
