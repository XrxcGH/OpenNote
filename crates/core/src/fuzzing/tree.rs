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
use crate::testing::{MemFs, RegistryCodec};

/// The most steps a script runs, so a long input can't take long.
const MAX_STEPS: usize = 48;

/// The seed of the IDs a script makes, so a crash file makes the same notebook, and fails, on every run.
pub const SEED: u64 = 1;

/// An arbitrary folder tree in `testing::MemFs`, opened and scanned. The scan must end, show every page at
/// most once, and change nothing when it runs twice. (Checking the result with WP4's `verify_notebook` needs
/// the real page store, so the scan's own rules stand in for it here.)
pub fn notebook_tree(data: &[u8]) {
    notebook_tree_seeded(data, SEED);
}

/// [`notebook_tree`] with the IDs from another seed.
pub fn notebook_tree_seeded(data: &[u8], seed: u64) {
    crate::id::seed_ids(Some(seed));
    run_script(data);
    crate::id::seed_ids(None);
}

fn run_script(data: &[u8]) {
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
    let after = snapshot(&kit.fs.inner);
    assert!(
        after == before,
        "a second scan changed the notebook: {}",
        changes(&kit.codec, &before, &after)
    );
}

/// The files that differ between two snapshots, as `+ added`, `- removed`, and `~ changed` lines. A changed
/// file shows what it held before and after, so a crash report says what the second scan rewrote.
fn changes(codec: &RegistryCodec, before: &BTreeMap<PathBuf, Vec<u8>>, after: &BTreeMap<PathBuf, Vec<u8>>) -> String {
    let show = |bytes: &[u8]| {
        codec
            .describe(bytes)
            .unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned())
    };
    let mut lines = Vec::new();
    for (path, bytes) in after {
        match before.get(path) {
            None => lines.push(format!("+ {}", path.display())),
            Some(old) if old != bytes => lines.push(format!(
                "~ {}\n  before: {}\n  after:  {}",
                path.display(),
                show(old),
                show(bytes)
            )),
            Some(_) => {}
        }
    }
    for path in before.keys().filter(|p| !after.contains_key(*p)) {
        lines.push(format!("- {}", path.display()));
    }
    lines.join("\n")
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

    /// The seeds, of 64, with which a crash input still fails.
    fn failing_seeds(crash: &[u8]) -> Vec<u64> {
        let mut failed = Vec::new();
        for seed in 0..64 {
            let hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let result = std::panic::catch_unwind(|| notebook_tree_seeded(crash, seed));
            std::panic::set_hook(hook);
            crate::id::seed_ids(None);
            if result.is_err() {
                failed.push(seed);
            }
        }
        failed
    }

    /// The nightly crash of a page restored from one Trash item while a second item also holds it. Whether it
    /// failed hung on the random IDs, so it runs over many seeds.
    #[test]
    fn the_restore_and_second_deletion_crash_passes_with_every_seed() {
        let crash =
            include_bytes!("../../fuzz/regressions/notebook_tree/crash-e691c790279917580bc59fa65208f421aefcb917");
        let failed = failing_seeds(crash);
        assert!(failed.is_empty(), "failed with seeds {failed:?}");
    }

    /// The nightly crash of a page restored from one Trash item and then taken by a second one. A copy of its
    /// folder sat in another section, and only the second scan added it. The first scan must add it.
    #[test]
    fn the_copy_left_by_a_second_deletion_is_added_by_the_first_scan() {
        let crash =
            include_bytes!("../../fuzz/regressions/notebook_tree/crash-c7416f02a7a547015e63402d8537fc43ac2a8a9c");
        let failed = failing_seeds(crash);
        assert!(failed.is_empty(), "failed with seeds {failed:?}");
    }

    /// The nightly crash of a restore that stopped part way and left an empty folder named like one of its
    /// pages. The second scan took that folder for the page and cleared its mark.
    #[test]
    fn an_empty_folder_named_like_a_restored_page_passes_with_every_seed() {
        let crash =
            include_bytes!("../../fuzz/regressions/notebook_tree/crash-b437e2a06be88bf4ef9b31fb84901340fd5aa807");
        let failed = failing_seeds(crash);
        assert!(failed.is_empty(), "failed with seeds {failed:?}");
    }

    /// The nightly crash of a page listed twice while a restore of it stopped part way. The scan settled one
    /// entry and kept the other, so the second scan cleared the mark the first one left. Whether it failed hung
    /// on the order of the sections' random IDs, so it runs over many seeds.
    #[test]
    fn the_second_section_file_crash_passes_with_every_seed() {
        let crash =
            include_bytes!("../../fuzz/regressions/notebook_tree/crash-c831e76a2fd168be3b91f46dcb129146270122fd");
        let failed = failing_seeds(crash);
        assert!(failed.is_empty(), "failed with seeds {failed:?}");
    }

    /// Every crash the nightly fuzzer found, which the driver mutates as `cargo fuzz` would.
    const CRASHES: [&[u8]; 5] = [
        include_bytes!("../../fuzz/regressions/notebook_tree/crash-44a77e0e2af24a100413c37c3a4dd97037cc49b9"),
        include_bytes!("../../fuzz/regressions/notebook_tree/crash-b437e2a06be88bf4ef9b31fb84901340fd5aa807"),
        include_bytes!("../../fuzz/regressions/notebook_tree/crash-c7416f02a7a547015e63402d8537fc43ac2a8a9c"),
        include_bytes!("../../fuzz/regressions/notebook_tree/crash-e691c790279917580bc59fa65208f421aefcb917"),
        include_bytes!("../../fuzz/regressions/notebook_tree/crash-c831e76a2fd168be3b91f46dcb129146270122fd"),
    ];

    /// A script for the driver: random bytes, or a known crash with a few random changes.
    fn driver_script(next: &mut impl FnMut() -> u64) -> Vec<u8> {
        let mut below = |n: usize| usize::try_from(next() % u64::try_from(n.max(1)).unwrap_or(1)).unwrap_or(0);
        if below(3) == 0 {
            let len = 16 + below(497);
            return (0..len).map(|_| u8::try_from(below(256)).unwrap_or(0)).collect();
        }
        let mut bytes = CRASHES[below(CRASHES.len())].to_vec();
        for _ in 0..=below(8) {
            let at = below(bytes.len() + 1);
            match below(6) {
                0 if at < bytes.len() => bytes[at] ^= 1 << below(8),
                1 if at < bytes.len() => bytes[at] = u8::try_from(below(256)).unwrap_or(0),
                2 => {
                    let n = 1 + below(16);
                    let new: Vec<u8> = (0..n).map(|_| u8::try_from(below(256)).unwrap_or(0)).collect();
                    bytes.splice(at..at, new);
                }
                3 => {
                    let end = (at + 1 + below(32)).min(bytes.len());
                    bytes.drain(at.min(end)..end);
                }
                4 => {
                    let end = (at + 1 + below(32)).min(bytes.len());
                    let copy = bytes[at.min(end)..end].to_vec();
                    let to = below(bytes.len() + 1);
                    bytes.splice(to..to, copy);
                }
                _ => {
                    let other = CRASHES[below(CRASHES.len())];
                    let from = below(other.len());
                    let end = (from + 1 + below(64)).min(other.len());
                    bytes.splice(at..at, other[from..end].iter().copied());
                }
            }
        }
        bytes
    }

    /// Runs `runs` driver scripts from `seed`, each with its own ID seed, and returns how each failing one
    /// failed. With `out`, it writes each failing script there.
    fn run_driver(runs: u64, seed: u64, out: Option<&std::path::Path>) -> Vec<String> {
        let mut state = seed;
        let mut next = || {
            state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = state;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        };
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let mut failed = Vec::new();
        for run in 0..runs {
            let bytes = driver_script(&mut next);
            let ids = next();
            let result = std::panic::catch_unwind(|| notebook_tree_seeded(&bytes, ids));
            crate::id::seed_ids(None);
            let Err(e) = result else { continue };
            let text = e
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| e.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                .unwrap_or_default();
            failed.push(format!("run {run} seed {ids}: {}", text.replace('\n', " | ")));
            if let Some(dir) = out {
                let _ = std::fs::create_dir_all(dir);
                let _ = std::fs::write(dir.join(format!("run-{run}-seed-{ids}")), &bytes);
            }
        }
        std::panic::set_hook(hook);
        failed
    }

    /// A short run of the driver on every test run: the nightly crashes, changed a little, with many ID seeds.
    #[test]
    fn changed_crash_scripts_settle_with_many_seeds() {
        let failed = run_driver(1_500, 0x5eed, None);
        assert!(failed.is_empty(), "{} scripts failed: {failed:#?}", failed.len());
    }

    /// A local stand-in for `cargo fuzz`, which runs on Linux only. It runs `TREE_DRIVER_RUNS` driver scripts
    /// (50,000 by default) from `TREE_DRIVER_SEED`, writes each failing one to `TREE_DRIVER_OUT`, and fails
    /// with the count. Run it in release mode:
    /// `cargo test -p opennote-core --release --lib tree_driver -- --ignored`.
    #[test]
    #[ignore = "a long local driver; run it by hand"]
    fn tree_driver() {
        let env = |name: &str, default: u64| std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
        let runs = env("TREE_DRIVER_RUNS", 50_000);
        let out = std::env::var("TREE_DRIVER_OUT").ok().map(PathBuf::from);
        let failed = run_driver(runs, env("TREE_DRIVER_SEED", 1), out.as_deref());
        for line in &failed {
            eprintln!("{line}");
        }
        assert!(failed.is_empty(), "{} of {runs} scripts failed", failed.len());
    }

    #[test]
    fn empty_and_tiny_inputs_run() {
        notebook_tree(&[]);
        notebook_tree(&[5, 0, 0, 0]);
        notebook_tree(&[0; 64]);
    }
}
