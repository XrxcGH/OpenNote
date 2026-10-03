use super::*;

fn p(text: &str) -> &Path {
    Path::new(text)
}

fn kind<T>(result: Result<T, FsError>) -> Option<FsErrorKind> {
    result.err().map(|e| e.kind)
}

#[test]
fn replaces_and_reads_files() {
    let fs = MemFs::new();
    fs.mkdir_all(p("/nb/s1"));
    let first = fs.replace_durable(p("/nb/s1/section.json"), b"one").unwrap();
    assert_eq!(first.durability, Durability::Confirmed);
    let second = fs.replace_durable(p("/nb/s1/section.json"), b"two!").unwrap();
    assert_ne!(first.stamp.file_id, second.stamp.file_id, "a replace makes a new file");
    assert_eq!(second.stamp.len, 4);
    assert_eq!(fs.read(p("/nb/s1/section.json"), 100).unwrap(), b"two!");
    assert_eq!(fs.read_prefix(p("/nb/s1/section.json"), 2).unwrap(), b"tw");
    assert_eq!(fs.read_range(p("/nb/s1/section.json"), 1..99).unwrap(), b"wo!");
    assert_eq!(kind(fs.read(p("/nb/s1/section.json"), 3)), Some(FsErrorKind::TooLarge));
    assert_eq!(kind(fs.read(p("/nb/missing"), 3)), Some(FsErrorKind::NotFound));
    assert_eq!(
        kind(fs.replace_durable(p("/nowhere/x"), b"")),
        Some(FsErrorKind::NotFound)
    );
}

#[test]
fn create_durable_is_idempotent_but_never_replaces() {
    let fs = MemFs::new();
    fs.mkdir_all(p("/page/ink"));
    let path = p("/page/ink/seg.onk");
    let first = fs.create_durable(path, b"segment").unwrap();
    let again = fs.create_durable(path, b"segment").unwrap();
    assert_eq!(first.stamp, again.stamp);
    assert_eq!(
        kind(fs.create_durable(path, b"other")),
        Some(FsErrorKind::AlreadyExists)
    );
    assert_eq!(fs.get(path).unwrap(), b"segment");
}

#[test]
fn lists_folders_in_name_order() {
    let fs = MemFs::new();
    fs.put(p("/nb/b.json"), b"12");
    fs.put(p("/nb/a.json"), b"1");
    fs.mkdir_all(p("/nb/c"));
    fs.put(p("/nb/c/deep.json"), b"x");
    let names: Vec<(String, bool, u64)> = fs
        .read_dir(p("/nb"))
        .unwrap()
        .into_iter()
        .map(|e| (e.name, e.is_dir, e.len))
        .collect();
    assert_eq!(
        names,
        [
            ("a.json".into(), false, 1),
            ("b.json".into(), false, 2),
            ("c".into(), true, 0)
        ]
    );
    assert_eq!(kind(fs.read_dir(p("/nb/a.json"))), Some(FsErrorKind::Io));
}

#[test]
fn a_power_cut_drops_what_was_not_flushed() {
    let fs = MemFs::new();
    fs.mkdir_all(p("/nb"));
    fs.replace_durable(p("/nb/page.json"), b"v1").unwrap();
    fs.write_derived(p("/nb/page.md"), b"readable").unwrap();
    let mut journal = fs.open_append(p("/nb/j.wal"), true).unwrap();
    journal.append(b"flushed").unwrap();
    journal.sync().unwrap();
    journal.append(b"+lost").unwrap();
    fs.remove_file(p("/nb/page.json")).unwrap();
    let boot = fs.boot_id().unwrap();

    let after = fs.crash(MemCrash::PowerCut);
    assert_eq!(
        after.get(p("/nb/page.json")).unwrap(),
        b"v1",
        "an unflushed deletion is undone"
    );
    assert!(!after.exists(p("/nb/page.md")));
    assert_eq!(after.get(p("/nb/j.wal")).unwrap(), b"flushed");
    assert_ne!(after.boot_id().unwrap(), boot);
    assert_eq!(kind(journal.append(b"late")), Some(FsErrorKind::Crashed));
    assert_eq!(kind(fs.read(p("/nb/page.json"), 10)), Some(FsErrorKind::Crashed));
}

#[test]
fn an_app_crash_keeps_everything() {
    let fs = MemFs::new();
    fs.mkdir_all(p("/nb"));
    fs.write_derived(p("/nb/page.md"), b"readable").unwrap();
    let mut journal = fs.open_append(p("/nb/j.wal"), true).unwrap();
    journal.append(b"not flushed").unwrap();
    let boot = fs.boot_id().unwrap();
    let after = fs.crash(MemCrash::App);
    assert_eq!(after.get(p("/nb/page.md")).unwrap(), b"readable");
    assert_eq!(after.get(p("/nb/j.wal")).unwrap(), b"not flushed");
    assert_eq!(after.boot_id().unwrap(), boot);
    assert!(
        after.open_append(p("/nb/j.wal"), false).is_ok(),
        "the crash released the lock"
    );
}

#[test]
fn appends_hold_a_lock() {
    let fs = MemFs::new();
    fs.mkdir_all(p("/j"));
    let mut first = fs.open_append(p("/j/a.wal"), true).unwrap();
    assert_eq!(kind(fs.open_append(p("/j/a.wal"), false)), Some(FsErrorKind::Busy));
    assert!(fs.try_lock(p("/j/a.wal")).unwrap().is_none());
    first.append(b"abc").unwrap();
    assert_eq!(first.len(), 3);
    drop(first);
    let second = fs.open_append(p("/j/a.wal"), false).unwrap();
    assert_eq!(second.len(), 3);
    assert_eq!(
        kind(fs.open_append(p("/j/b.wal"), false).map(|_| ())),
        Some(FsErrorKind::NotFound)
    );
    assert_eq!(
        kind(fs.open_append(p("/j/a.wal"), true).map(|_| ())),
        Some(FsErrorKind::Busy)
    );
}

#[test]
fn locks_are_exclusive_until_dropped() {
    let fs = MemFs::new();
    fs.mkdir_all(p("/locks"));
    let lock = fs.try_lock(p("/locks/nb.lock")).unwrap().unwrap();
    assert!(fs.try_lock(p("/locks/nb.lock")).unwrap().is_none());
    drop(lock);
    assert!(fs.try_lock(p("/locks/nb.lock")).unwrap().is_some());
}

#[test]
fn renames_folders_without_replacing() {
    let fs = MemFs::new();
    fs.put(p("/nb/s1/p1/page.json"), b"page");
    fs.mkdir_all(p("/nb/s2"));
    fs.rename_dir(p("/nb/s1/p1"), p("/nb/s2/p1")).unwrap();
    assert_eq!(fs.get(p("/nb/s2/p1/page.json")).unwrap(), b"page");
    assert!(!fs.exists(p("/nb/s1/p1")));
    fs.mkdir_all(p("/nb/s1/p2"));
    assert_eq!(
        kind(fs.rename_dir(p("/nb/s1/p2"), p("/nb/s2/p1"))),
        Some(FsErrorKind::AlreadyExists)
    );
    let after = fs.crash(MemCrash::PowerCut);
    assert!(after.exists(p("/nb/s2/p1/page.json")), "a folder rename is durable");
}

#[test]
fn read_only_and_placeholder_files_refuse() {
    let fs = MemFs::new();
    fs.put(p("/nb/page.json"), b"v1");
    fs.set_read_only(p("/nb/page.json"), true);
    assert_eq!(
        kind(fs.replace_durable(p("/nb/page.json"), b"v2")),
        Some(FsErrorKind::ReadOnlyFile)
    );
    assert!(fs.metadata(p("/nb/page.json")).unwrap().read_only);
    fs.clear_read_only(p("/nb/page.json")).unwrap();
    assert!(fs.replace_durable(p("/nb/page.json"), b"v2").is_ok());
    fs.set_placeholder(p("/nb/page.json"), true);
    assert_eq!(
        kind(fs.read(p("/nb/page.json"), 10)),
        Some(FsErrorKind::CloudPlaceholder)
    );
}

#[test]
fn removes_folder_trees_and_reports_identity() {
    let fs = MemFs::new();
    fs.put(p("/nb/.opennote/trash/~purge-x/page.json"), b"gone");
    let identity = fs.folder_identity(p("/nb")).unwrap();
    assert_eq!(identity, fs.folder_identity(p("/nb")).unwrap());
    assert_ne!(identity, fs.folder_identity(p("/nb/.opennote")).unwrap());
    fs.remove_dir_all(p("/nb/.opennote/trash/~purge-x")).unwrap();
    assert!(!fs.exists(p("/nb/.opennote/trash/~purge-x/page.json")));
    assert!(fs.exists(p("/nb/.opennote/trash")));
    assert_eq!(fs.files(), Vec::<PathBuf>::new());
}

#[test]
fn unconfirmed_volumes_report_it() {
    let fs = MemFs::new();
    fs.set_confirmed(false);
    fs.mkdir_all(p("/share"));
    assert_eq!(
        fs.replace_durable(p("/share/a"), b"x").unwrap().durability,
        Durability::Unconfirmed
    );
    assert!(key_of(p("/share/../escape")).is_err());
}
