//! Paragraph properties (`w:pPr`, ECMA-376 Part 1, 17.3.1): every `data.paras` key of DESIGN 2.3, in the
//! order the schema's sequence wants them.

use super::parts::xml_escape;
use super::units::{eighths, line_240ths, twips};
use crate::doc::data::{BorderLine, LineSpacing, Para, Spacing};
use crate::palette::color_hex;

/// The shading of a callout, and the rule of a divider.
pub const CALLOUT_FILL: &str = "F4F0EA";

/// What a paragraph's properties are made of.
#[derive(Clone, Debug, Default)]
pub struct ParaProps<'a> {
    /// The style ID, such as `Heading1`.
    pub style: Option<String>,
    /// `(numId, ilvl)` for a list item.
    pub num: Option<(usize, u32)>,
    /// The paragraph's own formatting.
    pub para: Option<&'a Para>,
    /// A shaded background from the frame, such as a callout. The paragraph's `shade` wins.
    pub frame_shade: bool,
    /// A left indent from the frame in twips, such as the body of a list item. The paragraph's indent wins.
    pub frame_indent: u32,
    /// A `w:framePr`, for a drop cap.
    pub frame_pr: Option<String>,
    /// Whether the paragraph belongs to a section with a different setup: a `w:sectPr` that ends it.
    pub sect: Option<String>,
    /// The properties of the paragraph mark, such as an inserted paragraph mark.
    pub mark: String,
}

impl ParaProps<'_> {
    /// `w:pPr`, or nothing when the paragraph has no properties.
    pub fn xml(&self) -> String {
        let para = self.para.cloned().unwrap_or_default();
        let mut out = self.head(&para);
        out.push_str(&borders(&para));
        out.push_str(&self.shading(&para));
        out.push_str(&tabs(&para));
        out.push_str(&hyphens_and_direction(&para));
        out.push_str(&spacing(&para));
        out.push_str(&self.indent(&para));
        flag(&mut out, "contextualSpacing", para.contextual);
        out.push_str(&alignment_and_outline(&para));
        out.push_str(&self.tail(&para));
        if out.is_empty() {
            out
        } else {
            format!("<w:pPr>{out}</w:pPr>")
        }
    }

    /// The style, the keep and break flags, the frame, widow control, and the list.
    fn head(&self, para: &Para) -> String {
        let mut out = String::new();
        if let Some(style) = &self.style {
            out.push_str(&format!("<w:pStyle w:val=\"{}\"/>", xml_escape(style)));
        }
        flag(&mut out, "keepNext", para.keep_next);
        flag(&mut out, "keepLines", para.keep_lines);
        flag(&mut out, "pageBreakBefore", para.break_before);
        if let Some(frame) = &self.frame_pr {
            out.push_str(frame);
        }
        flag(&mut out, "widowControl", para.widows);
        if let Some((id, level)) = self.num {
            out.push_str(&format!(
                "<w:numPr><w:ilvl w:val=\"{level}\"/><w:numId w:val=\"{id}\"/></w:numPr>"
            ));
        }
        out
    }

    /// The paragraph's shading, or the frame's.
    fn shading(&self, para: &Para) -> String {
        let hex = |color: &Option<String>| {
            color
                .as_deref()
                .and_then(color_hex)
                .unwrap_or_else(|| "auto".to_owned())
        };
        match &para.shade {
            Some(shade) => format!(
                "<w:shd w:val=\"{}\" w:color=\"{}\" w:fill=\"{}\"/>",
                xml_escape(&shade.pattern),
                hex(&shade.color),
                hex(&shade.fill)
            ),
            None if self.frame_shade => format!("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{CALLOUT_FILL}\"/>"),
            None => String::new(),
        }
    }

    /// The paragraph's indent, or the frame's.
    fn indent(&self, para: &Para) -> String {
        let Some(indent) = para.indent else {
            return if self.frame_indent > 0 && self.num.is_none() {
                format!("<w:ind w:left=\"{}\"/>", self.frame_indent)
            } else {
                String::new()
            };
        };
        let mut ind = format!("<w:ind w:left=\"{}\"", twips(indent.start));
        if indent.end != 0.0 {
            ind.push_str(&format!(" w:right=\"{}\"", twips(indent.end)));
        }
        if indent.first > 0.0 {
            ind.push_str(&format!(" w:firstLine=\"{}\"", twips(indent.first)));
        } else if indent.first < 0.0 {
            ind.push_str(&format!(" w:hanging=\"{}\"", twips(-indent.first)));
        }
        ind.push_str("/>");
        ind
    }

    /// The paragraph mark's properties, then the section the paragraph ends.
    fn tail(&self, para: &Para) -> String {
        let mut out = String::new();
        let mut mark = self.mark.clone();
        match para.lang.as_deref() {
            Some("zxx") => mark.push_str("<w:noProof/>"),
            Some(lang) => mark.push_str(&format!("<w:lang w:val=\"{}\"/>", xml_escape(lang))),
            None => {}
        }
        if !mark.is_empty() {
            out.push_str(&format!("<w:rPr>{mark}</w:rPr>"));
        }
        if let Some(sect) = &self.sect {
            out.push_str(sect);
        }
        out
    }
}

/// Hyphenation and the paragraph's direction.
fn hyphens_and_direction(para: &Para) -> String {
    let mut out = String::new();
    match para.hyphenate {
        Some(true) => out.push_str("<w:suppressAutoHyphens w:val=\"0\"/>"),
        Some(false) => out.push_str("<w:suppressAutoHyphens/>"),
        None => {}
    }
    match para.dir.as_deref() {
        Some("rtl") => out.push_str("<w:bidi/>"),
        Some("ltr") => out.push_str("<w:bidi w:val=\"0\"/>"),
        _ => {}
    }
    out
}

/// The alignment and the outline level.
fn alignment_and_outline(para: &Para) -> String {
    let mut out = String::new();
    if let Some(align) = para.align.as_deref() {
        let jc = match align {
            "start" => "left",
            "end" => "right",
            "justify" => "both",
            other => other,
        };
        out.push_str(&format!("<w:jc w:val=\"{jc}\"/>"));
    }
    if let Some(level) = para.outline {
        out.push_str(&format!("<w:outlineLvl w:val=\"{}\"/>", level.saturating_sub(1)));
    }
    out
}

fn flag(out: &mut String, name: &str, value: Option<bool>) {
    match value {
        Some(true) => out.push_str(&format!("<w:{name}/>")),
        Some(false) => out.push_str(&format!("<w:{name} w:val=\"0\"/>")),
        None => {}
    }
}

/// `w:pBdr`: top, left, bottom, right, and between, in the schema's order.
fn borders(para: &Para) -> String {
    let Some(border) = &para.border else {
        return String::new();
    };
    let sides = [
        ("top", &border.top),
        ("left", &border.start),
        ("bottom", &border.bottom),
        ("right", &border.end),
        ("between", &border.between),
    ];
    let inner: String = sides
        .iter()
        .filter_map(|(side, line)| line.as_ref().map(|line| border_line(side, line)))
        .collect();
    if inner.is_empty() {
        inner
    } else {
        format!("<w:pBdr>{inner}</w:pBdr>")
    }
}

/// One border: its width in eighths of a point and its space in points.
pub fn border_line(side: &str, line: &BorderLine) -> String {
    let color = line
        .color
        .as_deref()
        .and_then(color_hex)
        .unwrap_or_else(|| "auto".to_owned());
    format!(
        "<w:{side} w:val=\"{}\" w:sz=\"{}\" w:space=\"{}\" w:color=\"{color}\"/>",
        xml_escape(&line.style),
        eighths(line.width),
        line.space
    )
}

fn tabs(para: &Para) -> String {
    if para.tabs.is_empty() {
        return String::new();
    }
    let mut out = "<w:tabs>".to_owned();
    for tab in &para.tabs {
        let val = match tab.align.as_str() {
            "start" => "left",
            "end" => "right",
            other => other,
        };
        let leader = if tab.leader == "none" {
            String::new()
        } else {
            format!(" w:leader=\"{}\"", xml_escape(&tab.leader))
        };
        out.push_str(&format!(
            "<w:tab w:val=\"{}\"{leader} w:pos=\"{}\"/>",
            xml_escape(val),
            twips(tab.pos)
        ));
    }
    out.push_str("</w:tabs>");
    out
}

/// `w:spacing`: space before and after, and line spacing.
fn spacing(para: &Para) -> String {
    let mut attrs = String::new();
    match para.before {
        Some(Spacing::Points(points)) => attrs.push_str(&format!(" w:before=\"{}\"", twips(points))),
        Some(Spacing::Auto) => attrs.push_str(" w:beforeAutospacing=\"1\""),
        None => {}
    }
    match para.after {
        Some(Spacing::Points(points)) => attrs.push_str(&format!(" w:after=\"{}\"", twips(points))),
        Some(Spacing::Auto) => attrs.push_str(" w:afterAutospacing=\"1\""),
        None => {}
    }
    match para.line {
        Some(LineSpacing::Multiple(multiple)) => {
            attrs.push_str(&format!(" w:line=\"{}\" w:lineRule=\"auto\"", line_240ths(multiple)))
        }
        Some(LineSpacing::Exact(points)) => {
            attrs.push_str(&format!(" w:line=\"{}\" w:lineRule=\"exact\"", twips(points)));
        }
        Some(LineSpacing::AtLeast(points)) => {
            attrs.push_str(&format!(" w:line=\"{}\" w:lineRule=\"atLeast\"", twips(points)));
        }
        None => {}
    }
    if attrs.is_empty() {
        attrs
    } else {
        format!("<w:spacing{attrs}/>")
    }
}

/// `w:framePr` of a drop cap: the letter sits in a frame `lines` lines tall, `distance` points from the text.
pub fn drop_cap_frame(mode: &str, lines: u8, distance: f64) -> String {
    let mode = if mode == "margin" { "margin" } else { "drop" };
    format!(
        "<w:framePr w:dropCap=\"{mode}\" w:lines=\"{lines}\" w:hSpace=\"{}\" w:wrap=\"around\" \
         w:vAnchor=\"text\" w:hAnchor=\"text\"/>",
        twips(distance)
    )
}
