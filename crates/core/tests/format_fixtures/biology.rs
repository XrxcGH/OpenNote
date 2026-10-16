//! The content of the fixture notebook, a biology notebook. It has section groups, subpages, handwriting over
//! two segments, assets, a table, a drawing, extension blocks, an encrypted section, page history, and Trash.

use std::collections::BTreeMap;

use opennote_core::format::history_json::write_versions;
use opennote_core::format::page_json::write_page;
use opennote_core::format::readable::{render_index_md, render_ink_svg, render_page_md, render_readme};
use opennote_core::format::trash_json::write_trash_item;
use opennote_core::format::tree_json::{write_notebook, write_section};
use opennote_core::id::*;
use opennote_core::model::section::page_levels;
use opennote_core::model::*;
use opennote_core::seams::LinkResolver;
use serde_json::json;

use super::notebook::*;

/// Page numbers, which [`id`] turns into IDs.
const P_PHOTOSYNTHESIS: u64 = 101;
const P_LIGHT: u64 = 102;
const P_CALVIN: u64 = 103;
const P_CELL: u64 = 104;
const P_EMPTY: u64 = 105;
const P_DIARY: u64 = 106;
const P_OLD: u64 = 107;
const S_LABS: u64 = 11;
const S_LECTURES: u64 = 12;
const S_DIARY: u64 = 13;
const G_SEMESTER: u64 = 21;
const G_LABS: u64 = 22;

/// Resolves page links inside the notebook, as `page.md` needs them.
pub struct NotebookLinks {
    pub sections: BTreeMap<PageId, SectionId>,
}

impl LinkResolver for NotebookLinks {
    fn page_md(&self, from: PageId, to: PageId) -> Option<String> {
        let target = self.sections.get(&to)?;
        if self.sections.get(&from) == Some(target) {
            Some(format!("../{to}/page.md"))
        } else {
            Some(format!("../../{target}/{to}/page.md"))
        }
    }

    fn asset_file(&self, _asset: AssetId) -> Option<String> {
        None
    }
}

/// The navigation tree of a notebook from its files, as `index.md` needs it: titles from the page lists.
pub fn tree(notebook: &NotebookFile, sections: &[SectionFile]) -> NotebookTree {
    let nodes = sections
        .iter()
        .map(|s| SectionNode {
            id: s.id,
            title: s.title.clone(),
            color: s.color.clone(),
            group: s.group,
            order: s.order.clone(),
            created: s.created,
            changed: s.changed,
            pages: page_levels(&s.pages)
                .into_iter()
                .map(|(i, level)| {
                    let entry = &s.pages[i];
                    PageNode {
                        id: entry.id,
                        title: entry.title.clone(),
                        parent: entry.parent,
                        order: entry.order.clone(),
                        level,
                        pinned: entry.pinned,
                        archived: false,
                        color: entry.color.clone(),
                        created: entry.changed,
                        modified: None,
                        state: PageNodeState::Normal,
                    }
                })
                .collect(),
            access: s.format.access.clone(),
            encrypted: s.encryption.is_some(),
            archived: false,
            pinned: false,
        })
        .collect();
    NotebookTree {
        notebook: notebook.id,
        title: notebook.title.clone(),
        color: notebook.color.clone(),
        created: notebook.created,
        changed: notebook.changed,
        styles: notebook.styles.clone(),
        groups: notebook.groups.clone(),
        sections: nodes,
        access: Access::ReadWrite,
        notices: Vec::new(),
        archived: false,
    }
}

fn entry(n: u64, title: &str, parent: Option<u64>, order: &str) -> PageEntry {
    PageEntry {
        id: id(n),
        title: title.to_owned(),
        parent: parent.map(id),
        order: key(order),
        pinned: n == P_PHOTOSYNTHESIS,
        color: (n == P_CELL).then(|| Color::Palette("amber".into())),
        changed: at("2026-09-30T14:20:05.300Z"),
        moving: None,
        extra: JsonMap::new(),
    }
}

fn section(n: u64, title: &str, group: Option<u64>, order: &str, pages: Vec<PageEntry>) -> SectionFile {
    SectionFile {
        id: id(n),
        title: title.to_owned(),
        color: Some(Color::Palette("indigo".into())),
        group: group.map(id),
        order: key(order),
        created: at("2026-09-30T14:00:12.500Z"),
        changed: at("2026-09-30T14:20:05.300Z"),
        defaults: None,
        encryption: None,
        pages,
        extra: JsonMap::new(),
        format: FormatInfo::default(),
    }
}

fn group(n: u64, title: &str, parent: Option<u64>, order: &str) -> Group {
    Group {
        id: id(n),
        title: title.to_owned(),
        color: None,
        parent: parent.map(id),
        order: key(order),
        created: at("2026-09-30T13:59:10.000Z"),
        changed: at("2026-09-30T13:59:10.000Z"),
        extra: JsonMap::new(),
    }
}

fn notebook() -> NotebookFile {
    let mut file = NotebookFile::new(
        "01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap(),
        "Biology",
        at("2026-09-30T13:58:02.411Z"),
    );
    file.color = Some(Color::Palette("fern".into()));
    file.changed = at("2026-09-30T13:59:10.000Z");
    file.defaults = json!({"view": {"mode": "paginated", "paper": {"size": "a4", "width": 793.7, "height": 1122.52}}})
        .as_object()
        .cloned();
    file.styles = json!({
        "h1": {"size": 28, "color": "indigo", "spaceBefore": 18, "spaceAfter": 6},
        "normal": {"font": "Georgia", "size": 16, "lineHeight": 1.5},
        "zz-callout": {"color": "#aabbcc", "zzshadow": {"blur": 3}}
    })
    .as_object()
    .map(|styles| {
        styles
            .iter()
            .map(|(name, style)| (name.clone(), serde_json::from_value(style.clone()).unwrap()))
            .collect()
    })
    .unwrap();
    file.groups = vec![
        group(G_SEMESTER, "Semester 1", None, "a0"),
        group(G_LABS, "Labs", Some(G_SEMESTER), "a0"),
    ];
    file
}

fn sections() -> Vec<SectionFile> {
    let labs = section(
        S_LABS,
        "Lab reports",
        Some(G_LABS),
        "a0",
        vec![
            entry(P_PHOTOSYNTHESIS, "Photosynthesis", None, "a0"),
            entry(P_LIGHT, "Light reactions", Some(P_PHOTOSYNTHESIS), "a0"),
            entry(P_CALVIN, "Calvin cycle #3 [draft]", Some(P_LIGHT), "a0"),
        ],
    );
    let lectures = section(
        S_LECTURES,
        "Lectures",
        None,
        "a1",
        vec![
            entry(P_CELL, "Cell structure", None, "a0"),
            entry(P_EMPTY, "Notes to sort", None, "a1"),
        ],
    );
    let mut diary = section(
        S_DIARY,
        "Diary",
        Some(G_SEMESTER),
        "a1",
        vec![entry(P_DIARY, "Private", None, "a0")],
    );
    diary.encryption = Some(json!({"reserved": true}));
    vec![labs, lectures, diary]
}

/// Every file of the fixture notebook, by path.
pub fn files() -> Files {
    let mut files = Files::new();
    let notebook = notebook();
    let sections = sections();
    let links = NotebookLinks {
        sections: sections
            .iter()
            .flat_map(|s| s.pages.iter().map(move |p| (p.id, s.id)))
            .collect(),
    };
    let mut pages = vec![
        super::pages::photosynthesis(&mut files, &dir(S_LABS, P_PHOTOSYNTHESIS)),
        super::pages::light_reactions(id(P_PHOTOSYNTHESIS)),
        super::pages::calvin_cycle(),
        super::pages::cell_structure(&mut files, &dir(S_LECTURES, P_CELL), id(P_LIGHT)),
        page(P_EMPTY, "Notes to sort", revision(305, None)),
    ];
    let mut diary = page(P_DIARY, "Private", revision(306, None));
    diary.encryption = Some(json!({"reserved": true}));
    files.insert(format!("{}/page.json", dir(S_DIARY, P_DIARY)), write_page(&diary));
    for page in &mut pages {
        let section = links.sections[&page.id];
        let dir = format!("{section}/{}", page.id);
        files.insert(format!("{dir}/page.json"), write_page(page));
        files.insert(format!("{dir}/page.md"), render_page_md(page, &links));
        if !page.ink.is_empty() {
            files.insert(format!("{dir}/ink.svg"), render_ink_svg(page));
        }
    }
    for section in &sections {
        files.insert(format!("{}/section.json", section.id), write_section(section));
    }
    files.insert("notebook.json".to_owned(), write_notebook(&notebook));
    files.insert("README.md".to_owned(), render_readme(&notebook.title));
    files.insert("index.md".to_owned(), render_index_md(&tree(&notebook, &sections)));
    trash(&mut files);
    history(&mut files);
    files
}

fn dir(section: u64, page: u64) -> String {
    format!(
        "{}/{}",
        SectionId::from(id::<Id>(section)),
        PageId::from(id::<Id>(page))
    )
}

fn trash(files: &mut Files) {
    let item: TrashItemId = id(31);
    let old = page(P_OLD, "Old notes", revision(307, None));
    let file = TrashItemFile {
        id: item,
        kind: TrashKind::Page,
        title: "Old notes".to_owned(),
        deleted_at: at("2026-09-30T15:00:00.000Z"),
        expires_at: at("2026-10-30T15:00:00.000Z"),
        deleted_by: device(),
        reason: Named::default(),
        origin: TrashOrigin::Pages {
            section: id(S_LECTURES),
            section_title: "Lectures".to_owned(),
            entries: vec![entry(P_OLD, "Old notes", None, "a2")],
        },
        contents: vec![old.id.0],
        extra: JsonMap::new(),
        format: FormatInfo::default(),
    };
    let base = format!(".opennote/trash/{item}");
    files.insert(format!("{base}/item.json"), write_trash_item(&file));
    files.insert(format!("{base}/{}/page.json", old.id), write_page(&old));
}

/// An older revision of the photosynthesis page, kept in its history.
fn history(files: &mut Files) {
    let dir = dir(S_LABS, P_PHOTOSYNTHESIS);
    let current = files[&format!("{dir}/page.json")].clone();
    let page = opennote_core::format::page_json::read_page(&current, &opennote_core::Limits::default())
        .unwrap()
        .page;
    let mut older = page.clone();
    let parent = page.revision.parents[0];
    older.revision = revision(300, None);
    older.revision.id = parent;
    older.title = "Photosynthesis draft".to_owned();
    let first = page.ink.segments()[0].clone();
    older.ink = Ink::default();
    older.ink.commit(0, vec![first.clone()], 0);
    let snapshot_bytes = snapshot(&write_page(&older));
    let versions = VersionsFile {
        page: page.id,
        versions: vec![VersionEntry {
            revision: parent,
            saved_at: at("2026-09-30T14:06:10.020Z"),
            reason: Named::Known(VersionReason::Closed),
            name: Some("Before the lab".to_owned()),
            keep: false,
            device: device(),
            bytes: snapshot_bytes.len() as u64,
            segments: vec![first.id],
            assets: Vec::new(),
            extra: JsonMap::new(),
        }],
        extra: JsonMap::new(),
        format: FormatInfo::default(),
    };
    files.insert(format!("{dir}/.history/{parent}.json.gz"), snapshot_bytes);
    files.insert(format!("{dir}/.history/versions.json"), write_versions(&versions));
}
