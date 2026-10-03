//! Writing a Word (`.docx`) file by hand: WordprocessingML parts in a ZIP archive.
//!
//! No crate is needed. A document is a handful of XML parts, and this module writes the ones that text,
//! lists, tables, links, and pictures need.

mod body;
mod parts;
mod runs;
pub(crate) mod zip;

use std::collections::{BTreeSet, HashMap};

use opennote_core::Timestamp;

use self::body::Frame;
use self::parts::{content_types, core_props, document_rels, numbering, root_rels, styles, xml_escape};
use self::runs::State;
use self::zip::ZipWriter;
use crate::doc::Block;
use crate::error::Result;

/// A picture that the document embeds.
#[derive(Clone, Debug)]
pub struct Media {
    /// The file: a PNG, JPEG, GIF, or BMP.
    pub bytes: Vec<u8>,
    /// The extension in lowercase: `png`, `jpeg`, `gif`, or `bmp`.
    pub ext: String,
    /// The width in pixels.
    pub width: u32,
    /// The height in pixels.
    pub height: u32,
}

/// A piece of the document body.
#[derive(Clone, Debug)]
pub enum Part {
    /// A page title, which links can point to through its bookmark.
    Title {
        /// The title.
        text: String,
        /// The bookmark name, for links inside the document.
        bookmark: Option<String>,
    },
    /// A smaller line above a title, such as a section name.
    Subtitle(String),
    /// A new page.
    PageBreak,
    /// Blocks of a page.
    Blocks(Vec<Block>),
}

/// Everything a Word file holds.
#[derive(Debug)]
pub struct WordInput {
    /// The document's title, for its properties.
    pub title: String,
    /// When it was made.
    pub created: Timestamp,
    /// When it last changed.
    pub modified: Timestamp,
    /// The body.
    pub parts: Vec<Part>,
    /// The pictures, by the destination that images in `parts` use.
    pub media: HashMap<String, Media>,
}

/// Builds the file.
pub fn build(input: &WordInput) -> Result<Vec<u8>> {
    let mut state = State::new(&input.media);
    let body = body_xml(&mut state, &input.parts);
    let mut archive = ZipWriter::new();
    let extensions: BTreeSet<String> = state.files.iter().map(|(_, media)| media.ext.clone()).collect();
    archive.add("[Content_Types].xml", content_types(&extensions).as_bytes())?;
    archive.add("_rels/.rels", root_rels().as_bytes())?;
    archive.add("word/document.xml", document_xml(&body).as_bytes())?;
    archive.add("word/_rels/document.xml.rels", document_rels(&state.rels).as_bytes())?;
    archive.add("word/styles.xml", styles().as_bytes())?;
    archive.add("word/numbering.xml", numbering(&state.ordered).as_bytes())?;
    archive.add(
        "docProps/core.xml",
        core_props(&input.title, input.created, input.modified).as_bytes(),
    )?;
    for (name, media) in &state.files {
        archive.add(&format!("word/media/{name}"), &media.bytes)?;
    }
    archive.finish()
}

fn body_xml(state: &mut State<'_>, parts: &[Part]) -> String {
    let mut body = String::new();
    for part in parts {
        match part {
            Part::Title { text, bookmark } => body.push_str(&title_xml(state, text, bookmark.as_deref())),
            Part::Subtitle(text) => {
                let run = format!("<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>", xml_escape(text));
                body.push_str(&format!(
                    "<w:p><w:pPr><w:pStyle w:val=\"Subtitle\"/></w:pPr>{run}</w:p>"
                ));
            }
            Part::PageBreak => body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>"),
            Part::Blocks(blocks) => body.push_str(&state.blocks(blocks, Frame::default())),
        }
    }
    body
}

/// A title paragraph, with a bookmark around its text when links point to it.
fn title_xml(state: &mut State<'_>, text: &str, bookmark: Option<&str>) -> String {
    let runs = format!("<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>", xml_escape(text));
    let inner = match bookmark {
        Some(name) => {
            let id = state.bookmark_id;
            state.bookmark_id += 1;
            let name = xml_escape(name);
            format!("<w:bookmarkStart w:id=\"{id}\" w:name=\"{name}\"/>{runs}<w:bookmarkEnd w:id=\"{id}\"/>")
        }
        None => runs,
    };
    format!("<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr>{inner}</w:p>")
}

fn document_xml(body: &str) -> String {
    format!(
        "{}<w:document xmlns:w=\"{}\" xmlns:r=\"{}\" \
         xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" \
         xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" \
         xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body>{body}\
         <w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/>\
         <w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" \
         w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>\
         </w:sectPr></w:body></w:document>",
        parts::XML_HEADER,
        parts::NS_W,
        parts::NS_R
    )
}

/// Reads the files of a `.docx` made by [`build`], for tests.
#[cfg(any(test, feature = "testing"))]
pub fn read_parts(docx: &[u8]) -> Vec<(String, Vec<u8>)> {
    zip::read_entries(docx)
}
