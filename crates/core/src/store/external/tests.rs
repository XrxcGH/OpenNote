#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use super::*;
use crate::id::Id;
use crate::store::fs::VolumeKind;
use crate::store::page_store::tests::Harness;
use crate::store::page_store::ReadableOutcome;
use crate::testing::sample::{sample_device, sample_page};
use crate::testing::{MemFs, NoLinks};

fn revision(n: u64, lineage: &[u64]) -> Revision {
    let id = |n: u64| RevisionId(Id::from_parts(1_790_000_000_000 + n, 1));
    let mut revision = Revision::new(id(n), Timestamp::EPOCH, sample_device(), "test");
    revision.parents = lineage.first().map(|&p| vec![id(p)]).unwrap_or_default();
    revision.ancestors = lineage.iter().map(|&p| id(p)).collect();
    revision
}

#[test]
fn changes_on_disk_are_ours_older_newer_or_a_conflict() {
    let own = revision(3, &[2, 1]);
    let base = revision(2, &[1]).id;
    assert_eq!(classify_change(&own, base, &own, true), ExternalDecision::Unchanged);
    assert_eq!(
        classify_change(&revision(1, &[]), base, &own, true),
        ExternalDecision::OlderOfOurs
    );
    assert_eq!(
        classify_change(&revision(2, &[1]), base, &own, false),
        ExternalDecision::OlderOfOurs
    );
    let theirs = revision(9, &[2, 1]);
    assert_eq!(
        classify_change(&theirs, base, &own, false),
        ExternalDecision::FastForward
    );
    assert_eq!(classify_change(&theirs, base, &own, true), ExternalDecision::Conflict);
}

#[test]
fn paths_map_to_the_parts_of_a_notebook() {
    let root = Path::new("/notes/Biology");
    let section = "01m3s9v8ym7yt5c8yb61tthbwt";
    let page = "01m3sa12426sg32pmtyffjaqcf";
    let at = |rest: &str| classify_path(root, &root.join(rest));
    assert_eq!(at("notebook.json"), Some(NotebookChange::Notebook));
    assert_eq!(
        at(&format!("{section}/section.json")),
        Some(NotebookChange::Section(section.parse().unwrap()))
    );
    assert_eq!(
        at(&format!("{section}/section (conflicted copy).json")),
        Some(NotebookChange::Section(section.parse().unwrap()))
    );
    let file = |rest: &str| match at(&format!("{section}/{page}/{rest}")) {
        Some(NotebookChange::Page { file, .. }) => Some(file),
        _ => None,
    };
    assert_eq!(file("page.json"), Some(PageFile::PageJson));
    assert_eq!(file("page-LAPTOP.json"), Some(PageFile::ConflictCopy));
    assert_eq!(file("page.md"), Some(PageFile::ReadableCopy));
    assert_eq!(file("ink/01m3sa81n2n6c32zjexe5yq0r5.onk"), Some(PageFile::Other));
    assert_eq!(file("~page.json.0badf00d.tmp"), None, "temporary files are ignored");
    assert_eq!(at(".opennote/trash/x/item.json"), Some(NotebookChange::Internal));
    assert_eq!(at("Holiday photos/beach.png"), None);
    assert_eq!(classify_path(root, Path::new("/elsewhere/page.json")), None);
}

#[test]
fn edited_readable_copies_are_listed_for_the_interface() {
    let h = Harness::new();
    let page = sample_page();
    assert!(edited_copies(&h.fs, &h.dir).unwrap().is_empty());
    h.fs.put(&h.dir.join("page.md"), b"# My own edits\n");
    let kept = h.store.write_page_md(&h.dir, &page, &NoLinks).unwrap();
    assert!(matches!(kept, ReadableOutcome::EditedCopyKept(_)));
    h.fs.put(&h.dir.join("page.md"), b"# More edits\n");
    h.store.write_page_md(&h.dir, &page, &NoLinks).unwrap();
    let copies = edited_copies(&h.fs, &h.dir).unwrap();
    assert_eq!(copies.len(), 2);
    assert_eq!(copies[0].file, "page.md");
    assert_eq!(copies[0].kept_at, Timestamp::parse("2026-09-30T14:00:00Z").ok());
    assert!(copies.iter().any(|c| c.path.to_string_lossy().contains("-2.edited")));
}

#[test]
fn cloud_only_files_are_found_before_a_page_opens() {
    let fs = MemFs::new();
    let dir = PathBuf::from("/notes/page");
    let page = sample_page();
    fs.put(&NotebookLayout::page_json(&dir), b"page");
    assert!(cloud_only_files(&fs, &dir, &page).is_empty());
    fs.set_placeholder(&NotebookLayout::page_json(&dir), true);
    assert_eq!(cloud_only_files(&fs, &dir, &page), [NotebookLayout::page_json(&dir)]);
}

#[test]
fn sync_tool_folders_get_a_notice() {
    let mut volume = VolumeInfo {
        kind: VolumeKind::Ntfs,
        remote: false,
        sync_root: None,
        serial: 1,
    };
    assert_eq!(sync_notice(&volume), None);
    volume.sync_root = Some(SyncTool::OneDrive);
    let notice = sync_notice(&volume).unwrap();
    assert_eq!((notice.name, notice.files_on_demand), ("OneDrive", true));
    volume.sync_root = Some(SyncTool::Other);
    assert!(!sync_notice(&volume).unwrap().files_on_demand);
}
