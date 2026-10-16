//! Protected sections through a real core on a real disk (ADR 0042). Protecting seals the section. A locked
//! section shows no pages and opens none. An unlocked one edits as usual. No plain text of it reaches the disk, the
//! cache, the journals, or the search index.

mod real_core;

use std::path::Path;
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::id::{BlockId, ClientId, Id, PageId};
use opennote_core::model::ReadOnlyReason;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
use opennote_core::session::core::{Core, CoreConfig, MemoryCaps};
use opennote_core::session::events::CoreEvent;
use opennote_core::session::notebook::{NodePlacement, ParentRef};
use opennote_core::session::notes::{children_of, Protection};
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::DataLayout;
use opennote_core::store::sealed::{ProtectError, SealedFs, Secret};
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::fakes::{CollectingIndex, CollectingSink};
use opennote_core::testing::sample::test_clock;
use opennote_core::{CoreError, Limits, Timings};
use serde_json::json;

const SECRET: &str = "Launch codes 7741";
const LATER: &str = "Second secret 9093";

fn text(n: u128, markdown: &str) -> Edit {
    Edit::InsertBlock {
        block: NewBlock {
            id: BlockId(Id::from_parts(1_800_000_000_000, n)),
            type_name: "text".into(),
            frame: None,
            data: json!({ "markdown": markdown }).as_object().cloned().unwrap(),
            fallback: None,
        },
        after: None,
        before: None,
    }
}

fn request(page: PageId, seq: u64, edits: Vec<Edit>) -> TxnRequest {
    TxnRequest {
        page,
        client: ClientId::parse("main-1").unwrap(),
        client_seq: seq,
        coalesce: None,
        ui: None,
        edits,
    }
}

/// Every file under `root` that holds `needle`.
fn holding(root: &Path, needle: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(bytes) = std::fs::read(&path) {
                if bytes.windows(needle.len()).any(|w| w == needle.as_bytes()) {
                    found.push(path.display().to_string());
                }
            }
        }
    }
    found
}

/// A core on a sealing file system over a temporary folder, with a notebook of two sections and one page.
struct Fixture {
    dir: tempfile::TempDir,
    core: Core,
    index: Arc<CollectingIndex>,
    root: std::path::PathBuf,
    section: opennote_core::id::SectionId,
    plain: opennote_core::id::SectionId,
    page: PageId,
    client: ClientId,
    events: CollectingSink,
}

fn start() -> (tempfile::TempDir, Core, Arc<CollectingIndex>, CollectingSink) {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let timings = Timings::for_crash_tests();
    let fs: Arc<dyn Fs> = Arc::new(SealedFs::new(
        Arc::new(StdFs::new(&timings)),
        DataLayout::new(&data).journal_root(),
    ));
    let index = Arc::new(CollectingIndex::default());
    let config = CoreConfig {
        data_dir: data,
        device: real_core::device(),
        app_version: "opennote-test".into(),
        fs,
        codec: Arc::new(CanonicalCodec),
        applier: Arc::new(OpsApplier),
        clock: Arc::new(test_clock()),
        limits: Limits::default(),
        timings,
        caps: MemoryCaps::default(),
    };
    let events = CollectingSink::default();
    let core = Core::start(config, Arc::new(events.clone()), Some(index.clone())).unwrap();
    (dir, core, index, events)
}

/// A notebook "Personal" with a section "Diary" holding a page with the secret, and a section "Shopping".
fn fixture() -> Fixture {
    let (dir, core, index, events) = start();
    let notes = dir.path().join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    let notebook = core.create_notebook(&notes, "Personal").unwrap();
    let root = notebook.path().to_path_buf();
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    let section = notebook.create_section("Diary", top).unwrap();
    let plain = notebook.create_section("Shopping", top).unwrap();
    let page = notebook
        .create_page_titled(section, inside(section), "Plans 3381")
        .unwrap();
    let client = ClientId::parse("main-1").unwrap();
    let handle = notebook.open_page(page, client.clone()).unwrap();
    handle.apply(request(page, 1, vec![text(1, SECRET)])).unwrap();
    handle.save_now().unwrap();
    handle.close(&client).unwrap();
    Fixture {
        dir,
        core,
        index,
        root,
        section,
        plain,
        page,
        client,
        events,
    }
}

fn inside(section: opennote_core::id::SectionId) -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    }
}

/// Unlocked, the section edits as usual, while nothing of it is in plain text and pages can't leave it.
fn edit_while_unlocked(f: &Fixture) {
    let notebook = f.core.find_open(&f.root).unwrap();
    let hints_before = f.index.hints().len();
    let handle = notebook.open_page(f.page, f.client.clone()).unwrap();
    handle.apply(request(f.page, 1, vec![text(2, LATER)])).unwrap();
    f.core.flush_journals(std::time::Duration::from_secs(5)).unwrap();
    let degraded: Vec<CoreEvent> = f
        .events
        .events()
        .into_iter()
        .filter(|e| matches!(e, CoreEvent::JournalDegraded { .. }))
        .collect();
    assert!(
        degraded.is_empty(),
        "the in-memory journal takes the edit: {degraded:?}"
    );
    handle.save_now().unwrap();
    for needle in [SECRET, LATER, "Plans 3381"] {
        assert_eq!(
            holding(f.dir.path(), needle),
            Vec::<String>::new(),
            "{needle} is in plain text"
        );
    }
    assert_eq!(
        f.index.hints().len(),
        hints_before,
        "the search index hears nothing of it"
    );
    assert!(handle.page_md_path().is_none(), "no page.md to open in another editor");
    let moved = notebook.move_pages(&[f.page], f.plain, 0, 0);
    assert!(
        matches!(moved, Err(CoreError::ReadOnly(ReadOnlyReason::Encrypted))),
        "{moved:?}"
    );
    let trashed = notebook.delete(&[opennote_core::session::notebook::NodeRef::Page(f.page)]);
    assert!(trashed.is_err());
    handle.close(&f.client).unwrap();
}

/// Locked, the section shows its title and no pages, and opens nothing.
fn check_locked(f: &Fixture) {
    let notebook = f.core.find_open(&f.root).unwrap();
    let tree = notebook.tree();
    let shown = children_of(&tree, notebook.id().0).unwrap();
    let diary = shown.iter().find(|n| n.id == f.section.to_string()).unwrap();
    assert_eq!(diary.protection, Protection::Locked);
    assert_eq!(diary.title, "Diary", "the title stays readable");
    assert_eq!(children_of(&tree, f.section.0).unwrap().len(), 0);
    assert!(matches!(
        notebook.open_page(f.page, f.client.clone()),
        Err(CoreError::ReadOnly(ReadOnlyReason::Encrypted)) | Err(CoreError::NotFound(_))
    ));
}

#[test]
fn a_protected_section_keeps_no_plain_text_anywhere_and_opens_only_with_its_password() {
    let f = fixture();
    f.core.protect_section(&f.root, f.section, "correct horse").unwrap();
    assert_eq!(
        f.core.section_protection(&f.root, f.section).unwrap(),
        Protection::Unlocked
    );
    edit_while_unlocked(&f);
    assert!(f.core.lock_section(&f.root, f.section).unwrap());
    check_locked(&f);
    let wrong = f
        .core
        .unlock_section(&f.root, f.section, Secret::Password("battery staple"));
    assert!(matches!(wrong, Err(ProtectError::Wrong)));
    f.core
        .unlock_section(&f.root, f.section, Secret::Password("correct horse"))
        .unwrap();
    let notebook = f.core.find_open(&f.root).unwrap();
    let handle = notebook.open_page(f.page, f.client.clone()).unwrap();
    let json = real_core::page_json(&handle).to_string();
    assert!(json.contains(SECRET) && json.contains(LATER), "{json}");
    handle.close(&f.client).unwrap();

    // Delete forever works inside it, and removing protection brings plain files back.
    let second = notebook.create_page(f.section, inside(f.section)).unwrap();
    assert_eq!(notebook.delete_sealed_pages(&[second]).unwrap(), vec![second]);
    drop(notebook);
    f.core.unprotect_section(&f.root, f.section).unwrap();
    assert_eq!(f.core.section_protection(&f.root, f.section).unwrap(), Protection::None);
    assert!(!holding(&f.root, SECRET).is_empty(), "plain again");
}
