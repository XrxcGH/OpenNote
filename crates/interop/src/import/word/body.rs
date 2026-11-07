//! Reading the body of a Word document: paragraphs with their runs, lists, and tables, with run formatting
//! resolved through the styles (ECMA-376 Part 1, 17.7.2 and 17.7.3), paragraph formatting, notes, comments,
//! and tracked changes.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::{Map, Value};

use super::marks::{marks_of, over_style, plain_style_name};
use super::notes::Sources;
use super::numbering::Numbering;
use super::package::Rel;
use super::paras::para_keys;
use super::props::{resolve, ParaProps, RunProps, Toggle};
use super::styles::{child, children, val, StyleKind, Styles};
use super::theme::{Script as TextScript, Theme};
use super::TrackedChanges;
use crate::doc::{push_text, Block, Inline, Marks};
use crate::import::xmltree::{Element, Node};
use opennote_core::{Clock, ElementId};

mod records;
mod tables;

/// The character that stands for a page break inside a paragraph, until the paragraph is split.
const BREAK_MARK: char = '\u{c}';

/// The shading of OpenNote's callouts in a Word file, as the writer draws it (`docx::ppr::CALLOUT_FILL`).
const CALLOUT_FILL: &str = "F4F0EA";

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
        /// The number the item shows (`R-LIST-3`), or the first number of a list known only by its style.
        start: u64,
    },
}

impl Default for Kind {
    fn default() -> Kind {
        Kind::Styled(StyleKind::Normal)
    }
}

/// The formatting of one element (spec 6.6): its named style, and its `data.paras` entry.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Fmt {
    /// The style name, when the element's kind does not imply it.
    pub style: Option<String>,
    /// The paragraph formatting (spec 6.8).
    pub para: Map<String, Value>,
}

impl Fmt {
    pub fn is_empty(&self) -> bool {
        self.style.is_none() && self.para.is_empty()
    }
}

/// A paragraph of the body.
#[derive(Clone, Debug, Default)]
pub(super) struct Para {
    pub kind: Kind,
    pub inlines: Vec<Inline>,
    /// The names of the bookmarks that start in the paragraph, which links inside the file point to.
    pub bookmarks: Vec<String>,
    /// Whether the paragraph has a shaded background, as a callout's paragraphs do.
    pub shaded: bool,
    /// Its formatting.
    pub fmt: Fmt,
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
    pub hidden_runs: usize,
    pub images: usize,
    pub tables: usize,
    pub links: usize,
    pub footnotes: usize,
    pub endnotes: usize,
    /// Notes, comments, and suggestions inside tables, which keep only their text.
    pub table_marks: usize,
    pub suggestions: usize,
    /// Suggestions that were accepted or rejected as the import asked.
    pub settled: usize,
    /// Changes to paragraph marks and paragraph formatting, which have no suggestion form.
    pub para_changes: usize,
    /// Glow, reflection, 3-D, and gradient fills.
    pub effects: usize,
    /// Runs whose Latin, East Asian, and complex script fonts differ.
    pub script_fonts: usize,
    /// Runs that drop a value their paragraph's style gives, such as its color, which nothing can say.
    pub style_overrides: usize,
}

/// The records a body gives its text blocks (spec 6.10), by ID.
#[derive(Debug, Default)]
pub(super) struct Records {
    pub notes: BTreeMap<String, Value>,
    pub comments: BTreeMap<String, Value>,
    pub suggestions: BTreeMap<String, Value>,
}

/// A tracked change around the runs being read.
#[derive(Clone, Debug)]
struct Change {
    insert: bool,
    /// The suggestion's ID, when changes are kept as suggestions.
    id: Option<String>,
}

/// Reads the body.
pub(super) struct Reader<'a> {
    pub rels: &'a HashMap<String, Rel>,
    pub styles: &'a Styles,
    pub numbering: &'a Numbering,
    pub stats: Stats,
    pub records: Records,
    /// The Word style IDs of the paragraphs read, for the page style sheet.
    pub used_styles: BTreeSet<String>,
    /// The plain character styles that runs use, as `OFF_*` bits of [`super::marks`].
    pub plain_styles: BTreeSet<u8>,
    theme: Theme,
    sources: Option<&'a Sources>,
    clock: Option<&'a dyn Clock>,
    changes: TrackedChanges,
    /// When a date is missing: the time of the file.
    now: String,
    /// Paragraphs of text boxes, to add after the paragraph that holds them.
    pending: Vec<Item>,
    /// The comments whose ranges are open, by their IDs in the file, with the IDs they get.
    open_comments: Vec<(String, String)>,
    comment_ids: HashMap<String, String>,
    change: Vec<Change>,
    /// How deep in tables the reading is.
    in_table: usize,
    /// Whether this reads the text of a note or comment, which holds no notes or comments of its own.
    nested: bool,
    /// The marks a paragraph's style gives, and the style chains of the paragraph and its table.
    base: Marks,
    para_run: RunProps,
    table_run: RunProps,
    /// List numbers so far by list ID and level, and the lists that restarted.
    counters: HashMap<String, [Option<u64>; 9]>,
    restarted: BTreeSet<(u32, u32)>,
}

impl<'a> Reader<'a> {
    pub fn new(rels: &'a HashMap<String, Rel>, styles: &'a Styles, numbering: &'a Numbering) -> Reader<'a> {
        Reader {
            rels,
            styles,
            numbering,
            stats: Stats::default(),
            records: Records::default(),
            used_styles: BTreeSet::new(),
            plain_styles: BTreeSet::new(),
            theme: Theme::default(),
            sources: None,
            clock: None,
            changes: TrackedChanges::Suggest,
            now: String::new(),
            pending: Vec::new(),
            open_comments: Vec::new(),
            comment_ids: HashMap::new(),
            change: Vec::new(),
            in_table: 0,
            nested: false,
            base: Marks::none(),
            para_run: RunProps::default(),
            table_run: RunProps::default(),
            counters: HashMap::new(),
            restarted: BTreeSet::new(),
        }
    }

    /// Gives the reader the theme and the note and comment texts. It also gets the clock for new IDs, the choice
    /// for tracked changes, and the time to give records without a date.
    pub fn with(
        mut self,
        theme: Theme,
        sources: &'a Sources,
        clock: &'a dyn Clock,
        changes: TrackedChanges,
        now: String,
    ) -> Reader<'a> {
        self.theme = theme;
        self.sources = Some(sources);
        self.clock = Some(clock);
        self.changes = changes;
        self.now = now;
        self
    }

    fn new_id(&self) -> Option<String> {
        self.clock.map(|c| ElementId::generate(c).to_string())
    }

    /// Reads a `w:document` element.
    pub fn document(&mut self, root: &Element) -> Vec<Item> {
        let mut items = Vec::new();
        match child(root, "w:body") {
            Some(body) => self.block_content(body, &mut items),
            None => self.block_content(root, &mut items),
        }
        self.finish_comments();
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
                "w:ins" | "w:del" | "w:moveto" | "w:movefrom" => {
                    let entered = self.enter_change(e);
                    self.block_content(e, items);
                    if entered {
                        self.change.pop();
                    }
                }
                "w:customxml" | "w:smarttag" | "w:txbxcontent" => self.block_content(e, items),
                "w:commentrangestart" => self.open_comment(e),
                "w:commentrangeend" => self.close_comment(e),
                _ => {}
            }
        }
    }

    fn paragraph(&mut self, p: &Element, items: &mut Vec<Item>) {
        let props = child(p, "w:ppr");
        let style_id = self
            .styles
            .paragraph_style(props.and_then(|props| val(props, "w:pstyle")))
            .map(str::to_owned);
        self.para_run = style_id
            .as_deref()
            .map(|id| self.styles.run_chain(id))
            .unwrap_or_default();
        let base_props = if self.in_table > 0 {
            // A table cell's text shows with the page's normal style, so the table and paragraph styles become
            // run marks.
            let normal = self.styles.paragraph_style(None).map(|id| self.styles.run_chain(id));
            resolve(&self.styles.defaults_run, &[&normal.unwrap_or_default()], None)
        } else {
            resolve(&self.styles.defaults_run, &[&self.para_run], None)
        };
        self.base = marks_of(&base_props, &self.theme, TextScript::Latin);
        if let Some(changed) = props.and_then(|p| child(p, "w:rpr")) {
            if ["w:ins", "w:del", "w:moveto", "w:movefrom"]
                .iter()
                .any(|name| child(changed, name).is_some())
            {
                self.stats.para_changes += 1;
            }
        }
        if props.and_then(|p| child(p, "w:pprchange")).is_some() {
            self.stats.para_changes += 1;
        }
        let mut inlines = Vec::new();
        let mut link = None;
        self.inline_content(p, &Marks::none(), &mut link, &mut inlines);
        let kind = props.map_or(Kind::Styled(StyleKind::Normal), |props| self.kind(props));
        // Only the shading OpenNote gives its callouts makes a callout. Other shading is the paragraph's own
        // formatting (DESIGN 9.1 `shade`), which the paragraph keeps.
        let shaded = props
            .and_then(|props| child(props, "w:shd"))
            .and_then(|shd| shd.attr("w:fill"))
            .is_some_and(|fill| fill.eq_ignore_ascii_case(CALLOUT_FILL));
        let page_break_before = props.is_some_and(|props| child(props, "w:pagebreakbefore").is_some());
        if page_break_before {
            items.push(Item::PageBreak);
        }
        let bookmarks = children(p, "w:bookmarkstart")
            .filter_map(|b| b.attr("w:name"))
            .map(str::to_owned)
            .collect();
        let fmt = if self.in_table > 0 || self.nested {
            Fmt::default()
        } else {
            self.fmt(&kind, props, style_id.as_deref())
        };
        let (inlines, fmt) = join_drop_cap(items, inlines, fmt);
        self.emit(kind, shaded, bookmarks, inlines, fmt, items);
        items.append(&mut self.pending);
    }

    /// The formatting of a paragraph: its style when its kind does not imply it, and its direct paragraph
    /// properties. A list item takes its look from its list definition.
    fn fmt(&mut self, kind: &Kind, props: Option<&Element>, style_id: Option<&str>) -> Fmt {
        let mut fmt = Fmt::default();
        if let Some(props) = props {
            para_keys(&ParaProps::read(props), &self.theme, &mut fmt.para);
        }
        match kind {
            Kind::ListItem { level, num_id, .. } => {
                fmt.para.remove("indent");
                if let Some(id) = self.numbering.list_id(*num_id) {
                    let mut list = Map::new();
                    list.insert("id".to_owned(), Value::from(id));
                    if self.numbering.restarts(*num_id, *level) && self.restarted.insert((*num_id, *level)) {
                        list.insert("restart".to_owned(), Value::from(true));
                    }
                    fmt.para.insert("list".to_owned(), Value::Object(list));
                }
            }
            Kind::Styled(style_kind) => {
                if let Some(id) = style_id {
                    self.used_styles.insert(id.to_owned());
                    let name = self.styles.sheet_name(id);
                    let implied = match style_kind {
                        StyleKind::Normal => name == "normal",
                        StyleKind::Heading(n) if *n <= 6 => name == format!("h{n}") || name == "normal",
                        StyleKind::Quote => name == "quote",
                        StyleKind::Code => name == "code",
                        _ => false,
                    };
                    if !implied {
                        fmt.style = Some(name);
                    }
                }
                if let StyleKind::Heading(n) = style_kind {
                    if *n > 6 {
                        fmt.para.insert("outline".to_owned(), Value::from(*n));
                    } else {
                        fmt.para.remove("outline");
                    }
                }
            }
        }
        fmt
    }

    /// Adds a paragraph, split at the page breaks inside it.
    fn emit(
        &mut self,
        kind: Kind,
        shaded: bool,
        bookmarks: Vec<String>,
        inlines: Vec<Inline>,
        fmt: Fmt,
        items: &mut Vec<Item>,
    ) {
        let mut current = Vec::new();
        let mut broke = false;
        let para = |inlines: Vec<Inline>| {
            Item::Para(Para {
                kind: kind.clone(),
                inlines,
                bookmarks: bookmarks.clone(),
                shaded,
                fmt: fmt.clone(),
            })
        };
        for inline in inlines {
            match &inline {
                Inline::Text { text, marks } if text.contains(BREAK_MARK) => {
                    for (n, part) in text.split(BREAK_MARK).enumerate() {
                        if n > 0 {
                            broke = true;
                            items.push(para(std::mem::take(&mut current)));
                            items.push(Item::PageBreak);
                        }
                        push_text(&mut current, part, marks);
                    }
                }
                _ => current.push(inline),
            }
        }
        if broke || !current.is_empty() {
            items.push(para(current));
        } else {
            items.push(para(Vec::new()));
        }
    }

    fn kind(&mut self, props: &Element) -> Kind {
        let style_id = val(props, "w:pstyle");
        let style = style_id.map_or(StyleKind::Normal, |id| self.styles.kind(id));
        let own = child(props, "w:numpr");
        let number = |name| own.and_then(|n| val(n, name)).and_then(|v| v.parse::<u32>().ok());
        // The paragraph's own numbering wins; a list style such as "List Bullet" gives the rest.
        let from_style = style_id.and_then(|id| self.styles.list(id));
        let num_id = number("w:numid").or(from_style.map(|list| list.num_id));
        let level = number("w:ilvl")
            .or(from_style.and_then(|list| list.ilvl))
            .unwrap_or(0)
            .min(8);
        if !matches!(style, StyleKind::Heading(_) | StyleKind::Title) {
            if num_id.is_none() && own.is_none() {
                if let Some(ordered) = style_id.and_then(|id| self.styles.list_by_name(id)) {
                    return Kind::ListItem {
                        level,
                        // Lists known only by their style's name share one ID per kind.
                        num_id: if ordered { u32::MAX - 1 } else { u32::MAX - 2 },
                        ordered,
                        start: 1,
                    };
                }
            }
            if let Some(num_id) = num_id.filter(|id| *id != 0) {
                let look = self.numbering.level(num_id, level);
                let start = self.count(num_id, level, look.start);
                return Kind::ListItem {
                    level,
                    num_id,
                    ordered: look.ordered,
                    start,
                };
            }
        }
        // A paragraph with its own outline level stays a paragraph: Word shows it in the outline and the
        // navigation pane, but it keeps its style, so it keeps the `outline` attribute (DESIGN 9.1).
        Kind::Styled(style)
    }

    /// Counts a list item and returns the number it shows. Lists that share a definition count on, deeper levels
    /// start again after a shallower item as their `w:lvlRestart` says, and a `w:num` that overrides a level starts
    /// again at its first item.
    fn count(&mut self, num_id: u32, level: u32, start: u64) -> u64 {
        let key = self.numbering.list_id(num_id).unwrap_or_else(|| format!("x{num_id}"));
        let fresh = self.numbering.restarts(num_id, level) && !self.restarted.contains(&(num_id, level));
        let counters = self.counters.entry(key).or_insert([None; 9]);
        let level = level as usize;
        let shown = match counters[level] {
            Some(n) if !fresh => n + 1,
            _ => start,
        };
        counters[level] = Some(shown);
        for deeper in counters.iter_mut().skip(level + 1) {
            *deeper = None;
        }
        shown
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
                "w:ins" | "w:del" | "w:moveto" | "w:movefrom" => {
                    let entered = self.enter_change(e);
                    self.inline_content(e, marks, link, out);
                    if entered {
                        self.change.pop();
                    }
                }
                "w:smarttag" | "w:sdt" | "w:customxml" | "w:sdtcontent" => {
                    self.inline_content(e, marks, link, out);
                }
                "mc:alternatecontent" => {
                    if let Some(choice) = child(e, "mc:choice") {
                        self.inline_content(choice, marks, link, out);
                    }
                }
                "w:commentrangestart" => self.open_comment(e),
                "w:commentrangeend" => self.close_comment(e),
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

    /// The marks of a run with these direct properties, over the paragraph's style.
    fn marks_for(&mut self, direct: Option<&RunProps>, script: TextScript) -> (Marks, bool) {
        let char_style = direct
            .and_then(|d| d.style.as_deref())
            .map(|id| self.styles.run_chain(id))
            .unwrap_or_default();
        let resolved = resolve(
            &self.styles.defaults_run,
            &[&self.table_run, &self.para_run, &char_style],
            direct,
        );
        if resolved.effects != 0 {
            self.stats.effects += 1;
        }
        if self.theme.fonts_differ(&resolved.fonts) {
            self.stats.script_fonts += 1;
        }
        let hidden = resolved.toggle(Toggle::Vanish);
        let mut full = marks_of(&resolved, &self.theme, script);
        // A character style the file does not define still says what it means.
        match direct.and_then(|d| d.style.as_deref()) {
            Some("Strong") if self.styles.name("Strong").is_none() => full.strong = true,
            Some("Emphasis") if self.styles.name("Emphasis").is_none() => full.emphasis = true,
            _ => {}
        }
        let over = over_style(full, &self.base);
        self.stats.style_overrides += usize::from(over.lost);
        let mut marks = over.marks;
        if over.off != 0 {
            self.plain_styles.insert(over.off);
            marks.char_style = Some(plain_style_name(over.off));
        }
        (marks, hidden)
    }

    fn run(&mut self, r: &Element, outer: &Marks, link: &mut Option<String>, out: &mut Vec<Inline>) {
        let props = child(r, "w:rpr");
        let direct = props.map(RunProps::read);
        let Some((insertion, deletion)) = self.change_marks() else {
            return;
        };
        let script = TextScript::of(&run_text(r));
        let (mut marks, hidden) = self.marks_for(direct.as_ref(), script);
        if hidden {
            self.stats.hidden_runs += 1;
            return;
        }
        // A format change: kept as a suggestion with the marks before it, or settled.
        let before = props.and_then(|p| child(p, "w:rprchange")).map(|change| {
            let old = child(change, "w:rpr").map(RunProps::read).unwrap_or_default();
            (change, self.marks_for(Some(&old), script).0)
        });
        let mut format_change = None;
        if let Some((change, old)) = before {
            if self.changes == TrackedChanges::Reject {
                marks = old;
                self.stats.settled += 1;
            } else if self.changes == TrackedChanges::Accept || self.in_table > 0 || self.nested {
                self.stats.settled += 1;
            } else {
                let before = crate::doc::write::inlines_to_markdown(&[Inline::Text {
                    // The mark leaves the spaces at its edges outside (R-WS-1), so the range is the text between.
                    text: run_text(r).trim().to_owned(),
                    marks: old,
                }]);
                if let Some(id) = self.new_id() {
                    self.stats.suggestions += 1;
                    let record = self.suggestion("fmt", change, Some(before));
                    self.records.suggestions.insert(id.clone(), record);
                    format_change = Some(id);
                }
            }
        }
        if outer.link.is_some() {
            marks.link.clone_from(&outer.link);
        }
        if link.is_some() && marks.link.is_none() {
            marks.link.clone_from(link);
        }
        if marks.link.is_some() {
            // Word draws links blue and underlined, and OpenNote draws links its own way.
            marks.underline = false;
            marks.underline_line = None;
            marks.underline_color = None;
            marks.color = None;
        }
        marks.insertion = insertion;
        marks.deletion = deletion;
        marks.format_change = format_change;
        if self.in_table == 0 && !self.nested {
            let mut comments: Vec<String> = self.open_comments.iter().map(|(_, id)| id.clone()).collect();
            comments.sort();
            marks.comments = comments;
        }
        for node in &r.children {
            let Node::Element(e) = node else {
                continue;
            };
            match e.name.as_str() {
                "w:t" | "w:deltext" => push_text(out, &text_of(e), &marks),
                "w:tab" => push_text(out, " ", &marks),
                "w:nobreakhyphen" => push_text(out, "-", &marks),
                "w:br" | "w:cr" if e.attr("w:type") == Some("page") => push_text(out, &BREAK_MARK.to_string(), &marks),
                "w:br" | "w:cr" => out.push(Inline::HardBreak),
                "w:instrtext" => *link = hyperlink_in_instruction(&text_of(e)).or_else(|| link.take()),
                "w:fldchar" if e.attr("w:fldchartype") == Some("end") => *link = None,
                "w:drawing" | "w:pict" => self.drawing(e, out),
                "w:object" => self.stats.objects += 1,
                "w:footnotereference" => self.note(e, false, out),
                "w:endnotereference" => self.note(e, true, out),
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
            let (base, para_run) = (self.base.clone(), self.para_run.clone());
            self.block_content(content, &mut inner);
            (self.base, self.para_run) = (base, para_run);
            self.pending.append(&mut inner);
        }
        if !had_content {
            self.stats.shapes += 1;
        }
    }
}

/// Word writes a drop cap as a framed paragraph of its own that holds the letter, then the paragraph with the
/// rest (ECMA-376 Part 1, 17.3.1.11). The two become one paragraph again, with the `dropCap` attribute.
fn join_drop_cap(items: &mut Vec<Item>, inlines: Vec<Inline>, mut fmt: Fmt) -> (Vec<Inline>, Fmt) {
    let joins = match items.last() {
        Some(Item::Para(cap)) => {
            cap.fmt.para.contains_key("dropCap")
                && !cap.inlines.is_empty()
                && !inlines.is_empty()
                && !fmt.para.contains_key("dropCap")
        }
        _ => false,
    };
    if !joins {
        return (inlines, fmt);
    }
    let Some(Item::Para(cap)) = items.pop() else {
        return (inlines, fmt);
    };
    if let Some(drop_cap) = cap.fmt.para.get("dropCap") {
        fmt.para.insert("dropCap".to_owned(), drop_cap.clone());
    }
    let mut joined = Vec::new();
    for inline in cap.inlines.into_iter().chain(inlines) {
        match inline {
            Inline::Text { text, marks } => push_text(&mut joined, &text, &marks),
            other => joined.push(other),
        }
    }
    (joined, fmt)
}

/// The text of a run, for telling its script.
fn run_text(r: &Element) -> String {
    children(r, "w:t")
        .chain(children(r, "w:deltext"))
        .map(text_of)
        .collect()
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
