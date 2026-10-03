#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use sha2::{Digest, Sha256};

use super::*;
use crate::id::Id;
use crate::model::{TrashItemFile, TrashOrigin};
use crate::store::compact::CompactionPlan;
use crate::store::page_store::tests::Harness;
use crate::testing::sample::{sample_notebook, sample_page, sample_section};

const ROOT: &str = "/notebooks/Biology";

/// A notebook with the sample section and the sample page, saved, with real asset hashes.
fn notebook() -> Harness {
    let h = Harness::new();
    let root = Path::new(ROOT);
    h.fs.put(
        &NotebookLayout::new(root).notebook_json(),
        &h.codec.write_notebook(&sample_notebook()),
    );
    let mut section = sample_section();
    section.pages.truncate(1);
    h.fs.put(
        &h.dir.parent().unwrap().join(SECTION_JSON),
        &h.codec.write_section(&section),
    );
    let mut page = sample_page();
    for asset in page.assets.values_mut() {
        let bytes = vec![7u8; asset.bytes as usize];
        asset.sha256 = Sha256::digest(&bytes).into();
    }
    h.put_assets(&page);
    h.save(&page, None, CompactionPlan::None);
    h
}

fn verify(h: &Harness) -> VerifyReport {
    verify_notebook(&h.fs, &h.codec, Path::new(ROOT), &Limits::default()).unwrap()
}

fn codes(report: &VerifyReport) -> Vec<&'static str> {
    report.problems.iter().map(|(_, w)| w.code).collect()
}

#[test]
fn a_healthy_notebook_is_clean() {
    let h = notebook();
    let report = verify(&h);
    assert!(report.is_clean(), "{:?}", report.problems);
    assert!(report.files >= 5, "{}", report.files);
}

#[test]
fn damaged_and_missing_files_are_problems() {
    let h = notebook();
    let page = h.store.load(&h.dir).unwrap().page;
    let segment = NotebookLayout::segment_path(&h.dir, page.ink.segments()[0].id);
    h.fs.put(&segment, b"garbage");
    let asset = NotebookLayout::asset_path(&h.dir, page.assets.values().next().unwrap()).unwrap();
    let mut changed = h.fs.get(&asset).unwrap();
    changed[0] ^= 1;
    h.fs.put(&asset, &changed);
    h.fs.put(&h.dir.join(".conflicts").join("x.json"), b"nonsense");
    assert_eq!(
        codes(&verify(&h)),
        ["segment.invalid", "asset.checksum", "conflict.invalid"]
    );
    h.fs.put(&NotebookLayout::page_json(&h.dir), b"nonsense");
    let report = verify(&h);
    assert!(codes(&report).contains(&"page.invalid"));
    assert!(codes(&report).contains(&"tree.entryWithoutFolder"));
}

#[test]
fn the_tree_must_match_the_folders() {
    let h = notebook();
    let section_dir = h.dir.parent().unwrap().to_path_buf();
    let mut section = sample_section();
    section.pages.truncate(1);
    section.pages[0].moving = Some(crate::model::Moving::From(section.id));
    let mut stranger = section.pages[0].clone();
    stranger.id = PageId(Id::from_parts(9, 9));
    section.pages.push(stranger);
    h.fs.put(&section_dir.join(SECTION_JSON), &h.codec.write_section(&section));
    let bytes = h.fs.get(&NotebookLayout::page_json(&h.dir)).unwrap();
    let other = SectionId(Id::from_parts(8, 8));
    let copy = NotebookLayout::new(ROOT).page_dir(other, sample_page().id);
    h.fs.put(&NotebookLayout::page_json(&copy), &bytes);
    let mut other_file = sample_section();
    other_file.id = other;
    other_file.pages.truncate(1);
    h.fs.put(
        &NotebookLayout::new(ROOT).section_json(other),
        &h.codec.write_section(&other_file),
    );
    let report = verify(&h);
    let found = codes(&report);
    for code in ["tree.pendingMove", "tree.entryWithoutFolder", "tree.duplicatePage"] {
        assert!(found.contains(&code), "{code}: {found:?}");
    }
}

#[test]
fn trash_items_must_hold_what_they_list() {
    let h = notebook();
    let trash = NotebookLayout::new(ROOT).trash_dir();
    let item_id = TrashItemId(Id::from_parts(1_790_000_000_000, 4));
    let item = TrashItemFile {
        id: item_id,
        kind: TrashKind::Page,
        title: "Gone".into(),
        deleted_at: crate::time::Timestamp::EPOCH,
        expires_at: crate::time::Timestamp::EPOCH,
        deleted_by: crate::testing::sample::sample_device(),
        reason: Default::default(),
        origin: TrashOrigin::Pages {
            section: sample_section().id,
            section_title: "Lab reports".into(),
            entries: Vec::new(),
        },
        contents: vec![Id::from_parts(1_790_000_000_000, 5)],
        extra: Default::default(),
        format: Default::default(),
    };
    let dir = trash.join(item_id.to_string());
    h.fs.put(&dir.join(ITEM_JSON), &h.codec.write_trash_item(&item));
    assert_eq!(codes(&verify(&h)), ["trash.contentMissing"]);
    h.fs.put(&dir.join(ITEM_JSON), b"nonsense");
    assert_eq!(codes(&verify(&h)), ["trash.invalid"]);
}
