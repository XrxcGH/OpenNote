//! A real core for integration tests: `StdFs`, the canonical codec, and the real applier, on a temporary
//! folder. The unit-test kit uses the registry codec and a script applier, which can't apply block edits.

// Each test file uses a different subset of these helpers.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::id::{ClientId, DeviceId, PageId, SectionId};
use opennote_core::model::DeviceRef;
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::resolve::{Edit, TxnRequest};
use opennote_core::session::core::{Core, CoreConfig, MemoryCaps};
use opennote_core::session::notebook::{NodePlacement, NotebookHandle, ParentRef};
use opennote_core::session::page::PageHandle;
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::fakes::NullSink;
use opennote_core::testing::sample::test_clock;
use opennote_core::wire::envelope;
use opennote_core::{Limits, TestClock, Timings};
use serde_json::Value;
use tempfile::TempDir;

/// A core with one notebook, one section, and one empty page.
pub struct Real {
    pub dir: TempDir,
    pub core: Core,
    pub clock: Arc<TestClock>,
    pub notebook: NotebookHandle,
    pub section: SectionId,
    pub page: PageId,
    pub client: ClientId,
    seq: u64,
}

/// A device for the tests.
pub fn device() -> DeviceRef {
    DeviceRef {
        id: DeviceId::parse("01m1e34qm04rx4vfj1927vgwgm").unwrap(),
        label: "Test device".into(),
    }
}

/// Starts a core on `data` with the clock.
pub fn start(data: PathBuf, clock: Arc<TestClock>) -> Core {
    let timings = Timings::for_crash_tests();
    let config = CoreConfig {
        data_dir: data,
        device: device(),
        app_version: "opennote-test".into(),
        fs: Arc::new(StdFs::new(&timings)),
        codec: Arc::new(CanonicalCodec),
        applier: Arc::new(OpsApplier),
        clock,
        limits: Limits::default(),
        timings,
        caps: MemoryCaps::default(),
    };
    Core::start(config, Arc::new(NullSink), None).unwrap()
}

impl Real {
    /// A core on a fresh temporary folder, with a notebook "Biology", a section "Lab", and an empty page.
    pub fn new() -> Real {
        let dir = tempfile::tempdir().unwrap();
        let clock = Arc::new(test_clock());
        let core = start(dir.path().join("data"), clock.clone());
        let notes = dir.path().join("notes");
        std::fs::create_dir_all(&notes).unwrap();
        let notebook = core.create_notebook(&notes, "Biology").unwrap();
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
        Real {
            dir,
            core,
            clock,
            notebook,
            section,
            page,
            client: ClientId::parse("main-1").unwrap(),
            seq: 0,
        }
    }

    /// Opens the page for the test's client.
    pub fn open(&self) -> PageHandle {
        self.notebook.open_page(self.page, self.client.clone()).unwrap()
    }

    /// A request for the page with the next sequence number of the test's client.
    pub fn request(&mut self, edits: Vec<Edit>) -> TxnRequest {
        self.seq += 1;
        TxnRequest {
            page: self.page,
            client: self.client.clone(),
            client_seq: self.seq,
            coalesce: None,
            ui: None,
            edits,
        }
    }
}

/// The page as the interface receives it, from the envelope: the `page.json` object.
pub fn page_json(handle: &PageHandle) -> Value {
    let envelope = handle.envelope(None).unwrap();
    let decoded = envelope::decode(&envelope.bytes).unwrap();
    serde_json::from_slice(decoded.page_json).unwrap()
}

/// The JSON part of an applied-changes frame.
pub fn frame_json(frame: &opennote_core::wire::frames::AppliedFrame) -> Value {
    opennote_core::wire::frames::decode(&frame.bytes).unwrap().0
}
