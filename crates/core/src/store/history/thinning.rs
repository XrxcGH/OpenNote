//! Which versions thinning keeps (spec 13.3).

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use crate::id::{AssetId, Id, RevisionId, SegmentId};
use crate::limits::{Limits, Policy};
use crate::model::VersionEntry;
use crate::store::layout::{NotebookLayout, ASSETS_DIR, INK_DIR};
use crate::store::PageFiles;
use crate::time::Timestamp;

const DAY: Duration = Duration::from_secs(86_400);
const WEEK: Duration = Duration::from_secs(604_800);
/// 30 days.
pub const MONTH: Duration = Duration::from_secs(2_592_000);
/// 365 days.
pub const YEAR: Duration = Duration::from_secs(31_536_000);

/// What thinning keeps.
pub struct Plan<'a> {
    /// Now.
    pub now: Timestamp,
    /// The local time's offset from UTC, for day, week, and month boundaries.
    pub offset_minutes: i32,
    /// Versions older than this go, unless they are always kept.
    pub max_age: Option<Duration>,
    /// Revisions an open conflict or a journal still needs.
    pub protected: &'a [RevisionId],
}

impl Plan<'_> {
    /// Named versions, versions marked `keep`, the newest one, and protected ones always stay.
    fn pinned(&self, version: &VersionEntry, newest: Option<RevisionId>) -> bool {
        version.name.is_some()
            || version.keep
            || self.protected.contains(&version.revision)
            || newest == Some(version.revision)
    }

    /// The versions to drop by age: past the retention, or not the newest in their hour, day, week, or month.
    pub fn drop_by_age(&self, versions: &[VersionEntry]) -> Vec<RevisionId> {
        let newest = newest(versions);
        let mut best: HashMap<(u8, String), &VersionEntry> = HashMap::new();
        let mut dropped = Vec::new();
        for version in versions.iter().filter(|v| !self.pinned(v, newest)) {
            let age = self.now.since(version.saved_at);
            if self.max_age.is_some_and(|max| age > max) {
                dropped.push(version.revision);
                continue;
            }
            let Some(key) = bucket(version.saved_at, age, self.offset_minutes) else {
                continue;
            };
            let order = |v: &VersionEntry| (v.saved_at, v.revision);
            match best.get(&key) {
                Some(kept) if order(kept) >= order(version) => dropped.push(version.revision),
                Some(kept) => {
                    dropped.push(kept.revision);
                    best.insert(key, version);
                }
                None => {
                    best.insert(key, version);
                }
            }
        }
        dropped
    }

    /// More versions to drop, oldest first, while the history passes its size limit.
    pub fn drop_by_size(
        &self,
        versions: &[VersionEntry],
        already: &[RevisionId],
        sizes: &SharedSizes,
    ) -> Vec<RevisionId> {
        let cap = Policy::default().history_bytes;
        let newest = newest(versions);
        let mut left: Vec<&VersionEntry> = versions.iter().filter(|v| !already.contains(&v.revision)).collect();
        left.sort_by_key(|v| (v.saved_at, v.revision));
        let mut dropped = Vec::new();
        while sizes.history_bytes(&left) > cap {
            let Some(index) = left.iter().position(|v| !self.pinned(v, newest)) else {
                break;
            };
            dropped.push(left.remove(index).revision);
        }
        dropped
    }
}

fn newest(versions: &[VersionEntry]) -> Option<RevisionId> {
    versions
        .iter()
        .max_by_key(|v| (v.saved_at, v.revision))
        .map(|v| v.revision)
}

/// The thinning bucket of a version: `None` under 24 hours, where every version stays. Then the local hour
/// up to 7 days, the local day up to 30 days, the ISO week up to a year, and the month after that.
pub fn bucket(saved_at: Timestamp, age: Duration, offset_minutes: i32) -> Option<(u8, String)> {
    if age < DAY {
        return None;
    }
    let shift = i64::from(offset_minutes).saturating_mul(60_000);
    let local = Timestamp::from_unix_ms(saved_at.unix_ms().saturating_add(shift));
    let text = local.to_rfc3339();
    let prefix = |len: usize| text.get(..len).unwrap_or(&text).to_owned();
    Some(if age < WEEK {
        (1, prefix(13))
    } else if age < MONTH {
        (2, prefix(10))
    } else if age < YEAR {
        (3, iso_week(local))
    } else {
        (4, prefix(7))
    })
}

/// The ISO week of a local time, as a count of Monday-based weeks since the Unix epoch.
fn iso_week(local: Timestamp) -> String {
    let days = local.unix_ms().div_euclid(DAY.as_millis() as i64);
    // 1970-01-01 was a Thursday, so shifting by 3 days makes weeks start on Monday.
    let week = days.checked_add(3).map_or(0, |d| d.div_euclid(7));
    format!("w{week}")
}

/// The files history keeps alive: segment and asset sizes, and those the current page still uses.
#[derive(Clone, Debug, Default)]
pub struct SharedSizes {
    /// Segments and assets that `page.json` lists.
    pub current: HashSet<Id>,
    /// The size of every segment and asset file, by ID.
    pub sizes: HashMap<Id, u64>,
}

impl SharedSizes {
    /// Snapshots, plus the ink and assets that only these versions use.
    fn history_bytes(&self, versions: &[&VersionEntry]) -> u64 {
        let mut only_history = HashSet::new();
        let mut total = 0u64;
        for version in versions {
            total = total.saturating_add(version.bytes);
            let ids = version
                .segments
                .iter()
                .map(|s| s.0)
                .chain(version.assets.iter().map(|a| a.0));
            only_history.extend(ids.filter(|id| !self.current.contains(id)));
        }
        only_history
            .iter()
            .filter_map(|id| self.sizes.get(id))
            .fold(total, |sum, size| sum.saturating_add(*size))
    }
}

/// Reads the sizes of a page's segments and assets, and which ones `page.json` lists.
pub fn shared_sizes(files: &PageFiles<'_>, limits: &Limits) -> SharedSizes {
    let mut shared = SharedSizes::default();
    let page = files
        .fs
        .read(&NotebookLayout::page_json(files.dir), limits.page_json_bytes)
        .ok()
        .and_then(|bytes| files.codec.read_page(&bytes, limits).ok());
    if let Some(read) = page {
        shared.current.extend(read.page.ink.segments().iter().map(|s| s.id.0));
        shared.current.extend(read.page.assets.keys().map(|a| a.0));
    }
    for entry in files.fs.read_dir(&files.dir.join(INK_DIR)).unwrap_or_default() {
        if let Some(id) = entry.name.strip_suffix(".onk").and_then(|s| SegmentId::parse(s).ok()) {
            shared.sizes.insert(id.0, entry.len);
        }
    }
    for entry in files.fs.read_dir(&files.dir.join(ASSETS_DIR)).unwrap_or_default() {
        if let Some(id) = entry.name.get(..Id::TEXT_LEN).and_then(|s| AssetId::parse(s).ok()) {
            shared.sizes.insert(id.0, entry.len);
        }
    }
    shared
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]

    use super::*;

    fn at(text: &str) -> Timestamp {
        Timestamp::parse(text).unwrap()
    }

    #[test]
    fn buckets_by_age_in_local_time() {
        let saved = at("2026-11-01T04:30:00.000Z");
        assert_eq!(bucket(saved, Duration::from_secs(3_600), 0), None);
        assert_eq!(bucket(saved, DAY * 2, -240).unwrap(), (1, "2026-11-01T00".to_owned()));
        assert_eq!(bucket(saved, DAY * 9, -240).unwrap(), (2, "2026-11-01".to_owned()));
        assert_eq!(bucket(saved, DAY * 9, -300).unwrap(), (2, "2026-10-31".to_owned()));
        assert_eq!(bucket(saved, DAY * 400, 0).unwrap(), (4, "2026-11".to_owned()));
        let monday = at("2026-09-28T10:00:00.000Z");
        let sunday = at("2026-10-04T10:00:00.000Z");
        let next_monday = at("2026-10-05T10:00:00.000Z");
        let week = |t| bucket(t, DAY * 60, 0).unwrap();
        assert_eq!(week(monday), week(sunday));
        assert_ne!(week(sunday), week(next_monday));
    }

    fn entry(n: u64, bytes: u64, assets: &[u64]) -> VersionEntry {
        VersionEntry {
            revision: RevisionId(Id::from_parts(1_790_000_000_000 + n, 1)),
            saved_at: Timestamp::from_unix_ms(1_790_000_000_000 + n as i64),
            reason: crate::model::Named::Known(crate::model::VersionReason::Interval),
            name: None,
            keep: false,
            device: crate::testing::sample::sample_device(),
            bytes,
            segments: Vec::new(),
            assets: assets.iter().map(|&a| AssetId(Id::from_parts(a, 2))).collect(),
            extra: crate::model::JsonMap::new(),
        }
    }

    #[test]
    fn history_stays_within_its_size_limit() {
        const MIB: u64 = 1024 * 1024;
        let plan = Plan {
            now: Timestamp::from_unix_ms(1_790_000_100_000),
            offset_minutes: 0,
            max_age: None,
            protected: &[],
        };
        let versions = [
            entry(1, 10 * MIB, &[7]),
            entry(2, 10 * MIB, &[8]),
            entry(3, 10 * MIB, &[]),
        ];
        let mut sizes = SharedSizes::default();
        sizes.sizes.insert(Id::from_parts(7, 2), 25 * MIB);
        sizes.sizes.insert(Id::from_parts(8, 2), 5 * MIB);
        let dropped = plan.drop_by_size(&versions, &[], &sizes);
        assert_eq!(dropped, [versions[0].revision], "an image only history uses counts too");
        sizes.current.insert(Id::from_parts(7, 2));
        assert!(
            plan.drop_by_size(&versions, &[], &sizes).is_empty(),
            "the page still shows that image"
        );
        let named = [VersionEntry {
            name: Some("Keep".into()),
            ..entry(1, 60 * MIB, &[])
        }];
        assert!(plan.drop_by_size(&named, &[], &sizes).is_empty());
    }
}
