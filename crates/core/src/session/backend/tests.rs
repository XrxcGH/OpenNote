#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use super::*;
use crate::store::compact::CompactionPlan;
use crate::store::fs::FolderIdentity;
use crate::store::page_store::tests::{draw, stroke_n, Harness};
use crate::testing::fakes::ScriptApplier;
use crate::testing::sample::{sample_device, sample_page};
use crate::testing::CollectingSink;

const DAY: Duration = Duration::from_secs(86_400);
const WAIT: Duration = Duration::from_secs(5);

fn backend(h: &Harness) -> StoreBackend {
    h.fs.mkdir_all(Path::new("/data"));
    let config = StoreConfig {
        fs: Arc::new(h.fs.clone()),
        codec: Arc::new(h.codec.clone()),
        applier: Arc::new(ScriptApplier),
        clock: h.clock.clone(),
        limits: Limits::default(),
        timings: Timings::default(),
        device: sample_device(),
        writer: "OpenNote test".into(),
        data: DataLayout::new("/data"),
        boot: "boot-1".into(),
    };
    StoreBackend::start(config, Arc::new(CollectingSink::default())).unwrap()
}

fn meta() -> JournalMeta {
    JournalMeta {
        notebook: "01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap(),
        notebook_path: "/notebooks/Biology".into(),
        identity: FolderIdentity([7; 24]),
        section: Some("01m3s9v8ym7yt5c8yb61tthbwt".parse().unwrap()),
        app: "OpenNote test".into(),
        device: sample_device().id,
        boot: "boot-1".into(),
        page_format: 1,
    }
}

#[test]
fn tidying_keeps_what_a_journal_base_snapshot_still_lists() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    draw(&mut page, stroke_n(1));
    let (first, saved) = h.save(&page, None, CompactionPlan::None);
    let (second, _) = h.save(&first, Some(saved.stamp), CompactionPlan::Major);
    let old = saved.segments[0].id;
    let segment = NotebookLayout::segment_path(&h.dir, old);

    // The page closes after an unconfirmed save: its generation keeps the first save as its base.
    let backend = backend(&h);
    let key = NotebookKey("01m3s9q9xbpmxwz4cz4ht6twg9-0a1b2c3d".into());
    let base = BaseSnapshot::of(first.revision.id, &h.codec.write_page(&first));
    let journal = backend.open_page_journal(&key, page.id, meta(), base).unwrap();
    journal.append_ink_progress(&stroke_n(2));
    journal.close(Some((second.revision.id, Durability::Unconfirmed)));
    backend.flush_journals(WAIT).unwrap();

    let later = h.clock.now().saturating_add(DAY * 400);
    backend.tidy_page(&h.dir, page.id, later, Retention::Days30).unwrap();
    assert!(
        h.fs.exists(&segment),
        "recovery may still rebuild from the base snapshot"
    );

    for journals in backend.journals().unwrap() {
        for path in journals.pages.values().flatten() {
            h.fs.remove_file(path).unwrap();
        }
    }
    backend.tidy_page(&h.dir, page.id, later, Retention::Days30).unwrap();
    assert!(!h.fs.exists(&segment), "without the journal the segment is garbage");
    backend.shutdown(WAIT);
}
