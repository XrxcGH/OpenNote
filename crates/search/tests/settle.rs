//! Settled titles: the links to a page follow a rename once the title stops changing, never a title on the way.

mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::world::MemSource;
use common::{doc, notebook_id, page_id, DocExt};
use opennote_search::{
    IndexEvent, IndexUpdate, Indexer, IndexerConfig, Job, LinkStatus, PageDoc, RenamePlan, SearchIndex, SharedIndex,
};

/// An indexer over a fake notebook, with the updates it reported.
struct Rig {
    source: MemSource,
    index: SharedIndex,
    indexer: Indexer<MemSource>,
    updates: Arc<Mutex<Vec<IndexUpdate>>>,
}

impl Rig {
    fn new(config: IndexerConfig, pages: Vec<PageDoc>) -> Rig {
        let source = MemSource::default();
        for page in pages {
            source.world().save(page);
        }
        let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
        let updates: Arc<Mutex<Vec<IndexUpdate>>> = Arc::default();
        let seen = updates.clone();
        let observer = Box::new(move |event| {
            if let IndexEvent::Updated(update) = event {
                seen.lock().unwrap().push(update);
            }
        });
        let mut indexer = Indexer::new(index.clone(), source.clone(), config, Some(observer));
        indexer.enqueue(Job::Start {
            notebooks: vec![notebook_id(1)],
        });
        indexer.run(Instant::now());
        Rig {
            source,
            index,
            indexer,
            updates,
        }
    }

    /// Saves a page, as the editor does while the person types, and lets the indexer read it.
    fn save(&mut self, page: PageDoc) {
        let id = page.page;
        self.source.world().save(page);
        self.indexer.enqueue(Job::Reload {
            page: id,
            notebook: Some(notebook_id(1)),
        });
        self.indexer.run(Instant::now());
    }

    fn plans(&self) -> Vec<RenamePlan> {
        let updates = self.updates.lock().unwrap();
        updates.iter().flat_map(|update| update.renames.clone()).collect()
    }

    fn status(&self, title: &str) -> LinkStatus {
        self.index
            .lock()
            .unwrap()
            .resolve_title(title, None, None)
            .unwrap()
            .status
    }
}

fn notebook() -> Vec<PageDoc> {
    vec![
        doc(1, "Leaf anatomy"),
        doc(2, "Reader").text("See [[Physics]] and [[Leaf anatomy]]."),
        doc(3, ""),
    ]
}

fn waiting() -> IndexerConfig {
    IndexerConfig {
        debounce: Duration::ZERO,
        ..IndexerConfig::default()
    }
}

#[test]
fn a_title_saved_on_the_way_captures_no_links_meant_for_another_page() {
    let mut rig = Rig::new(waiting(), notebook());
    // The person names the new page 3, and a pause saves it on the way.
    rig.save(doc(3, "Physics"));
    rig.save(doc(3, "Physics Lab Report"));
    let rewrites_physics = rig
        .plans()
        .iter()
        .flat_map(|plan| plan.edits.clone())
        .any(|edit| edit.old == "[[Physics]]");
    assert!(!rewrites_physics, "{:?}", rig.plans());
}

#[test]
fn a_rename_settles_after_a_while_or_when_the_person_is_done() {
    let mut rig = Rig::new(waiting(), notebook());
    rig.save(doc(1, "Plant"));
    rig.save(doc(1, "Plant leaves"));
    assert!(rig.plans().is_empty(), "no plan while the title may still change");
    assert_eq!(
        rig.status("Leaf anatomy"),
        LinkStatus::Renamed,
        "links still find the page meanwhile"
    );

    rig.indexer.run(Instant::now() + Duration::from_secs(21));
    let plans = rig.plans();
    assert_eq!(plans.len(), 1);
    let rename = &plans[0].rename;
    assert_eq!(
        (rename.old_title.as_str(), rename.new_title.as_str()),
        ("Leaf anatomy", "Plant leaves")
    );
    assert_eq!(plans[0].edits.len(), 1);
    assert_eq!(plans[0].edits[0].new, "[[Plant leaves]]");
    assert_eq!(plans[0].other_pages(), [page_id(2)]);
    assert_eq!(
        rig.status("Plant"),
        LinkStatus::Broken,
        "a title on the way leaves no alias"
    );
    assert_eq!(rig.status("Leaf anatomy"), LinkStatus::Renamed);

    // The interface says the person is done, so the next rename settles at once.
    rig.save(doc(1, "Leaves"));
    rig.indexer.enqueue(Job::SettleTitle { page: page_id(1) });
    rig.indexer.run(Instant::now());
    let last = rig.plans().pop().unwrap();
    assert_eq!(last.rename.old_title, "Plant leaves");
}

#[test]
fn a_new_page_named_in_steps_settles_without_edits() {
    let mut rig = Rig::new(waiting(), notebook());
    rig.save(doc(3, "Physics"));
    rig.save(doc(3, "Physics Lab Report"));
    rig.indexer.enqueue(Job::SettleTitle { page: page_id(3) });
    rig.indexer.run(Instant::now());
    let plan = rig.plans().pop().unwrap();
    assert_eq!(plan.rename.old_title, "");
    assert!(plan.edits.is_empty());
    assert_eq!(rig.status("Physics"), LinkStatus::Broken);
}

#[test]
fn a_title_left_unsettled_by_the_last_run_settles_at_start() {
    let mut rig = Rig::new(waiting(), notebook());
    rig.save(doc(1, "Plant leaves"));
    assert!(rig.plans().is_empty());
    let mut next = Indexer::new(rig.index.clone(), rig.source.clone(), waiting(), None);
    next.enqueue(Job::Start {
        notebooks: vec![notebook_id(1)],
    });
    next.run(Instant::now());
    assert!(rig.index.lock().unwrap().unsettled_pages().unwrap().is_empty());
    assert_eq!(rig.status("Leaf anatomy"), LinkStatus::Renamed);
}
