//! Protected sections through a real core on a real disk (ADR 0042): protecting seals the section, a locked
//! section shows no pages and opens none, an unlocked one edits as usual, and no plain text of it reaches the disk,
//! the cache, the journals, or the search index.

mod real_core;

use std::path::Path;
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::id::{BlockId, ClientId, Id, PageId};
use opennote_core::model::ReadOnlyReason;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
use opennote_core::session::core::{Core, CoreConfig, MemoryCaps};
use opennote_core::session::notebook::{NodePlacement, ParentRef};
use opennote_core::session::notes::{children_of, Protection};
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::DataLayout;
use opennote_core::store::sealed::{ProtectError, SealedFs, Secret};
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::fakes::{CollectingIndex, NullSink};
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

#[test]
fn a_protected_section_keeps_no_plain_text_anywhere_and_opens_only_with_its_password() {
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
    let core = Core::start(config, Arc::new(NullSink), Some(index.clone())).unwrap();
    let notes = dir.path().join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    let notebook = core.create_notebook(&notes, "Personal").unwrap();
    let root = notebook.path().to_path_buf();
    let top = |before| NodePlacement {
        parent: ParentRef::Notebook,
        before,
    };
    let section = notebook.create_section("Diary", top(None)).unwrap();
    let plain = notebook.create_section("Shopping", top(None)).unwrap();
    let in_section = NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    };
    let page = notebook.create_page_titled(section, in_section, "Plans 3381").unwrap();
    let client = ClientId::parse("main-1").unwrap();
    let handle = notebook.open_page(page, client.clone()).unwrap();
    handle.apply(request(page, 1, vec![text(1, SECRET)])).unwrap();
    handle.save_now().unwrap();
    handle.close(&client).unwrap();
    drop(notebook);

    core.protect_section(&root, section, "correct horse").unwrap();
    let notebook = core.find_open(&root).unwrap();
    assert_eq!(core.section_protection(&root, section).unwrap(), Protection::Unlocked);
    let hints_before = index.hints().len();

    // Unlocked, it edits as usual; nothing of it is in plain text on disk.
    let handle = notebook.open_page(page, client.clone()).unwrap();
    handle.apply(request(page, 1, vec![text(2, LATER)])).unwrap();
    handle.save_now().unwrap();
    for needle in [SECRET, LATER, "Plans 3381"] {
        assert_eq!(holding(dir.path(), needle), Vec::<String>::new(), "{needle} is in plain text");
    }
    assert_eq!(index.hints().len(), hints_before, "the search index hears nothing of it");
    assert!(handle.page_md_path().is_none(), "no page.md to open in another editor");

    // Pages can't carry their files out of it, or into Trash.
    let moved = notebook.move_pages(&[page], plain, 0, 0);
    assert!(matches!(moved, Err(CoreError::ReadOnly(ReadOnlyReason::Encrypted))), "{moved:?}");
    let trashed = notebook.delete(&[opennote_core::session::notebook::NodeRef::Page(page)]);
    assert!(trashed.is_err());
    handle.close(&client).unwrap();
    drop(notebook);

    // Locked: no pages, nothing opens, and the password is checked before anything changes.
    assert!(core.lock_section(&root, section).unwrap());
    let notebook = core.find_open(&root).unwrap();
    let tree = notebook.tree();
    let shown = children_of(&tree, notebook.id().0).unwrap();
    let diary = shown.iter().find(|n| n.id == section.to_string()).unwrap();
    assert_eq!(diary.protection, Protection::Locked);
    assert_eq!(diary.title, "Diary", "the title stays readable");
    assert_eq!(children_of(&tree, section.0).unwrap().len(), 0);
    assert!(matches!(
        notebook.open_page(page, client.clone()),
        Err(CoreError::ReadOnly(ReadOnlyReason::Encrypted)) | Err(CoreError::NotFound(_))
    ));
    drop(notebook);
    assert!(matches!(
        core.unlock_section(&root, section, Secret::Password("battery staple")),
        Err(ProtectError::Wrong)
    ));
    core.unlock_section(&root, section, Secret::Password("correct horse")).unwrap();
    let notebook = core.find_open(&root).unwrap();
    let handle = notebook.open_page(page, client.clone()).unwrap();
    let json = real_core::page_json(&handle).to_string();
    assert!(json.contains(SECRET) && json.contains(LATER), "{json}");
    handle.close(&client).unwrap();

    // Delete forever works inside it, and removing protection brings plain files back.
    let second = notebook
        .create_page(
            section,
            NodePlacement {
                parent: ParentRef::Section(section),
                before: None,
            },
        )
        .unwrap();
    assert_eq!(notebook.delete_sealed_pages(&[second]).unwrap(), vec![second]);
    drop(notebook);
    core.unprotect_section(&root, section).unwrap();
    assert_eq!(core.section_protection(&root, section).unwrap(), Protection::None);
    assert!(!holding(&root, SECRET).is_empty(), "plain again");
}
