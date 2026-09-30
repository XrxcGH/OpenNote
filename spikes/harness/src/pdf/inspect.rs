//! Reads an exported PDF with lopdf: the page sizes, what each page draws (filled paths by color, stroked
//! paths, text runs, and images), and how each font's glyphs are embedded.
//!
//! Pen strokes are filled outlines, so each stroke shows up as one filled path in its pen's color. An ink
//! stroke that was turned into a picture would show up as an image instead.

use std::collections::BTreeMap;
use std::path::Path;

use lopdf::content::Content;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use serde::Serialize;

use super::encoding::{hex, rgb_from_unit, Rgb};
use crate::common::Result;

/// Form XObjects can nest; this stops a malformed file from recursing forever.
const MAX_FORM_DEPTH: usize = 8;

#[derive(Clone, Debug, Default, Serialize)]
pub struct PageReport {
    /// The page's MediaBox in points (1/72 inch): left, bottom, right, top.
    pub media_box_pt: [f64; 4],
    /// Filled paths by fill color (#rrggbb).
    pub fills: BTreeMap<String, usize>,
    pub stroked_paths: usize,
    /// Path construction operators (m, l, c, v, y, h, re).
    pub path_segments: usize,
    /// Text-showing operators (Tj, TJ, ', ").
    pub text_runs: usize,
    /// Image XObjects drawn on the page, as [width, height] in image pixels.
    pub images: Vec<[i64; 2]>,
    pub forms: usize,
    pub shadings: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FontReport {
    pub name: String,
    pub subtype: String,
    /// FontFile2 (TrueType), FontFile3 (CFF or OpenType), FontFile (Type 1), "Type 3 glyph procedures", or
    /// "not embedded".
    pub embedding: String,
    pub glyph_procedures: usize,
    /// A ToUnicode map lets people search and copy the text.
    pub to_unicode: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PdfReport {
    pub file_bytes: u64,
    pub producer: Option<String>,
    pub pages: Vec<PageReport>,
    pub fonts: Vec<FontReport>,
}

pub fn inspect(path: &Path) -> Result<PdfReport> {
    let document = Document::load(path)?;
    let pages = document
        .get_pages()
        .values()
        .map(|&page| page_report(&document, page))
        .collect::<Result<Vec<_>>>()?;
    Ok(PdfReport {
        file_bytes: std::fs::metadata(path)?.len(),
        producer: producer(&document),
        pages,
        fonts: fonts(&document),
    })
}

/// Just the page count and file size, for the timing runs.
pub fn page_count(path: &Path) -> Result<usize> {
    Ok(Document::load(path)?.get_pages().len())
}

fn page_report(document: &Document, page: ObjectId) -> Result<PageReport> {
    let mut walker = Walker {
        document,
        report: PageReport {
            media_box_pt: media_box(document, page),
            ..PageReport::default()
        },
        fill: [0, 0, 0],
        saved: Vec::new(),
        depth: 0,
    };
    let (inline, referenced) = document.get_page_resources(page)?;
    let resources = inline.or_else(|| referenced.first().and_then(|&id| document.get_dictionary(id).ok()));
    walker.walk(&document.get_page_content(page), resources)?;
    Ok(walker.report)
}

fn deref<'a>(document: &'a Document, object: &'a Object) -> Option<&'a Object> {
    document.dereference(object).ok().map(|(_, target)| target)
}

fn dict<'a>(document: &'a Document, object: &'a Object) -> Option<&'a Dictionary> {
    deref(document, object)?.as_dict().ok()
}

fn number(object: &Object) -> Option<f64> {
    object.as_float().ok().map(f64::from)
}

/// The page's MediaBox, inherited from the page tree when the page has none.
fn media_box(document: &Document, page: ObjectId) -> [f64; 4] {
    let mut node = document.get_dictionary(page).ok();
    for _ in 0..16 {
        let Some(current) = node else { break };
        let values = current.get(b"MediaBox").ok().and_then(|object| deref(document, object));
        if let Some(Ok(array)) = values.map(Object::as_array) {
            let numbers: Vec<f64> = array.iter().filter_map(number).collect();
            if let [left, bottom, right, top] = numbers[..] {
                return [left, bottom, right, top];
            }
        }
        let parent = current.get(b"Parent").and_then(Object::as_reference).ok();
        node = parent.and_then(|id| document.get_dictionary(id).ok());
    }
    [0.0; 4]
}

/// Interprets content streams, tracking the fill color through q and Q.
struct Walker<'a> {
    document: &'a Document,
    report: PageReport,
    fill: Rgb,
    saved: Vec<Rgb>,
    depth: usize,
}

impl<'a> Walker<'a> {
    fn walk(&mut self, content: &[u8], resources: Option<&'a Dictionary>) -> Result<()> {
        for operation in Content::decode(content)?.operations {
            self.apply(&operation.operator, &operation.operands, resources)?;
        }
        Ok(())
    }

    fn apply(&mut self, operator: &str, operands: &[Object], resources: Option<&'a Dictionary>) -> Result<()> {
        let report = &mut self.report;
        match operator {
            "q" => self.saved.push(self.fill),
            "Q" => self.fill = self.saved.pop().unwrap_or(self.fill),
            "rg" | "sc" | "scn" | "g" => self.fill = fill_color(operands).unwrap_or(self.fill),
            "m" | "l" | "c" | "v" | "y" | "h" | "re" => report.path_segments += 1,
            "f" | "F" | "f*" => *report.fills.entry(hex(self.fill)).or_default() += 1,
            "B" | "B*" | "b" | "b*" => {
                *report.fills.entry(hex(self.fill)).or_default() += 1;
                report.stroked_paths += 1;
            }
            "S" | "s" => report.stroked_paths += 1,
            "Tj" | "TJ" | "'" | "\"" => report.text_runs += 1,
            "sh" => report.shadings += 1,
            "Do" => self.draw(operands, resources)?,
            _ => {}
        }
        Ok(())
    }

    fn draw(&mut self, operands: &[Object], resources: Option<&'a Dictionary>) -> Result<()> {
        let name = operands.first().and_then(|operand| operand.as_name().ok());
        let Some(stream) = name.and_then(|name| xobject(self.document, resources, name)) else {
            return Ok(());
        };
        let size = |key: &[u8]| stream.dict.get(key).and_then(Object::as_i64).unwrap_or(0);
        match stream.dict.get(b"Subtype").and_then(Object::as_name) {
            Ok(b"Image") => self.report.images.push([size(b"Width"), size(b"Height")]),
            Ok(b"Form") if self.depth < MAX_FORM_DEPTH => {
                self.report.forms += 1;
                let inner = stream.dict.get(b"Resources").ok();
                let inner = inner.and_then(|object| dict(self.document, object)).or(resources);
                let content = stream.get_plain_content()?;
                self.depth += 1;
                self.saved.push(self.fill);
                let outcome = self.walk(&content, inner);
                self.fill = self.saved.pop().unwrap_or(self.fill);
                self.depth -= 1;
                outcome?;
            }
            _ => {}
        }
        Ok(())
    }
}

/// The color set by rg, g, sc, or scn with gray or RGB operands. Pattern colors are ignored.
fn fill_color(operands: &[Object]) -> Option<Rgb> {
    let values: Vec<f32> = operands.iter().filter_map(|operand| operand.as_float().ok()).collect();
    match values[..] {
        [gray] if operands.len() == 1 => Some(rgb_from_unit(gray, gray, gray)),
        [red, green, blue] if operands.len() == 3 => Some(rgb_from_unit(red, green, blue)),
        _ => None,
    }
}

fn xobject<'a>(document: &'a Document, resources: Option<&'a Dictionary>, name: &[u8]) -> Option<&'a Stream> {
    let xobjects = dict(document, resources?.get(b"XObject").ok()?)?;
    deref(document, xobjects.get(name).ok()?)?.as_stream().ok()
}

fn text(object: Option<&Object>) -> String {
    match object {
        Some(Object::Name(name)) => String::from_utf8_lossy(name).into_owned(),
        Some(Object::String(bytes, _)) if bytes.starts_with(&[0xfe, 0xff]) => {
            let units: Vec<u16> = bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&pair| u16::from_be_bytes(pair))
                .collect();
            String::from_utf16_lossy(&units)
        }
        Some(Object::String(bytes, _)) => String::from_utf8_lossy(bytes).into_owned(),
        _ => String::new(),
    }
}

fn producer(document: &Document) -> Option<String> {
    let info = dict(document, document.trailer.get(b"Info").ok()?)?;
    Some(text(
        info.get(b"Producer").ok().and_then(|object| deref(document, object)),
    ))
}

/// Every font in the file, except the CID fonts that Type 0 fonts wrap (they are reported with their parent).
fn fonts(document: &Document) -> Vec<FontReport> {
    let mut reports: Vec<FontReport> = document
        .objects
        .values()
        .filter_map(|object| object.as_dict().ok())
        .filter(|font| font.get(b"Type").and_then(Object::as_name).ok() == Some(b"Font".as_slice()))
        .filter(|font| !text(font.get(b"Subtype").ok()).starts_with("CIDFontType"))
        .map(|font| font_report(document, font))
        .collect();
    reports.sort_by(|a, b| a.name.cmp(&b.name));
    reports
}

fn font_report(document: &Document, font: &Dictionary) -> FontReport {
    let subtype = text(font.get(b"Subtype").ok());
    let described = match font
        .get(b"DescendantFonts")
        .ok()
        .and_then(|object| deref(document, object))
    {
        Some(Object::Array(fonts)) => fonts.first().and_then(|first| dict(document, first)).unwrap_or(font),
        _ => font,
    };
    let descriptor = described
        .get(b"FontDescriptor")
        .ok()
        .and_then(|object| dict(document, object));
    let glyph_procedures = font
        .get(b"CharProcs")
        .ok()
        .and_then(|object| dict(document, object))
        .map_or(0, Dictionary::len);
    let program = ["FontFile2", "FontFile3", "FontFile"]
        .into_iter()
        .find(|key| descriptor.is_some_and(|d| d.has(key.as_bytes())));
    let embedding = match program {
        Some(key) => key.to_string(),
        None if glyph_procedures > 0 => "Type 3 glyph procedures".to_string(),
        None => "not embedded".to_string(),
    };
    let mut name = text(font.get(b"BaseFont").ok());
    if name.is_empty() {
        name = text(descriptor.and_then(|d| d.get(b"FontName").ok()));
    }
    FontReport {
        name,
        subtype,
        embedding,
        glyph_procedures,
        to_unicode: font.has(b"ToUnicode"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn walk(document: &Document, content: &[u8], resources: Option<&Dictionary>) -> PageReport {
        let mut walker = Walker {
            document,
            report: PageReport::default(),
            fill: [0, 0, 0],
            saved: Vec::new(),
            depth: 0,
        };
        walker.walk(content, resources).unwrap();
        walker.report
    }

    #[test]
    fn counts_paths_by_fill_color_and_text() {
        let document = Document::with_version("1.7");
        let content = b"q 0.184 0.310 0.604 rg 10 10 m 20 20 l h f Q 0 0 10 10 re f \
            BT /F1 12 Tf (Hi) Tj ET 1 0 0 RG 0 0 m 5 5 l S";
        let report = walk(&document, content, None);
        assert_eq!(report.fills.get("#2f4f9a"), Some(&1));
        assert_eq!(report.fills.get("#000000"), Some(&1), "Q restores the black fill");
        assert_eq!(report.text_runs, 1);
        assert_eq!(report.stroked_paths, 1);
        assert_eq!(report.path_segments, 6);
    }

    #[test]
    fn finds_images_inside_forms() {
        let mut document = Document::with_version("1.7");
        let image = document.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 360, "Height" => 240 },
            vec![0; 4],
        ));
        let form_resources = dictionary! { "XObject" => dictionary! { "Im1" => image } };
        let form = document.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "Resources" => form_resources },
            b"0.5 0.5 0.5 rg 0 0 m 1 1 l f /Im1 Do".to_vec(),
        ));
        let resources = dictionary! { "XObject" => dictionary! { "Fm1" => form } };
        let report = walk(&document, b"q /Fm1 Do Q", Some(&resources));
        assert_eq!(report.forms, 1);
        assert_eq!(report.images, vec![[360, 240]]);
        assert_eq!(report.fills.get("#808080"), Some(&1));
    }

    #[test]
    fn describes_how_fonts_are_embedded() {
        let mut document = Document::with_version("1.7");
        let program = document.add_object(Stream::new(dictionary! {}, vec![0; 4]));
        let descriptor = document.add_object(dictionary! { "Type" => "FontDescriptor", "FontFile2" => program });
        let cid = document.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "FontDescriptor" => descriptor,
        });
        document.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "AAAAAA+Mono",
            "DescendantFonts" => vec![Object::Reference(cid)], "ToUnicode" => program,
        });
        let glyph = document.add_object(Stream::new(dictionary! {}, b"0 0 m 1 1 l f".to_vec()));
        document.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type3", "CharProcs" => dictionary! { "g1" => glyph, "g2" => glyph },
        });
        let fonts = fonts(&document);
        assert_eq!(fonts.len(), 2);
        let type0 = fonts.iter().find(|font| font.subtype == "Type0").unwrap();
        assert_eq!(
            (type0.name.as_str(), type0.embedding.as_str(), type0.to_unicode),
            ("AAAAAA+Mono", "FontFile2", true)
        );
        let type3 = fonts.iter().find(|font| font.subtype == "Type3").unwrap();
        assert_eq!(
            (type3.embedding.as_str(), type3.glyph_procedures),
            ("Type 3 glyph procedures", 2)
        );
    }

    #[test]
    fn inherits_the_media_box_from_the_page_tree() {
        let mut document = Document::with_version("1.7");
        let pages = document.new_object_id();
        let page = document.add_object(dictionary! { "Type" => "Page", "Parent" => pages });
        let tree = dictionary! {
            "Type" => "Pages", "Kids" => vec![Object::Reference(page)], "Count" => 1,
            "MediaBox" => [0, 0, 612, 792].map(Object::Integer).to_vec(),
        };
        document.objects.insert(pages, Object::Dictionary(tree));
        assert_eq!(media_box(&document, page), [0.0, 0.0, 612.0, 792.0]);
    }
}
