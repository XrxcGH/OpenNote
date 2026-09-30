#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::time::Duration;

use super::*;
use crate::id::Id;
use crate::model::VersionReason;
use crate::seams::Codec;
use crate::store::compact::CompactionPlan;
use crate::store::fs::Fs;
use crate::store::page_store::tests::{draw, stroke_n, Harness};
use crate::testing::sample::sample_page;

fn files(h: &Harness) -> PageFiles<'_> {
    PageFiles {
        fs: &h.fs,
        codec: &h.codec,
        dir: &h.dir,
    }
}

fn at(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

/// Writes a version of the sample page saved at `saved_at`, with an optional name.
fn version(h: &Harness, n: u64, saved_at: Timestamp, name: Option<&str>) -> RevisionId {
    let mut page = sample_page();
    page.revision.id = RevisionId(Id::from_parts(saved_at.unix_ms() as u64, n.into()));
    page.revision.saved_at = saved_at;
    let bytes = h.codec.write_page(&page);
    write_version(
        &files(h),
        &bytes,
        &page,
        VersionReason::Interval,
        name.map(str::to_owned),
    )
    .unwrap();
    page.revision.id
}

#[test]
fn writes_lists_and_opens_versions() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    draw(&mut page, stroke_n(1));
    let (saved, outcome) = h.save(&page, None, CompactionPlan::None);
    let f = files(&h);
    write_version(&f, &outcome.bytes, &saved, VersionReason::Closed, None).unwrap();
    write_version(
        &f,
        &outcome.bytes,
        &saved,
        VersionReason::Interval,
        Some("Before exam".into()),
    )
    .unwrap();
    let list = list_versions(&f, &Limits::default()).unwrap();
    assert_eq!(list.page, saved.id);
    assert_eq!(list.versions.len(), 1);
    let entry = &list.versions[0];
    assert_eq!(entry.reason.known(), Some(VersionReason::Closed));
    assert_eq!(entry.name.as_deref(), Some("Before exam"));
    assert_eq!(entry.segments, [outcome.segments[0].id]);
    assert_eq!(entry.assets.len(), 1);
    let opened = open_version(&f, saved.revision.id, &Limits::default()).unwrap();
    assert_eq!(opened.page, saved);
    assert!(opened.warnings.is_empty());
    assert!(open_version(&f, RevisionId::ZERO, &Limits::default()).is_err());
}

#[test]
fn rebuilds_a_missing_or_damaged_list() {
    let h = Harness::new();
    let first = version(&h, 1, at("2026-09-30T10:00:00.000Z"), Some("One"));
    let second = version(&h, 2, at("2026-09-30T11:00:00.000Z"), None);
    let list_path = NotebookLayout::versions_json(&h.dir);
    h.fs.put(&list_path, b"damaged");
    let rebuilt = list_versions(&files(&h), &Limits::default()).unwrap();
    let revisions: Vec<RevisionId> = rebuilt.versions.iter().map(|v| v.revision).collect();
    assert_eq!(revisions, [first, second]);
    assert_eq!(rebuilt.versions[0].reason.as_str(), "unknown");
    assert!(
        h.codec
            .read_versions(&h.fs.get(&list_path).unwrap(), &Limits::default())
            .is_ok(),
        "written back"
    );
    h.fs.remove_file(&NotebookLayout::version_path(&h.dir, first)).unwrap();
    let pruned = list_versions(&files(&h), &Limits::default()).unwrap();
    assert_eq!(pruned.versions.len(), 1, "an entry without its snapshot is left out");
    let empty = Harness::new();
    assert!(list_versions(&files(&empty), &Limits::default())
        .unwrap()
        .versions
        .is_empty());
}

#[test]
fn encrypted_pages_keep_no_history() {
    let h = Harness::new();
    let mut page = sample_page();
    page.encryption = Some(serde_json::json!({}));
    write_version(&files(&h), b"secret", &page, VersionReason::Closed, None).unwrap();
    assert!(!h.fs.exists(&h.dir.join(HISTORY_DIR)));
}

#[test]
fn thinning_keeps_one_version_per_bucket_and_the_pinned_ones() {
    let h = Harness::new();
    let now = at("2026-11-10T12:00:00.000Z");
    let recent: Vec<RevisionId> = (0..3)
        .map(|n| version(&h, n, now.saturating_sub(Duration::from_secs(60 * (n + 1))), None))
        .collect();
    let hour_a = version(&h, 10, at("2026-11-08T09:10:00.000Z"), None);
    let hour_b = version(&h, 11, at("2026-11-08T09:40:00.000Z"), None);
    let named = version(&h, 12, at("2026-11-08T09:20:00.000Z"), Some("Keep me"));
    let protected = version(&h, 13, at("2026-11-08T09:30:00.000Z"), None);
    let ancient = version(&h, 14, at("2024-01-01T00:00:00.000Z"), None);
    let report = thin(&files(&h), now, 0, Retention::Year1, &[protected]).unwrap();
    assert_eq!(report.dropped, [ancient, hour_a]);
    let left: Vec<RevisionId> = list_versions(&files(&h), &Limits::default())
        .unwrap()
        .versions
        .iter()
        .map(|v| v.revision)
        .collect();
    for kept in recent.iter().chain([&hour_b, &named, &protected]) {
        assert!(left.contains(kept));
    }
    assert!(!h.fs.exists(&NotebookLayout::version_path(&h.dir, hour_a)));
    assert_eq!(report.kept as usize, left.len());
}

#[test]
fn thinning_places_day_boundaries_in_local_time_across_a_clock_change() {
    // Clocks in New York fell back on 2026-11-01. The two versions straddle local midnight in daylight time.
    let now = at("2026-11-10T12:00:00.000Z");
    let before = at("2026-11-01T03:30:00.000Z");
    let after = at("2026-11-01T04:30:00.000Z");
    for (offset, dropped) in [(-240, 0), (-300, 1)] {
        let h = Harness::new();
        let early = version(&h, 1, before, None);
        version(&h, 2, after, None);
        version(&h, 3, now, None);
        let report = thin(&files(&h), now, offset, Retention::Forever, &[]).unwrap();
        assert_eq!(report.dropped.len(), dropped, "offset {offset}");
        if dropped == 1 {
            assert_eq!(report.dropped, [early]);
        }
    }
}

#[test]
fn retention_drops_old_versions_but_never_the_newest() {
    let h = Harness::new();
    let now = at("2026-11-10T12:00:00.000Z");
    let old = version(&h, 1, at("2026-09-01T12:00:00.000Z"), None);
    let only_newest = Harness::new();
    let newest = version(&only_newest, 1, at("2026-01-01T12:00:00.000Z"), None);
    version(&h, 2, now, None);
    assert_eq!(thin(&files(&h), now, 0, Retention::Days30, &[]).unwrap().dropped, [old]);
    let report = thin(&files(&only_newest), now, 0, Retention::Days30, &[]).unwrap();
    assert!(report.dropped.is_empty() && report.kept == 1, "{newest}");
}
