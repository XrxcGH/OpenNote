//! Fuzz entry point for notebook folders (plan 13.3). Owned by WP5.
//!
//! The fuzzer's bytes are a short script. Some steps change the notebook through the tree code, such as
//! creating, moving, or deleting a page. Others damage it behind the tree code's back, as a sync tool, a
//! crash, or a person would:
//!
//! - Garbage in a tree file, or a sync tool's copy of one.
//! - A missing, renamed, or copied folder.
//! - A stray temporary file.
//! - An entry marked as moving.
//!
//! Then the notebook opens and the scan runs. Opening may fail, for example when `notebook.json` is garbage.
//! But nothing may panic, and a second scan must change nothing.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::fuzzing::Input;
use crate::id::{PageId, SectionId};
use crate::model::{Moving, TrashReason};
use crate::session::notebook::{NodePlacement, NodeRef, ParentRef};
use crate::store::fs::Fs;
use crate::store::layout::{temp_name, ITEM_JSON, SECTION_JSON};
use crate::store::notebook_store::kit::Kit;
use crate::store::notebook_store::{copy_tree, NotebookStore};
use crate::testing::MemFs;

/// The most steps a script runs, so a long input can't take long.
const MAX_STEPS: usize = 48;

/// An arbitrary folder tree in `testing::MemFs`, opened and scanned. The scan must end, show every page at
/// most once, and change nothing when it runs twice. (Checking the result with WP4's `verify_notebook` needs
/// the real page store, so the scan's own rules stand in for it here.)
pub fn notebook_tree(data: &[u8]) {
    let kit = Kit::new();
    let Ok(mut store) = kit.open() else { return };
    let mut input = Input::new(data);
    for _ in 0..MAX_STEPS {
        if input.rest().is_empty() {
            break;
        }
        step(&kit, &mut store, &mut input);
    }
    let Ok(mut fresh) = kit.open() else { return };
    if fresh.scan().is_err() {
        return;
    }
    let shown = pages(&fresh);
    let unique: std::collections::BTreeSet<PageId> = shown.iter().map(|(_, p)| *p).collect();
    assert!(unique.len() == shown.len(), "the scan shows a page twice: {shown:?}");
    let before = snapshot(&kit.fs.inner);
    let second = fresh.scan();
    let changed = second.as_ref().is_ok_and(|report| report.changed_files());
    assert!(!changed, "a second scan changed files: {second:?}");
    assert!(snapshot(&kit.fs.inner) == before, "a second scan changed the notebook");
}

fn snapshot(fs: &MemFs) -> BTreeMap<PathBuf, Vec<u8>> {
    fs.files()
        .into_iter()
        .map(|path| {
            let bytes = fs.get(&path).unwrap_or_default();
            (path, bytes)
        })
        .collect()
}

fn sections(store: &NotebookStore) -> Vec<SectionId> {
    store.sections.keys().copied().collect()
}

fn pages(store: &NotebookStore) -> Vec<(SectionId, PageId)> {
    store
        .sections
        .values()
        .flat_map(|s| s.file.pages.iter().map(move |e| (s.file.id, e.id)))
        .collect()
}

fn pick<T: Copy>(items: &[T], input: &mut Input<'_>) -> Option<T> {
    let bound = u32::try_from(items.len()).ok().filter(|n| *n > 0)?;
    items.get(usize::try_from(input.below(bound)).ok()?).copied()
}

/// Runs one step of the script. Every error is ignored: the point is what the notebook looks like after.
fn step(kit: &Kit, store: &mut NotebookStore, input: &mut Input<'_>) {
    match input.below(12) {
        0 => {
            let title = input.string(12);
            let _ = store.create_section(&title, None, None);
        }
        1 => create_page(store, input),
        2 => {
            let title = input.string(12);
            let _ = store.create_group(&title, None, None);
        }
        3 => delete(kit, store, input),
        4 => move_page(store, input),
        5 => damage_file(kit, store, input),
        6 => {
            let name = input.string(16);
            let parent = pick(&sections(store), input).map_or(kit.root.clone(), |s| kit.root.join(s.to_string()));
            kit.fs.inner.mkdir_all(&parent.join(name));
        }
        7 => {
            if let Some((_, page)) = pick(&pages(store), input) {
                let _ = kit.fs.remove_dir_all(&store.page_dir(page).unwrap_or_default());
            }
        }
        8 => rename_or_copy(kit, store, input),
        9 => {
            if let Some(section) = pick(&sections(store), input) {
                let dir = kit.root.join(section.to_string());
                kit.fs.inner.put(&dir.join(temp_name(SECTION_JSON)), input.bytes(8));
            }
        }
        10 => {
            let items: Vec<_> = store.trash.keys().copied().collect();
            if let Some(item) = pick(&items, input) {
                let _ = store.restore(item, None);
            }
        }
        _ => mark_moving(store, input),
    }
}

fn create_page(store: &mut NotebookStore, input: &mut Input<'_>) {
    let Some(section) = pick(&sections(store), input) else {
        return;
    };
    let under: Vec<PageId> = pages(store)
        .into_iter()
        .filter(|(s, _)| *s == section)
        .map(|(_, p)| p)
        .collect();
    let parent = if input.bool() { pick(&under, input) } else { None };
    let title = input.string(12);
    let _ = store.create_page(section, parent, None, &title);
}

fn delete(kit: &Kit, store: &mut NotebookStore, input: &mut Input<'_>) {
    let node = if input.bool() {
        pick(&pages(store), input).map(|(_, p)| NodeRef::Page(p))
    } else {
        pick(&sections(store), input).map(NodeRef::Section)
    };
    let Some(node) = node else { return };
    let hold = input.bool();
    if hold {
        if let NodeRef::Page(page) = node {
            kit.fs.hold(&store.page_dir(page).unwrap_or_default());
        }
    }
    let _ = store.delete(&[node], TrashReason::Deleted);
    kit.fs.release();
}

fn move_page(store: &mut NotebookStore, input: &mut Input<'_>) {
    let (Some((_, page)), Some(target)) = (pick(&pages(store), input), pick(&sections(store), input)) else {
        return;
    };
    let to = NodePlacement {
        parent: ParentRef::Section(target),
        before: None,
    };
    let _ = store.move_node(NodeRef::Page(page), &to);
}

/// Writes garbage over a tree file, or next to it as a sync-tool copy.
fn damage_file(kit: &Kit, store: &mut NotebookStore, input: &mut Input<'_>) {
    let garbage = input.bytes(24).to_vec();
    let path = match input.below(4) {
        0 => pick(&sections(store), input).map(|s| kit.root.join(s.to_string()).join(SECTION_JSON)),
        1 => pick(&sections(store), input).map(|s| kit.root.join(s.to_string()).join("section (1).json")),
        2 => Some(kit.root.join("notebook (conflicted copy).json")),
        _ => {
            let items: Vec<_> = store.trash.keys().copied().collect();
            pick(&items, input).map(|i| store.layout.trash_item_dir(i).join(ITEM_JSON))
        }
    };
    if let Some(path) = path {
        kit.fs.inner.put(&path, &garbage);
    }
}

fn rename_or_copy(kit: &Kit, store: &mut NotebookStore, input: &mut Input<'_>) {
    let (Some((_, page)), Some(target)) = (pick(&pages(store), input), pick(&sections(store), input)) else {
        return;
    };
    let from = store.page_dir(page).unwrap_or_default();
    let name = if input.bool() {
        page.to_string()
    } else {
        input.string(12)
    };
    let to = kit.root.join(target.to_string()).join(name);
    if input.bool() {
        let _ = copy_tree(&kit.fs, &from, &to);
    } else {
        let _ = kit.fs.rename_dir(&from, &to);
    }
}

fn mark_moving(store: &mut NotebookStore, input: &mut Input<'_>) {
    let (Some((from, page)), Some(to)) = (pick(&pages(store), input), pick(&sections(store), input)) else {
        return;
    };
    if from == to {
        return;
    }
    let entry = store.sections.get(&from).and_then(|s| s.entry(page)).cloned();
    let Some(mut entry) = entry else { return };
    entry.moving = Some(Moving::From(from));
    if let Some(state) = store.sections.get_mut(&from) {
        state.file.pages.retain(|e| e.id != page);
    }
    if let Some(state) = store.sections.get_mut(&to) {
        state.file.pages.push(entry);
    }
    let _ = store.write_section(from);
    let _ = store.write_section(to);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small, fixed set of scripts from a simple generator, so the target runs on every test run.
    #[test]
    fn scripts_from_a_generator_never_panic_and_scans_settle() {
        let mut state: u64 = 0x5eed;
        let scripts: usize = std::env::var("PROPTEST_CASES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(200);
        for _ in 0..scripts {
            let mut bytes = Vec::with_capacity(256);
            for _ in 0..256 {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                bytes.push((state >> 33) as u8);
            }
            notebook_tree(&bytes);
        }
    }

    #[test]
    fn empty_and_tiny_inputs_run() {
        notebook_tree(&[]);
        notebook_tree(&[5, 0, 0, 0]);
        notebook_tree(&[0; 64]);
    }
}
