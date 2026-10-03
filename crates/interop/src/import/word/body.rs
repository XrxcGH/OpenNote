//! Reading the body of a Word document: paragraphs with their runs, lists, and tables.

use std::collections::HashMap;

use super::package::Rel;
use super::styles::{child, children, val, Numbering, StyleKind, Styles};
use crate::doc::{push_text, Block, Inline, Marks, Script};
use crate::import::xmltree::{Element, Node};
use crate::palette::{highlight_name, pen_name};

/// The character that stands for a page break inside a paragraph, until the paragraph is split.
const BREAK_MARK: char = '\u{c}';

/// Fonts that mark text as code.
const CODE_FONTS: &[&str] = &[
    "consolas",
    "courier new",
    "courier",
    "lucida console",
    "monaco",
    "menlo",
    "source code pro",
    "cascadia code",
    "cascadia mono",
    "fira code",
    "roboto mono",
];

/// What a paragraph is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Kind {
    /// A style that means something for a note.
    Styled(StyleKind),
    /// An item of a list at a level.
    ListItem {
        /// The depth, from 0.
        level: u32,
        /// The list's definition number, so neighboring lists can be told apart.
        num_id: u32,
        /// Whether the list is numbered.
        ordered: bool,
        /// The first number of the list.
        start: u64,
    },
}

/// A paragraph of the body.
#[derive(Clone, Debug)]
pub(super) struct Para {
    pub kind: Kind,
    pub inlines: Vec<Inline>,
    /// The names of the bookmarks that start in the paragraph, which links inside the file point to.
    pub bookmarks: Vec<String>,
    /// Whether the paragraph has a shaded background, as a callout's paragraphs do.
    pub shaded: bool,
}

/// A piece of the body.
#[derive(Clone, Debug)]
pub(super) enum Item {
    Para(Para),
    Table(Block),
    PageBreak,
}

/// What the reading left out or simplified, for the report.
#[derive(Debug, Default)]
pub(super) struct Stats {
    pub merged_cells: usize,
    pub nested_tables: usize,
    pub text_boxes: usize,
    pub shapes: usize,
    pub objects: usize,
    pub note_marks: usize,
    pub lettered_lists: usize,
    pub hidden_runs: usize,
    pub images: usize,
    pub tables: usize,
    pub links: usize,
}

/// Reads the body.
pub(super) struct Reader<'a> {
    pub rels: &'a HashMap<String, Rel>,
    pub styles: &'a Styles,
    pub numbering: &'a Numbering,
    pub stats: Stats,
    /// Paragraphs of text boxes, to add after the paragraph that holds them.
    pending: Vec<Item>,
}

impl<'a> Reader<'a> {
    pub fn new(rels: &'a HashMap<String, Rel>, styles: &'a Styles, numbering: &'a Numbering) -> Reader<'a> {
        Reader {
            rels,
            styles,
            numbering,
            stats: Stats::default(),
            pending: Vec::new(),
        }
    }

    /// Reads a `w:document` element.
    pub fn document(&mut self, root: &Element) -> Vec<Item> {
        let mut items = Vec::new();
        match child(root, "w:body") {
            Some(body) => self.block_content(body, &mut items),
            None => self.block_content(root, &mut items),
        }
        items
    }

    fn block_content(&mut self, parent: &Element, items: &mut Vec<Item>) {
        for node in &parent.children {
            let Node::Element(e) = node else {
                continue;
            };
            match e.name.as_str() {
                "w:p" => self.paragraph(e, items),
                "w:tbl" => {
                    if let Some(table) = self.table(e) {
                        items.push(Item::Table(table));
                        self.stats.tables += 1;
                    }
                }
                "w:sdt" => {
                    if let Some(content) = child(e, "w:sdtcontent") {
                        self.block_content(content, items);
                    }
                }
                "mc:alternatecontent" => {
                    if let Some(choice) = child(e, "mc:choice") {
                        self.block_content(choice, items);
                    }
                }
                "w:ins" | "w:customxml" | "w:smarttag" | "w:txbxcontent" => self.block_content(e, items),
                _ => {}
            }
        }
    }

    fn paragraph(&mut self, p: &Element, items: &mut Vec<Item>) {
        let props = child(p, "w:ppr");
        let mut inlines = Vec::new();
        let mut link = None;
        self.inline_content(p, &Marks::none(), &mut link, &mut inlines);
        let kind = props.map_or(Kind::Styled(StyleKind::Normal), |props| self.kind(props));
        let shaded = props
            .and_then(|props| child(props, "w:shd"))
            .and_then(|shd| shd.attr("w:fill"))
            .is_some_and(|fill| !fill.eq_ignore_ascii_case("auto") && !fill.eq_ignore_ascii_case("FFFFFF"));
        let page_break_before = props.is_some_and(|props| child(props, "w:pagebreakbefore").is_some());
        if page_break_before {
            items.push(Item::PageBreak);
        }
        let bookmarks = children(p, "w:bookmarkstart")
            .filter_map(|b| b.attr("w:name"))
            .map(str::to_owned)
            .collect();
        self.emit(kind, shaded, bookmarks, inlines, items);
        items.append(&mut self.pending);
    }

    /// Adds a paragraph, split at the page breaks inside it.
    fn emit(&mut self, kind: Kind, shaded: bool, bookmarks: Vec<String>, inlines: Vec<Inline>, items: &mut Vec<Item>) {
        let mut current = Vec::new();
        let mut broke = false;
        for inline in inlines {
            match &inline {
                Inline::Text { text, marks } if text.contains(BREAK_MARK) => {
                    for (n, part) in text.split(BREAK_MARK).enumerate() {
                        if n > 0 {
                            broke = true;
                            push_para(items, &kind, shaded, &bookmarks, std::mem::take(&mut current));
                            items.push(Item::PageBreak);
                        }
                        push_text(&mut current, part, marks);
                    }
                }
                _ => current.push(inline),
            }
        }
        if broke || !current.is_empty() {
            push_para(items, &kind, shaded, &bookmarks, current);
        } else {
            items.push(Item::Para(Para {
                kind,
                inlines: Vec::new(),
                bookmarks,
                shaded,
            }));
        }
    }

    fn kind(&mut self, props: &Element) -> Kind {
        let style = val(props, "w:pstyle").map_or(StyleKind::Normal, |id| self.styles.kind(id));
        if let Some(num) = child(props, "w:numpr") {
            let num_id: u32 = val(num, "w:numid").and_then(|v| v.parse().ok()).unwrap_or(0);
            let level: u32 = val(num, "w:ilvl").and_then(|v| v.parse().ok()).unwrap_or(0);
            if num_id != 0 && !matches!(style, StyleKind::Heading(_) | StyleKind::Title) {
                let look = self.numbering.level(num_id, level);
                self.stats.lettered_lists += usize::from(look.exotic);
                return Kind::ListItem {
                    level,
                    num_id,
                    ordered: look.ordered,
                    start: look.start,
                };
            }
        }
        if style == StyleKind::Normal {
            let outline = val(props, "w:outlinelvl").and_then(|v| v.parse::<u8>().ok());
            if let Some(level) = outline.filter(|l| *l < 6) {
                return Kind::Styled(StyleKind::Heading(level + 1));
            }
        }
        Kind::Styled(style)
    }

    /// Reads the runs of a paragraph or a hyperlink.
    fn inline_content(&mut self, parent: &Element, marks: &Marks, link: &mut Option<String>, out: &mut Vec<Inline>) {
        for node in &parent.children {
            let Node::Element(e) = node else {
                continue;
            };
            match e.name.as_str() {
                "w:r" => self.run(e, marks, link, out),
                "w:hyperlink" => {
                    let mut marks = marks.clone();
                    marks.link = self.hyperlink_target(e);
                    self.stats.links += usize::from(marks.link.is_some());
                    self.inline_content(e, &marks, link, out);
                }
                "w:fldsimple" => {
                    let target = e.attr("w:instr").and_then(hyperlink_in_instruction);
                    let mut marks = marks.clone();
                    marks.link = target.or(marks.link);
                    self.inline_content(e, &marks, link, out);
                }
                "w:ins" | "w:smarttag" | "w:sdt" | "w:customxml" | "w:sdtcontent" => {
                    self.inline_content(e, marks, link, out);
                }
                "mc:alternatecontent" => {
                    if let Some(choice) = child(e, "mc:choice") {
                        self.inline_content(choice, marks, link, out);
                    }
                }
                _ => {}
            }
        }
    }

    fn hyperlink_target(&mut self, e: &Element) -> Option<String> {
        if let Some(rel) = e.attr("r:id").and_then(|id| self.rels.get(id)) {
            let target = rel.target.trim();
            let safe = ["http:", "https:", "mailto:", "tel:"]
                .iter()
                .any(|s| target.to_ascii_lowercase().starts_with(s));
            return safe.then(|| target.to_owned());
        }
        e.attr("w:anchor").map(|anchor| format!("#{anchor}"))
    }

    fn run(&mut self, r: &Element, outer: &Marks, link: &mut Option<String>, out: &mut Vec<Inline>) {
        let props = child(r, "w:rpr");
        if props.is_some_and(|p| flag(p, "w:vanish")) {
            self.stats.hidden_runs += 1;
            return;
        }
        let mut marks = props.map_or_else(Marks::none, run_marks);
        if outer.link.is_some() {
            marks.link.clone_from(&outer.link);
        }
        if link.is_some() && marks.link.is_none() {
            marks.link.clone_from(link);
        }
        if marks.link.is_some() {
            // Word draws links blue and underlined, and OpenNote draws links its own way.
            marks.underline = false;
            marks.color = None;
        }
        for node in &r.children {
            let Node::Element(e) = node else {
                continue;
            };
            match e.name.as_str() {
                "w:t" => push_text(out, &text_of(e), &marks),
                "w:tab" => push_text(out, " ", &marks),
                "w:nobreakhyphen" => push_text(out, "-", &marks),
                "w:br" | "w:cr" if e.attr("w:type") == Some("page") => push_text(out, &BREAK_MARK.to_string(), &marks),
                "w:br" | "w:cr" => out.push(Inline::HardBreak),
                "w:instrtext" => *link = hyperlink_in_instruction(&text_of(e)).or_else(|| link.take()),
                "w:fldchar" if e.attr("w:fldchartype") == Some("end") => *link = None,
                "w:drawing" | "w:pict" => self.drawing(e, out),
                "w:object" => self.stats.objects += 1,
                "w:footnotereference" | "w:endnotereference" | "w:commentreference" => self.stats.note_marks += 1,
                "mc:alternatecontent" => {
                    if let Some(choice) = child(e, "mc:choice") {
                        self.run_children(choice, out);
                    }
                }
                _ => {}
            }
        }
    }

    fn run_children(&mut self, parent: &Element, out: &mut Vec<Inline>) {
        for node in &parent.children {
            if let Node::Element(e) = node {
                if matches!(e.name.as_str(), "w:drawing" | "w:pict") {
                    self.drawing(e, out);
                }
            }
        }
    }

    /// A picture becomes an image whose destination names its file in the package. Text boxes add paragraphs.
    fn drawing(&mut self, e: &Element, out: &mut Vec<Inline>) {
        let description = find_attr(e, "wp:docpr", "descr").unwrap_or_default();
        let blip = find_attr(e, "a:blip", "r:embed").or_else(|| find_attr(e, "v:imagedata", "r:id"));
        let target = blip.and_then(|id| self.rels.get(&id)).map(|rel| rel.target.clone());
        let mut had_content = false;
        if let Some(target) = target {
            self.stats.images += 1;
            had_content = true;
            out.push(Inline::Image {
                dest: format!("docx:{target}"),
                alt: description,
            });
        }
        let mut boxes = Vec::new();
        collect_named(e, "w:txbxcontent", &mut boxes);
        for content in boxes {
            self.stats.text_boxes += 1;
            had_content = true;
            let mut inner = Vec::new();
            self.block_content(content, &mut inner);
            self.pending.append(&mut inner);
        }
        if !had_content {
            self.stats.shapes += 1;
        }
    }

    fn table(&mut self, tbl: &Element) -> Option<Block> {
        let mut rows: Vec<Vec<Vec<Inline>>> = Vec::new();
        let mut header = false;
        for (index, tr) in children(tbl, "w:tr").enumerate() {
            let is_header = child(tr, "w:trpr").is_some_and(|p| child(p, "w:tblheader").is_some());
            header |= is_header && index == 0;
            let mut cells = Vec::new();
            for tc in children(tr, "w:tc") {
                let props = child(tc, "w:tcpr");
                let span: usize = props
                    .and_then(|p| val(p, "w:gridspan"))
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1);
                let continues = props
                    .and_then(|p| child(p, "w:vmerge"))
                    .is_some_and(|m| m.attr("w:val") != Some("restart"));
                self.stats.merged_cells += usize::from(span > 1 || continues);
                cells.push(if continues { Vec::new() } else { self.cell(tc) });
                cells.extend(std::iter::repeat_with(Vec::new).take(span.saturating_sub(1)));
            }
            if !cells.is_empty() {
                rows.push(cells);
            }
        }
        if rows.is_empty() {
            return None;
        }
        let look_first_row = child(tbl, "w:tblpr")
            .and_then(|p| child(p, "w:tbllook"))
            .and_then(|l| l.attr("w:firstrow"))
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
        let header = header || look_first_row;
        if header {
            // Header cells are shown in bold anyway, so bold text in them says nothing.
            for cell in rows.first_mut().into_iter().flatten() {
                for inline in cell {
                    if let Inline::Text { marks, .. } = inline {
                        marks.strong = false;
                    }
                }
            }
        }
        Some(Block::Table { header, rows })
    }

    /// The text of a table cell: its paragraphs, joined by line breaks.
    fn cell(&mut self, tc: &Element) -> Vec<Inline> {
        let mut inner = Vec::new();
        self.block_content(tc, &mut inner);
        let mut inlines: Vec<Inline> = Vec::new();
        for item in inner {
            let (content, prefix) = match item {
                Item::Para(para) => {
                    let bullet = matches!(para.kind, Kind::ListItem { .. });
                    (para.inlines, bullet)
                }
                Item::Table(Block::Table { rows, .. }) => {
                    self.stats.nested_tables += 1;
                    let mut flat = Vec::new();
                    for (n, cell) in rows.into_iter().flatten().enumerate() {
                        if n > 0 {
                            flat.push(Inline::text(" | "));
                        }
                        flat.extend(cell);
                    }
                    (flat, false)
                }
                _ => continue,
            };
            if content.is_empty() {
                continue;
            }
            if !inlines.is_empty() {
                inlines.push(Inline::HardBreak);
            }
            if prefix {
                inlines.push(Inline::text("\u{2022} "));
            }
            inlines.extend(content);
        }
        inlines
    }
}

fn push_para(items: &mut Vec<Item>, kind: &Kind, shaded: bool, bookmarks: &[String], inlines: Vec<Inline>) {
    items.push(Item::Para(Para {
        kind: kind.clone(),
        inlines,
        bookmarks: bookmarks.to_vec(),
        shaded,
    }));
}

/// The text inside a `w:t` or `w:instrText`.
fn text_of(e: &Element) -> String {
    e.children
        .iter()
        .filter_map(|n| match n {
            Node::Text(t) => Some(t.as_str()),
            Node::Element(_) => None,
        })
        .collect()
}

/// Whether a run property such as `w:b` is on. Its `w:val` can switch it off.
fn flag(props: &Element, name: &str) -> bool {
    child(props, name).is_some_and(|e| !matches!(e.attr("w:val"), Some("0" | "false" | "off" | "none")))
}

fn run_marks(props: &Element) -> Marks {
    let mut marks = Marks::none();
    marks.strong = flag(props, "w:b");
    marks.emphasis = flag(props, "w:i");
    marks.strike = flag(props, "w:strike") || flag(props, "w:dstrike");
    marks.underline = child(props, "w:u").is_some_and(|u| u.attr("w:val") != Some("none"));
    marks.script = match val(props, "w:vertalign") {
        Some("superscript") => Some(Script::Sup),
        Some("subscript") => Some(Script::Sub),
        _ => None,
    };
    marks.color = val(props, "w:color")
        .filter(|c| !c.eq_ignore_ascii_case("auto") && c.len() == 6)
        .filter(|c| !is_near_black(c))
        .map(pen_name);
    marks.highlight = highlight_of(props);
    marks.code = child(props, "w:rfonts").is_some_and(|f| {
        ["w:ascii", "w:hansi", "w:cs"]
            .iter()
            .filter_map(|a| f.attr(a))
            .any(|font| CODE_FONTS.contains(&font.to_lowercase().as_str()))
    });
    marks.size = val(props, "w:sz").and_then(|v| match v {
        "18" => Some("small".to_owned()),
        "28" => Some("large".to_owned()),
        "36" => Some("xlarge".to_owned()),
        _ => None,
    });
    match val(props, "w:rstyle") {
        Some("Strong") => marks.strong = true,
        Some("Emphasis") => marks.emphasis = true,
        _ => {}
    }
    marks
}

fn is_near_black(hex: &str) -> bool {
    (0..3).all(|i| {
        hex.get(i * 2..i * 2 + 2)
            .and_then(|d| u8::from_str_radix(d, 16).ok())
            .is_some_and(|v| v <= 0x22)
    })
}

/// The highlighter that a run's highlight or shading stands for.
fn highlight_of(props: &Element) -> Option<String> {
    if let Some(shd) = child(props, "w:shd").and_then(|s| s.attr("w:fill")) {
        if let Some(name) = highlight_name(shd) {
            return Some(name.to_owned());
        }
    }
    let name = match val(props, "w:highlight")? {
        "none" => return None,
        "green" | "darkGreen" => "mint",
        "magenta" | "red" | "darkRed" | "darkMagenta" => "rose",
        "cyan" | "blue" | "darkBlue" | "darkCyan" => "lilac",
        "lightGray" | "darkGray" | "black" => "apricot",
        _ => "honey",
    };
    Some(name.to_owned())
}

/// The address in a field instruction such as `HYPERLINK "https://example.org"`.
fn hyperlink_in_instruction(instruction: &str) -> Option<String> {
    let rest = instruction.trim().strip_prefix("HYPERLINK")?.trim();
    let url = rest.strip_prefix('"')?.split('"').next()?;
    let lower = url.to_ascii_lowercase();
    ["http:", "https:", "mailto:"]
        .iter()
        .any(|s| lower.starts_with(s))
        .then(|| url.to_owned())
}

/// The value of an attribute of the first element with this name below `e`.
fn find_attr(e: &Element, name: &str, attr: &str) -> Option<String> {
    for node in &e.children {
        if let Node::Element(c) = node {
            if c.name == name {
                if let Some(value) = c.attr(attr) {
                    return Some(value.to_owned());
                }
            }
            if c.name != "mc:fallback" {
                if let Some(found) = find_attr(c, name, attr) {
                    return Some(found);
                }
            }
        }
    }
    None
}

/// Collects the elements with this name below `e`, skipping fallback copies.
fn collect_named<'e>(e: &'e Element, name: &str, found: &mut Vec<&'e Element>) {
    for node in &e.children {
        if let Node::Element(c) = node {
            if c.name == name {
                found.push(c);
            } else if c.name != "mc:fallback" {
                collect_named(c, name, found);
            }
        }
    }
}
