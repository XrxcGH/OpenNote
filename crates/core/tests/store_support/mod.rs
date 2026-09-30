//! Helpers for the storage integration tests (`store_*.rs`). They hold a file system that crashes at a chosen
//! call, a writer that edits, journals, and saves one page, and the checks of plan 13.4 after a crash.

// Each test file uses a different subset of these helpers.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opennote_core::limits::{Limits, Timings};
use opennote_core::model::{Page, Stroke};
use opennote_core::ops::{Op, Origin, PageFields, Txn};
use opennote_core::seams::Codec;
use opennote_core::session::events::RecoveryOutcome;
use opennote_core::session::journal_thread::JournalMeta;
use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::Fs;
use opennote_core::store::journal::reader::list_journals;
use opennote_core::store::layout::{notebook_key, NotebookKey, NotebookLayout};
use opennote_core::store::page_store::{PageStore, PageStoreConfig, SaveRequest};
use opennote_core::store::recovery::{recover_page, RecoverCtx};
use opennote_core::store::verify::verify_notebook;
use opennote_core::testing::sample::{sample_device, sample_notebook, sample_page, sample_section, sample_stroke};
use opennote_core::testing::{MemFs, RegistryCodec, ScriptApplier};
use opennote_core::{ClientId, Id, PageId, StrokeId, TestClock, Timestamp, TxnId};

pub const ROOT: &str = "/notebooks/Biology";
pub const JOURNALS: &str = "/data/journal";
pub const WAIT: Duration = Duration::from_secs(5);

/// The sample page's folder.
pub fn page_dir() -> PathBuf {
    NotebookLayout::new(ROOT).page_dir(sample_section().id, sample_page().id)
}

/// The sample page without its image, so every file it refers to can be written with the right hash.
pub fn test_page() -> Page {
    let mut page = sample_page();
    page.assets.clear();
    let image = page.blocks.iter().find(|b| b.type_name() == "image").map(|b| b.id);
    if let Some(image) = image {
        page.blocks.remove(image);
    }
    page
}

/// A notebook with the sample section and the test page saved, on an in-memory file system.
pub fn notebook(codec: &RegistryCodec) -> MemFs {
    let fs = MemFs::new();
    notebook_on(Arc::new(fs.clone()), codec);
    fs
}

/// Writes a notebook with the sample section and the test page, and the device-local data folder.
pub fn notebook_on(fs: Arc<dyn Fs>, codec: &RegistryCodec) {
    for dir in ["/notebooks", ROOT, "/data"] {
        let _ = fs.create_dir_durable(Path::new(dir));
    }
    let layout = NotebookLayout::new(ROOT);
    let mut section = sample_section();
    section.pages.truncate(1);
    fs.create_dir_durable(&layout.section_dir(section.id)).unwrap();
    fs.create_dir_durable(&page_dir()).unwrap();
    fs.replace_durable(&layout.notebook_json(), &codec.write_notebook(&sample_notebook()))
        .unwrap();
    fs.replace_durable(&layout.section_json(section.id), &codec.write_section(&section))
        .unwrap();
    let store = store(fs, codec);
    let page = test_page();
    let request = SaveRequest {
        page: &page,
        pending: page.ink.pending(),
        through_seq: 0,
        base_stamp: None,
        journal: None,
        compaction: CompactionPlan::None,
    };
    store.save(&page_dir(), request).unwrap();
}

pub fn clock() -> Arc<TestClock> {
    Arc::new(opennote_core::testing::sample::test_clock())
}

pub fn store(fs: Arc<dyn Fs>, codec: &RegistryCodec) -> PageStore {
    store_with(fs, Arc::new(codec.clone()))
}

/// A page store with any codec.
pub fn store_with(fs: Arc<dyn Fs>, codec: Arc<dyn Codec>) -> PageStore {
    PageStore::new(PageStoreConfig {
        fs,
        codec,
        clock: clock(),
        device: sample_device(),
        writer: "OpenNote test".into(),
        limits: Limits::default(),
    })
}

pub fn key(fs: &dyn Fs) -> NotebookKey {
    notebook_key(sample_notebook().id, &fs.folder_identity(Path::new(ROOT)).unwrap())
}

pub fn meta(fs: &dyn Fs) -> JournalMeta {
    JournalMeta {
        notebook: sample_notebook().id,
        notebook_path: ROOT.into(),
        identity: fs.folder_identity(Path::new(ROOT)).unwrap(),
        section: Some(sample_section().id),
        app: "OpenNote test".into(),
        device: sample_device().id,
        boot: fs.boot_id().unwrap(),
        page_format: 1,
    }
}

/// Stroke `n` in the sample page's handwriting layer.
pub fn stroke(n: u64) -> Arc<Stroke> {
    let mut stroke = sample_stroke();
    stroke.id = StrokeId(Id::from_parts(1_790_777_500_000 + n, u128::from(n)));
    Arc::new(stroke)
}

mod crash_fs;
pub mod damaging;
mod writer;

pub use crash_fs::CrashAtFs;
pub use writer::Writer;

/// Recovers the sample page on a file system after a crash.
pub fn recover(fs: &Arc<dyn Fs>, codec: &RegistryCodec) -> RecoveryOutcome {
    try_recover(fs, codec).unwrap()
}

/// Recovers the sample page, reporting errors, as a crash during recovery gives.
pub fn try_recover(fs: &Arc<dyn Fs>, codec: &RegistryCodec) -> Result<RecoveryOutcome, String> {
    let store = store(fs.clone(), codec);
    let generations: Vec<PathBuf> = list_journals(&**fs, Path::new(JOURNALS))
        .map_err(|e| e.to_string())?
        .into_iter()
        .flat_map(|k| k.pages.into_values().flatten())
        .collect();
    let identity = fs.folder_identity(Path::new(ROOT)).map_err(|e| e.to_string())?;
    let boot = fs.boot_id().map_err(|e| e.to_string())?;
    let layout = NotebookLayout::new(ROOT);
    let locate = |_: PageId| Some(page_dir());
    let clock = clock();
    let ctx = RecoverCtx {
        fs: &**fs,
        codec,
        applier: &ScriptApplier,
        store: &store,
        layout: &layout,
        identity: &identity,
        boot: &boot,
        clock: &*clock,
        locate: &locate,
        recovery_dir: Path::new("/data/recovery"),
    };
    recover_page(&ctx, sample_page().id, &generations).map_err(|e| e.to_string())
}

/// Whether two pages hold the same content: everything but the revision, the segments, and what the reader
/// found.
pub fn same_content(a: &Page, b: &Page) -> bool {
    let strokes = |p: &Page| p.ink.strokes().cloned().collect::<Vec<_>>();
    a.id == b.id
        && a.title == b.title
        && a.tags == b.tags
        && a.blocks == b.blocks
        && a.assets == b.assets
        && strokes(a) == strokes(b)
}

/// The checks of plan 13.4 after a crash: recovery succeeds, invariant I1 holds through `verify_notebook`, the
/// page equals the oracle at a step no older than `floor`, and a second recovery changes nothing.
pub fn check_after_crash(
    fs: &Arc<dyn Fs>,
    codec: &RegistryCodec,
    oracle: &[Page],
    floor: usize,
) -> Result<usize, String> {
    let first = try_recover(fs, codec)?;
    let report = verify_notebook(&**fs, codec, Path::new(ROOT), &Limits::default()).map_err(|e| e.to_string())?;
    if !report.is_clean() {
        return Err(format!("I1: {:?}", report.problems));
    }
    let store = store(fs.clone(), codec);
    let page = store.load(&page_dir()).map_err(|e| format!("{e:?}"))?.page;
    let step = (floor..oracle.len())
        .find(|&step| same_content(&oracle[step], &page))
        .ok_or_else(|| format!("I2: the page matches no step from {floor} of {}", oracle.len() - 1))?;
    let second = try_recover(fs, codec)?;
    if second != RecoveryOutcome::Nothing {
        return Err(format!(
            "a second recovery changed something: first {first:?}, second {second:?}"
        ));
    }
    Ok(step)
}

/// A transaction at `at`.
pub fn txn(at: Timestamp, ops: Vec<Op>) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(u64::try_from(at.unix_ms()).unwrap(), 11)),
        at,
        origin: Origin::Local,
        client: ClientId::parse("main-1").unwrap(),
        coalesce: None,
        ui: None,
        ops,
    }
}

/// A rename of the page from `before` to `after`.
pub fn retitle(before: &str, after: &str) -> Op {
    Op::SetPage {
        before: PageFields {
            title: Some(before.to_owned()),
            ..PageFields::default()
        },
        after: PageFields {
            title: Some(after.to_owned()),
            ..PageFields::default()
        },
    }
}

/// Journal timings that flush only when asked and rotate constantly.
pub fn busy_timings() -> Timings {
    Timings {
        group_commit: Duration::from_secs(3_600),
        rotate_bytes: 64,
        ..Timings::default()
    }
}
