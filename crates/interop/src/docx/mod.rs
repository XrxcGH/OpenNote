//! Writing a Word (`.docx`) file by hand: WordprocessingML parts in a ZIP archive (ADR 0083).
//!
//! No crate is needed. The writer covers every run mark, paragraph key, named style, list definition, and page
//! setting of format version 2, with notes, comments, suggestions, headers, and footers.

mod body;
mod fonts;
mod numbering;
mod parts;
mod ppr;
mod rpr;
mod runs;
mod section;
mod styles;
mod table;
mod units;
pub(crate) mod zip;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet, HashMap};

use opennote_core::Timestamp;

pub use self::fonts::{bundled_embeds, EmbedFont, Theme, BUNDLED};
pub use self::rpr::{split_weight_face, weight_face};
pub use self::section::{Band, BandFields, Bands, PageSetup};
pub use self::styles::{app_styles, merge as merge_styles, sheet_from_json, style_id, StyleSheet};
pub use self::units::NUMBER_FORMATS;

use self::body::Frame;
use self::parts::{content_types, core_props, document_rels, root_rels, xml_escape, Extras};
use self::runs::{State, SubPart};
use self::section::{sect_pr, HeaderParts};
use self::zip::ZipWriter;
use crate::doc::data::TextData;
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
    /// A new column, or a new page outside columns.
    ColumnBreak,
    /// Blocks of a page.
    Blocks(Vec<Block>),
    /// The blocks of one text block, with its paragraph formatting, styles, lists, notes, comments, and
    /// suggestions.
    Text {
        /// The blocks.
        blocks: Vec<Block>,
        /// The text block's records.
        data: Box<TextData>,
    },
    /// The end of a section: everything since the previous one has this page setup, and the next part starts on
    /// a new sheet.
    Section {
        /// The setup.
        setup: Box<PageSetup>,
        /// The values of the band fields.
        fields: BandFields,
    },
}

/// Choices of the export.
#[derive(Clone, Debug, Default)]
pub struct WordOptions {
    /// The full names of the faces the device lists, such as `Segoe UI Semibold`, so a weight other than regular
    /// and bold names its face. Empty when unknown.
    pub faces: Vec<String>,
    /// Font files offered for embedding. Only the bundled fonts ([`BUNDLED`]) that the document uses are
    /// embedded. Empty by default: Word files name their fonts and never embed them.
    pub embed_fonts: Vec<EmbedFont>,
    /// Leaves the names of authors and the dates out of comments and suggestions, and the dates out of the
    /// document's properties, as Word's "Remove personal information" does.
    pub remove_personal: bool,
}

/// The document-wide settings of a page's text (`view.text`, spec 5.4.2).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextSettings {
    /// The default tab interval in points.
    pub default_tab: Option<f64>,
    /// Whether text is hyphenated.
    pub hyphenate: Option<bool>,
}

/// The settings of the whole document.
#[derive(Clone, Debug, Default)]
pub struct Setup {
    /// The named styles: the notebook's, with a page's own sheet over them. Empty means the app's own.
    pub styles: StyleSheet,
    /// The fonts and colors that tokens resolve to.
    pub theme: Theme,
    /// Text settings.
    pub text: TextSettings,
    /// The export's choices.
    pub options: WordOptions,
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
    /// Styles, theme, and options.
    pub setup: Setup,
}

/// Builds the file.
pub fn build(input: &WordInput) -> Result<Vec<u8>> {
    let setup = &input.setup;
    let sheet = styles::merge(styles::app_styles(), &[&setup.styles]);
    let mut state = State::new(&input.media, &setup.options.faces, &setup.theme.mono);
    state.remove_personal = setup.options.remove_personal;
    state.style_names = sheet.keys().cloned().collect();
    let mut headers = HeaderParts::default();
    let body = body_xml(&mut state, &input.parts, &mut headers);
    let doc_lists = state.doc_list_nums.clone();
    let list_num = move |id: &str| doc_lists.get(id).copied();
    let styles_xml = styles::styles_xml(
        &sheet,
        &styles::StylesInput {
            ctx: state.ctx(),
            list_num: &list_num,
        },
    );
    let numbering_xml = state.lists.xml(&state.mono);
    let document = document_xml(&body);
    let notes = std::mem::take(&mut state.notes);
    let footnotes = (!notes.footnotes.is_empty()).then(|| parts::notes_xml("footnote", &notes.footnotes));
    let endnotes = (!notes.endnotes.is_empty()).then(|| parts::notes_xml("endnote", &notes.endnotes));
    let comments = (!notes.comments.is_empty()).then(|| parts::comments_xml(&notes.comments));
    let comments_ex = (!notes.comments.is_empty()).then(|| parts::comments_ex_xml(&notes.comments_ex));

    // The fonts the document names, for the font table and for embedding.
    let mut used = BTreeSet::new();
    for xml in [&document, &styles_xml, &numbering_xml] {
        collect_fonts(xml, &mut used);
    }
    for xml in [&footnotes, &endnotes, &comments].into_iter().flatten() {
        collect_fonts(xml, &mut used);
    }
    used.insert(setup.theme.heading.clone());
    used.insert(setup.theme.body.clone());
    let fonts::Embedding {
        embedded,
        files: font_files,
        rels: font_rels,
    } = fonts::embed(&setup.options.embed_fonts, &used);

    let extras = Extras {
        footnotes: footnotes.is_some(),
        endnotes: endnotes.is_some(),
        comments: comments.is_some(),
        headers: headers
            .files
            .iter()
            .map(|(name, kind, _)| (name.clone(), *kind))
            .collect(),
        fonts: !font_files.is_empty(),
    };
    let mut archive = ZipWriter::new();
    let extensions: BTreeSet<String> = state.files.iter().map(|(_, media)| media.ext.clone()).collect();
    archive.add("[Content_Types].xml", content_types(&extensions, &extras).as_bytes())?;
    archive.add("_rels/.rels", root_rels().as_bytes())?;
    archive.add("word/document.xml", document.as_bytes())?;
    let mut rels = state.rels.clone();
    rels.extend(headers.rels.iter().cloned());
    archive.add("word/_rels/document.xml.rels", document_rels(&rels, &extras).as_bytes())?;
    archive.add("word/styles.xml", styles_xml.as_bytes())?;
    archive.add("word/numbering.xml", numbering_xml.as_bytes())?;
    archive.add("word/settings.xml", parts::settings_xml(setup, &extras).as_bytes())?;
    archive.add("word/fontTable.xml", fonts::font_table(&used, &embedded).as_bytes())?;
    if !font_rels.is_empty() {
        archive.add("word/_rels/fontTable.xml.rels", parts::rels_xml(&font_rels).as_bytes())?;
    }
    for (name, bytes) in &font_files {
        archive.add(&format!("word/fonts/{name}"), bytes)?;
    }
    archive.add("word/theme/theme1.xml", fonts::theme_xml(&setup.theme).as_bytes())?;
    let annotations = [
        ("footnotes", &footnotes),
        ("endnotes", &endnotes),
        ("comments", &comments),
        ("commentsExtended", &comments_ex),
    ];
    add_annotation_parts(&mut archive, &annotations, &state.sub_rels)?;
    for (name, _, xml) in &headers.files {
        archive.add(&format!("word/{name}"), xml.as_bytes())?;
    }
    let (created, modified) = if setup.options.remove_personal {
        (None, None)
    } else {
        (Some(input.created), Some(input.modified))
    };
    archive.add(
        "docProps/core.xml",
        core_props(&input.title, created, modified).as_bytes(),
    )?;
    for (name, media) in &state.files {
        archive.add(&format!("word/media/{name}"), &media.bytes)?;
    }
    archive.finish()
}

/// Adds the font names of `w:rFonts` in a part to `out`.
fn collect_fonts(xml: &str, out: &mut BTreeSet<String>) {
    for attr in ["w:ascii=\"", "w:hAnsi=\"", "w:eastAsia=\"", "w:cs=\""] {
        let mut rest = xml;
        while let Some(at) = rest.find(attr) {
            rest = &rest[at + attr.len()..];
            if let Some(end) = rest.find('"') {
                out.insert(unescape(&rest[..end]));
                rest = &rest[end..];
            }
        }
    }
}

fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn body_xml<'a>(state: &mut State<'a>, parts: &'a [Part], headers: &mut HeaderParts) -> String {
    let mut body = String::new();
    let last_section = parts.iter().rposition(|p| matches!(p, Part::Section { .. }));
    // A section without a header after one with a header would inherit it, so it gets an empty one.
    let any_header = parts
        .iter()
        .any(|p| matches!(p, Part::Section { setup, .. } if setup.header.is_some()));
    let any_footer = parts
        .iter()
        .any(|p| matches!(p, Part::Section { setup, .. } if setup.footer.is_some()));
    let effective = |setup: &PageSetup| {
        let mut setup = setup.clone();
        if any_header && setup.header.is_none() {
            setup.header = Some(Bands::default());
        }
        if any_footer && setup.footer.is_none() {
            setup.footer = Some(Bands::default());
        }
        setup
    };
    // The page a part is on: the setup and fields of the next section, which closes that page.
    let mut pages: Vec<Option<(PageSetup, BandFields)>> = vec![None; parts.len()];
    let mut next = None;
    for (index, part) in parts.iter().enumerate().rev() {
        if let Part::Section { setup, fields } = part {
            next = Some((effective(setup), fields.clone()));
        }
        pages[index] = next.clone();
    }
    let mut current = PageSetup::default();
    let mut fields = BandFields::default();
    let mut rel_ids = RelIds { next: 1 };
    // Whether a section of this page has ended already, so the next one goes on the same sheet.
    let mut on_page = false;
    // The length of the body at the end of the last section.
    let mut sect_end = 0;
    for (index, part) in parts.iter().enumerate() {
        match part {
            Part::Title { text, bookmark } => body.push_str(&title_xml(state, text, bookmark.as_deref())),
            Part::Subtitle(text) => {
                let run = format!("<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>", xml_escape(text));
                body.push_str(&format!(
                    "<w:p><w:pPr><w:pStyle w:val=\"Subtitle\"/></w:pPr>{run}</w:p>"
                ));
            }
            Part::PageBreak => body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>"),
            Part::ColumnBreak => body.push_str("<w:p><w:r><w:br w:type=\"column\"/></w:r></w:p>"),
            Part::Blocks(blocks) => {
                state.begin_text(None, HashMap::new());
                body.push_str(&state.blocks(blocks, Frame::default()));
                body.push_str(&state.end_text());
            }
            Part::Text { blocks, data } => {
                let elements = data
                    .elements(blocks)
                    .into_iter()
                    .map(|element| (element.path.clone(), element))
                    .collect();
                state.begin_text(Some(data), elements);
                count_block_comments(state, blocks);
                let columns = data.layout.filter(|l| l.columns > 1);
                // Columns are a section of their own, with the setup and fields of the page they are on.
                let (page, page_fields) = match &pages[index] {
                    Some((setup, f)) => (setup, f),
                    None => (&current, &fields),
                };
                let mut rel_id = || rel_ids.take();
                if columns.is_some() && body.len() > sect_end {
                    // End the text before the columns in a section of its own.
                    let before = sect_pr(page, page_fields, headers, &mut rel_id, None, on_page);
                    body.push_str(&format!("<w:p><w:pPr>{before}</w:pPr></w:p>"));
                    on_page = true;
                }
                body.push_str(&state.blocks(blocks, Frame::default()));
                body.push_str(&state.end_text());
                if let Some(layout) = columns {
                    let cols = Some((layout.columns, layout.gap, layout.rule));
                    let sect = sect_pr(page, page_fields, headers, &mut rel_id, cols, on_page);
                    body.push_str(&format!("<w:p><w:pPr>{sect}</w:pPr></w:p>"));
                    on_page = true;
                    sect_end = body.len();
                }
            }
            Part::Section { setup, fields: f } => {
                current = effective(setup);
                fields = f.clone();
                if Some(index) != last_section {
                    let mut rel_id = || rel_ids.take();
                    let sect = sect_pr(&current, &fields, headers, &mut rel_id, None, on_page);
                    body.push_str(&format!("<w:p><w:pPr>{sect}</w:pPr></w:p>"));
                    sect_end = body.len();
                    on_page = false;
                }
            }
        }
    }
    let mut rel_id = || rel_ids.take();
    body.push_str(&sect_pr(&current, &fields, headers, &mut rel_id, None, on_page));
    body
}

/// Relationship IDs of headers and footers, apart from those of links and pictures.
/// Adds the notes and comments parts that have content, and the relationships part of each that has links or
/// pictures.
fn add_annotation_parts(
    archive: &mut ZipWriter,
    annotations: &[(&str, &Option<String>)],
    sub_rels: &BTreeMap<SubPart, Vec<String>>,
) -> Result<()> {
    for (name, part) in annotations {
        if let Some(xml) = part {
            archive.add(&format!("word/{name}.xml"), xml.as_bytes())?;
        }
    }
    for (part, rels) in sub_rels {
        if !rels.is_empty() {
            archive.add(
                &format!("word/_rels/{}.xml.rels", part.name()),
                parts::rels_xml(&rels.concat()).as_bytes(),
            )?;
        }
    }
    Ok(())
}

struct RelIds {
    next: u32,
}

impl RelIds {
    fn take(&mut self) -> String {
        let id = format!("rIdH{}", self.next);
        self.next += 1;
        id
    }
}

/// Counts the runs of each comment in blocks, at every depth.
fn count_block_comments(state: &mut State<'_>, blocks: &[Block]) {
    for block in blocks {
        match block {
            Block::Paragraph(content) | Block::Heading { content, .. } => state.count_comments(content),
            Block::List { items, .. } => {
                for item in items {
                    count_block_comments(state, &item.blocks);
                }
            }
            Block::Quote(inner) => count_block_comments(state, inner),
            Block::Callout { title, blocks, .. } => {
                state.count_comments(title);
                count_block_comments(state, blocks);
            }
            Block::Table { rows, .. } => {
                for cell in rows.iter().flatten() {
                    state.count_comments(cell);
                }
            }
            Block::Code { .. } | Block::Break => {}
        }
    }
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
        "{}<w:document xmlns:w=\"{}\" xmlns:r=\"{}\" {} {} mc:Ignorable=\"w14\"><w:body>{body}\
         </w:body></w:document>",
        parts::XML_HEADER,
        parts::NS_W,
        parts::NS_R,
        parts::NS_EXTENSIONS,
        parts::NS_DRAWING
    )
}

/// Reads the files of a `.docx` made by [`build`], for tests.
#[cfg(any(test, feature = "testing"))]
pub fn read_parts(docx: &[u8]) -> Vec<(String, Vec<u8>)> {
    zip::read_entries(docx)
}
