#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use super::*;
use crate::model::VersionReason;
use crate::seams::Codec;
use crate::store::compact::CompactionPlan;
use crate::store::fs::Fs;
use crate::store::history::write_version;
use crate::store::layout::NotebookLayout;
use crate::store::page_store::tests::{draw, stroke_n, Harness};
use crate::testing::sample::sample_page;
use crate::time::Clock;

const DAY: Duration = Duration::from_secs(86_400);

fn files(h: &Harness) -> PageFiles<'_> {
    PageFiles {
        fs: &h.fs,
        codec: &h.codec,
        dir: &h.dir,
    }
}

/// A page saved twice, the second time with major compaction, so the first segment is unreferenced.
fn two_bases(h: &Harness) -> (SegmentId, SegmentId, Page) {
    let mut page = sample_page();
    h.put_assets(&page);
    draw(&mut page, stroke_n(1));
    let (page, first) = h.save(&page, None, CompactionPlan::None);
    let (page, second) = h.save(&page, Some(first.stamp), CompactionPlan::Major);
    (first.segments[0].id, second.segments[0].id, page)
}

#[test]
fn deletes_unreferenced_segments_after_the_grace_period() {
    let h = Harness::new();
    let (old, live, _) = two_bases(&h);
    let now = h.clock.now();
    let early = collect_garbage(&files(&h), &RefSet::default(), now.saturating_add(DAY * 10), DAY * 30).unwrap();
    assert_eq!(early, GcReport::default());
    let report = collect_garbage(&files(&h), &RefSet::default(), now.saturating_add(DAY * 31), DAY * 30).unwrap();
    assert_eq!(report.segments, [old]);
    assert!(report.bytes > 0);
    assert!(!h.fs.exists(&NotebookLayout::segment_path(&h.dir, old)));
    assert!(h.fs.exists(&NotebookLayout::segment_path(&h.dir, live)));
}

#[test]
fn history_conflicts_copies_and_journals_keep_files_alive() {
    let h = Harness::new();
    let (old, _, page) = two_bases(&h);
    let later = h.clock.now().saturating_add(DAY * 31);
    let mut protect = RefSet::default();
    protect.segments.insert(old);
    assert!(collect_garbage(&files(&h), &protect, later, DAY * 30)
        .unwrap()
        .segments
        .is_empty());
    let mut older = page.clone();
    older.ink = sample_page().ink;
    older.ink.commit(usize::MAX, vec![], 0);
    let mut listed = older.ink.segments().to_vec();
    listed.push(crate::model::SegmentRef {
        id: old,
        bytes: 1,
        records: 1,
        crc32: 0,
        extra: Default::default(),
    });
    older.ink.commit(0, listed, 0);
    older.revision.id = "01m3sa8yf8bryf28a7sjgb7mmz".parse().unwrap();
    let copy = h.dir.join("page-LAPTOP.json");
    h.fs.put(&copy, &h.codec.write_page(&older));
    assert!(collect_garbage(&files(&h), &RefSet::default(), later, DAY * 30)
        .unwrap()
        .segments
        .is_empty());
    h.fs.remove_file(&copy).unwrap();
    h.fs.put(
        &NotebookLayout::conflict_path(&h.dir, older.revision.id),
        &h.codec.write_page(&older),
    );
    assert!(collect_garbage(&files(&h), &RefSet::default(), later, DAY * 30)
        .unwrap()
        .segments
        .is_empty());
    h.fs.remove_file(&NotebookLayout::conflict_path(&h.dir, older.revision.id))
        .unwrap();
    write_version(&files(&h), b"old", &older, VersionReason::Closed, None).unwrap();
    assert!(collect_garbage(&files(&h), &RefSet::default(), later, DAY * 30)
        .unwrap()
        .segments
        .is_empty());
}

#[test]
fn unreadable_references_stop_every_deletion() {
    let h = Harness::new();
    let (_, _, _) = two_bases(&h);
    let later = h.clock.now().saturating_add(DAY * 31);
    let json = NotebookLayout::page_json(&h.dir);
    let good = h.fs.get(&json).unwrap();
    h.fs.put(&json, b"damaged");
    assert_eq!(
        collect_garbage(&files(&h), &RefSet::default(), later, DAY * 30).unwrap(),
        GcReport::default()
    );
    h.fs.put(&json, &good);
    h.fs.put(
        &h.dir.join(".conflicts").join("01m3sa8yf8bryf28a7sjgb7mmz.json"),
        b"damaged",
    );
    assert!(collect_garbage(&files(&h), &RefSet::default(), later, DAY * 30)
        .unwrap()
        .segments
        .is_empty());
}

#[test]
fn only_files_with_the_patterns_of_spec_19_are_deleted() {
    let h = Harness::new();
    let (_, _, mut page) = two_bases(&h);
    let asset = page.assets.values().next().unwrap().clone();
    let asset_path = NotebookLayout::asset_path(&h.dir, &asset).unwrap();
    page.assets.clear();
    let stamp = h.store.fingerprint(&h.dir).unwrap();
    h.save(&page, stamp, CompactionPlan::None);
    let ink = h.dir.join("ink");
    h.fs.put(&ink.join("my drawing.onk"), b"x");
    h.fs.put(&h.dir.join("assets").join("holiday.png"), b"x");
    let damaged = h.dir.join(".damaged");
    h.fs.put(&damaged.join("20260101T000000Z-page.json"), b"old");
    h.fs.put(&damaged.join("20260930T140000Z-page.json"), b"new");
    h.fs.put(&damaged.join("notes.txt"), b"mine");
    let report = collect_garbage(
        &files(&h),
        &RefSet::default(),
        h.clock.now().saturating_add(DAY * 31),
        DAY * 30,
    )
    .unwrap();
    assert_eq!(report.assets, [asset.id]);
    assert!(!h.fs.exists(&asset_path));
    assert!(h.fs.exists(&ink.join("my drawing.onk")));
    assert!(h.fs.exists(&h.dir.join("assets").join("holiday.png")));
    assert!(!h.fs.exists(&damaged.join("20260101T000000Z-page.json")));
    assert!(h.fs.exists(&damaged.join("20260930T140000Z-page.json")));
    assert!(h.fs.exists(&damaged.join("notes.txt")));
    assert_eq!(
        parse_file_time("20260930T140740Z"),
        Timestamp::parse("2026-09-30T14:07:40Z").ok()
    );
    assert_eq!(parse_file_time("2026-09-30"), None);
}
