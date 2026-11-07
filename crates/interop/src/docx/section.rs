//! Sections: page size, margins, orientation, columns, page numbers, and the headers and footers of a page
//! (`w:sectPr`, ECMA-376 Part 1, 17.6).

use super::parts::{xml_escape, NS_R, NS_W, XML_HEADER};
use super::units::page_twips;

/// The page setup of a section, from a page's paper (spec 5.4).
#[derive(Clone, Debug, PartialEq)]
pub struct PageSetup {
    /// The width in page units (1/96 inch), as oriented.
    pub width: f64,
    /// The height in page units, as oriented.
    pub height: f64,
    /// Top, right, bottom, and left margins in page units.
    pub margins: [f64; 4],
    /// Whether the paper is turned on its side.
    pub landscape: bool,
    /// The header on every sheet.
    pub header: Option<Bands>,
    /// The footer on every sheet.
    pub footer: Option<Bands>,
    /// The format and first number of page numbers, from `view.text.pageNumbers`.
    pub page_numbers: Option<(String, Option<u32>)>,
}

impl Default for PageSetup {
    /// Letter with one-inch margins, the paper of a page that sets none.
    fn default() -> PageSetup {
        PageSetup {
            width: 816.0,
            height: 1_056.0,
            margins: [96.0; 4],
            landscape: false,
            header: None,
            footer: None,
            page_numbers: None,
        }
    }
}

/// A header or footer: the band on every sheet, and the one on the first sheet when it differs (`R-PRN-1`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Bands {
    /// Every sheet.
    pub all: Band,
    /// The first sheet, when it differs.
    pub first: Option<Band>,
}

/// The three parts of a band, each a template with fields such as `{page}` (`R-PRN-2`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Band {
    /// At the start edge.
    pub left: String,
    /// In the middle.
    pub center: String,
    /// At the end edge.
    pub right: String,
}

/// The values of the text fields of a band.
#[derive(Clone, Debug, Default)]
pub struct BandFields {
    /// The page title.
    pub title: String,
    /// The notebook's name.
    pub notebook: String,
    /// The section's name.
    pub section: String,
}

/// A header or footer part to write: its file name and content.
#[derive(Debug, Default)]
pub struct HeaderParts {
    /// `(file name, kind, xml)`, where kind is `header` or `footer`.
    pub files: Vec<(String, &'static str, String)>,
    /// The relationships of the document part to them.
    pub rels: Vec<String>,
    /// The relationship ID of each file, in the order of `files`.
    ids: Vec<String>,
}

impl HeaderParts {
    /// Adds a header or footer part and returns its relationship ID. A part with the same kind and content as
    /// one already added, such as the header of a page's columns section, reuses that part.
    fn add(&mut self, kind: &'static str, xml: String, rel_id: &mut dyn FnMut() -> String) -> String {
        if let Some(i) = self.files.iter().position(|(_, k, x)| *k == kind && *x == xml) {
            return self.ids[i].clone();
        }
        let n = self.files.iter().filter(|(_, k, _)| *k == kind).count() + 1;
        let name = format!("{kind}{n}.xml");
        let rid = rel_id();
        self.rels.push(format!(
            "<Relationship Id=\"{rid}\" Type=\"{NS_R}/{kind}\" Target=\"{name}\"/>"
        ));
        self.files.push((name, kind, xml));
        self.ids.push(rid.clone());
        rid
    }
}

/// The text width of a setup in twips: the paper less the side margins.
fn text_width(setup: &PageSetup) -> i64 {
    page_twips(setup.width - setup.margins[1] - setup.margins[3]).clamp(720, MAX_TWIPS)
}

/// The paragraph of a band: three parts at a start, center, and end tab stop, with `{page}` and `{pages}` as
/// `PAGE` and `NUMPAGES` fields and `{date}` as a `DATE` field.
fn band_xml(kind: &str, band: &Band, fields: &BandFields, width: i64) -> String {
    let style = if kind == "header" { "Header" } else { "Footer" };
    let mut runs = String::new();
    for (i, part) in [&band.left, &band.center, &band.right].iter().enumerate() {
        if i > 0 {
            runs.push_str("<w:r><w:tab/></w:r>");
        }
        runs.push_str(&template_runs(part, fields));
    }
    let root = if kind == "header" { "hdr" } else { "ftr" };
    format!(
        "{XML_HEADER}<w:{root} xmlns:w=\"{NS_W}\" xmlns:r=\"{NS_R}\"><w:p><w:pPr><w:pStyle w:val=\"{style}\"/>\
         <w:tabs><w:tab w:val=\"center\" w:pos=\"{}\"/><w:tab w:val=\"right\" w:pos=\"{width}\"/></w:tabs>\
         </w:pPr>{runs}</w:p></w:{root}>",
        width / 2
    )
}

/// The runs of a template: text, with the fields filled in or written as Word fields.
fn template_runs(template: &str, fields: &BandFields) -> String {
    let mut out = String::new();
    let mut text = String::new();
    let mut rest = template;
    let flush = |text: &mut String, out: &mut String| {
        if !text.is_empty() {
            out.push_str(&format!(
                "<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>",
                xml_escape(text)
            ));
            text.clear();
        }
    };
    while let Some(open) = rest.find('{') {
        text.push_str(&rest[..open]);
        let after = &rest[open..];
        let field = ["{page}", "{pages}", "{title}", "{notebook}", "{section}", "{date}"]
            .into_iter()
            .find(|f| after.starts_with(f));
        match field {
            Some(name) => {
                match name {
                    "{title}" => text.push_str(&fields.title),
                    "{notebook}" => text.push_str(&fields.notebook),
                    "{section}" => text.push_str(&fields.section),
                    _ => {
                        flush(&mut text, &mut out);
                        let instruction = match name {
                            "{page}" => " PAGE ",
                            "{pages}" => " NUMPAGES ",
                            _ => " DATE \\@ \"MMMM d, yyyy\" ",
                        };
                        out.push_str(&format!(
                            "<w:fldSimple w:instr=\"{}\"><w:r><w:t>1</w:t></w:r></w:fldSimple>",
                            xml_escape(instruction)
                        ));
                    }
                }
                rest = &after[name.len()..];
            }
            None => {
                text.push('{');
                rest = &after[1..];
            }
        }
    }
    text.push_str(rest);
    flush(&mut text, &mut out);
    out
}

/// The largest page side and margin Word accepts, in twips: 22 inches.
const MAX_TWIPS: i64 = 31_680;

/// A setup Word can open: a paper that is not a finite size is Letter, and the sides and margins are clamped to
/// Word's range, with the side margins never negative.
fn sane(setup: &PageSetup) -> PageSetup {
    let mut setup = setup.clone();
    let letter = PageSetup::default();
    if !(setup.width.is_finite() && setup.height.is_finite()) {
        (setup.width, setup.height) = (letter.width, letter.height);
    }
    for (i, margin) in setup.margins.iter_mut().enumerate() {
        if !margin.is_finite() {
            *margin = letter.margins[i];
        }
    }
    setup
}

/// Page units as twips, clamped to `low..=MAX_TWIPS`.
fn clamped(units: f64, low: i64) -> i64 {
    page_twips(units.clamp(-1e9, 1e9)).clamp(low, MAX_TWIPS)
}

/// `w:sectPr` of a setup. Its header and footer parts are added to `parts`. A `continuous` section goes on the
/// sheet of the section before it; any other starts a new sheet.
pub fn sect_pr(
    setup: &PageSetup,
    fields: &BandFields,
    parts: &mut HeaderParts,
    rel_id: &mut dyn FnMut() -> String,
    columns: Option<(u8, f64, bool)>,
    continuous: bool,
) -> String {
    let setup = &sane(setup);
    let mut out = "<w:sectPr>".to_owned();
    let width = text_width(setup);
    let mut first_page = false;
    for (kind, bands) in [("header", &setup.header), ("footer", &setup.footer)] {
        let Some(bands) = bands else {
            continue;
        };
        let rid = parts.add(kind, band_xml(kind, &bands.all, fields, width), rel_id);
        out.push_str(&format!("<w:{kind}Reference w:type=\"default\" r:id=\"{rid}\"/>"));
        if let Some(first) = &bands.first {
            let rid = parts.add(kind, band_xml(kind, first, fields, width), rel_id);
            out.push_str(&format!("<w:{kind}Reference w:type=\"first\" r:id=\"{rid}\"/>"));
            first_page = true;
        }
    }
    if continuous {
        out.push_str("<w:type w:val=\"continuous\"/>");
    }
    let (w, h) = (clamped(setup.width, 1), clamped(setup.height, 1));
    let orient = if setup.landscape { " w:orient=\"landscape\"" } else { "" };
    out.push_str(&format!("<w:pgSz w:w=\"{w}\" w:h=\"{h}\"{orient}/>"));
    let [top, bottom] = [setup.margins[0], setup.margins[2]].map(|m| clamped(m, -MAX_TWIPS));
    let [right, left] = [setup.margins[1], setup.margins[3]].map(|m| clamped(m, 0));
    let band = |margin: i64| (margin / 2).clamp(0, 720);
    out.push_str(&format!(
        "<w:pgMar w:top=\"{top}\" w:right=\"{right}\" w:bottom=\"{bottom}\" w:left=\"{left}\" \
         w:header=\"{}\" w:footer=\"{}\" w:gutter=\"0\"/>",
        band(top),
        band(bottom)
    ));
    if let Some((format, start)) = &setup.page_numbers {
        let start = start.map(|s| format!(" w:start=\"{s}\"")).unwrap_or_default();
        out.push_str(&format!("<w:pgNumType w:fmt=\"{}\"{start}/>", xml_escape(format)));
    }
    if let Some((count, gap, rule)) = columns {
        let sep = if rule { " w:sep=\"1\"" } else { "" };
        out.push_str(&format!(
            "<w:cols w:num=\"{count}\" w:space=\"{}\"{sep}/>",
            super::units::twips(gap)
        ));
    }
    if first_page {
        out.push_str("<w:titlePg/>");
    }
    out.push_str("</w:sectPr>");
    out
}
