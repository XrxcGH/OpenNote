#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::time::Duration;

use super::*;
use crate::testing::MemFs;
use crate::time::Timestamp;

const ROOT: &str = "/notes/Biology";
const SECTION: &str = "01m3s9v8ym7yt5c8yb61tthbwt";
const PAGE: &str = "01m3sa12426sg32pmtyffjaqcf";

fn notebook() -> MemFs {
    let fs = MemFs::new();
    let root = Path::new(ROOT);
    let page = root.join(SECTION).join(PAGE);
    fs.put(&root.join("notebook.json"), b"notebook");
    fs.put(&root.join(SECTION).join("section.json"), b"section");
    fs.put(&page.join("page.json"), b"page");
    fs.put(&page.join("page.md"), b"# Page");
    fs.put(&page.join("ink").join("01m3sa81n2n6c32zjexe5yq0r5.onk"), b"ink");
    fs.put(&page.join(".history").join("versions.json"), b"versions");
    fs.put(&page.join("~page.json.0badf00d.tmp"), b"temp");
    fs.put(&root.join(".opennote").join("lock"), b"");
    fs.mkdir_all(Path::new("/data"));
    fs
}

fn at(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

#[test]
fn upgrade_backups_copy_every_json_file_and_keep_three_sets() {
    let fs = notebook();
    let backups = Path::new("/data/backups/01m3s9q9xbpmxwz4cz4ht6twg9");
    let set = backup_before_upgrade(&fs, Path::new(ROOT), backups, 1, 2).unwrap();
    let name = set.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.ends_with("-v1-to-v2") && is_upgrade_set(&name), "{name}");
    let page = set.join(SECTION).join(PAGE);
    assert_eq!(fs.get(&set.join("notebook.json")).unwrap(), b"notebook");
    assert_eq!(fs.get(&page.join("page.json")).unwrap(), b"page");
    assert_eq!(
        fs.get(&page.join(".history").join("versions.json")).unwrap(),
        b"versions"
    );
    assert!(!fs.exists(&page.join("page.md")) && !fs.exists(&page.join("ink")));
    for _ in 0..3 {
        backup_before_upgrade(&fs, Path::new(ROOT), backups, 1, 2).unwrap();
    }
    let sets = fs.read_dir(backups).unwrap();
    assert_eq!(sets.len(), 3, "{sets:?}");
    assert!(!fs.exists(&set), "the oldest set went");
}

#[test]
fn scheduled_backups_copy_only_what_changed() {
    let fs = notebook();
    let dest = Path::new("/usb/OpenNote backups/Biology");
    let now = at("2026-09-30T14:00:00Z");
    let policy = BackupPolicy::default();
    let first = backup_notebook(&fs, Path::new(ROOT), dest, now, 0, &policy).unwrap();
    assert_eq!(first.set, dest.join("2026-09-30"));
    assert_eq!(first.copied_files, 6, "every file but the temporary one and the lock");
    assert!(is_backup(&fs, &first.set));
    assert_eq!(last_backup(&fs, dest), Some(now));
    let page = Path::new(ROOT).join(SECTION).join(PAGE);
    let later = now.saturating_add(Duration::from_secs(3_600));
    let again = backup_notebook(&fs, Path::new(ROOT), dest, later, 0, &policy).unwrap();
    assert_eq!((again.copied_files, again.removed_files), (0, 0));
    fs.put(&page.join("page.json"), b"page, edited");
    fs.remove_file(&page.join("page.md")).unwrap();
    let edited = backup_notebook(&fs, Path::new(ROOT), dest, later, 0, &policy).unwrap();
    assert_eq!((edited.copied_files, edited.removed_files), (1, 1));
    let copy = first.set.join(SECTION).join(PAGE);
    assert_eq!(fs.get(&copy.join("page.json")).unwrap(), b"page, edited");
    assert!(!fs.exists(&copy.join("page.md")));
    let local = backup_notebook(&fs, Path::new(ROOT), dest, at("2026-10-01T02:00:00Z"), -240, &policy).unwrap();
    assert_eq!(local.set, dest.join("2026-09-30"), "still the 30th in New York");
}

#[test]
fn old_sets_follow_the_daily_weekly_and_monthly_policy() {
    let fs = notebook();
    let dest = Path::new("/usb/backups");
    let policy = BackupPolicy {
        daily: 2,
        weekly: 3,
        monthly: 2,
    };
    let start = at("2026-08-01T12:00:00Z");
    for day in 0..40u64 {
        let now = start.saturating_add(Duration::from_secs(86_400 * day));
        backup_notebook(&fs, Path::new(ROOT), dest, now, 0, &policy).unwrap();
    }
    let mut names: Vec<String> = fs.read_dir(dest).unwrap().into_iter().map(|e| e.name).collect();
    names.sort();
    assert_eq!(
        names,
        ["2026-08-30", "2026-08-31", "2026-09-06", "2026-09-08", "2026-09-09"],
        "the newest 2 days, the newest of 3 weeks, and the newest of 2 months"
    );
}

#[test]
fn backups_are_due_on_schedule() {
    let now = at("2026-09-30T14:00:00Z");
    let hour = Duration::from_secs(3_600);
    assert!(backup_due(None, hour, now));
    assert!(!backup_due(Some(now.saturating_sub(hour / 2)), hour, now));
    assert!(backup_due(Some(now.saturating_sub(hour)), hour, now));
}
