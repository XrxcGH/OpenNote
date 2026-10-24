use super::*;
use crate::report::{Kind, FORMAT};

const ID: &str = "3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71A";

const SYMBOLS: &str = "MODULE windows x86_64 3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71A opennote.pdb
INFO CODE_ID 5F3E1A2B1C4000 opennote.exe
FILE 0 C:\\Users\\jdoe\\GitHub\\OpenNote\\crates\\core\\src\\store.rs
FUNC 1a2b00 120 0 opennote_core::store::Store::save_page
1a2b00 10 120 0
FUNC m 2000 40 0 opennote::run::{{closure}}
PUBLIC 3000 0 opennote::main
PUBLIC m 3100 0 opennote::other
STACK CFI INIT 1a2b00 120 .cfa: $rsp 8 + .ra: .cfa 8 - ^
FUNC zz 1 0 broken
FUNC 5000 notanumber 0 broken
";

fn table() -> SymbolTable {
    SymbolTable::parse(SYMBOLS).unwrap()
}

fn frame(module: &str, offset: &str, id: Option<&str>) -> Frame {
    Frame {
        debug_id: id.map(str::to_owned),
        ..Frame::new(module, offset)
    }
}

fn report(frames: Vec<Frame>) -> Report {
    Report {
        format: FORMAT,
        kind: Kind::Exception,
        app_version: "1.0.0".into(),
        os: "Windows 10.0.26200 x86_64".into(),
        time_unix: 1,
        message: None,
        location: None,
        exception_code: Some("0xc0000005".into()),
        frames,
        backtrace: Vec::new(),
    }
}

#[test]
fn reads_a_breakpad_table_and_skips_what_it_does_not_know() {
    let table = table();
    assert_eq!(table.debug_id(), ID);
    assert_eq!(table.module(), "opennote.pdb");
    // Two FUNC lines and two PUBLIC lines. The line records, FILE, INFO, STACK, and damaged lines are ignored.
    assert_eq!(table.len(), 4);
    assert!(!table.is_empty());
}

#[test]
fn finds_the_function_that_holds_an_offset() {
    let table = table();
    let found = table.lookup(0x1a2b3c).unwrap();
    assert_eq!(
        (found.name, found.into),
        ("opennote_core::store::Store::save_page", 0x3c)
    );
    assert_eq!(table.lookup(0x1a2b00).unwrap().into, 0);
    assert_eq!(table.lookup(0x1a2b00 + 0x11f).unwrap().into, 0x11f);
    // Past the end of a sized function there is nothing, not the function before.
    assert_eq!(table.lookup(0x1a2b00 + 0x120), None);
    assert_eq!(table.lookup(0x2000).unwrap().name, "opennote::run::{{closure}}");
    // A public symbol runs until the next symbol, up to a limit.
    assert_eq!(table.lookup(0x30ff).unwrap().name, "opennote::main");
    assert_eq!(table.lookup(0x3100).unwrap().name, "opennote::other");
    assert_eq!(table.lookup(0x3100 + PUBLIC_REACH), None);
    // Before the first function.
    assert_eq!(table.lookup(0x10), None);
    assert_eq!(table.lookup(u64::MAX), None);
}

#[test]
fn a_function_with_a_size_wins_over_a_public_symbol_at_its_address() {
    let text = "MODULE windows x86_64 AB app.pdb\nPUBLIC 100 0 mangled\nFUNC 100 20 0 nice::name\n";
    let table = SymbolTable::parse(text).unwrap();
    assert_eq!(table.len(), 1);
    assert_eq!(table.lookup(0x104).unwrap().name, "nice::name");
}

#[test]
fn refuses_text_that_is_not_a_symbol_file() {
    for text in [
        "",
        "hello\n",
        "MODULE windows x86_64\n",
        "MODULE windows x86_64 not-an-id app.pdb\n",
        "FUNC 1 2 0 a\n",
        r"MODULE windows x86_64 C:\Users\jdoe app.pdb",
    ] {
        assert!(
            matches!(SymbolTable::parse(text), Err(SymbolError::NotSymbols)),
            "{text:?}"
        );
    }
    // An id in lowercase is accepted and normalized.
    let lower = SymbolTable::parse("MODULE windows x86_64 abc123 app.pdb\n").unwrap();
    assert_eq!(lower.debug_id(), "ABC123");
}

#[test]
fn a_frame_is_resolved_by_the_debug_id_of_its_build() {
    let mut set = SymbolSet::new();
    set.add(table());
    let frame = frame("opennote.exe", "0x1a2b3c", Some(ID));
    assert_eq!(
        set.resolve(&frame).unwrap().name,
        "opennote_core::store::Store::save_page"
    );
    // The id is matched in any letter case.
    assert!(set
        .resolve(&self::frame("opennote.exe", "0x1a2b3c", Some(&ID.to_lowercase())))
        .is_some());
    // Another build's symbols are never applied, and neither are symbols to a frame of unknown build.
    assert_eq!(
        set.resolve(&self::frame("opennote.exe", "0x1a2b3c", Some("ABCDEF01"))),
        None
    );
    assert_eq!(set.resolve(&self::frame("opennote.exe", "0x1a2b3c", None)), None);
    assert_eq!(set.resolve(&self::frame("opennote.exe", "1a2b3c", Some(ID))), None);
}

#[test]
fn symbolicating_a_report_names_the_frames_it_can_and_leaves_the_rest() {
    let mut set = SymbolSet::new();
    set.add(table());
    let original = report(vec![
        frame("opennote.exe", "0x1a2b3c", Some(ID)),
        frame("ntdll.dll", "0x9f", Some("1122334455667788")),
        frame("opennote.exe", "0x10", Some(ID)),
        Frame {
            function: Some("kept::name".into()),
            ..frame("opennote.exe", "0x2000", Some(ID))
        },
    ]);
    let (done, counts) = original.symbolicated(&set, &Scrubber::new());
    assert_eq!(
        counts,
        Symbolicated {
            resolved: 1,
            unresolved: 2
        }
    );
    let names: Vec<_> = done.frames.iter().map(|f| f.function.as_deref()).collect();
    assert_eq!(
        names,
        [
            Some("opennote_core::store::Store::save_page"),
            None,
            None,
            Some("kept::name")
        ]
    );
    // The original is untouched, and a second pass changes nothing.
    assert!(original
        .frames
        .iter()
        .all(|f| f.function.as_deref() != Some("opennote_core::store::Store::save_page")));
    assert_eq!(done.symbolicated(&set, &Scrubber::new()).0, done);
}

#[test]
fn function_names_from_a_symbol_file_are_scrubbed_like_all_other_text() {
    let text = "MODULE windows x86_64 AB app.pdb\nFUNC 100 20 0 C:\\Users\\jdoe\\secret path::fn\n";
    let mut set = SymbolSet::new();
    set.add(SymbolTable::parse(text).unwrap());
    let (done, _) = report(vec![frame("app.exe", "0x104", Some("AB"))]).symbolicated(&set, &Scrubber::new());
    assert_eq!(done.frames[0].function.as_deref(), Some("<symbol>"));
}

#[test]
fn loads_every_sym_file_of_a_folder_and_reports_the_ones_it_skips() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("opennote.sym"), SYMBOLS).unwrap();
    std::fs::write(dir.path().join("broken.sym"), "nothing useful").unwrap();
    std::fs::write(dir.path().join("notes.txt"), SYMBOLS).unwrap();
    let (set, skipped) = SymbolSet::load_dir(dir.path());
    assert_eq!(set.len(), 1);
    assert!(set.table(ID).is_some() && set.table(&ID.to_lowercase()).is_some());
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0].file, "broken.sym");
    assert!(matches!(skipped[0].error, SymbolError::NotSymbols));
    // A folder that does not exist is an empty set.
    let (none, skipped) = SymbolSet::load_dir(&dir.path().join("missing"));
    assert!(none.is_empty() && skipped.is_empty());
    assert!(matches!(
        SymbolTable::load(&dir.path().join("missing.sym")),
        Err(SymbolError::Io(_))
    ));
}

#[test]
fn a_report_with_function_names_round_trips_and_stays_clean() {
    let mut set = SymbolSet::new();
    set.add(table());
    let (done, _) = report(vec![frame("opennote.exe", "0x1a2b3c", Some(ID))]).symbolicated(&set, &Scrubber::new());
    let json = done.to_json();
    assert!(
        json.contains("\"function\": \"opennote_core::store::Store::save_page\""),
        "{json}"
    );
    assert!(json.contains(&format!("\"debug_id\": \"{ID}\"")), "{json}");
    assert_eq!(Report::from_json(&json).unwrap(), done);
    // Loading checks the new fields too: a bad id is dropped, a path in a name becomes a placeholder.
    let mut tampered = done.clone();
    tampered.frames[0].debug_id = Some(r"C:\Users\jdoe".into());
    tampered.frames[0].function = Some(r"C:\Users\jdoe\notes".into());
    let loaded = tampered.scrubbed(&Scrubber::new());
    assert_eq!(loaded.frames[0].debug_id, None);
    assert_eq!(loaded.frames[0].function.as_deref(), Some("<symbol>"));
}

#[test]
fn reports_written_before_debug_ids_still_load() {
    let json = r#"{"format":1,"kind":"exception","app_version":"0.1.0","os":"Windows","time_unix":5,
                   "message":null,"location":null,"exception_code":"0xc0000005",
                   "frames":[{"module":"opennote.exe","offset":"0x42"}],"backtrace":[]}"#;
    let report = Report::from_json(json).unwrap();
    assert_eq!(report.frames, [Frame::new("opennote.exe", "0x42")]);
    assert!(!report.to_json().contains("debug_id"));
}
