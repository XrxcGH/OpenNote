//! Format version 2 through the real core: lowest-version stamping, the backup before the first upgrade
//! (spec 15.4 and 15.6), and the migration fixtures of every file kind (spec 15.3).

mod real_core;

use opennote_core::format::header::Stamp;
use opennote_core::format::history_json::{read_versions, write_versions};
use opennote_core::format::migrate::{upgrade, FileKind};
use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::format::trash_json::{read_trash_item, write_trash_item};
use opennote_core::format::tree_json::{read_notebook, read_section, write_notebook, write_section};
use opennote_core::id::{BlockId, Id};
use opennote_core::model::{Named, VersionReason};
use opennote_core::ops::resolve::{Edit, NewBlock};
use opennote_core::Limits;
use real_core::Real;
use serde_json::{json, Value};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/v2/");

fn add_text(real: &mut Real, n: u128, markdown: &str) {
    let block = NewBlock {
        id: BlockId(Id::from_parts(1_800_000_000_000, n)),
        type_name: "text".into(),
        frame: None,
        data: json!({"markdown": markdown}).as_object().cloned().unwrap(),
        fallback: None,
    };
    let edit = Edit::InsertBlock {
        block,
        after: None,
        before: None,
    };
    real.open().apply(real.request(vec![edit])).unwrap();
    real.open().save_now().unwrap();
}

fn on_disk(real: &Real) -> Value {
    let section = std::fs::read_dir(real.notebook.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.join("section.json").exists())
        .unwrap();
    let page = std::fs::read_dir(section)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.join("page.json").exists())
        .unwrap();
    serde_json::from_slice(&std::fs::read(page.join("page.json")).unwrap()).unwrap()
}

fn backup_sets(real: &Real) -> Vec<String> {
    let backups = real
        .dir
        .path()
        .join("data/backups")
        .join(real.notebook.id().to_string());
    let mut names: Vec<String> = match std::fs::read_dir(backups) {
        Ok(entries) => entries.map(|e| e.unwrap().file_name().into_string().unwrap()).collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    names
}

#[test]
fn a_page_saves_with_the_lowest_version_its_content_needs() {
    let mut real = Real::new();
    add_text(&mut real, 1, "Plain **text** with <u>a version 1 tag</u>.");
    let page = on_disk(&real);
    assert_eq!(
        (page["formatVersion"].clone(), page["minReaderVersion"].clone()),
        (json!(1), json!(1))
    );
    assert!(page.get("minWriterVersion").is_none());
    assert!(backup_sets(&real).is_empty(), "version 1 content needs no upgrade");

    add_text(&mut real, 2, "a <span data-font=\"Georgia\">word</span> b");
    let page = on_disk(&real);
    assert_eq!(
        (page["formatVersion"].clone(), page["minReaderVersion"].clone()),
        (json!(2), json!(1))
    );
    assert!(
        page.get("minWriterVersion").is_none(),
        "minWriterVersion equals formatVersion, so it is left out"
    );
}

#[test]
fn the_first_save_that_needs_version_2_backs_up_the_notebook_and_keeps_the_page_as_it_was() {
    let mut real = Real::new();
    add_text(&mut real, 1, "Plain text.");
    add_text(&mut real, 2, "See the note[^01m3sbcmt0000000000000n001].");
    assert_eq!(on_disk(&real)["formatVersion"], 2);
    let sets = backup_sets(&real);
    assert_eq!(sets.len(), 1, "{sets:?}");
    assert!(sets[0].ends_with("-v1-to-v2"), "{sets:?}");
    let set = real
        .dir
        .path()
        .join("data/backups")
        .join(real.notebook.id().to_string())
        .join(&sets[0]);
    let notebook: Value = serde_json::from_slice(&std::fs::read(set.join("notebook.json")).unwrap()).unwrap();
    assert_eq!(notebook["formatVersion"], 1);
    let reasons: Vec<_> = real.open().history().unwrap().into_iter().map(|v| v.reason).collect();
    assert!(
        reasons.contains(&Named::Known(VersionReason::BeforeUpgrade)),
        "{reasons:?}"
    );

    add_text(&mut real, 3, "More.");
    assert_eq!(backup_sets(&real).len(), 1, "only the first upgrade backs up");
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{FIXTURES}{name}")).unwrap()
}

fn round_trip(kind: FileKind, bytes: &[u8]) -> Vec<u8> {
    let limits = Limits::default();
    match kind {
        FileKind::Notebook => write_notebook(&read_notebook(bytes, &limits).unwrap()),
        FileKind::Section => write_section(&read_section(bytes, &limits).unwrap()),
        FileKind::Page => write_page(&read_page(bytes, &limits).unwrap().page),
        FileKind::TrashItem => write_trash_item(&read_trash_item(bytes, &limits).unwrap()),
        FileKind::Versions => write_versions(&read_versions(bytes, &limits).unwrap()),
    }
}

/// Spec 15.3: every migration has an input file for each older version and the expected output. Version 1 to 2
/// is the identity apart from `formatVersion` (`R-VER-6`), and a writer of version 2 then writes the file back
/// as version 1, byte for byte, because it uses nothing newer (`R-VER-1`, `R-VER-8`).
#[test]
fn migration_fixtures_of_every_file_kind_upgrade_and_save_as_the_spec_says() {
    let kinds = [
        ("notebook", FileKind::Notebook),
        ("section", FileKind::Section),
        ("page", FileKind::Page),
        ("item", FileKind::TrashItem),
        ("versions", FileKind::Versions),
    ];
    for (name, kind) in kinds {
        let input = fixture(&format!("{name}.v1.json"));
        let mut value: Value = serde_json::from_slice(&input).unwrap();
        let report = upgrade(kind, &mut value).unwrap();
        assert_eq!(report.applied, ["v1-to-v2"], "{name}");
        let expected: Value = serde_json::from_slice(&fixture(&format!("{name}.v2.json"))).unwrap();
        assert_eq!(value, expected, "{name}: the upgrade in memory");
        assert_eq!(round_trip(kind, &input), input, "{name}: saved as version 1");
    }
    let input = fixture("page-font-span.v1.json");
    let saved = fixture("page-font-span.saved.json");
    assert_eq!(
        String::from_utf8(round_trip(FileKind::Page, &input)).unwrap(),
        String::from_utf8(saved).unwrap()
    );
    assert_eq!(Stamp::new(2).min_writer, 2);
}
