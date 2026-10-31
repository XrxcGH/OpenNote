//! A relaunch while the previous run of the profile is still ending (spec 20.3), on the real storage backend: the
//! ink.restart E2E failure. The killed run's stroke sits only in its journal, and the run lets go of its locks in
//! no fixed order, often the notebook's lock before the journals'.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::*;
use crate::format::CanonicalCodec;
use crate::id::{BlockId, ClientId, PageId, StrokeId};
use crate::limits::{Limits, Timings};
use crate::model::{BlockData, InkRecord, ReadOnlyReason};
use crate::ops::apply::OpsApplier;
use crate::ops::resolve::StrokeTxnMeta;
use crate::seams::Codec;
use crate::session::events::RecoveryOutcome;
use crate::session::kit::stroke;
use crate::session::notebook::{NodePlacement, NotebookHandle, ParentRef};
use crate::session::page::{read_page_dir, write_page_dir};
use crate::store::fs::{Fs, FsLock};
use crate::store::journal::reader::list_journals;
use crate::store::layout::DataLayout;
use crate::testing::mem_fs::MemCrash;
use crate::testing::{sample, CollectingSink, MemFs};
use crate::time::TestClock;

/// A core on the real backend over `fs`, with a lock budget of `patience`.
fn start(fs: &MemFs, clock: &Arc<TestClock>, patience: Duration) -> Core {
    let config = CoreConfig {
        data_dir: "/data".into(),
        device: sample::sample_device(),
        app_version: "test".into(),
        fs: Arc::new(fs.clone()),
        codec: Arc::new(CanonicalCodec),
        applier: Arc::new(OpsApplier),
        clock: clock.clone(),
        limits: Limits::default(),
        timings: Timings {
            lock_patience: patience,
            ..Timings::for_crash_tests()
        },
        caps: MemoryCaps::default(),
    };
    Core::start(config, Arc::new(CollectingSink::default()), None).unwrap()
}

fn client() -> ClientId {
    ClientId::parse("main-1").unwrap()
}

/// A section with a page that has a handwriting layer, which new strokes go into.
fn inked_page(fs: &MemFs, notebook: &NotebookHandle) -> PageId {
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    let section = notebook.create_section("Lab", top).unwrap();
    let in_section = NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    };
    let page = notebook.create_page(section, in_section).unwrap();
    let dir = notebook.inner.tree().store.page_dir(page).unwrap();
    let created = read_page_dir(fs, &CanonicalCodec, &dir, &Limits::default()).unwrap();
    let mut inked = sample::sample_page();
    inked.id = page;
    inked.revision = created.page.revision;
    inked.assets.clear();
    let others: Vec<BlockId> = inked
        .blocks
        .iter()
        .filter(|b| !matches!(b.data, BlockData::Text(_) | BlockData::Ink(_)))
        .map(|b| b.id)
        .collect();
    for block in others {
        inked.blocks.remove(block);
    }
    write_page_dir(fs, &CanonicalCodec, &dir, &inked).unwrap();
    page
}

/// What the killed run left: its files, the notebook folder, the page, and the stroke only in its journal.
struct Killed {
    fs: MemFs,
    clock: Arc<TestClock>,
    dir: PathBuf,
    page: PageId,
    stroke: StrokeId,
    lock_file: PathBuf,
}

/// Creates `folder` in `/notes` with a page (from `copy_of` when given, as a person copies a folder), draws a
/// stroke that reaches only the journal, and kills the app.
fn killed_with_a_journaled_stroke(fs: MemFs, folder: &str, copy_of: Option<&str>) -> Killed {
    let clock = Arc::new(sample::test_clock());
    fs.mkdir_all(Path::new("/notes"));
    let dir = Path::new("/notes").join(folder);
    let core = start(&fs, &clock, Duration::ZERO);
    let (notebook, page) = if let Some(original) = copy_of {
        crate::store::notebook_store::copy_tree(&fs, &Path::new("/notes").join(original), &dir).unwrap();
        let notebook = core.open_notebook(&dir).unwrap();
        let page = notebook.tree().sections[0].pages[0].id;
        (notebook, page)
    } else {
        let notebook = core.create_notebook(Path::new("/notes"), folder).unwrap();
        let page = inked_page(&fs, &notebook);
        (notebook, page)
    };
    let handle = notebook.open_page(page, client()).unwrap();
    let ink = stroke(9);
    let meta = StrokeTxnMeta {
        page,
        client: client(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: Vec::new(),
    };
    let records = CanonicalCodec.encode_records(&[InkRecord::Stroke(ink.clone())]);
    handle.add_strokes(meta, &records).unwrap();
    core.flush_journals(Duration::from_secs(5)).unwrap();
    let lock_file = DataLayout::new("/data").lock_file(&notebook.inner.key());
    // The kill: from here on every call of the killed run fails, so it saves nothing on its way out.
    let after = fs.crash(MemCrash::App);
    drop((handle, notebook, core));
    Killed {
        fs: after,
        clock,
        dir,
        page,
        stroke: ink.id,
        lock_file,
    }
}

/// The locks the ending run still holds: the notebook's, and its page and tree journal generations'.
/// The notebook's lock, and its page and tree journal generations' locks.
type Held = (Box<dyn FsLock>, Vec<Box<dyn FsLock>>, Vec<Box<dyn FsLock>>);

fn still_held(killed: &Killed) -> Held {
    let notebook = killed.fs.try_lock(&killed.lock_file).unwrap().unwrap();
    let journals = list_journals(&killed.fs, Path::new("/data/journal")).unwrap();
    let take = |path: &PathBuf| killed.fs.try_lock(path).unwrap().unwrap();
    let pages: Vec<_> = journals
        .iter()
        .flat_map(|k| k.pages.values().flatten())
        .map(take)
        .collect();
    let tree: Vec<_> = journals.iter().flat_map(|k| k.tree.iter()).map(take).collect();
    assert!(!pages.is_empty(), "the stroke isn't in a journal");
    (notebook, pages, tree)
}

/// Opens the page and says whether it is writable and shows the killed run's stroke.
fn shows_the_stroke(notebook: &NotebookHandle, killed: &Killed) -> bool {
    let page = notebook.open_page(killed.page, client()).unwrap();
    let shown = page.read_only().is_none() && page.page_for_tests().ink.stroke(killed.stroke).is_some();
    page.close(&client()).unwrap();
    shown
}

#[test]
fn a_journaled_stroke_shows_when_the_ending_run_lets_go_of_the_notebook_before_its_journals() {
    let killed = killed_with_a_journaled_stroke(MemFs::new(), "Biology", None);
    let (notebook_lock, pages, tree) = still_held(&killed);
    let lets_go = thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        drop(notebook_lock);
        thread::sleep(Duration::from_millis(200));
        drop(tree);
        thread::sleep(Duration::from_millis(200));
        drop(pages);
    });
    let next = start(&killed.fs, &killed.clock, Duration::from_secs(10));
    let report = next.recover_pending(Some(&killed.dir)).unwrap();
    lets_go.join().unwrap();
    let outcome = report.pages.iter().find(|(p, _)| *p == killed.page).map(|(_, o)| o);
    assert!(
        outcome.is_some_and(|o| !matches!(o, RecoveryOutcome::Deferred { .. } | RecoveryOutcome::OwnerAlive)),
        "{outcome:?}"
    );
    let notebook = next.find_open(&killed.dir).unwrap();
    assert!(!notebook.tree().access.is_read_only());
    assert!(shows_the_stroke(&notebook, &killed));
}

#[test]
fn a_notebook_held_past_the_budget_opens_read_only_with_the_notice_and_the_next_open_recovers_it() {
    let killed = killed_with_a_journaled_stroke(MemFs::new(), "Biology", None);
    let held = still_held(&killed);
    let next = start(&killed.fs, &killed.clock, Duration::from_millis(100));
    let notebook = next.open_notebook(&killed.dir).unwrap();
    assert_eq!(
        notebook.tree().access,
        crate::model::Access::ReadOnly(ReadOnlyReason::StillClosing)
    );
    // The page carries the reason, which the page view shows as its notice.
    let page = notebook.open_page(killed.page, client()).unwrap();
    assert_eq!(page.read_only(), Some(ReadOnlyReason::StillClosing));
    page.close(&client()).unwrap();
    // The read-only open left the journal alone, and the next open, with the run gone, recovers it.
    drop(held);
    notebook.close().unwrap();
    let again = next.open_notebook(&killed.dir).unwrap();
    assert!(!again.tree().access.is_read_only());
    assert!(shows_the_stroke(&again, &killed));
}

#[test]
fn a_tree_journal_held_past_the_budget_keeps_the_notebook_read_only_until_the_next_open() {
    let killed = killed_with_a_journaled_stroke(MemFs::new(), "Biology", None);
    let (notebook_lock, pages, tree) = still_held(&killed);
    assert!(!tree.is_empty(), "the tree journal has no generation");
    drop((notebook_lock, pages));
    let next = start(&killed.fs, &killed.clock, Duration::from_millis(100));
    let notebook = next.open_notebook(&killed.dir).unwrap();
    assert_eq!(
        notebook.tree().access,
        crate::model::Access::ReadOnly(ReadOnlyReason::StillClosing)
    );
    drop(tree);
    notebook.close().unwrap();
    let again = next.open_notebook(&killed.dir).unwrap();
    assert!(!again.tree().access.is_read_only());
    assert!(shows_the_stroke(&again, &killed));
}

#[test]
fn a_page_journal_held_past_the_budget_opens_that_page_read_only_until_the_next_open() {
    let killed = killed_with_a_journaled_stroke(MemFs::new(), "Biology", None);
    let (notebook_lock, pages, tree) = still_held(&killed);
    drop((notebook_lock, tree));
    let next = start(&killed.fs, &killed.clock, Duration::from_millis(100));
    let notebook = next.open_notebook(&killed.dir).unwrap();
    assert!(!notebook.tree().access.is_read_only());
    let page = notebook.open_page(killed.page, client()).unwrap();
    assert_eq!(page.read_only(), Some(ReadOnlyReason::StillClosing));
    page.close(&client()).unwrap();
    drop(pages);
    notebook.close().unwrap();
    let again = next.open_notebook(&killed.dir).unwrap();
    assert!(shows_the_stroke(&again, &killed));
}

#[test]
fn many_held_notebooks_wait_one_budget_in_all() {
    let fs = MemFs::new();
    fs.mkdir_all(Path::new("/notes"));
    let clock = Arc::new(sample::test_clock());
    let first = start(&fs, &clock, Duration::ZERO);
    let dirs: Vec<PathBuf> = ["A", "B", "C", "D"]
        .iter()
        .map(|t| {
            first
                .create_notebook(Path::new("/notes"), t)
                .unwrap()
                .path()
                .to_path_buf()
        })
        .collect();
    // The first core keeps them open, as a run that never ends would.
    let patience = Duration::from_millis(400);
    let started = Instant::now();
    let next = start(&fs, &clock, patience);
    for dir in &dirs {
        let notebook = next.open_notebook(dir).unwrap();
        assert_eq!(
            notebook.tree().access,
            crate::model::Access::ReadOnly(ReadOnlyReason::StillClosing)
        );
    }
    let took = started.elapsed();
    assert!(took >= patience, "{took:?}");
    assert!(took < patience.saturating_mul(2), "{took:?}");
}

#[test]
fn a_second_path_to_an_open_notebook_never_waits_for_its_own_lock() {
    let fs = MemFs::new();
    fs.mkdir_all(Path::new("/notes"));
    let clock = Arc::new(sample::test_clock());
    let core = start(&fs, &clock, Duration::from_secs(10));
    let notebook = core.create_notebook(Path::new("/notes"), "Biology").unwrap();
    let ctx = core.ctx();
    let started = Instant::now();
    let how = crate::session::notebook::open::OpenAs { copy_of_open: false };
    let again = crate::session::notebook::open::open_notebook(ctx, notebook.path(), &how).unwrap();
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        again.tree().access,
        crate::model::Access::ReadOnly(ReadOnlyReason::LockedElsewhere)
    );
}

#[test]
fn making_a_copy_separate_recovers_its_journal_first() {
    let fs = MemFs::new();
    let clock = Arc::new(sample::test_clock());
    fs.mkdir_all(Path::new("/notes"));
    let core = start(&fs, &clock, Duration::ZERO);
    let original = core.create_notebook(Path::new("/notes"), "Biology").unwrap();
    inked_page(&fs, &original);
    original.close().unwrap();
    drop(core);
    // The copy is drawn on alone, and the app is killed with the stroke only in the copy's journal.
    let killed = killed_with_a_journaled_stroke(fs, "Biology copy", Some("Biology"));
    let next = start(&killed.fs, &killed.clock, Duration::ZERO);
    let original = next.open_notebook(Path::new("/notes/Biology")).unwrap();
    let copy = next.open_notebook(&killed.dir).unwrap();
    assert_eq!(copy.id(), original.id());
    assert!(copy.tree().access.is_read_only());
    let id = copy.make_separate().unwrap();
    assert_ne!(id, original.id());
    assert!(!copy.tree().access.is_read_only());
    assert!(shows_the_stroke(&copy, &killed));
}

#[test]
fn a_copy_whose_journal_is_still_held_is_not_made_separate() {
    let fs = MemFs::new();
    let clock = Arc::new(sample::test_clock());
    fs.mkdir_all(Path::new("/notes"));
    let core = start(&fs, &clock, Duration::ZERO);
    let original = core.create_notebook(Path::new("/notes"), "Biology").unwrap();
    inked_page(&fs, &original);
    original.close().unwrap();
    drop(core);
    let killed = killed_with_a_journaled_stroke(fs, "Biology copy", Some("Biology"));
    let next = start(&killed.fs, &killed.clock, Duration::ZERO);
    let original = next.open_notebook(Path::new("/notes/Biology")).unwrap();
    let (notebook_lock, pages, tree) = still_held(&killed);
    drop((notebook_lock, tree));
    let copy = next.open_notebook(&killed.dir).unwrap();
    let refused = copy.make_separate().err();
    assert_eq!(refused, Some(CoreError::ReadOnly(ReadOnlyReason::PendingJournal)));
    assert_eq!(copy.id(), original.id());
    drop(pages);
    assert!(copy.make_separate().is_ok());
    assert!(shows_the_stroke(&copy, &killed));
}
