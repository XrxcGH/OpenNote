//! The sample notebook generator (plan 13.9). Owned by WP1.
//!
//! It writes a deterministic notebook through the canonical writer: by default 20 sections of 50 pages in 3
//! section groups, with subpages, or every page in one section. The Phase 1 pen recordings were not kept, so the
//! strokes are synthetic handwriting from [`pen`], shaped like Surface Pen recordings. Images are on 10% of
//! pages, 5 history versions on 10%, and 30 items are in Trash.

mod pages;
mod pen;
mod rng;

use std::collections::BTreeMap;
use std::path::Path;

use opennote_core::format::gzip::gzip;
use opennote_core::format::history_json::write_versions;
use opennote_core::format::page_json::write_page;
use opennote_core::format::readable::{render_index_md, render_page_md, render_readme};
use opennote_core::format::trash_json::write_trash_item;
use opennote_core::format::tree_json::{write_notebook, write_section};
use opennote_core::model::section::page_levels;
use opennote_core::model::*;
use opennote_core::testing::NoLinks;
use opennote_core::{GroupId, OrderKey, PageId, SectionId, Timestamp, TrashItemId};

use crate::harness::GenerateArgs;
pub use pages::{build_page, device, Built, PageKind};
pub use pen::{handwriting, stroke_points, PenProfile, FINE_TILT, SURFACE_PEN, WACOM};
pub use rng::Rng;

/// Pages per section in the default layout.
const PAGES_PER_SECTION: usize = 50;
const TIME: i64 = 1_790_777_000_000;

/// Writes the sample notebook.
pub fn run(args: &GenerateArgs) -> Result<(), String> {
    let busy = std::fs::read_dir(&args.dir).is_ok_and(|mut entries| entries.next().is_some());
    if busy {
        return Err(format!("{} is not empty", args.dir.display()));
    }
    let mut rng = Rng::new(args.seed);
    let files = notebook(&mut rng, args);
    for (path, bytes) in &files {
        let target = args.dir.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        std::fs::write(&target, bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(())
}

/// Every file of the notebook, by path.
fn notebook(rng: &mut Rng, args: &GenerateArgs) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    let groups = groups(rng);
    let section_count = if args.one_section {
        1
    } else {
        args.pages.div_ceil(PAGES_PER_SECTION).max(1)
    };
    let per_section = args.pages.div_ceil(section_count);
    let keys = OrderKey::spread(None, None, section_count).expect("section keys");
    let mut sections = Vec::new();
    for (s, key) in keys.into_iter().enumerate() {
        let count = per_section.min(args.pages.saturating_sub(s * per_section));
        let group = (s % 4 < 3).then(|| groups[s % 3].id);
        sections.push(section(rng, &mut files, (s, count), group, key));
    }
    let mut notebook = NotebookFile::new(rng.id(TIME as u64), "Sample notebook", Timestamp::from_unix_ms(TIME));
    notebook.groups = groups;
    trash(rng, &mut files, &sections[0]);
    files.insert("index.md".to_owned(), render_index_md(&tree(&notebook, &sections)));
    files.insert("notebook.json".to_owned(), write_notebook(&notebook));
    files.insert("README.md".to_owned(), render_readme(&notebook.title));
    files
}

/// Three section groups: two at the top level, and one inside the first.
fn groups(rng: &mut Rng) -> Vec<Group> {
    let keys = OrderKey::spread(None, None, 3).expect("group keys");
    let ids: Vec<GroupId> = (0..3).map(|_| rng.id(TIME as u64)).collect();
    ["Semester 1", "Semester 2", "Labs"]
        .into_iter()
        .zip(keys)
        .enumerate()
        .map(|(i, (title, order))| Group {
            id: ids[i],
            title: title.to_owned(),
            color: None,
            parent: (i == 2).then(|| ids[0]),
            order,
            created: Timestamp::from_unix_ms(TIME),
            changed: Timestamp::from_unix_ms(TIME),
            extra: JsonMap::new(),
        })
        .collect()
}

/// A section and its pages. Every fourth page is a subpage, and every twelfth a sub-subpage.
fn section(
    rng: &mut Rng,
    files: &mut BTreeMap<String, Vec<u8>>,
    (index, count): (usize, usize),
    group: Option<GroupId>,
    order: OrderKey,
) -> SectionFile {
    let id: SectionId = rng.id(TIME as u64);
    let keys = OrderKey::spread(None, None, count.max(1)).expect("page keys");
    let mut entries: Vec<PageEntry> = Vec::with_capacity(count);
    for (p, key) in keys.into_iter().take(count).enumerate() {
        let title = format!("Page {} of section {}", p + 1, index + 1);
        let (kind, page_id) = (PageKind::draw(rng), rng.id(TIME as u64 + p as u64));
        let built = build_page(rng, kind, page_id, &title, &SURFACE_PEN);
        let parent = if p % 12 == 11 {
            entries.iter().rev().find(|e| e.parent.is_some()).map(|e| e.id)
        } else if p % 4 == 3 {
            entries.iter().rev().find(|e| e.parent.is_none()).map(|e| e.id)
        } else {
            None
        };
        write_page_files(rng, files, &format!("{id}/{}", built.page.id), &built);
        entries.push(entry(built.page.id, &title, parent, key));
    }
    let file = SectionFile {
        id,
        title: format!("Section {}", index + 1),
        color: None,
        group,
        order,
        created: Timestamp::from_unix_ms(TIME),
        changed: Timestamp::from_unix_ms(TIME),
        defaults: None,
        encryption: None,
        pages: entries,
        extra: JsonMap::new(),
        format: FormatInfo::default(),
    };
    files.insert(format!("{id}/section.json"), write_section(&file));
    file
}

fn entry(id: PageId, title: &str, parent: Option<PageId>, order: OrderKey) -> PageEntry {
    PageEntry {
        id,
        title: title.to_owned(),
        parent,
        order,
        pinned: false,
        color: None,
        changed: Timestamp::from_unix_ms(TIME),
        moving: None,
        extra: JsonMap::new(),
    }
}

/// A page folder: `page.json`, its segments and assets, `page.md`, and on 10% of pages 5 history versions.
fn write_page_files(rng: &mut Rng, files: &mut BTreeMap<String, Vec<u8>>, dir: &str, built: &Built) {
    for (id, bytes) in &built.segments {
        files.insert(format!("{dir}/ink/{id}.onk"), bytes.clone());
    }
    for (name, bytes) in &built.assets {
        files.insert(format!("{dir}/assets/{name}"), bytes.clone());
    }
    files.insert(format!("{dir}/page.json"), write_page(&built.page));
    files.insert(format!("{dir}/page.md"), render_page_md(&built.page, &NoLinks));
    if rng.chance(0.1) {
        history(rng, files, dir, &built.page);
    }
}

/// Five saved versions of a page, an hour apart.
fn history(rng: &mut Rng, files: &mut BTreeMap<String, Vec<u8>>, dir: &str, page: &Page) {
    let mut versions = Vec::new();
    for v in 0..5i64 {
        let mut older = page.clone();
        older.revision.id = rng.id((TIME - (5 - v) * 3_600_000) as u64);
        older.revision.saved_at = Timestamp::from_unix_ms(TIME - (5 - v) * 3_600_000);
        let snapshot = gzip(&write_page(&older));
        versions.push(VersionEntry {
            revision: older.revision.id,
            saved_at: older.revision.saved_at,
            reason: Named::Known(VersionReason::Closed),
            name: None,
            keep: false,
            device: device(),
            bytes: snapshot.len() as u64,
            segments: page.ink.segments().iter().map(|s| s.id).collect(),
            assets: page.assets.keys().copied().collect(),
            extra: JsonMap::new(),
        });
        files.insert(format!("{dir}/.history/{}.json.gz", older.revision.id), snapshot);
    }
    let file = VersionsFile {
        page: page.id,
        versions,
        extra: JsonMap::new(),
        format: FormatInfo::default(),
    };
    files.insert(format!("{dir}/.history/versions.json"), write_versions(&file));
}

/// Thirty Trash items, each a light page deleted from the first section.
fn trash(rng: &mut Rng, files: &mut BTreeMap<String, Vec<u8>>, from: &SectionFile) {
    for n in 0..30u64 {
        let item: TrashItemId = rng.id(TIME as u64 + n);
        let title = format!("Deleted page {}", n + 1);
        let page_id = rng.id(TIME as u64 + n);
        let built = build_page(rng, PageKind::Light, page_id, &title, &SURFACE_PEN);
        let order = OrderKey::parse("a0").expect("a valid key");
        let file = TrashItemFile {
            id: item,
            kind: TrashKind::Page,
            title: title.clone(),
            deleted_at: Timestamp::from_unix_ms(TIME),
            expires_at: Timestamp::from_unix_ms(TIME + 30 * 86_400_000),
            deleted_by: device(),
            reason: Named::default(),
            origin: TrashOrigin::Pages {
                section: from.id,
                section_title: from.title.clone(),
                entries: vec![entry(built.page.id, &title, None, order)],
            },
            contents: vec![built.page.id.0],
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        };
        let base = format!(".opennote/trash/{item}");
        files.insert(format!("{base}/item.json"), write_trash_item(&file));
        write_page_files(rng, files, &format!("{base}/{}", built.page.id), &built);
    }
}

/// The navigation tree of the generated notebook, for `index.md`.
fn tree(notebook: &NotebookFile, sections: &[SectionFile]) -> NotebookTree {
    let node = |s: &SectionFile| SectionNode {
        id: s.id,
        title: s.title.clone(),
        color: None,
        group: s.group,
        order: s.order.clone(),
        created: s.created,
        changed: s.changed,
        pages: page_levels(&s.pages)
            .into_iter()
            .map(|(i, level)| page_node(&s.pages[i], level))
            .collect(),
        access: Access::ReadWrite,
        encrypted: false,
    };
    NotebookTree {
        notebook: notebook.id,
        title: notebook.title.clone(),
        color: None,
        created: notebook.created,
        changed: notebook.changed,
        groups: notebook.groups.clone(),
        sections: sections.iter().map(node).collect(),
        access: Access::ReadWrite,
        notices: Vec::new(),
    }
}

fn page_node(entry: &PageEntry, level: u8) -> PageNode {
    PageNode {
        id: entry.id,
        title: entry.title.clone(),
        parent: entry.parent,
        order: entry.order.clone(),
        level,
        pinned: false,
        color: None,
        created: entry.changed,
        modified: None,
        state: PageNodeState::Normal,
    }
}

/// Whether a folder holds a generated notebook.
pub fn is_notebook(dir: &Path) -> bool {
    dir.join("notebook.json").is_file()
}

#[cfg(test)]
mod tests;
