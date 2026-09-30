#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use super::*;
use crate::id::{AssetId, SectionId};
use crate::model::Asset;

fn section() -> SectionId {
    SectionId::parse("01m3s9v8ym7yt5c8yb61tthbwt").unwrap()
}

fn page() -> PageId {
    PageId::parse("01m3sa12426sg32pmtyffjaqcf").unwrap()
}

#[test]
fn builds_notebook_paths_from_ids() {
    let layout = NotebookLayout::new("Biology");
    let page_dir = layout.page_dir(section(), page());
    assert_eq!(
        page_dir,
        Path::new("Biology/01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf")
    );
    assert_eq!(
        layout.section_json(section()),
        Path::new("Biology/01m3s9v8ym7yt5c8yb61tthbwt/section.json")
    );
    let segment = SegmentId::parse("01m3sa81n2n6c32zjexe5yq0r5").unwrap();
    assert_eq!(
        NotebookLayout::segment_path(&page_dir, segment),
        page_dir.join("ink/01m3sa81n2n6c32zjexe5yq0r5.onk")
    );
    let rev = RevisionId::parse("01m3sa6634zkpfshkpzzrzbmav").unwrap();
    assert_eq!(
        NotebookLayout::version_path(&page_dir, rev),
        page_dir.join(".history/01m3sa6634zkpfshkpzzrzbmav.json.gz")
    );
    let item = TrashItemId::parse("01m3sd8rc0w1pt611mq42a0rx1").unwrap();
    assert_eq!(
        layout.trash_item_dir(item),
        Path::new("Biology/.opennote/trash/01m3sd8rc0w1pt611mq42a0rx1")
    );
    assert_eq!(
        layout.purge_dir(item),
        Path::new("Biology/.opennote/trash/~purge-01m3sd8rc0w1pt611mq42a0rx1")
    );
}

#[test]
fn asset_paths_check_the_name() {
    let id = AssetId::parse("01m3sa43z1tp9rdr5e8df2jbxy").unwrap();
    let mut asset = Asset {
        id,
        file: "01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png".to_owned(),
        mime: "image/png".to_owned(),
        bytes: 482_113,
        sha256: [0; 32],
        name: "Leaf section.png".to_owned(),
        width: None,
        height: None,
        created: Timestamp::EPOCH,
        extra: Default::default(),
    };
    let dir = Path::new("page");
    assert_eq!(
        NotebookLayout::asset_path(dir, &asset).unwrap(),
        dir.join("assets/01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png")
    );
    asset.file = "../../escape.png".to_owned();
    assert!(NotebookLayout::asset_path(dir, &asset).is_err());
}

#[test]
fn builds_device_paths() {
    let data = DataLayout::new("data");
    let key = NotebookKey("01m3s9q9xbpmxwz4cz4ht6twg9-1a2b3c4d".to_owned());
    assert_eq!(
        data.journal_file(&key, Some(page()), 3),
        Path::new("data/journal/01m3s9q9xbpmxwz4cz4ht6twg9-1a2b3c4d/01m3sa12426sg32pmtyffjaqcf-0000000000000003.wal")
    );
    assert_eq!(
        data.lock_file(&key),
        Path::new("data/locks/01m3s9q9xbpmxwz4cz4ht6twg9-1a2b3c4d.lock")
    );
    let notebook = NotebookId::parse("01m3s9q9xbpmxwz4cz4ht6twg9").unwrap();
    let at = Timestamp::parse("2026-09-30T14:07:40.520Z").unwrap();
    assert_eq!(
        data.backup_set(notebook, at, 1, 2),
        Path::new("data/backups/01m3s9q9xbpmxwz4cz4ht6twg9/20260930T140740Z-v1-to-v2")
    );
}

#[test]
fn parses_journal_file_names() {
    assert_eq!(
        parse_journal_file_name(&journal_file_name(Some(page()), 42)),
        Some((Some(page()), 42))
    );
    assert_eq!(parse_journal_file_name("tree-00000000000000ff.wal"), Some((None, 255)));
    for bad in [
        "tree-ff.wal",
        "tree-00000000000000FF.wal",
        "page-0000000000000001.wal",
        "tree-0000000000000001.log",
    ] {
        assert_eq!(parse_journal_file_name(bad), None, "{bad}");
    }
}

#[test]
fn notebook_keys_depend_on_the_folder_identity() {
    let id = NotebookId::parse("01m3s9q9xbpmxwz4cz4ht6twg9").unwrap();
    let a = notebook_key(id, &FolderIdentity([1; 24]));
    let b = notebook_key(id, &FolderIdentity([2; 24]));
    assert_ne!(a, b);
    assert!(a.0.starts_with("01m3s9q9xbpmxwz4cz4ht6twg9-"));
    assert_eq!(a.0.len(), 26 + 1 + 8);
    assert_eq!(a, notebook_key(id, &FolderIdentity([1; 24])));
    // The first 8 hex digits of SHA-256 over 24 zero bytes.
    assert_eq!(
        notebook_key(id, &FolderIdentity([0; 24])).0,
        "01m3s9q9xbpmxwz4cz4ht6twg9-9d908ecf"
    );
}

#[test]
fn temp_names_round_trip() {
    let name = temp_name("page.json");
    assert!(name.starts_with("~page.json.") && name.ends_with(".tmp") && name.len() == "~page.json..tmp".len() + 8);
    assert_eq!(parse_temp_name(&name), Some("page.json"));
    assert_ne!(temp_name("page.json"), temp_name("page.json"));
    for bad in [
        "page.json",
        "~page.json.tmp",
        "~page.json.0A1B2C3D.tmp",
        "~.0a1b2c3d.tmp",
        "~page.json.0a1b2c3.tmp",
    ] {
        assert_eq!(parse_temp_name(bad), None, "{bad}");
    }
}

#[test]
fn partial_folders_round_trip() {
    let id = page().id();
    let item = TrashItemId::parse("01m3sd8rc0w1pt611mq42a0rx1").unwrap();
    for folder in [
        PartialFolder::Copying(id),
        PartialFolder::Moving(id),
        PartialFolder::Purge(item),
    ] {
        assert_eq!(PartialFolder::parse(&folder.name()), Some(folder));
    }
    assert_eq!(PartialFolder::Moving(id).name(), "~01m3sa12426sg32pmtyffjaqcf.moving");
    assert_eq!(PartialFolder::parse("~01m3sa12426sg32pmtyffjaqcf.deleting"), None);
    assert_eq!(PartialFolder::parse("01m3sa12426sg32pmtyffjaqcf.moving"), None);
}

#[test]
fn file_times_are_compact() {
    let at = Timestamp::parse("2026-09-30T14:07:40.520Z").unwrap();
    assert_eq!(file_time(at), "20260930T140740Z");
}
