//! Small OneNote section files and notebook packages, written from [MS-ONESTORE] and [MS-ONE], for tests and fuzz
//! seeds (A3-17). They follow the published structure; they are not byte-for-byte what OneNote writes.

mod layout;

use std::collections::HashMap;

use layout::{exguid, At, FileNode, Layout, Props};

use super::bytes::{ExGuid, Guid};
use super::ids::{jcid, prop};

/// `FileDataStoreObject.guidHeader` and `guidFooter`, [MS-ONESTORE] 2.6.13.
const DATA_HEADER: Guid = Guid::new(
    0xBDE3_16E7,
    0x2665,
    0x4511,
    [0xA4, 0xC4, 0x8D, 0x4D, 0x0B, 0x7A, 0x9E, 0xAC],
);
const DATA_FOOTER: Guid = Guid::new(
    0x71FB_A722,
    0x0F79,
    0x4A0B,
    [0xBB, 0x13, 0x89, 0x92, 0x56, 0x42, 0x6B, 0x24],
);

/// A section to write.
#[derive(Clone, Debug, Default)]
pub struct SectionSpec {
    /// The pages.
    pub pages: Vec<PageSpec>,
    /// Marks the section's data as encrypted, as a password-protected section is.
    pub encrypted: bool,
    /// Adds a root node after the last committed one, as a write that never finished leaves.
    pub uncommitted_root: bool,
    /// Repeats a global identification table entry after every object declaration, as a hostile file may.
    pub interleaved_table: bool,
}

/// A page to write.
#[derive(Clone, Debug, Default)]
pub struct PageSpec {
    /// The title.
    pub title: String,
    /// An earlier title, written as an older revision that the current one depends on.
    pub old_title: Option<String>,
    /// 1 for a page, 2 or 3 for a subpage.
    pub level: u32,
    /// The paragraphs of the page's outline.
    pub paragraphs: Vec<ParaSpec>,
    /// A table of plain text cells, after the paragraphs.
    pub table: Vec<Vec<String>>,
    /// A picture placed on the page.
    pub picture: Option<Vec<u8>>,
    /// Keeps the picture in the onefiles folder under this name instead of in the section file.
    pub picture_file: Option<String>,
    /// A file placed on the page: its name and bytes.
    pub file: Option<(String, Vec<u8>)>,
    /// Adds an object of a type the public format does not describe, as handwriting is.
    pub ink: bool,
}

/// A paragraph to write.
#[derive(Clone, Debug, Default)]
pub struct ParaSpec {
    /// The runs: text, and whether it is bold.
    pub runs: Vec<(String, bool)>,
    /// `Some(true)` for a numbered list item, `Some(false)` for a bullet.
    pub list: Option<bool>,
    /// The indent level, 0 at the left; a paragraph goes under the last one a level up.
    pub depth: usize,
    /// A note tag.
    pub tag: Option<TagSpec>,
    /// 1 to 6 for a heading style.
    pub heading: u8,
    /// Gives every run one shared format object, as OneNote does for runs of the same format.
    pub shared_style: bool,
}

/// A note tag to write.
#[derive(Clone, Debug)]
pub struct TagSpec {
    /// The label of a normal tag.
    pub label: String,
    /// The NoteTagShape: 1 to 12 are check boxes, 13 is a star.
    pub shape: u16,
    /// Whether a check box is checked.
    pub done: bool,
}

/// An object to declare: a property set, or a file data object with its FileDataReference.
enum Body {
    Props(Props),
    File(String),
}

/// The objects of one object space, as they are built.
struct Space {
    gosid: ExGuid,
    guid: Guid,
    objects: Vec<(ExGuid, u32, Body)>,
    roots: Vec<(u32, ExGuid)>,
    /// Objects of an older revision that the written one depends on.
    older: Vec<(ExGuid, u32, Body)>,
}

/// Hands out GUIDs that are unique within one file.
struct Guids(u32);

impl Guids {
    fn next(&mut self) -> Guid {
        self.0 += 1;
        Guid::new(
            0xA000_0000 | self.0,
            0x0E0E,
            0x4000,
            [0x80, 0, 0, 0, 0, 0, 0, self.0 as u8],
        )
    }
}

impl Space {
    fn new(guids: &mut Guids) -> Space {
        Space {
            gosid: ExGuid {
                guid: guids.next(),
                n: 1,
            },
            guid: guids.next(),
            objects: Vec::new(),
            roots: Vec::new(),
            older: Vec::new(),
        }
    }

    fn add(&mut self, jcid: u32, props: Props) -> ExGuid {
        let id = ExGuid {
            guid: self.guid,
            n: self.objects.len() as u32 + 1,
        };
        assert!(id.n < 256, "test pages hold fewer than 256 objects");
        self.objects.push((id, jcid, Body::Props(props)));
        id
    }

    fn add_file(&mut self, jcid: u32, reference: String) -> ExGuid {
        let id = ExGuid {
            guid: self.guid,
            n: self.objects.len() as u32 + 1,
        };
        self.objects.push((id, jcid, Body::File(reference)));
        id
    }
}

/// Writes a section file.
pub fn section(spec: &SectionSpec) -> Vec<u8> {
    let mut guids = Guids(0);
    let mut files: Vec<(Guid, Vec<u8>)> = Vec::new();
    let pages: Vec<Space> = spec
        .pages
        .iter()
        .map(|page| page_space(page, &mut guids, &mut files))
        .collect();
    let mut root = Space::new(&mut guids);
    let ids: Vec<ExGuid> = pages.iter().map(|p| p.gosid).collect();
    let series = root.add(
        jcid::PAGE_SERIES,
        Props::default().spaces(prop::CHILD_GRAPH_SPACE_ELEMENT_NODES, &ids),
    );
    let node = root.add(
        jcid::SECTION,
        Props::default().objects(prop::ELEMENT_CHILD_NODES, &[series]),
    );
    let meta = root.add(jcid::SECTION_META_DATA, Props::default());
    root.roots = vec![(1, node), (2, meta)];

    let mut layout = Layout::new();
    let mut root_nodes = Vec::new();
    for space in pages.iter().chain([&root]) {
        let encrypted = spec.encrypted && space.gosid == root.gosid;
        let manifest = write_space(&mut layout, space, encrypted, spec.interleaved_table);
        root_nodes.push(FileNode::pointing(0x008, manifest, exguid(space.gosid)));
    }
    root_nodes.push(FileNode::plain(0x004, exguid(root.gosid)));
    let mut stored = Vec::new();
    for (guid, bytes) in &files {
        let mut object = DATA_HEADER.0.to_vec();
        object.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        object.extend_from_slice(&[0; 12]);
        object.extend_from_slice(bytes);
        while !object.len().is_multiple_of(8) {
            object.push(0);
        }
        object.extend_from_slice(&DATA_FOOTER.0);
        let at = layout.blob(&object);
        stored.push(FileNode::pointing(0x094, at, guid.0.to_vec()));
    }
    let store_list = layout.list(&stored, &[]);
    root_nodes.push(FileNode::pointing(0x090, store_list, Vec::new()));
    let uncommitted: Vec<FileNode> = if spec.uncommitted_root {
        vec![FileNode::plain(
            0x004,
            exguid(ExGuid {
                guid: guids.next(),
                n: 9,
            }),
        )]
    } else {
        Vec::new()
    };
    let root_list = layout.list(&root_nodes, &uncommitted);
    layout.finish(root_list)
}

/// Writes one object space: its object groups, its revision manifest list, and its object space manifest list.
fn write_space(layout: &mut Layout, space: &Space, encrypted: bool, interleaved: bool) -> At {
    let mut revisions = vec![FileNode::plain(0x014, [exguid(space.gosid), vec![0; 4]].concat())];
    let mut dependent = ExGuid::ZERO;
    let mut n = 0;
    for objects in [&space.older, &space.objects] {
        if objects.is_empty() {
            continue;
        }
        n += 1;
        let rid = ExGuid {
            guid: space.guid,
            n: 1000 + n,
        };
        let group = ExGuid {
            guid: space.guid,
            n: 2000 + n,
        };
        let start = [
            exguid(rid),
            exguid(dependent),
            1u32.to_le_bytes().to_vec(),
            vec![u8::from(encrypted) * 2, 0],
        ];
        revisions.push(FileNode::plain(0x01E, start.concat()));
        let group_list = write_group(layout, group, objects, interleaved);
        revisions.push(FileNode::pointing(0x0B0, group_list, exguid(group)));
        for (role, id) in &space.roots {
            revisions.push(FileNode::plain(
                0x05A,
                [exguid(*id), role.to_le_bytes().to_vec()].concat(),
            ));
        }
        revisions.push(FileNode::plain(0x01C, Vec::new()));
        revisions.push(FileNode::plain(
            0x05C,
            [exguid(rid), 1u32.to_le_bytes().to_vec()].concat(),
        ));
        dependent = rid;
    }
    let revision_list = layout.list(&revisions, &[]);
    let manifest = [
        FileNode::plain(0x00C, exguid(space.gosid)),
        FileNode::pointing(0x010, revision_list, Vec::new()),
    ];
    layout.list(&manifest, &[])
}

/// Writes an object group ([MS-ONESTORE] 2.1.13) with its global identification table.
fn write_group(layout: &mut Layout, group: ExGuid, objects: &[(ExGuid, u32, Body)], interleaved: bool) -> At {
    let mut table: HashMap<Guid, u32> = HashMap::new();
    let mut order = Vec::new();
    for (id, _, body) in objects {
        let mut add = |guid: Guid| {
            if !table.contains_key(&guid) {
                table.insert(guid, table.len() as u32);
                order.push(guid);
            }
        };
        add(id.guid);
        if let Body::Props(props) = body {
            props.guids().for_each(&mut add);
        }
    }
    let mut nodes = vec![
        FileNode::plain(0x0B4, exguid(group)),
        FileNode::plain(0x022, Vec::new()),
    ];
    for guid in &order {
        nodes.push(FileNode::plain(
            0x024,
            [table[guid].to_le_bytes().to_vec(), guid.0.to_vec()].concat(),
        ));
    }
    nodes.push(FileNode::plain(0x028, Vec::new()));
    for (id, jcid, body) in objects {
        let oid = ((table[&id.guid] << 8) | (id.n & 0xFF)).to_le_bytes();
        match body {
            Body::Props(props) => {
                let blob = layout.blob(&props.encode(&table));
                let body = [&oid[..], &jcid.to_le_bytes(), &[3, 1]].concat();
                nodes.push(FileNode::pointing(0x0A4, blob, body));
            }
            Body::File(reference) => {
                let mut data = [&oid[..], &jcid.to_le_bytes(), &[1]].concat();
                data.extend(storage_string(reference));
                data.extend(storage_string(""));
                nodes.push(FileNode::plain(0x072, data));
            }
        }
        if let Some(guid) = order.last().filter(|_| interleaved) {
            nodes.push(FileNode::plain(
                0x024,
                [table[guid].to_le_bytes().to_vec(), guid.0.to_vec()].concat(),
            ));
        }
    }
    nodes.push(FileNode::plain(0x0B8, Vec::new()));
    layout.list(&nodes, &[])
}

/// A StringInStorageBuffer ([MS-ONESTORE] 2.2.3).
fn storage_string(text: &str) -> Vec<u8> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut out = (units.len() as u32).to_le_bytes().to_vec();
    out.extend(units.iter().flat_map(|u| u.to_le_bytes()));
    out
}

mod page;
use page::page_space;

pub use page::{package, sample_section, sample_section_with_onefiles};
