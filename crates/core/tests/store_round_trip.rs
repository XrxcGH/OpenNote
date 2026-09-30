//! P2, the Phase 3 round-trip gate (plan 13.2): a page saved through the page store and loaded again is
//! identical, with points compared bit for bit.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::limits::{Limits, Timings};
use opennote_core::model::Page;
use opennote_core::seams::Codec;
use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::page_store::{PageStore, PageStoreConfig, SaveOutcome, SaveRequest};
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::gen::{arb_page, PageGen};
use opennote_core::testing::sample::sample_device;
use opennote_core::testing::{MemFs, RegistryCodec};
use proptest::prelude::*;

fn store(fs: Arc<dyn Fs>, codec: Arc<dyn Codec>) -> PageStore {
    PageStore::new(PageStoreConfig {
        fs,
        codec,
        clock: Arc::new(common::clock()),
        device: sample_device(),
        writer: "OpenNote test".into(),
        limits: Limits::default(),
    })
}

/// Gives every asset a small size and writes its file, so the save's asset check passes.
fn with_asset_files(fs: &dyn Fs, dir: &Path, mut page: Page) -> Page {
    for asset in page.assets.values_mut() {
        asset.bytes %= 4_096;
        let path = NotebookLayout::asset_path(dir, asset).unwrap();
        let _ = fs.create_dir_durable(&dir.join("assets"));
        fs.replace_durable(&path, &vec![1u8; usize::try_from(asset.bytes).unwrap()])
            .unwrap();
    }
    page
}

/// Saves the page and returns it as a session holds it after the save.
fn save(store: &PageStore, dir: &Path, page: &Page) -> Page {
    let request = SaveRequest {
        page,
        pending: page.ink.pending(),
        through_seq: 0,
        base_stamp: None,
        journal: None,
        compaction: CompactionPlan::None,
    };
    let outcome: SaveOutcome = store.save(dir, request).unwrap();
    let mut saved = page.clone();
    saved.revision = outcome.revision;
    let pending = saved.ink.pending().len();
    saved.ink.commit(pending, outcome.segments, outcome.dead_bytes);
    saved
}

fn page_dir(root: &Path) -> PathBuf {
    root.join("01m3s9v8ym7yt5c8yb61tthbwt")
        .join("01m3sa12426sg32pmtyffjaqcf")
}

proptest! {
    #![proptest_config(common::cases(256))]

    /// P2 on the in-memory file system with the registry codec, which keeps every value as written.
    #[test]
    fn p2_a_saved_page_loads_back_identical(page in arb_page(PageGen::default())) {
        let fs = MemFs::new();
        let dir = page_dir(Path::new("/notebooks/Biology"));
        fs.mkdir_all(&dir);
        let codec = RegistryCodec::new();
        let store = store(Arc::new(fs.clone()), Arc::new(codec));
        let page = with_asset_files(&fs, &dir, page);
        let saved = save(&store, &dir, &page);
        let loaded = store.load(&dir).unwrap();
        prop_assert!(loaded.damaged.is_empty() && loaded.missing.is_empty());
        prop_assert_eq!(loaded.page, saved);
    }
}

#[test]
fn p2_pages_round_trip_on_disk_with_the_canonical_codec() {
    let mut runner = proptest::test_runner::TestRunner::new(common::cases(256));
    runner
        .run(&arb_page(PageGen::default()), |page| {
            let temp = common::temp_dir();
            let dir = page_dir(temp.path());
            std::fs::create_dir_all(&dir).unwrap();
            let fs: Arc<dyn Fs> = Arc::new(StdFs::new(&Timings::default()));
            let store = store(fs.clone(), Arc::new(CanonicalCodec));
            let page = with_asset_files(&*fs, &dir, page);
            let saved = save(&store, &dir, &page);
            let loaded = store.load(&dir).unwrap();
            prop_assert_eq!(loaded.page, saved);
            Ok(())
        })
        .unwrap();
}
