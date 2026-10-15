//! A page's content ([MS-ONE] 1.3.2, 2.2.19 to 2.2.36): outlines, outline elements, rich text, tables,
//! pictures, and attached files.
//!
//! The walker visits each object once, stops at [`limits::DEPTH`] levels and [`limits::ITEMS`] items, and counts
//! what it cannot read instead of failing the page.

use std::collections::HashSet;

use super::bytes::{utf16, ExGuid};
use super::ids::{idx, jcid, prop};
use super::limits;
use super::model::{Attached, Blob, Item, ListKind, Missed, Paragraph, Run, Tag};
use super::props::PropSet;
use super::space::{File, FileData, Object, Space};

/// The note tag shapes that are check boxes ([MS-ONE] 2.3.86).
const CHECKABLE: [u64; 15] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 28, 30, 32];

/// Reads the content of one page.
pub(crate) struct Walker<'f, 'a> {
    file: &'f File<'a>,
    space: &'f Space<'a>,
    seen: HashSet<ExGuid>,
    items: usize,
    /// What could not be read.
    pub missed: Missed,
}

impl<'f, 'a> Walker<'f, 'a> {
    pub(crate) fn new(file: &'f File<'a>, space: &'f Space<'a>) -> Walker<'f, 'a> {
        Walker {
            file,
            space,
            seen: HashSet::new(),
            items: 0,
            missed: Missed::default(),
        }
    }

    /// An object's type and properties, once. `None` for a file data object, a repeat, or damage.
    fn props(&mut self, id: ExGuid) -> Option<(u32, PropSet<'a>)> {
        if !self.seen.insert(id) {
            return None;
        }
        match self.space.object(id)? {
            Ok(Object::Props { jcid, props }) => Some((idx(jcid), props)),
            Ok(Object::File { .. }) => None,
            Err(_) => {
                self.missed.damaged += 1;
                None
            }
        }
    }

    /// The text of the page's title node ([MS-ONE] 2.2.29), one line.
    pub(crate) fn title(&mut self, page: &PropSet<'a>) -> String {
        let mut items = Vec::new();
        for id in page.objects(prop::STRUCTURE_ELEMENT_CHILD_NODES) {
            match self.props(*id) {
                Some((kind, title)) if kind == idx(jcid::TITLE) => {
                    for outline in title.objects(prop::ELEMENT_CHILD_NODES) {
                        self.outline(*outline, &mut items);
                    }
                }
                _ => {}
            }
        }
        let lines: Vec<String> = items
            .iter()
            .filter_map(|item| match item {
                Item::Text(p) => Some(p.runs.iter().map(|r| r.text.as_str()).collect::<String>()),
                _ => None,
            })
            .collect();
        lines.join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// The outlines, pictures, and files placed on the page, top to bottom.
    pub(crate) fn page_children(&mut self, page: &PropSet<'a>) -> Vec<Item> {
        let mut placed: Vec<(f32, f32, ExGuid)> = Vec::new();
        for id in page.objects(prop::ELEMENT_CHILD_NODES) {
            let Some(object) = self.space.object(*id) else {
                continue;
            };
            let at = match object {
                Ok(Object::Props { props, .. }) => (
                    float(&props, prop::OFFSET_FROM_PARENT_VERT),
                    float(&props, prop::OFFSET_FROM_PARENT_HORIZ),
                ),
                _ => (0.0, 0.0),
            };
            placed.push((at.0, at.1, *id));
        }
        placed.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        let mut items = Vec::new();
        for (_, _, id) in placed {
            self.content(id, 0, None, &mut items);
        }
        items
    }

    /// An outline or outline group: its outline elements.
    fn outline(&mut self, id: ExGuid, out: &mut Vec<Item>) {
        let Some((kind, props)) = self.props(id) else {
            return;
        };
        if kind != idx(jcid::OUTLINE) && kind != idx(jcid::OUTLINE_GROUP) {
            self.missed.unknown += 1;
            return;
        }
        for child in props.objects(prop::ELEMENT_CHILD_NODES) {
            self.element(*child, 0, out);
        }
    }

    /// An outline element ([MS-ONE] 2.2.21): its content, then its indented children.
    fn element(&mut self, id: ExGuid, depth: usize, out: &mut Vec<Item>) {
        if depth > limits::DEPTH || self.items >= limits::ITEMS {
            self.missed.too_deep += 1;
            return;
        }
        let Some((kind, props)) = self.props(id) else {
            return;
        };
        if kind == idx(jcid::OUTLINE_GROUP) {
            for child in props.objects(prop::ELEMENT_CHILD_NODES) {
                self.element(*child, depth, out);
            }
            return;
        }
        if kind != idx(jcid::OUTLINE_ELEMENT) {
            self.missed.unknown += 1;
            return;
        }
        let mut list = self.list_kind(&props);
        for content in props.objects(prop::CONTENT_CHILD_NODES) {
            self.content(*content, depth, list.take(), out);
        }
        for child in props.objects(prop::ELEMENT_CHILD_NODES) {
            self.element(*child, depth + 1, out);
        }
    }

    /// Whether an outline element is a list item ([MS-ONE] 2.2.25, 2.3.20): numbered when its format holds
    /// U+FFFD, bulleted otherwise.
    fn list_kind(&mut self, element: &PropSet<'a>) -> Option<ListKind> {
        let id = *element.objects(prop::LIST_NODES).first()?;
        let (kind, list) = self.props(id)?;
        if kind != idx(jcid::NUMBER_LIST) {
            return None;
        }
        let format = list.bytes(prop::NUMBER_LIST_FORMAT).unwrap_or_default();
        let numbered = format
            .as_chunks::<2>()
            .0
            .iter()
            .skip(1)
            .any(|c| u16::from_le_bytes(*c) == 0xFFFD);
        Some(if numbered { ListKind::Number } else { ListKind::Bullet })
    }

    /// One piece of content: rich text, a picture, a table, a file, or an outline placed on the page.
    fn content(&mut self, id: ExGuid, depth: usize, list: Option<ListKind>, out: &mut Vec<Item>) {
        if self.items >= limits::ITEMS {
            self.missed.too_deep += 1;
            return;
        }
        let Some((kind, props)) = self.props(id) else {
            return;
        };
        self.items += 1;
        match kind {
            k if k == idx(jcid::RICH_TEXT) => out.push(Item::Text(self.paragraph(&props, depth, list))),
            k if k == idx(jcid::OUTLINE) || k == idx(jcid::OUTLINE_GROUP) => {
                for child in props.objects(prop::ELEMENT_CHILD_NODES) {
                    self.element(*child, depth, out);
                }
            }
            k if k == idx(jcid::IMAGE) => out.push(Item::Picture(Attached {
                name: props.text(prop::IMAGE_FILENAME).unwrap_or_default(),
                alt: props.text(prop::IMAGE_ALT_TEXT).unwrap_or_default(),
                data: self.blob(&props, prop::PICTURE_CONTAINER),
            })),
            k if k == idx(jcid::EMBEDDED_FILE) => out.push(Item::File(Attached {
                name: props.text(prop::EMBEDDED_FILE_NAME).unwrap_or_default(),
                alt: String::new(),
                data: self.blob(&props, prop::EMBEDDED_FILE_CONTAINER),
            })),
            k if k == idx(jcid::TABLE) => {
                let table = self.table(&props, depth);
                out.push(Item::Table(table));
            }
            _ => self.missed.unknown += 1,
        }
    }

    /// The bytes of the file data object a property points to ([MS-ONE] 2.1.5).
    fn blob(&mut self, props: &PropSet<'a>, which: u32) -> Blob {
        let Some(id) = props.objects(which).first() else {
            return Blob::Missing;
        };
        match self.space.object(*id) {
            Some(Ok(Object::File { reference, .. })) => match self.file.file_data(&reference) {
                FileData::Inside(bytes) => Blob::Inside(bytes.to_vec()),
                FileData::Outside(name) => Blob::Outside(name),
                FileData::Missing => Blob::Missing,
            },
            _ => Blob::Missing,
        }
    }

    /// A table ([MS-ONE] 2.2.26 to 2.2.28): rows of cells, each a list of outline elements.
    fn table(&mut self, table: &PropSet<'a>, depth: usize) -> Vec<Vec<Vec<Item>>> {
        let mut rows = Vec::new();
        for row_id in table.objects(prop::ELEMENT_CHILD_NODES) {
            let row = match self.props(*row_id) {
                Some((kind, row)) if kind == idx(jcid::TABLE_ROW) => row,
                _ => continue,
            };
            let mut cells = Vec::new();
            for cell_id in row.objects(prop::ELEMENT_CHILD_NODES) {
                let mut items = Vec::new();
                match self.props(*cell_id) {
                    Some((kind, cell)) if kind == idx(jcid::TABLE_CELL) => {
                        for element in cell.objects(prop::ELEMENT_CHILD_NODES) {
                            self.element(*element, depth + 1, &mut items);
                        }
                    }
                    _ => {}
                }
                cells.push(items);
            }
            rows.push(cells);
        }
        rows
    }

    /// A rich text paragraph ([MS-ONE] 2.2.23, 2.2.76, 2.2.77).
    fn paragraph(&mut self, text: &PropSet<'a>, depth: usize, list: Option<ListKind>) -> Paragraph {
        let units: Vec<u16> = match text.bytes(prop::RICH_EDIT_TEXT_UNICODE) {
            Some(bytes) => utf16(bytes).encode_utf16().collect(),
            None => {
                let ascii = text.bytes(prop::TEXT_EXTENDED_ASCII).unwrap_or_default();
                encoding_rs::WINDOWS_1252.decode(ascii).0.encode_utf16().collect()
            }
        };
        let ends = text.numbers(prop::TEXT_RUN_INDEX);
        let formats: Vec<ExGuid> = text.objects(prop::TEXT_RUN_FORMATTING).to_vec();
        let mut runs = Vec::new();
        let mut start = 0usize;
        for i in 0..=ends.len() {
            let end = ends
                .get(i)
                .map_or(units.len(), |e| (*e as usize).clamp(start, units.len()));
            let mut run = formats.get(i).map(|f| self.run_format(*f)).unwrap_or_default();
            run.text = String::from_utf16_lossy(&units[start..end]);
            if !run.text.is_empty() {
                runs.push(run);
            }
            start = end;
        }
        Paragraph {
            runs,
            heading: self.heading(text),
            list,
            depth,
            tags: self.tags(text),
        }
    }

    /// The format of a text run ([MS-ONE] 2.2.43). Style objects are shared, so they are read every time.
    fn run_format(&mut self, id: ExGuid) -> Run {
        let Some(Ok(Object::Props { props, .. })) = self.space.object(id) else {
            return Run::default();
        };
        Run {
            text: String::new(),
            bold: props.flag(prop::BOLD),
            italic: props.flag(prop::ITALIC),
            underline: props.flag(prop::UNDERLINE),
            strike: props.flag(prop::STRIKETHROUGH),
            superscript: props.flag(prop::SUPERSCRIPT),
            subscript: props.flag(prop::SUBSCRIPT),
            hyperlink: props.flag(prop::HYPERLINK),
        }
    }

    /// The heading level of a paragraph style named `h1` to `h6` or `Heading 1` to `Heading 6`.
    fn heading(&mut self, text: &PropSet<'a>) -> u8 {
        let Some(id) = text.objects(prop::PARAGRAPH_STYLE).first() else {
            return 0;
        };
        let Some(Ok(Object::Props { props, .. })) = self.space.object(*id) else {
            return 0;
        };
        let name = props
            .text(prop::PARAGRAPH_STYLE_ID)
            .unwrap_or_default()
            .to_ascii_lowercase();
        let level = name
            .strip_prefix("heading")
            .or_else(|| name.strip_prefix('h'))
            .and_then(|n| n.trim().parse::<u8>().ok());
        level.filter(|l| (1..=6).contains(l)).unwrap_or(0)
    }

    /// The note tags of a paragraph ([MS-ONE] 2.2.42, 2.2.88).
    fn tags(&mut self, text: &PropSet<'a>) -> Vec<Tag> {
        let mut tags = Vec::new();
        for state in text.sets(prop::NOTE_TAG_STATES).iter().take(9) {
            let status = state.number(prop::ACTION_ITEM_STATUS).unwrap_or(0);
            let mut shape = state.number(prop::NOTE_TAG_SHAPE);
            let mut label = String::new();
            if let Some(id) = state.objects(prop::NOTE_TAG_DEFINITION_OID).first() {
                if let Some(Ok(Object::Props { props, .. })) = self.space.object(*id) {
                    label = props.text(prop::NOTE_TAG_LABEL).unwrap_or_default();
                    shape = shape.or(props.number(prop::NOTE_TAG_SHAPE));
                }
            }
            let checkable = shape.is_some_and(|s| CHECKABLE.contains(&s));
            tags.push(Tag {
                label,
                checkable,
                done: checkable && status & 1 == 1,
            });
        }
        tags
    }
}

/// A 4-byte float property, or 0.
fn float(props: &PropSet<'_>, which: u32) -> f32 {
    match props.bytes(which) {
        Some(b) if b.len() == 4 => {
            let v = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            if v.is_finite() {
                v
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}
