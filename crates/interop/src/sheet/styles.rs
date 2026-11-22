//! Builds `xl/styles.xml` of a workbook (ECMA-376 Part 1, 18.8): number formats, fonts, fills, borders, the cell
//! formats that cells point at, and the differential formats that conditional formats use. Equal parts are kept
//! once, so a workbook of many cells with few looks stays small.

use super::numfmt;
use crate::doc::cell_style::{CellAlign, CellBorder, CellBorders, CellFont, CellStyle, Fill};
use crate::palette::color_hex;

/// The first ID of a custom number format.
const FIRST_CUSTOM: usize = 164;

/// The parts of a style sheet, each written once.
#[derive(Debug)]
pub struct StyleSheet {
    formats: Vec<String>,
    fonts: Vec<String>,
    fills: Vec<String>,
    borders: Vec<String>,
    xfs: Vec<String>,
    dxfs: Vec<String>,
}

impl Default for StyleSheet {
    fn default() -> Self {
        Self {
            formats: Vec::new(),
            fonts: vec!["<font><sz val=\"11\"/><name val=\"Calibri\"/></font>".to_owned()],
            // Excel expects these two fills first.
            fills: vec![
                "<fill><patternFill patternType=\"none\"/></fill>".to_owned(),
                "<fill><patternFill patternType=\"gray125\"/></fill>".to_owned(),
            ],
            borders: vec!["<border><left/><right/><top/><bottom/><diagonal/></border>".to_owned()],
            xfs: vec!["<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>".to_owned()],
            dxfs: Vec::new(),
        }
    }
}

/// The place of `item` in `list`, adding it when it is new.
fn index_of(list: &mut Vec<String>, item: String) -> usize {
    if let Some(at) = list.iter().position(|x| *x == item) {
        return at;
    }
    list.push(item);
    list.len() - 1
}

/// An Excel color with full opacity, such as `FFFDE68A`, or `None` for a color that has no value.
pub fn argb(color: &str) -> Option<String> {
    color_hex(color).map(|hex| format!("FF{hex}"))
}

fn color_element(tag: &str, color: Option<&str>) -> String {
    color
        .and_then(argb)
        .map_or_else(String::new, |rgb| format!("<{tag} rgb=\"{rgb}\"/>"))
}

/// The XML of a font. `whole` adds the size and the name, which a differential format leaves out.
fn font_xml(font: &CellFont, bold: bool, whole: bool) -> String {
    let mut out = String::from("<font>");
    if bold {
        out.push_str("<b/>");
    }
    if font.italic == Some(true) {
        out.push_str("<i/>");
    }
    if font.strike.as_deref().is_some_and(|s| s != "none") {
        out.push_str("<strike/>");
    }
    match font.underline.as_deref() {
        None | Some("none") => {}
        Some(u @ ("double" | "singleAccounting" | "doubleAccounting")) => out.push_str(&format!("<u val=\"{u}\"/>")),
        Some(_) => out.push_str("<u/>"),
    }
    match font.script.as_deref() {
        Some("super") => out.push_str("<vertAlign val=\"superscript\"/>"),
        Some("sub") => out.push_str("<vertAlign val=\"subscript\"/>"),
        _ => {}
    }
    if whole || font.size.is_some() {
        out.push_str(&format!("<sz val=\"{}\"/>", font.size.unwrap_or(11.0)));
    }
    out.push_str(&color_element("color", font.color.as_deref()));
    let family = font.family.as_deref().filter(|f| !f.starts_with('+') && !f.is_empty());
    if whole || family.is_some() {
        out.push_str(&format!("<name val=\"{}\"/>", escape(family.unwrap_or("Calibri"))));
    }
    out.push_str("</font>");
    out
}

fn is_bold(font: &CellFont, header: bool) -> bool {
    match (font.weight, font.bold) {
        (Some(w), _) => w >= 600,
        (None, Some(b)) => b,
        (None, None) => header,
    }
}

/// The XML of a fill. A differential format puts a solid color in `bgColor`, as Excel reads it there.
fn fill_xml(fill: &Fill, differential: bool) -> Option<String> {
    Some(match fill {
        Fill::None => return None,
        Fill::Color(c) => {
            let rgb = argb(c)?;
            if differential {
                format!("<fill><patternFill patternType=\"solid\"><fgColor rgb=\"{rgb}\"/><bgColor rgb=\"{rgb}\"/></patternFill></fill>")
            } else {
                format!("<fill><patternFill patternType=\"solid\"><fgColor rgb=\"{rgb}\"/><bgColor indexed=\"64\"/></patternFill></fill>")
            }
        }
        Fill::Pattern { pattern, color, back } => format!(
            "<fill><patternFill patternType=\"{}\">{}{}</patternFill></fill>",
            escape(pattern),
            color_element("fgColor", color.as_deref()),
            color_element("bgColor", back.as_deref())
        ),
        Fill::Gradient { angle, stops } => {
            let stops: String = stops
                .iter()
                .filter_map(|(at, c)| Some(format!("<stop position=\"{at}\"><color rgb=\"{}\"/></stop>", argb(c)?)))
                .collect();
            format!("<fill><gradientFill degree=\"{angle}\">{stops}</gradientFill></fill>")
        }
    })
}

fn side_xml(tag: &str, side: Option<&CellBorder>) -> String {
    match side.filter(|s| s.style != "none") {
        None => format!("<{tag}/>"),
        Some(s) => {
            let color = s.color.as_deref().and_then(argb).map_or_else(
                || "<color auto=\"1\"/>".to_owned(),
                |rgb| format!("<color rgb=\"{rgb}\"/>"),
            );
            format!("<{tag} style=\"{}\">{color}</{tag}>", escape(&s.style))
        }
    }
}

fn border_xml(b: &CellBorders) -> Option<String> {
    let any = [&b.top, &b.right, &b.bottom, &b.left, &b.diagonal_up, &b.diagonal_down]
        .iter()
        .any(|s| s.as_ref().is_some_and(|s| s.style != "none"));
    if !any {
        return None;
    }
    fn live(s: &Option<CellBorder>) -> Option<&CellBorder> {
        s.as_ref().filter(|s| s.style != "none")
    }
    let up = live(&b.diagonal_up);
    let down = live(&b.diagonal_down);
    let mut out = String::from("<border");
    if up.is_some() {
        out.push_str(" diagonalUp=\"1\"");
    }
    if down.is_some() {
        out.push_str(" diagonalDown=\"1\"");
    }
    out.push('>');
    out.push_str(&side_xml("left", b.left.as_ref()));
    out.push_str(&side_xml("right", b.right.as_ref()));
    out.push_str(&side_xml("top", b.top.as_ref()));
    out.push_str(&side_xml("bottom", b.bottom.as_ref()));
    out.push_str(&side_xml("diagonal", up.or(down)));
    out.push_str("</border>");
    Some(out)
}

/// The `alignment` element, or nothing when every property is the default.
fn alignment_xml(a: &CellAlign, wrap_lines: bool) -> String {
    let mut attrs = String::new();
    let horizontal = match a.horizontal.as_deref() {
        Some("centerAcross") => Some("centerContinuous"),
        Some("general") | None => None,
        Some(h) => Some(h),
    };
    if let Some(h) = horizontal {
        attrs.push_str(&format!(" horizontal=\"{}\"", escape(h)));
    }
    let vertical = match a.vertical.as_deref() {
        Some("middle") => Some("center"),
        None if wrap_lines => Some("top"),
        v => v,
    };
    if let Some(v) = vertical {
        attrs.push_str(&format!(" vertical=\"{}\"", escape(v)));
    }
    let rotation = if a.stacked {
        Some(255)
    } else {
        a.rotate.map(|r| if r >= 0 { r } else { 90 - r })
    };
    if let Some(r) = rotation.filter(|r| *r != 0) {
        attrs.push_str(&format!(" textRotation=\"{r}\""));
    }
    let wrap = match a.wrap.as_deref() {
        Some("wrap") => true,
        Some(_) => false,
        None => wrap_lines,
    };
    if wrap {
        attrs.push_str(" wrapText=\"1\"");
    }
    if let Some(i) = a.indent.filter(|i| *i > 0) {
        attrs.push_str(&format!(" indent=\"{i}\""));
    }
    if a.shrink == Some(true) {
        attrs.push_str(" shrinkToFit=\"1\"");
    }
    match a.dir.as_deref() {
        Some("ltr") => attrs.push_str(" readingOrder=\"1\""),
        Some("rtl") => attrs.push_str(" readingOrder=\"2\""),
        _ => {}
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<alignment{attrs}/>")
    }
}

impl StyleSheet {
    /// The ID of a number format code: a built-in ID, or a custom format added here.
    fn format_id(&mut self, code: Option<&str>) -> usize {
        let Some(code) = code.filter(|c| !c.is_empty()) else {
            return 0;
        };
        match numfmt::built_in_id(code) {
            Some(id) => id as usize,
            None => FIRST_CUSTOM + index_of(&mut self.formats, code.to_owned()),
        }
    }

    /// The cell format of a cell, as its index in `cellXfs`. `header` makes the font bold unless the style says
    /// otherwise; `wrap_lines` wraps a cell with line breaks at the top unless the style says otherwise.
    pub fn cell(&mut self, style: Option<&CellStyle>, fmt: Option<&str>, header: bool, wrap_lines: bool) -> usize {
        let fallback = CellStyle::default();
        let style = style.unwrap_or(&fallback);
        let format = self.format_id(fmt);
        let font = index_of(
            &mut self.fonts,
            font_xml(&style.font, is_bold(&style.font, header), true),
        );
        let fill = style
            .fill
            .as_ref()
            .and_then(|f| fill_xml(f, false))
            .map_or(0, |xml| index_of(&mut self.fills, xml));
        let border = border_xml(&style.border).map_or(0, |xml| index_of(&mut self.borders, xml));
        let align = alignment_xml(&style.align, wrap_lines);
        let mut xf =
            format!("<xf numFmtId=\"{format}\" fontId=\"{font}\" fillId=\"{fill}\" borderId=\"{border}\" xfId=\"0\"");
        for (on, name) in [
            (format != 0, "applyNumberFormat"),
            (font != 0, "applyFont"),
            (fill != 0, "applyFill"),
            (border != 0, "applyBorder"),
            (!align.is_empty(), "applyAlignment"),
        ] {
            if on {
                xf.push_str(&format!(" {name}=\"1\""));
            }
        }
        if align.is_empty() {
            xf.push_str("/>");
        } else {
            xf.push_str(&format!(">{align}</xf>"));
        }
        index_of(&mut self.xfs, xf)
    }

    /// The differential format of a conditional format's style, as its index in `dxfs`.
    pub fn dxf(&mut self, style: &CellStyle, fmt: Option<&str>) -> usize {
        let mut out = String::from("<dxf>");
        let font = &style.font;
        let bold = match (font.weight, font.bold) {
            (Some(w), _) => w >= 600,
            (None, b) => b == Some(true),
        };
        let font_part = font_xml(font, bold, false);
        if font_part != "<font></font>" {
            out.push_str(&font_part);
        }
        if let Some(code) = fmt.filter(|c| !c.is_empty()) {
            let id = self.format_id(Some(code));
            out.push_str(&format!("<numFmt numFmtId=\"{id}\" formatCode=\"{}\"/>", escape(code)));
        }
        if let Some(fill) = style.fill.as_ref().and_then(|f| fill_xml(f, true)) {
            out.push_str(&fill);
        }
        if let Some(border) = border_xml(&style.border) {
            out.push_str(&border);
        }
        out.push_str("</dxf>");
        index_of(&mut self.dxfs, out)
    }

    /// The whole `xl/styles.xml` part.
    pub fn xml(&self) -> String {
        let mut out = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
             <styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
        );
        if !self.formats.is_empty() {
            out.push_str(&format!("<numFmts count=\"{}\">", self.formats.len()));
            for (i, code) in self.formats.iter().enumerate() {
                out.push_str(&format!(
                    "<numFmt numFmtId=\"{}\" formatCode=\"{}\"/>",
                    FIRST_CUSTOM + i,
                    escape(code)
                ));
            }
            out.push_str("</numFmts>");
        }
        for (tag, list) in [
            ("fonts", &self.fonts),
            ("fills", &self.fills),
            ("borders", &self.borders),
        ] {
            out.push_str(&format!("<{tag} count=\"{}\">{}</{tag}>", list.len(), list.concat()));
        }
        out.push_str(
            "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>",
        );
        out.push_str(&format!(
            "<cellXfs count=\"{}\">{}</cellXfs>",
            self.xfs.len(),
            self.xfs.concat()
        ));
        out.push_str("<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>");
        out.push_str(&format!(
            "<dxfs count=\"{}\">{}</dxfs>",
            self.dxfs.len(),
            self.dxfs.concat()
        ));
        out.push_str("</styleSheet>");
        out
    }
}

/// Text for an XML attribute or element.
pub fn escape(text: &str) -> String {
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
mod tests;
