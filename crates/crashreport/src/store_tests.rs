use super::*;
use crate::report::FORMAT;

fn report(time_unix: u64) -> Report {
    Report {
        format: FORMAT,
        kind: Kind::Panic,
        app_version: "1.0.0".into(),
        os: "Windows".into(),
        time_unix,
        message: Some("attempt to divide by zero".into()),
        location: Some("math.rs:1:2".into()),
        exception_code: None,
        frames: Vec::new(),
        backtrace: Vec::new(),
    }
}

fn store() -> (tempfile::TempDir, CrashStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = CrashStore::new(dir.path().join("crashes"));
    (dir, store)
}

#[test]
fn saves_lists_shows_and_deletes() {
    let (_guard, store) = store();
    assert!(store.list().is_empty(), "a folder that does not exist has no reports");
    let first = store.save(&report(100)).unwrap();
    let second = store.save(&report(200)).unwrap();
    let list = store.list();
    assert_eq!(
        list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        [second.as_str(), first.as_str()]
    );
    assert_eq!(
        (list[0].time_unix, list[0].kind, list[0].app_version.as_str()),
        (200, Kind::Panic, "1.0.0")
    );
    assert!(list[0].size_bytes > 50);
    assert_eq!(store.load(&first, &Scrubber::new()).unwrap(), report(100));
    store.delete(&first).unwrap();
    assert!(matches!(
        store.load(&first, &Scrubber::new()),
        Err(StoreError::Missing(_))
    ));
    assert!(matches!(store.delete(&first), Err(StoreError::Missing(_))));
    assert_eq!(store.list().len(), 1);
}

#[test]
fn never_overwrites_a_report() {
    let (_guard, store) = store();
    let ids: Vec<String> = (0..3).map(|_| store.save(&report(100)).unwrap()).collect();
    assert_eq!(ids, ["crash-100-0", "crash-100-1", "crash-100-2"]);
}

#[test]
fn ids_cannot_reach_other_files() {
    let (guard, store) = store();
    std::fs::write(guard.path().join("outside.json"), "{}").unwrap();
    store.save(&report(1)).unwrap();
    for id in [
        "",
        "../outside",
        "crash-1-0/../../outside",
        "crash-1",
        "crash-a-b",
        "crash--1",
        "crash-1-0.json",
        "crash-1-0 ",
    ] {
        assert!(
            matches!(store.load(id, &Scrubber::new()), Err(StoreError::BadId(_))),
            "{id:?}"
        );
        assert!(matches!(store.delete(id), Err(StoreError::BadId(_))), "{id:?}");
    }
    assert!(guard.path().join("outside.json").exists());
}

#[test]
fn keeps_only_the_newest_reports() {
    let (_guard, store) = store();
    for time in 1..=(MAX_REPORTS as u64 + 5) {
        store.save(&report(time)).unwrap();
    }
    let list = store.list();
    assert_eq!(list.len(), MAX_REPORTS);
    assert_eq!(list.first().unwrap().time_unix, MAX_REPORTS as u64 + 5);
    assert_eq!(list.last().unwrap().time_unix, 6);
}

#[test]
fn files_that_are_not_reports_are_ignored_and_kept() {
    let (_guard, store) = store();
    store.save(&report(1)).unwrap();
    std::fs::write(store.dir().join("notes.txt"), "hello").unwrap();
    std::fs::write(store.dir().join("crash-9-9.json"), "not json").unwrap();
    std::fs::write(store.dir().join("other.json"), "{}").unwrap();
    assert_eq!(store.list().len(), 1);
    assert_eq!(store.delete_all(), 1);
    assert!(store.dir().join("notes.txt").exists());
}

#[test]
fn a_damaged_report_says_so() {
    let (_guard, store) = store();
    std::fs::create_dir_all(store.dir()).unwrap();
    std::fs::write(store.dir().join("crash-9-9.json"), "not json").unwrap();
    assert!(matches!(
        store.load("crash-9-9", &Scrubber::new()),
        Err(StoreError::Damaged(_))
    ));
}

#[test]
fn a_loaded_report_is_scrubbed_again() {
    let (_guard, store) = store();
    let mut dirty = report(5);
    dirty.message = Some("could not save C:\\Users\\jdoe\\Holiday Plans\\page.json".into());
    let id = store.save(&dirty).unwrap();
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    let loaded = store.load(&id, &scrubber).unwrap();
    assert_eq!(loaded.message.as_deref(), Some("could not save <path>"));
}

#[test]
fn the_standard_folder_is_in_open_note() {
    if let Some(store) = CrashStore::standard() {
        assert!(store.dir().ends_with(Path::new("OpenNote").join("crashes")));
    }
}

fn only_files(store: &CrashStore) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(store.dir())
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[test]
fn saving_leaves_only_the_finished_report() {
    let (_guard, store) = store();
    let id = store.save(&report(100)).unwrap();
    assert_eq!(only_files(&store), [format!("{id}.json")]);
}

#[test]
fn a_leftover_temporary_file_never_blocks_or_counts_as_a_report() {
    let (_guard, store) = store();
    fs::create_dir_all(store.dir()).unwrap();
    fs::write(store.dir().join("crash-100-0.tmp"), "half a rep").unwrap();
    // The id is skipped while its temporary file stands, and the report is saved under the next one.
    let id = store.save(&report(100)).unwrap();
    assert_eq!(id, "crash-100-1");
    assert_eq!(store.list().len(), 1);
}

#[test]
fn sweeping_removes_leftovers_and_damaged_reports_and_nothing_else() {
    let (_guard, store) = store();
    let good = store.save(&report(100)).unwrap();
    fs::write(store.dir().join("crash-5-0.tmp"), "half a rep").unwrap();
    fs::write(store.dir().join("crash-6-0.json"), "{ not json").unwrap();
    fs::write(store.dir().join("notes.txt"), "mine").unwrap();
    fs::write(store.dir().join("other.json"), "{}").unwrap();
    fs::write(store.dir().join("other.tmp"), "x").unwrap();
    assert_eq!(store.sweep(), 2);
    assert_eq!(
        only_files(&store),
        [
            format!("{good}.json"),
            "notes.txt".to_owned(),
            "other.json".to_owned(),
            "other.tmp".to_owned()
        ]
    );
    assert_eq!(store.sweep(), 0);
    assert_eq!(CrashStore::new(store.dir().join("missing")).sweep(), 0);
}

#[test]
fn replacing_a_report_swaps_it_whole_or_not_at_all() {
    let (_guard, store) = store();
    let id = store.save(&report(100)).unwrap();
    let mut changed = report(100);
    changed.message = Some("a new message".into());
    store.replace(&id, &changed).unwrap();
    assert_eq!(store.load(&id, &Scrubber::new()).unwrap(), changed);
    assert_eq!(only_files(&store), [format!("{id}.json")]);
    assert!(matches!(
        store.replace("crash-9-9", &changed),
        Err(StoreError::Missing(_))
    ));
    assert!(matches!(store.replace("../x", &changed), Err(StoreError::BadId(_))));
    assert_eq!(only_files(&store), [format!("{id}.json")]);
}

#[test]
fn symbols_go_in_a_folder_next_to_the_reports() {
    let (_guard, store) = store();
    assert_eq!(store.symbols_dir(), store.dir().parent().unwrap().join("symbols"));
}

#[test]
fn saved_reports_get_function_names_when_symbols_arrive() {
    use crate::report::Frame;
    use crate::symbols::{SymbolSet, SymbolTable};

    const ID: &str = "3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71A";
    let (_guard, store) = store();
    let with_frames = |time, id: &str| Report {
        kind: Kind::Exception,
        frames: vec![Frame {
            debug_id: Some(id.to_owned()),
            ..Frame::new("opennote.exe", "0x1010")
        }],
        ..report(time)
    };
    let known = store.save(&with_frames(100, ID)).unwrap();
    let other_build = store.save(&with_frames(200, "ABCD")).unwrap();
    let mut set = SymbolSet::new();
    set.add(
        SymbolTable::parse(&format!(
            "MODULE windows x86_64 {ID} opennote.pdb\nFUNC 1000 100 0 opennote::save\n"
        ))
        .unwrap(),
    );

    let counts = store.symbolicate_all(&set, &Scrubber::new());
    assert_eq!((counts.resolved, counts.unresolved), (1, 1));
    let named = store.load(&known, &Scrubber::new()).unwrap();
    assert_eq!(named.frames[0].function.as_deref(), Some("opennote::save"));
    assert_eq!(
        store.load(&other_build, &Scrubber::new()).unwrap().frames[0].function,
        None
    );
    // Running it again finds nothing more to do, and writes nothing.
    let again = store.symbolicate_all(&set, &Scrubber::new());
    assert_eq!(again.resolved, 0);
}
