//! Runs of text for Word: marks, links, pictures, note references, comment ranges, and suggestions.

use std::collections::{BTreeMap, HashMap};

use super::numbering::Lists;
use super::parts::{xml_escape, NS_R};
use super::rpr::{run_props, RunContext};
use super::Media;
use crate::doc::data::{inline_markdown, Element, NoteKind, TextData};
use crate::doc::{Inline, Marks};

/// One inch is 914,400 English Metric Units, and a pixel is one 96th of an inch.
const EMU_PER_PIXEL: u64 = 9_525;
/// The text width of a Letter page with one-inch margins.
const MAX_WIDTH_EMU: u64 = 6 * 914_400 + 457_200;

/// The notes, comments, and their extensions that the body made.
#[derive(Debug, Default)]
pub(super) struct Annotations {
    /// `w:footnote` elements, without the separators.
    pub footnotes: Vec<String>,
    /// `w:endnote` elements, without the separators.
    pub endnotes: Vec<String>,
    /// `w:comment` elements.
    pub comments: Vec<String>,
    /// `w15:commentEx` elements: replies and resolved state.
    pub comments_ex: Vec<String>,
}

/// The comments that are open in the text, and how many runs of each are still to come.
#[derive(Debug, Default)]
struct CommentRanges {
    /// The runs of each comment ID in the current text part that are still to be written.
    left: HashMap<String, usize>,
    /// The Word IDs of each open comment: the comment's, then its replies'.
    open: BTreeMap<String, Vec<u32>>,
}

/// What the body needs to remember while it writes: relationships, lists, notes, comments, and IDs.
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
    /// The next bookmark ID.
    pub bookmark_id: u32,
    /// The lists.
    pub lists: Lists,
    /// The faces the device lists.
    faces: &'a [String],
    /// The font of `+mono`.
    pub mono: String,
    /// The names of the styles the sheet defines.
    pub style_names: Vec<String>,
    /// The records of the text part being written, and the elements by path.
    pub data: Option<&'a TextData>,
    pub elements: HashMap<Vec<usize>, Element>,
    /// Where the writer is in the blocks of the text part.
    pub path: Vec<usize>,
    /// The definition and the current list of each list ID of the text part.
    pub list_defs: HashMap<String, usize>,
    pub list_nums: HashMap<String, usize>,
    /// The latest list of each list ID in the document, for styles tied to a list.
    pub doc_list_nums: HashMap<String, usize>,
    /// The notes and comments so far.
    pub notes: Annotations,
    comments: CommentRanges,
    /// The next ID of a comment, insertion, deletion, or format change.
    annotation_id: u32,
    /// The next `w14:paraId`.
    para_id: u32,
    /// Whether runs go to a note or a comment, which have no relationships of their own.
    sub_part: bool,
    /// Whether authors and dates are left out.
    pub remove_personal: bool,
}

impl<'a> State<'a> {
    pub fn new(media: &'a HashMap<String, Media>, faces: &'a [String], mono: &str) -> State<'a> {
        State {
            media,
            rels: Vec::new(),
            next_rel: 10,
            links: HashMap::new(),
            pictures: HashMap::new(),
            files: Vec::new(),
            drawing_id: 1,
            bookmark_id: 1,
            lists: Lists::new(),
            faces,
            mono: mono.to_owned(),
            style_names: Vec::new(),
            data: None,
            elements: HashMap::new(),
            path: Vec::new(),
            list_defs: HashMap::new(),
            list_nums: HashMap::new(),
            doc_list_nums: HashMap::new(),
            notes: Annotations::default(),
            comments: CommentRanges::default(),
            annotation_id: 1,
            para_id: 1,
            sub_part: false,
            remove_personal: false,
        }
    }

    /// The context of run properties.
    pub fn ctx(&self) -> RunContext<'_> {
        RunContext {
            faces: self.faces,
            mono: &self.mono,
        }
    }

    /// Adds a relationship of the document part and returns its ID.
    pub fn relationship(&mut self, kind: &str, target: &str, external: bool) -> String {
        let id = format!("rId{}", self.next_rel);
        self.next_rel += 1;
        let mode = if external { " TargetMode=\"External\"" } else { "" };
        self.rels.push(format!(
            "<Relationship Id=\"{id}\" Type=\"{NS_R}/{kind}\" Target=\"{}\"{mode}/>",
            xml_escape(target)
        ));
        id
    }

    /// Starts a text part: its records, and the comments its runs carry.
    pub fn begin_text(&mut self, data: Option<&'a TextData>, elements: HashMap<Vec<usize>, Element>) {
        self.data = data;
        self.elements = elements;
        self.path.clear();
        self.list_defs.clear();
        self.list_nums.clear();
        self.comments = CommentRanges::default();
    }

    /// Counts the runs of each comment in the blocks, so each range ends after its last run.
    pub fn count_comments(&mut self, inlines: &[Inline]) {
        for inline in inlines {
            if let Inline::Text { marks, .. } = inline {
                for id in &marks.comments {
                    *self.comments.left.entry(id.clone()).or_default() += 1;
                }
            }
        }
    }

    /// Ends the text part: any comment still open ends here.
    pub fn end_text(&mut self) -> String {
        let open = std::mem::take(&mut self.comments.open);
        let mut out = String::new();
        for ids in open.values() {
            out.push_str(&comment_ends(ids));
        }
        self.data = None;
        self.elements.clear();
        out
    }

    /// A fresh `w14:paraId`, eight hexadecimal digits below 0x80000000.
    pub fn next_para_id(&mut self) -> String {
        let id = format!("{:08X}", 0x1000_0000 + self.para_id);
        self.para_id += 1;
        id
    }

    fn next_annotation(&mut self) -> u32 {
        let id = self.annotation_id;
        self.annotation_id += 1;
        id
    }

    /// The author and date attributes of a comment or change, or a plain author when personal information is
    /// removed.
    fn who(&self, author: &str, time: &str) -> String {
        if self.remove_personal {
            return " w:author=\"Author\"".to_owned();
        }
        // `w:date` is an `xsd:dateTime`, so a time that is not a timestamp is left out rather than written.
        let date = match opennote_core::Timestamp::parse(time) {
            Ok(_) if !time.bytes().any(|b| b.is_ascii_lowercase()) => format!(" w:date=\"{time}\""),
            Ok(stamp) => format!(" w:date=\"{stamp}\""),
            Err(_) => String::new(),
        };
        format!(" w:author=\"{}\"{date}", xml_escape(author))
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
                Inline::Note { id, .. } => out.push_str(&self.note_reference(id)),
            }
        }
        out
    }

    fn text_run(&mut self, text: &str, marks: &Marks) -> String {
        let mut before = String::new();
        if !self.sub_part {
            before = self.comment_starts(&marks.comments);
        }
        let change = self.format_change(marks);
        let props = run_props(marks, &self.ctx(), &change);
        let deleted = marks.deletion.is_some() && !self.sub_part;
        let element = if deleted { "w:delText" } else { "w:t" };
        let mut run = format!(
            "<w:r>{props}<{element} xml:space=\"preserve\">{}</{element}></w:r>",
            xml_escape(text)
        );
        if !self.sub_part {
            run = self.wrap_change(run, marks);
        }
        let run = self.link(run, marks);
        let mut out = before;
        out.push_str(&run);
        if !self.sub_part {
            out.push_str(&self.comment_ends_after(&marks.comments));
        }
        out
    }

    /// A link around a run: an anchor inside the document, or an external address through a relationship.
    fn link(&mut self, run: String, marks: &Marks) -> String {
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
        if !external || self.sub_part {
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

    /// The author and date of a suggestion record, or an unknown author when the record is missing.
    fn change_who(&self, id: &str) -> String {
        let record = self.data.and_then(|d| d.suggestions.get(id));
        self.who(
            record.map_or("Unknown", |r| r.author.as_str()),
            record.map_or("", |r| r.time.as_str()),
        )
    }

    /// An insertion or deletion around a run. Text that one suggestion inserted and another deletes is both.
    fn wrap_change(&mut self, mut run: String, marks: &Marks) -> String {
        if let Some(id) = &marks.deletion {
            let n = self.next_annotation();
            run = format!("<w:del w:id=\"{n}\"{}>{run}</w:del>", self.change_who(id));
        }
        if let Some(id) = &marks.insertion {
            let n = self.next_annotation();
            run = format!("<w:ins w:id=\"{n}\"{}>{run}</w:ins>", self.change_who(id));
        }
        run
    }

    /// `w:rPrChange` for a format change: the run's properties before the change.
    fn format_change(&mut self, marks: &Marks) -> String {
        let Some(id) = &marks.format_change else {
            return String::new();
        };
        if self.sub_part {
            return String::new();
        }
        let before_marks = self
            .data
            .and_then(|d| d.suggestions.get(id))
            .and_then(|r| r.before.as_deref())
            .map(inline_markdown)
            .and_then(|inlines| {
                inlines.into_iter().find_map(|i| match i {
                    Inline::Text { marks, .. } => Some(marks),
                    _ => None,
                })
            })
            .unwrap_or_default();
        let who = self.change_who(id);
        let n = self.next_annotation();
        let before = run_props(&before_marks, &self.ctx(), "");
        let before = if before.is_empty() {
            "<w:rPr/>".to_owned()
        } else {
            before
        };
        format!("<w:rPrChange w:id=\"{n}\"{who}>{before}</w:rPrChange>")
    }

    /// Opens the comments that start at this run, writing each comment and its replies.
    fn comment_starts(&mut self, ids: &[String]) -> String {
        let mut out = String::new();
        for id in ids {
            if self.comments.open.contains_key(id) {
                continue;
            }
            let Some(comment) = self.data.and_then(|d| d.comments.get(id)) else {
                continue;
            };
            let mut word_ids = Vec::new();
            let parent = self.next_annotation();
            word_ids.push(parent);
            let parent_para = self.comment_xml(parent, &comment.author, &comment.time, &comment.markdown);
            let done = if comment.resolved { "1" } else { "0" };
            self.notes.comments_ex.push(format!(
                "<w15:commentEx w15:paraId=\"{parent_para}\" w15:done=\"{done}\"/>"
            ));
            for reply in &comment.replies {
                let n = self.next_annotation();
                word_ids.push(n);
                let para = self.comment_xml(n, &reply.author, &reply.time, &reply.markdown);
                self.notes.comments_ex.push(format!(
                    "<w15:commentEx w15:paraId=\"{para}\" w15:paraIdParent=\"{parent_para}\" w15:done=\"{done}\"/>"
                ));
            }
            for n in &word_ids {
                out.push_str(&format!("<w:commentRangeStart w:id=\"{n}\"/>"));
            }
            self.comments.open.insert(id.clone(), word_ids);
        }
        out
    }

    /// Closes the comments whose last run this was.
    fn comment_ends_after(&mut self, ids: &[String]) -> String {
        let mut out = String::new();
        for id in ids {
            let Some(left) = self.comments.left.get_mut(id) else {
                continue;
            };
            *left = left.saturating_sub(1);
            if *left == 0 {
                if let Some(word_ids) = self.comments.open.remove(id) {
                    out.push_str(&comment_ends(&word_ids));
                }
            }
        }
        out
    }

    /// Writes one `w:comment` and returns the `w14:paraId` of its paragraph.
    fn comment_xml(&mut self, n: u32, author: &str, time: &str, markdown: &str) -> String {
        let para_id = self.next_para_id();
        let who = self.who(author, time);
        let inlines = inline_markdown(markdown);
        let runs = self.sub_runs(&inlines);
        self.notes.comments.push(format!(
            "<w:comment w:id=\"{n}\"{who}><w:p w14:paraId=\"{para_id}\"><w:pPr><w:pStyle w:val=\"CommentText\"/></w:pPr>\
             <w:r><w:rPr><w:rStyle w:val=\"CommentReference\"/></w:rPr><w:annotationRef/></w:r>{runs}</w:p></w:comment>"
        ));
        para_id
    }

    /// Runs for a note or a comment, which have no relationships: links keep their text, and pictures their
    /// description.
    fn sub_runs(&mut self, inlines: &[Inline]) -> String {
        let outer = self.sub_part;
        self.sub_part = true;
        let runs = self.runs(inlines, false);
        self.sub_part = outer;
        runs
    }

    /// A footnote or endnote reference, which writes its note. A reference whose note is missing, or one inside a
    /// note, writes nothing.
    fn note_reference(&mut self, id: &str) -> String {
        if self.sub_part {
            return String::new();
        }
        let Some(note) = self.data.and_then(|d| d.notes.get(id)) else {
            return String::new();
        };
        let (kind, style, reference, list) = match note.kind {
            NoteKind::Foot => ("footnote", "Footnote", "footnoteRef", &self.notes.footnotes),
            NoteKind::End => ("endnote", "Endnote", "endnoteRef", &self.notes.endnotes),
        };
        let n = list.len() + 1;
        let inlines = note.inlines();
        let runs = self.sub_runs(&inlines);
        let xml = format!(
            "<w:{kind} w:id=\"{n}\"><w:p><w:pPr><w:pStyle w:val=\"{style}Text\"/></w:pPr>\
             <w:r><w:rPr><w:rStyle w:val=\"{style}Reference\"/></w:rPr><w:{reference}/></w:r>\
             <w:r><w:t xml:space=\"preserve\"> </w:t></w:r>{runs}</w:p></w:{kind}>"
        );
        match note.kind {
            NoteKind::Foot => self.notes.footnotes.push(xml),
            NoteKind::End => self.notes.endnotes.push(xml),
        }
        format!("<w:r><w:rPr><w:rStyle w:val=\"{style}Reference\"/></w:rPr><w:{kind}Reference w:id=\"{n}\"/></w:r>")
    }

    /// A picture run, or the description in brackets when the picture is not in the file.
    fn picture(&mut self, dest: &str, alt: &str) -> String {
        let media = if self.sub_part { None } else { self.media.get(dest) };
        let Some(media) = media else {
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

/// The ends of a comment and its replies, each with its reference run.
fn comment_ends(ids: &[u32]) -> String {
    let mut out = String::new();
    for n in ids {
        out.push_str(&format!(
            "<w:commentRangeEnd w:id=\"{n}\"/><w:r><w:rPr><w:rStyle w:val=\"CommentReference\"/></w:rPr>\
             <w:commentReference w:id=\"{n}\"/></w:r>"
        ));
    }
    out
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
