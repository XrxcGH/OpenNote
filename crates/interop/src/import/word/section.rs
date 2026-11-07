//! Page setup: the paper and margins of the document's first section, and its header and footer as print bands
//! (`R-PRN-1`). Also the document settings that become `view.text` (spec 5.4.2).

use serde_json::{Map, Value};

use super::styles::{child, children, val};
use super::values::{num, twips};
use crate::import::xmltree::{Element, Node};
use opennote_core::model::{Named, Orientation, Paper, PaperSize};

/// The most characters one part of a band holds (`R-PRN-1`).
const BAND_CHARS: usize = 200;

/// The first section's properties, and how many sections follow it.
pub(super) fn first_section(body: &Element) -> (Option<&Element>, usize) {
    let mut found = Vec::new();
    for node in &body.children {
        let Node::Element(e) = node else {
            continue;
        };
        match e.name.as_str() {
            "w:p" => {
                if let Some(sect) = child(e, "w:ppr").and_then(|p| child(p, "w:sectpr")) {
                    found.push(sect);
                }
            }
            "w:sectpr" => found.push(e),
            _ => {}
        }
    }
    let further = found.len().saturating_sub(1);
    (found.first().copied(), further)
}

/// Twips in page units (1/96 inch), rounded as geometry values are (spec 2.3).
fn units(t: i64) -> f64 {
    (t as f64 / 15.0 * 100.0).round() / 100.0
}

/// The paper of a section, or `None` when it names no size.
pub(super) fn paper(sect: &Element) -> Option<Paper> {
    let size = child(sect, "w:pgsz")?;
    let dim = |name: &str| {
        size.attr(name)
            .and_then(|v| v.trim().parse::<i64>().ok())
            .filter(|v| *v > 0)
    };
    let (w, h) = (dim("w:w")?, dim("w:h")?);
    let landscape = size.attr("w:orient") == Some("landscape") || w > h;
    let (short, long) = (w.min(h), w.max(h));
    let near = |a: i64, b: i64| (a - b).abs() <= 20;
    // ISO 216 and ANSI sizes in twips.
    let label = [
        (PaperSize::Letter, 12240, 15840),
        (PaperSize::Legal, 12240, 20160),
        (PaperSize::A4, 11906, 16838),
        (PaperSize::A5, 8391, 11906),
        (PaperSize::Tabloid, 15840, 24480),
    ]
    .into_iter()
    .find(|(_, s, l)| near(short, *s) && near(long, *l))
    .map_or(PaperSize::Custom, |(p, _, _)| p);
    let mut paper = Paper {
        size: Named::Known(label),
        orientation: Named::Known(if landscape {
            Orientation::Landscape
        } else {
            Orientation::Portrait
        }),
        width: units(w),
        height: units(h),
        ..Paper::default()
    };
    if let Some(margins) = child(sect, "w:pgmar") {
        let side = |name: &str| {
            margins
                .attr(name)
                .and_then(|v| v.trim().parse::<i64>().ok())
                .map(|v| units(v.abs()))
        };
        for (slot, name) in paper.margins.iter_mut().zip(["w:top", "w:right", "w:bottom", "w:left"]) {
            if let Some(value) = side(name) {
                *slot = value;
            }
        }
    }
    Some(paper)
}

/// What became of the headers and footers.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct BandReport {
    /// Bands that came over.
    pub kept: usize,
    /// Bands whose pictures, tables, or extra lines were left out.
    pub simplified: usize,
}

/// The relationship IDs of a section's header or footer references, by type.
pub(super) fn references<'e>(sect: &'e Element, name: &'e str) -> Vec<(&'e str, &'e str)> {
    children(sect, name)
        .filter_map(|r| Some((r.attr("w:type").unwrap_or("default"), r.attr("r:id")?)))
        .collect()
}

/// Whether the section gives its first sheet a header and footer of its own.
pub(super) fn title_page(sect: &Element) -> bool {
    child(sect, "w:titlepg").is_some_and(super::props::on_off)
}

/// A header or footer part as a band: its text split at tabs into left, center, and right, with `PAGE`,
/// `NUMPAGES`, `DATE`, and `TITLE` fields as `{page}`, `{pages}`, `{date}`, and `{title}` (`R-PRN-2`).
/// Returns the band and whether something was left out.
pub(super) fn band(root: &Element) -> (Value, bool) {
    let mut lines: Vec<(Vec<String>, Option<String>)> = Vec::new();
    let mut lost = false;
    for p in children(root, "w:p").chain(nested_paragraphs(root)) {
        let mut line = BandLine {
            parts: vec![String::new()],
            ..BandLine::default()
        };
        line.content(p);
        lost |= line.lost;
        if line.parts.iter().any(|t| !t.trim().is_empty()) {
            let jc = child(p, "w:ppr").and_then(|pp| val(pp, "w:jc")).map(str::to_owned);
            lines.push((line.parts, jc));
        }
    }
    if child(root, "w:tbl").is_some() {
        lost = true;
    }
    if lines.len() > 1 {
        lost = true;
    }
    let (mut left, mut center, mut right) = (String::new(), String::new(), String::new());
    if let Some((parts, jc)) = lines.into_iter().next() {
        let parts: Vec<String> = parts.into_iter().map(|t| t.trim().to_owned()).collect();
        match parts.len() {
            1 => match jc.as_deref() {
                Some("center") => center.clone_from(&parts[0]),
                Some("right" | "end") => right.clone_from(&parts[0]),
                _ => left.clone_from(&parts[0]),
            },
            2 => {
                left.clone_from(&parts[0]);
                center.clone_from(&parts[1]);
            }
            _ => {
                left.clone_from(&parts[0]);
                center.clone_from(&parts[1]);
                right = parts[2..].join(" ");
            }
        }
    }
    let cut = |s: String| s.chars().take(BAND_CHARS).collect::<String>();
    let mut obj = Map::new();
    obj.insert("left".to_owned(), Value::from(cut(left)));
    obj.insert("center".to_owned(), Value::from(cut(center)));
    obj.insert("right".to_owned(), Value::from(cut(right)));
    (Value::Object(obj), lost)
}

/// Paragraphs inside content controls of a header, which Word uses for page number blocks.
fn nested_paragraphs(root: &Element) -> impl Iterator<Item = &Element> {
    children(root, "w:sdt")
        .filter_map(|sdt| child(sdt, "w:sdtcontent"))
        .flat_map(|content| children(content, "w:p"))
}

fn field_token(instruction: &str) -> Option<&'static str> {
    let name = instruction.split_whitespace().next()?.to_ascii_uppercase();
    match name.as_str() {
        "PAGE" => Some("{page}"),
        "NUMPAGES" | "SECTIONPAGES" => Some("{pages}"),
        "DATE" | "TIME" | "PRINTDATE" | "SAVEDATE" | "CREATEDATE" => Some("{date}"),
        "TITLE" => Some("{title}"),
        _ => None,
    }
}

/// What a header paragraph has read so far: its text between tabs, and the field it is in.
#[derive(Default)]
struct BandLine {
    parts: Vec<String>,
    /// The instruction of the complex field being read.
    field: Option<String>,
    /// Whether the reading is inside the shown result of a field that became a token.
    in_result: bool,
    /// Whether a picture or object was left out.
    lost: bool,
}

impl BandLine {
    fn push(&mut self, text: &str) {
        match self.parts.last_mut() {
            Some(last) => last.push_str(text),
            None => self.parts.push(text.to_owned()),
        }
    }

    fn content(&mut self, parent: &Element) {
        for node in &parent.children {
            let Node::Element(e) = node else {
                continue;
            };
            match e.name.as_str() {
                "w:fldsimple" => match e.attr("w:instr").and_then(field_token) {
                    Some(token) => self.push(token),
                    None => self.content(e),
                },
                "w:r" => self.run(e),
                "w:hyperlink" | "w:smarttag" | "w:ins" | "w:customxml" => self.content(e),
                "w:sdt" => {
                    if let Some(content) = child(e, "w:sdtcontent") {
                        self.content(content);
                    }
                }
                _ => {}
            }
        }
    }

    fn run(&mut self, r: &Element) {
        for node in &r.children {
            let Node::Element(e) = node else {
                continue;
            };
            match e.name.as_str() {
                "w:fldchar" => self.field_char(e.attr("w:fldchartype")),
                "w:instrtext" => {
                    if let Some(f) = self.field.as_mut() {
                        f.push_str(&text_of(e));
                    }
                }
                "w:t" if !self.in_result => self.push(&text_of(e)),
                "w:tab" if !self.in_result => self.parts.push(String::new()),
                "w:drawing" | "w:pict" | "w:object" => self.lost = true,
                _ => {}
            }
        }
    }

    /// A complex field: its instruction comes between `begin` and `separate`, its shown result before `end`.
    fn field_char(&mut self, kind: Option<&str>) {
        match kind {
            Some("begin") => self.field = Some(String::new()),
            Some("separate") => {
                if let Some(token) = self.field.as_deref().and_then(field_token) {
                    self.push(token);
                    self.in_result = true;
                }
            }
            Some("end") => {
                let token = self.field.take().as_deref().and_then(field_token);
                if let (Some(token), false) = (token, self.in_result) {
                    self.push(token);
                }
                self.in_result = false;
            }
            _ => {}
        }
    }
}

fn text_of(e: &Element) -> String {
    e.children
        .iter()
        .filter_map(|n| match n {
            Node::Text(t) => Some(t.as_str()),
            Node::Element(_) => None,
        })
        .collect()
}

/// The `view.text` keys that `settings.xml` sets: the default tab stop and automatic hyphenation.
pub(super) fn text_settings(settings: &Element) -> Map<String, Value> {
    let mut out = Map::new();
    let tab = val(settings, "w:defaulttabstop")
        .and_then(|v| v.trim().parse::<i32>().ok())
        .map(twips)
        .filter(|t| (1.0..=1584.0).contains(t) && *t != 36.0);
    if let Some(tab) = tab {
        out.insert("defaultTab".to_owned(), num(tab));
    }
    if child(settings, "w:autohyphenation").is_some_and(super::props::on_off) {
        out.insert("hyphenate".to_owned(), Value::from(true));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    #[test]
    fn a4_landscape_paper_and_margins_come_over() {
        let body = parse(
            r#"<w:body><w:p/><w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
            <w:pgMar w:top="1440" w:right="720" w:bottom="1440" w:left="720"/></w:sectPr></w:body>"#,
        );
        let (sect, further) = first_section(&body);
        assert_eq!(further, 0);
        let paper = paper(sect.expect("a section")).expect("a paper");
        assert_eq!(paper.size, Named::Known(PaperSize::A4));
        assert_eq!(paper.orientation, Named::Known(Orientation::Landscape));
        // 16838 twips are 16838 / 1440 inches, 1122.53 page units.
        assert_eq!((paper.width, paper.height), (1122.53, 793.73));
        assert_eq!(paper.margins, [96.0, 48.0, 96.0, 48.0]);
    }

    #[test]
    fn a_header_with_page_fields_becomes_a_band() {
        let header = parse(
            r#"<w:hdr><w:p><w:r><w:t>Report</w:t></w:r><w:r><w:tab/></w:r><w:r><w:tab/></w:r>
            <w:r><w:t xml:space="preserve">Page </w:t></w:r>
            <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>
            <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r>
            <w:fldChar w:fldCharType="end"/></w:r>
            <w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>3</w:t></w:r>
            </w:fldSimple></w:p></w:hdr>"#,
        );
        let (band, lost) = band(&header);
        assert!(!lost);
        assert_eq!(
            band,
            serde_json::json!({"left": "Report", "center": "", "right": "Page {page} of {pages}"})
        );
    }

    #[test]
    fn settings_give_the_default_tab() {
        let settings = parse(r#"<w:settings><w:defaultTabStop w:val="708"/><w:autoHyphenation/></w:settings>"#);
        assert_eq!(
            Value::Object(text_settings(&settings)),
            serde_json::json!({"defaultTab": 35.4, "hyphenate": true})
        );
    }
}
