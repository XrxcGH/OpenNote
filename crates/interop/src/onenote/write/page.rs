//! The objects of a page ([MS-ONE] 2.1.10 and 2.2), a sample section, and a stored cabinet.

use super::layout::Props;
use super::{Guids, PageSpec, ParaSpec, SectionSpec, Space, TagSpec};
use crate::onenote::bytes::{ExGuid, Guid};
use crate::onenote::ids::{jcid, prop};

/// 2026-01-01T00:00:00Z in FILETIME units, and 2026-01-02T00:00:00Z in Time32 units.
const CREATED: u64 = 134_116_992_000_000_000;
const MODIFIED: u32 = 1_451_779_200;

/// Builds the object space of a page.
pub(super) fn page_space(spec: &PageSpec, guids: &mut Guids, files: &mut Vec<(Guid, Vec<u8>)>) -> Space {
    let mut s = Space::new(guids);
    let title_text = s.add(
        jcid::RICH_TEXT,
        title_props(spec.old_title.as_deref().unwrap_or(&spec.title)),
    );
    let title_element = s.add(
        jcid::OUTLINE_ELEMENT,
        children(prop::CONTENT_CHILD_NODES, &[title_text]),
    );
    let title_outline = s.add(jcid::OUTLINE, children(prop::ELEMENT_CHILD_NODES, &[title_element]));
    let title = s.add(jcid::TITLE, children(prop::ELEMENT_CHILD_NODES, &[title_outline]));
    let mut top = outline_elements(&mut s, &spec.paragraphs);
    if !spec.table.is_empty() {
        top.push(table_element(&mut s, &spec.table));
    }
    let outline = s.add(
        jcid::OUTLINE,
        children(prop::ELEMENT_CHILD_NODES, &top).u32(prop::OFFSET_FROM_PARENT_VERT, 1.0f32.to_bits()),
    );
    let placed = placed(&mut s, spec, outline, guids, files);
    let page = Props::default()
        .u32(prop::LAST_MODIFIED_TIME, MODIFIED)
        .objects(prop::STRUCTURE_ELEMENT_CHILD_NODES, &[title])
        .objects(prop::ELEMENT_CHILD_NODES, &placed);
    let page = s.add(jcid::PAGE, page);
    let manifest = s.add(jcid::PAGE_MANIFEST, children(prop::CONTENT_CHILD_NODES, &[page]));
    let meta = Props::default()
        .text(prop::CACHED_TITLE_STRING, &spec.title)
        .u32(prop::PAGE_LEVEL, spec.level.max(1))
        .u64(prop::TOPOLOGY_CREATION_TIME_STAMP, CREATED);
    let meta = s.add(jcid::PAGE_META_DATA, meta);
    s.roots = vec![(1, manifest), (2, meta)];
    if spec.old_title.is_some() {
        // The current revision changes only the title text; everything else comes from the older one.
        s.older = std::mem::take(&mut s.objects);
        s.objects.push((
            title_text,
            jcid::RICH_TEXT,
            super::Body::Props(title_props(&spec.title)),
        ));
    }
    s
}

/// The top outline elements of the paragraphs. Built from the last paragraph up, so the deeper paragraphs that
/// follow one become its children.
fn outline_elements(s: &mut Space, paragraphs: &[ParaSpec]) -> Vec<ExGuid> {
    let mut parents: Vec<(usize, Vec<ExGuid>)> = Vec::new();
    for para in paragraphs.iter().rev() {
        let mut kids = Vec::new();
        while parents.last().is_some_and(|(depth, _)| *depth > para.depth) {
            kids.extend(parents.pop().map(|(_, ids)| ids).unwrap_or_default());
        }
        let element = paragraph(s, para, &kids);
        match parents.last_mut() {
            Some((depth, ids)) if *depth == para.depth => ids.insert(0, element),
            _ => parents.push((para.depth, vec![element])),
        }
    }
    parents.into_iter().rev().flat_map(|(_, ids)| ids).collect()
}

/// An outline element that holds a table of plain text cells.
fn table_element(s: &mut Space, table: &[Vec<String>]) -> ExGuid {
    let mut rows = Vec::new();
    for row in table {
        let mut cells = Vec::new();
        for cell in row {
            let text = s.add(
                jcid::RICH_TEXT,
                Props::default().text(prop::RICH_EDIT_TEXT_UNICODE, cell),
            );
            let element = s.add(jcid::OUTLINE_ELEMENT, children(prop::CONTENT_CHILD_NODES, &[text]));
            cells.push(s.add(jcid::TABLE_CELL, children(prop::ELEMENT_CHILD_NODES, &[element])));
        }
        rows.push(s.add(jcid::TABLE_ROW, children(prop::ELEMENT_CHILD_NODES, &cells)));
    }
    let table = s.add(jcid::TABLE, children(prop::ELEMENT_CHILD_NODES, &rows));
    s.add(jcid::OUTLINE_ELEMENT, children(prop::CONTENT_CHILD_NODES, &[table]))
}

/// What sits on the page itself: the picture, the outline, the file, and the ink stand-in.
fn placed(
    s: &mut Space,
    spec: &PageSpec,
    outline: ExGuid,
    guids: &mut Guids,
    files: &mut Vec<(Guid, Vec<u8>)>,
) -> Vec<ExGuid> {
    let mut placed = Vec::new();
    if let Some(bytes) = &spec.picture {
        let reference = match &spec.picture_file {
            Some(name) => format!("<file>{name}"),
            None => format!("<ifndf>{}", stored(guids, files, bytes)),
        };
        let container = s.add_file(jcid::PICTURE_CONTAINER, reference);
        let image = Props::default()
            .object(prop::PICTURE_CONTAINER, container)
            .text(prop::IMAGE_ALT_TEXT, "A red dot")
            .u32(prop::OFFSET_FROM_PARENT_VERT, 0.5f32.to_bits());
        placed.push(s.add(jcid::IMAGE, image));
    }
    placed.push(outline);
    if let Some((name, bytes)) = &spec.file {
        let reference = format!("<ifndf>{}", stored(guids, files, bytes));
        let container = s.add_file(jcid::EMBEDDED_FILE_CONTAINER, reference);
        let file = Props::default()
            .object(prop::EMBEDDED_FILE_CONTAINER, container)
            .text(prop::EMBEDDED_FILE_NAME, name)
            .u32(prop::OFFSET_FROM_PARENT_VERT, 9.0f32.to_bits());
        placed.push(s.add(jcid::EMBEDDED_FILE, file));
    }
    if spec.ink {
        placed.push(s.add(
            0x0006_00FE,
            Props::default().u32(prop::OFFSET_FROM_PARENT_VERT, 3.0f32.to_bits()),
        ));
    }
    placed
}

fn title_props(text: &str) -> Props {
    Props::default()
        .flag(prop::IS_TITLE_TEXT, true)
        .text(prop::RICH_EDIT_TEXT_UNICODE, text)
}

fn children(which: u32, ids: &[ExGuid]) -> Props {
    Props::default().objects(which, ids)
}

/// Keeps file data for the file data store and returns its GUID.
fn stored(guids: &mut Guids, files: &mut Vec<(Guid, Vec<u8>)>, bytes: &[u8]) -> Guid {
    let guid = guids.next();
    files.push((guid, bytes.to_vec()));
    guid
}

/// An outline element with one paragraph of rich text, its list, its tag, and its children.
fn paragraph(s: &mut Space, para: &ParaSpec, kids: &[ExGuid]) -> ExGuid {
    let text: String = para.runs.iter().map(|(t, _)| t.as_str()).collect();
    let mut ends = Vec::new();
    let mut at = 0u32;
    let mut styles = Vec::new();
    for (i, (run, bold)) in para.runs.iter().enumerate() {
        at += run.encode_utf16().count() as u32;
        if i + 1 < para.runs.len() {
            ends.extend_from_slice(&at.to_le_bytes());
        }
        match styles.first() {
            Some(first) if para.shared_style => styles.push(*first),
            _ => styles.push(s.add(jcid::PARAGRAPH_STYLE, Props::default().flag(prop::BOLD, *bold))),
        }
    }
    let mut props = Props::default()
        .text(prop::RICH_EDIT_TEXT_UNICODE, &text)
        .bytes(prop::TEXT_RUN_INDEX, &ends)
        .objects(prop::TEXT_RUN_FORMATTING, &styles);
    if para.heading > 0 {
        let style = Props::default().text(prop::PARAGRAPH_STYLE_ID, &format!("h{}", para.heading));
        let style = s.add(jcid::PARAGRAPH_STYLE, style);
        props = props.object(prop::PARAGRAPH_STYLE, style);
    }
    if let Some(tag) = &para.tag {
        props = props.sets(prop::NOTE_TAG_STATES, vec![tag_state(s, tag)]);
    }
    let rich = s.add(jcid::RICH_TEXT, props);
    let mut element = children(prop::CONTENT_CHILD_NODES, &[rich]).objects(prop::ELEMENT_CHILD_NODES, kids);
    if let Some(numbered) = para.list {
        let units: &[u16] = if numbered { &[2, 0xFFFD, 0] } else { &[1, 0x2022] };
        let format: Vec<u8> = units.iter().flat_map(|u| u.to_le_bytes()).collect();
        let list = s.add(
            jcid::NUMBER_LIST,
            Props::default().bytes(prop::NUMBER_LIST_FORMAT, &format),
        );
        element = element.objects(prop::LIST_NODES, &[list]);
    }
    s.add(jcid::OUTLINE_ELEMENT, element)
}

fn tag_state(s: &mut Space, tag: &TagSpec) -> Props {
    let definition = Props::default()
        .text(prop::NOTE_TAG_LABEL, &tag.label)
        .u16(prop::NOTE_TAG_SHAPE, tag.shape);
    let definition = s.add(jcid::NOTE_TAG_DEFINITION, definition);
    Props::default()
        .object(prop::NOTE_TAG_DEFINITION_OID, definition)
        .u16(prop::ACTION_ITEM_STATUS, u16::from(tag.done))
}

fn run(text: &str, bold: bool) -> (String, bool) {
    (text.to_owned(), bold)
}

/// A section with two pages and a subpage that use every feature the reader knows.
pub fn sample_section() -> Vec<u8> {
    sample(None)
}

/// The sample section, with the picture of its first page kept in the onefiles folder under `name`.
pub fn sample_section_with_onefiles(name: &str) -> Vec<u8> {
    sample(Some(name))
}

fn sample(picture_file: Option<&str>) -> Vec<u8> {
    let first = PageSpec {
        title: "Trip plan".into(),
        old_title: Some("Draft plan".into()),
        level: 1,
        paragraphs: vec![
            ParaSpec {
                runs: vec![run("Packing", false)],
                heading: 2,
                ..ParaSpec::default()
            },
            ParaSpec {
                runs: vec![run("Bring the ", false), run("passport", true)],
                tag: Some(TagSpec {
                    label: "To Do".into(),
                    shape: 1,
                    done: true,
                }),
                ..ParaSpec::default()
            },
            ParaSpec {
                runs: vec![run("Book the train", false)],
                list: Some(true),
                ..ParaSpec::default()
            },
            ParaSpec {
                runs: vec![run("Window seat", false)],
                list: Some(false),
                depth: 1,
                ..ParaSpec::default()
            },
        ],
        table: vec![vec!["Day".into(), "Town".into()], vec!["1".into(), "Lyon".into()]],
        picture: Some(crate::testing::png_bytes()),
        picture_file: picture_file.map(str::to_owned),
        file: Some(("tickets.txt".into(), b"Seat 12A".to_vec())),
        ink: true,
    };
    let second = PageSpec {
        title: "Budget".into(),
        level: 1,
        paragraphs: vec![ParaSpec {
            runs: vec![run("Café: 40 €", false)],
            tag: Some(TagSpec {
                label: "Important".into(),
                shape: 13,
                done: false,
            }),
            ..ParaSpec::default()
        }],
        ..PageSpec::default()
    };
    let sub = PageSpec {
        title: "Receipts".into(),
        level: 2,
        paragraphs: vec![ParaSpec {
            runs: vec![run("Keep them", false)],
            ..ParaSpec::default()
        }],
        ..PageSpec::default()
    };
    super::section(&SectionSpec {
        pages: vec![first, second, sub],
        ..SectionSpec::default()
    })
}

/// A cabinet file with the files stored as they are (no compression), as a `.onepkg` holds them.
pub fn package(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut entries = Vec::new();
    let mut data = Vec::new();
    for (name, bytes) in files {
        entries.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        entries.extend_from_slice(&(data.len() as u32).to_le_bytes());
        entries.extend_from_slice(&[0, 0, 0x21, 0x5B, 0, 0, 0x80, 0]);
        entries.extend_from_slice(name.as_bytes());
        entries.push(0);
        data.extend_from_slice(bytes);
    }
    let blocks: Vec<&[u8]> = data.chunks(32 * 1024).collect();
    let files_at = 36 + 8;
    let data_at = files_at + entries.len();
    let mut out = b"MSCF".to_vec();
    let mut blocks_bytes = Vec::new();
    for block in &blocks {
        blocks_bytes.extend_from_slice(&[0; 4]);
        blocks_bytes.extend_from_slice(&(block.len() as u16).to_le_bytes());
        blocks_bytes.extend_from_slice(&(block.len() as u16).to_le_bytes());
        blocks_bytes.extend_from_slice(block);
    }
    let total = data_at + blocks_bytes.len();
    for word in [0, total as u32, 0, files_at as u32, 0] {
        out.extend_from_slice(&word.to_le_bytes());
    }
    out.extend_from_slice(&[3, 1, 1, 0]);
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&[0; 6]);
    out.extend_from_slice(&(data_at as u32).to_le_bytes());
    out.extend_from_slice(&(blocks.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend(entries);
    out.extend(blocks_bytes);
    out
}
