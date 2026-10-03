//! Runs of text for Word: marks, links, and pictures.

use std::collections::HashMap;

use super::parts::{xml_escape, NS_R};
use super::Media;
use crate::doc::{Inline, Marks, Script};
use crate::palette::{highlight_hex, pen_hex};

/// One inch is 914,400 English Metric Units, and a pixel is one 96th of an inch.
const EMU_PER_PIXEL: u64 = 9_525;
/// The text width of a Letter page with one-inch margins.
const MAX_WIDTH_EMU: u64 = 6 * 914_400 + 457_200;

/// What the body needs to remember while it writes: relationships, list numbers, and IDs.
pub(super) struct State<'a> {
    media: &'a HashMap<String, Media>,
    /// Relationship elements for the links and pictures so far.
    pub rels: Vec<String>,
    next_rel: u32,
    links: HashMap<String, String>,
    pictures: HashMap<String, String>,
    /// The files to write under `word/media/`, each with its name.
    pub files: Vec<(String, &'a Media)>,
    drawing_id: u32,
    /// The numbered lists so far, as `(level, start)`.
    pub ordered: Vec<(u32, u64)>,
    /// The next bookmark ID.
    pub bookmark_id: u32,
}

impl<'a> State<'a> {
    pub fn new(media: &'a HashMap<String, Media>) -> State<'a> {
        State {
            media,
            rels: Vec::new(),
            next_rel: 10,
            links: HashMap::new(),
            pictures: HashMap::new(),
            files: Vec::new(),
            drawing_id: 1,
            ordered: Vec::new(),
            bookmark_id: 1,
        }
    }

    fn relationship(&mut self, kind: &str, target: &str, external: bool) -> String {
        let id = format!("rId{}", self.next_rel);
        self.next_rel += 1;
        let mode = if external { " TargetMode=\"External\"" } else { "" };
        self.rels.push(format!(
            "<Relationship Id=\"{id}\" Type=\"{NS_R}/{kind}\" Target=\"{}\"{mode}/>",
            xml_escape(target)
        ));
        id
    }

    /// Writes inlines as runs. `bold` makes every run bold, for headers.
    pub fn runs(&mut self, inlines: &[Inline], bold: bool) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text { text, marks } => {
                    let mut marks = marks.clone();
                    marks.strong |= bold;
                    out.push_str(&self.text_run(text, &marks));
                }
                Inline::HardBreak => out.push_str("<w:r><w:br/></w:r>"),
                Inline::SoftBreak => out.push_str("<w:r><w:t xml:space=\"preserve\"> </w:t></w:r>"),
                Inline::Image { dest, alt } => out.push_str(&self.picture(dest, alt)),
            }
        }
        out
    }

    fn text_run(&mut self, text: &str, marks: &Marks) -> String {
        let run = format!(
            "<w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r>",
            run_props(marks),
            xml_escape(text)
        );
        let Some(dest) = &marks.link else {
            return run;
        };
        if let Some(anchor) = dest.strip_prefix('#') {
            return format!(
                "<w:hyperlink w:anchor=\"{}\" w:history=\"1\">{run}</w:hyperlink>",
                xml_escape(anchor)
            );
        }
        let external = ["http:", "https:", "mailto:"]
            .iter()
            .any(|scheme| dest.starts_with(scheme));
        if !external {
            return run;
        }
        let id = match self.links.get(dest) {
            Some(id) => id.clone(),
            None => {
                let id = self.relationship("hyperlink", dest, true);
                self.links.insert(dest.clone(), id.clone());
                id
            }
        };
        format!("<w:hyperlink r:id=\"{id}\" w:history=\"1\">{run}</w:hyperlink>")
    }

    /// A picture run, or the description in brackets when the picture is not in the file.
    fn picture(&mut self, dest: &str, alt: &str) -> String {
        let Some(media) = self.media.get(dest) else {
            let name = if alt.is_empty() { "image" } else { alt };
            return format!("<w:r><w:t xml:space=\"preserve\">[{}]</w:t></w:r>", xml_escape(name));
        };
        let rid = match self.pictures.get(dest) {
            Some(rid) => rid.clone(),
            None => {
                let name = format!("image{}.{}", self.files.len() + 1, media.ext);
                let rid = self.relationship("image", &format!("media/{name}"), false);
                self.files.push((name, media));
                self.pictures.insert(dest.to_owned(), rid.clone());
                rid
            }
        };
        let id = self.drawing_id;
        self.drawing_id += 1;
        let (cx, cy) = extent(media);
        drawing(&rid, id, (cx, cy), alt)
    }
}

/// The size of a picture in EMU, scaled down to fit the text width.
fn extent(media: &Media) -> (u64, u64) {
    let (width, height) = (u64::from(media.width.max(1)), u64::from(media.height.max(1)));
    let (cx, cy) = (width * EMU_PER_PIXEL, height * EMU_PER_PIXEL);
    if cx <= MAX_WIDTH_EMU {
        (cx, cy)
    } else {
        (MAX_WIDTH_EMU, cy * MAX_WIDTH_EMU / cx)
    }
}

fn drawing(rid: &str, id: u32, (cx, cy): (u64, u64), alt: &str) -> String {
    let alt = xml_escape(alt);
    format!(
        "<w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">\
         <wp:extent cx=\"{cx}\" cy=\"{cy}\"/>\
         <wp:docPr id=\"{id}\" name=\"Picture {id}\" descr=\"{alt}\"/><wp:cNvGraphicFramePr>\
         <a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr><a:graphic>\
         <a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic>\
         <pic:nvPicPr><pic:cNvPr id=\"{id}\" name=\"Picture {id}\" descr=\"{alt}\"/><pic:cNvPicPr/></pic:nvPicPr>\
         <pic:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>\
         <pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>\
         <a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>\
         </wp:inline></w:drawing></w:r>"
    )
}

/// The properties of a run, in the order the schema wants them.
fn run_props(marks: &Marks) -> String {
    let mut out = String::new();
    if marks.link.is_some() {
        out.push_str("<w:rStyle w:val=\"Hyperlink\"/>");
    }
    if marks.code {
        out.push_str("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>");
    }
    if marks.strong {
        out.push_str("<w:b/>");
    }
    if marks.emphasis {
        out.push_str("<w:i/>");
    }
    if marks.strike {
        out.push_str("<w:strike/>");
    }
    if let Some(hex) = marks.color.as_deref().and_then(pen_hex) {
        out.push_str(&format!("<w:color w:val=\"{hex}\"/>"));
    }
    if let Some(half_points) = marks.size.as_deref().and_then(size_half_points) {
        out.push_str(&format!("<w:sz w:val=\"{half_points}\"/>"));
    }
    if marks.underline {
        out.push_str("<w:u w:val=\"single\"/>");
    }
    if let Some(name) = &marks.highlight {
        out.push_str(&format!(
            "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{}\"/>",
            highlight_hex(name)
        ));
    }
    match marks.script {
        Some(Script::Sub) => out.push_str("<w:vertAlign w:val=\"subscript\"/>"),
        Some(Script::Sup) => out.push_str("<w:vertAlign w:val=\"superscript\"/>"),
        None => {}
    }
    if out.is_empty() {
        out
    } else {
        format!("<w:rPr>{out}</w:rPr>")
    }
}

fn size_half_points(size: &str) -> Option<u32> {
    match size {
        "small" => Some(18),
        "large" => Some(28),
        "xlarge" => Some(36),
        _ => None,
    }
}
