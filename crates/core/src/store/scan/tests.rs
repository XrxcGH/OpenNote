#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::Duration;

use proptest::prelude::*;

use crate::id::{PageId, SectionId};
use crate::model::{Moving, PageNodeState, TrashReason};
use crate::seams::Codec;
use crate::session::notebook::NodeRef;
use crate::store::fs::Fs;
use crate::store::layout::{temp_name, PAGE_JSON, SECTION_JSON};
use crate::store::notebook_store::kit::Kit;
use crate::store::notebook_store::{read_page_files, write_page_files, NotebookStore};
use crate::store::PageFiles;
use crate::testing::MemFs;
use crate::time::Clock;

fn setup() -> (Kit, NotebookStore, [SectionId; 2], Vec<PageId>) {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let s1 = store.create_section("One", None, None).unwrap();
    let s2 = store.create_section("Two", None, None).unwrap();
    let mut pages = Vec::new();
    for (section, title) in [(s1, "A"), (s1, "B"), (s2, "C")] {
        pages.push(store.create_page(section, None, None, title).unwrap());
    }
    (kit, store, [s1, s2], pages)
}

fn section_dir(kit: &Kit, section: SectionId) -> PathBuf {
    kit.root.join(section.to_string())
}

/// Writes a page folder without an entry in a section folder, as a sync tool or a person would leave it.
fn unlisted_page(kit: &Kit, section: &std::path::Path, title: &str) -> PageId {
    let id = PageId::generate(kit.clock.as_ref());
    let dir = &section.join(id.to_string());
    let mut page = crate::model::Page::new(id, kit.clock.now(), crate::testing::sample::sample_page().revision);
    page.title = title.to_owned();
    kit.fs.inner.mkdir_all(dir);
    let files = PageFiles {
        fs: &kit.fs,
        codec: &kit.codec,
        dir,
    };
    write_page_files(&files, kit.clock.as_ref(), &page, page.revision.clone()).unwrap();
    id
}

fn snapshot(fs: &MemFs) -> BTreeMap<PathBuf, Vec<u8>> {
    fs.files()
        .into_iter()
        .map(|p| (p.clone(), fs.get(&p).unwrap_or_default()))
        .collect()
}

#[test]
fn an_unlisted_folder_is_added_at_the_end_of_its_section() {
    let (kit, mut store, [s1, _], _) = setup();
    let page = unlisted_page(&kit, &section_dir(&kit, s1), "Found");
    let report = store.scan().unwrap();
    assert_eq!(report.added, vec![page]);
    let node = store.tree().section(s1).unwrap().pages.last().cloned().unwrap();
    assert_eq!((node.id, node.title.as_str()), (page, "Found"));
    assert!(store.scan().unwrap().written.is_empty());
}

#[test]
fn an_entry_follows_its_folder_to_another_section() {
    let (kit, mut store, [s1, s2], pages) = setup();
    let a = pages[0];
    kit.fs
        .rename_dir(
            &section_dir(&kit, s1).join(a.to_string()),
            &section_dir(&kit, s2).join(a.to_string()),
        )
        .unwrap();
    let report = store.scan().unwrap();
    assert_eq!(report.moved, vec![a]);
    assert_eq!(store.section_of(a), Some(s2));
    assert_eq!(store.page_dir(a), Some(section_dir(&kit, s2).join(a.to_string())));
}

#[test]
fn a_missing_folder_is_unavailable_then_dropped_after_30_days() {
    let (kit, mut store, [s1, _], pages) = setup();
    let a = pages[0];
    store.scan().unwrap();
    kit.fs
        .remove_dir_all(&section_dir(&kit, s1).join(a.to_string()))
        .unwrap();
    let report = store.scan().unwrap();
    assert_eq!(report.unavailable, vec![a]);
    let state = store.tree().find_page(a).unwrap().1.state.clone();
    assert_eq!(state, PageNodeState::Unavailable { maybe_syncing: false });
    kit.clock.advance(Duration::from_secs(31 * 86_400));
    let report = store.scan().unwrap();
    assert_eq!(report.dropped, vec![a]);
    assert!(store.tree().find_page(a).is_none());
}

#[test]
fn a_damaged_section_json_is_rebuilt_from_its_folders() {
    let (kit, mut store, [s1, _], pages) = setup();
    kit.fs.inner.put(&section_dir(&kit, s1).join(SECTION_JSON), b"{damaged");
    let report = store.scan().unwrap();
    assert_eq!(report.rebuilt, vec![s1]);
    let node = store.tree().section(s1).cloned().unwrap();
    let ids: Vec<PageId> = node.pages.iter().map(|p| p.id).collect();
    assert!(ids.contains(&pages[0]) && ids.contains(&pages[1]));
    assert_eq!(node.pages[0].title.len() + node.pages[1].title.len(), 2);
    let kept = kit.fs.read_dir(&kit.root.join(".opennote").join("conflicts")).unwrap();
    assert_eq!(kept.len(), 1);
}

#[test]
fn a_sync_tool_copy_of_section_json_is_merged_and_kept_aside() {
    let (kit, mut store, [s1, _], pages) = setup();
    let mut copy = store.sections[&s1].file.clone();
    copy.pages.retain(|e| e.id == pages[0]);
    unlisted_page(&kit, &section_dir(&kit, s1), "Theirs");
    let bytes = kit.codec.write_section(&copy);
    kit.fs
        .inner
        .put(&section_dir(&kit, s1).join("section (conflicted copy).json"), &bytes);
    let report = store.scan().unwrap();
    assert!(report
        .deleted
        .iter()
        .any(|p| p.ends_with("section (conflicted copy).json")));
    assert!(store.tree().section(s1).unwrap().pages.len() >= 2);
    assert!(store.scan().unwrap().written.is_empty());
}

#[test]
fn a_copied_page_folder_is_a_duplicate_not_a_new_page() {
    let (kit, mut store, [s1, _], pages) = setup();
    let a = pages[0];
    let src = section_dir(&kit, s1).join(a.to_string());
    let copy = section_dir(&kit, s1).join("A - Copy");
    crate::store::notebook_store::copy_tree(&kit.fs, &src, &copy).unwrap();
    let report = store.scan().unwrap();
    assert_eq!(report.duplicates, vec![(a, copy)]);
    assert_eq!(store.tree().find_page(a).unwrap().1.state, PageNodeState::Duplicate);
    assert!(report.added.is_empty());
    assert_eq!(store.tree().section(s1).unwrap().pages.len(), 2);
}

#[test]
fn temporary_files_go_after_24_hours() {
    let (kit, mut store, [s1, _], pages) = setup();
    let tmp = section_dir(&kit, s1)
        .join(pages[0].to_string())
        .join(temp_name(PAGE_JSON));
    kit.fs.inner.put(&tmp, b"partial");
    let partial = section_dir(&kit, s1).join(format!("~{}.copying", pages[1]));
    kit.fs.inner.mkdir_all(&partial);
    store.scan().unwrap();
    assert!(kit.fs.inner.exists(&tmp) && kit.fs.inner.exists(&partial));
    kit.clock.advance(Duration::from_secs(25 * 3_600));
    let report = store.scan().unwrap();
    assert_eq!(report.deleted.len(), 2);
    assert!(!kit.fs.inner.exists(&tmp) && !kit.fs.inner.exists(&partial));
}

#[test]
fn a_leftover_purge_folder_is_deleted() {
    let (kit, mut store, _, pages) = setup();
    let item = store.delete(&[NodeRef::Page(pages[0])], TrashReason::Deleted).unwrap()[0];
    let dir = kit.root.join(".opennote/trash").join(item.to_string());
    let purge = kit.root.join(".opennote/trash").join(format!("~purge-{item}"));
    kit.fs.rename_dir(&dir, &purge).unwrap();
    let report = store.scan().unwrap();
    assert!(report.deleted.contains(&purge));
    assert!(store.trash_items().is_empty());
}

#[test]
fn a_hand_renamed_folder_keeps_working_where_it_is() {
    let (kit, mut store, [s1, _], pages) = setup();
    let a = pages[0];
    let renamed = section_dir(&kit, s1).join("My page");
    kit.fs
        .rename_dir(&section_dir(&kit, s1).join(a.to_string()), &renamed)
        .unwrap();
    store.scan().unwrap();
    assert_eq!(store.page_dir(a), Some(renamed.clone()));
    let loaded = read_page_files(&kit.fs, &kit.codec, &renamed, &crate::limits::Limits::default()).unwrap();
    assert_eq!(loaded.page.id, a);
}

/// A change made behind the notebook's back, by index into the notebook's pages and sections.
#[derive(Clone, Debug)]
enum Mess {
    Unlisted(usize),
    Missing(usize),
    Moving(usize),
    HandMoved(usize),
    PendingDelete(usize),
    Duplicate(usize),
    Renamed(usize),
    Temp(usize),
}

fn arb_mess() -> impl Strategy<Value = Vec<Mess>> {
    let one = prop_oneof![
        any::<usize>().prop_map(Mess::Unlisted),
        any::<usize>().prop_map(Mess::Missing),
        any::<usize>().prop_map(Mess::Moving),
        any::<usize>().prop_map(Mess::HandMoved),
        any::<usize>().prop_map(Mess::PendingDelete),
        any::<usize>().prop_map(Mess::Duplicate),
        any::<usize>().prop_map(Mess::Renamed),
        any::<usize>().prop_map(Mess::Temp),
    ];
    proptest::collection::vec(one, 0..8)
}

/// Applies each change to the notebook's files, keeping track of each page's current folder.
fn make_mess(kit: &Kit, store: &mut NotebookStore, mess: &[Mess], sections: [SectionId; 2]) {
    for m in mess {
        let pages: Vec<(SectionId, PageId)> = store
            .sections
            .values()
            .flat_map(|s| s.file.pages.iter().map(move |e| (s.file.id, e.id)))
            .collect();
        let pick = |i: usize| pages.get(i % pages.len().max(1)).copied();
        let other = |s: SectionId| if s == sections[0] { sections[1] } else { sections[0] };
        let dir_of = |p: PageId| store.page_dir(p).unwrap_or_default();
        match *m {
            Mess::Unlisted(i) => {
                unlisted_page(kit, &section_dir(kit, sections[i % 2]), "Unlisted");
            }
            Mess::Missing(i) => {
                if let Some((_, p)) = pick(i) {
                    let _ = kit.fs.remove_dir_all(&dir_of(p));
                }
            }
            Mess::Moving(i) => {
                if let Some((s, p)) = pick(i) {
                    let target = other(s);
                    let mut entry = store.sections[&s].entry(p).cloned().unwrap();
                    entry.moving = Some(Moving::From(s));
                    store.sections.get_mut(&s).unwrap().file.pages.retain(|e| e.id != p);
                    store.sections.get_mut(&target).unwrap().file.pages.push(entry);
                    store.write_section(s).unwrap();
                    store.write_section(target).unwrap();
                }
            }
            Mess::HandMoved(i) => {
                if let Some((s, p)) = pick(i) {
                    let _ = kit
                        .fs
                        .rename_dir(&dir_of(p), &section_dir(kit, other(s)).join(p.to_string()));
                }
            }
            Mess::PendingDelete(i) => {
                if let Some((_, p)) = pick(i) {
                    let dir = dir_of(p);
                    kit.fs.hold(&dir);
                    let _ = store.delete(&[NodeRef::Page(p)], TrashReason::Deleted);
                    kit.fs.release();
                }
            }
            Mess::Duplicate(i) => {
                if let Some((s, p)) = pick(i) {
                    let copy = section_dir(kit, s).join(format!("copy {i}"));
                    let _ = crate::store::notebook_store::copy_tree(&kit.fs, &dir_of(p), &copy);
                }
            }
            Mess::Renamed(i) => {
                if let Some((s, p)) = pick(i) {
                    let _ = kit
                        .fs
                        .rename_dir(&dir_of(p), &section_dir(kit, s).join(format!("renamed {i}")));
                }
            }
            Mess::Temp(i) => {
                kit.fs
                    .inner
                    .put(&section_dir(kit, sections[i % 2]).join(temp_name("x")), b"t");
            }
        }
        store.mark_pending();
    }
}

/// Checks P11 for one mix: the scan doesn't fail, shows every page once, each shown page has its folder, and
/// a second scan changes nothing.
fn check_scan_heals(mess: &[Mess]) -> Result<(), TestCaseError> {
    let (kit, mut store, sections, _) = setup();
    make_mess(&kit, &mut store, mess, sections);
    let mut fresh = kit.open().unwrap();
    fresh.scan().unwrap();
    let tree = fresh.tree();
    let mut seen: HashMap<PageId, u32> = HashMap::new();
    for page in tree.sections.iter().flat_map(|s| s.pages.iter()) {
        *seen.entry(page.id).or_default() += 1;
        if !matches!(page.state, PageNodeState::Unavailable { .. }) {
            let dir = fresh.page_dir(page.id).unwrap();
            prop_assert!(kit.fs.inner.exists(&dir.join(PAGE_JSON)), "no folder for {}", page.id);
        }
    }
    prop_assert!(seen.values().all(|&n| n == 1), "a page shows twice: {seen:?}");
    let before = snapshot(&kit.fs.inner);
    let second = fresh.scan().unwrap();
    prop_assert!(!second.changed_files(), "the second scan changed {:?}", second);
    prop_assert_eq!(snapshot(&kit.fs.inner), before);
    prop_assert_eq!(kit.open().unwrap().tree().sections.len(), tree.sections.len());
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(64),
        failure_persistence: None,
        ..ProptestConfig::default()
    })]

    /// P11: whatever mix of listed, unlisted, missing, moving, trashed, and duplicated folders the notebook
    /// has, the scan never fails, shows every page once, and changes nothing when it runs again.
    #[test]
    fn p11_the_scan_heals_any_mix_and_is_idempotent(mess in arb_mess()) {
        check_scan_heals(&mess)?;
    }
}

/// Past failures of P11, kept as plain tests.
#[test]
fn p11_a_missing_folder_with_a_move_mark_is_unavailable() {
    check_scan_heals(&[
        Mess::Missing(12_218_746_045_822_954_919),
        Mess::Moving(6_279_497_440_818_687_287),
    ])
    .unwrap();
}

#[test]
fn p11_a_renamed_folder_with_a_move_mark_finishes_its_move() {
    check_scan_heals(&[
        Mess::Renamed(52_660_940_398_661_126),
        Mess::Moving(82_285_572_162_426_152),
    ])
    .unwrap();
}
