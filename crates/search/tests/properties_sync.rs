//! Property tests: incremental updates through the indexer converge to the same index as a fresh build.

mod common;

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use common::spec::{config, pages_of, spec, Spec, PAGES, VOCAB};
use common::world::MemSource;
use common::{notebook_id, page_id, section_id};
use opennote_core::RevisionId;
use opennote_search::{Indexer, IndexerConfig, Job, Query, SearchIndex, SharedIndex};
use proptest::prelude::*;

proptest! {
    #![proptest_config(config())]

    #[test]
    fn incremental_updates_converge_to_the_same_index_as_a_fresh_build(
        steps in prop::collection::vec(world_step(), 1..30),
    ) {
        converge(&steps)?;
    }
}

#[derive(Clone, Debug)]
enum WorldStep {
    Save(Spec),
    Remove(u64),
    Lock(u64),
    Unlock(u64),
    Move(u64, u64),
    Hint(u64),
    Reconcile,
}

fn world_step() -> impl Strategy<Value = WorldStep> {
    prop_oneof![
        8 => spec().prop_map(WorldStep::Save),
        2 => (1..=PAGES).prop_map(WorldStep::Remove),
        1 => (1..=3u64).prop_map(WorldStep::Lock),
        1 => (1..=3u64).prop_map(WorldStep::Unlock),
        2 => (1..=PAGES, 1..=3u64).prop_map(|(p, s)| WorldStep::Move(p, s)),
        6 => (1..=PAGES).prop_map(WorldStep::Hint),
        2 => Just(WorldStep::Reconcile),
    ]
}

/// Runs the steps against pretend notebooks and an indexer, then compares the index with a fresh build.
fn converge(steps: &[WorldStep]) -> Result<(), TestCaseError> {
    let source = MemSource::default();
    let both = vec![notebook_id(1), notebook_id(2)];
    let index: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
    let mut indexer = Indexer::new(index.clone(), source.clone(), IndexerConfig::default(), None);
    indexer.enqueue(Job::Start {
        notebooks: both.clone(),
    });
    indexer.run(Instant::now());
    for step in steps {
        step.apply(&source, &mut indexer);
    }
    indexer.enqueue(Job::Reconcile {
        notebook: notebook_id(1),
    });
    indexer.enqueue(Job::Reconcile {
        notebook: notebook_id(2),
    });
    indexer.run(Instant::now());

    let fresh: SharedIndex = Arc::new(Mutex::new(SearchIndex::open_in_memory().unwrap()));
    let mut builder = Indexer::new(fresh.clone(), source.clone(), IndexerConfig::default(), None);
    builder.enqueue(Job::Start { notebooks: both });
    builder.run(Instant::now());

    prop_assert_eq!(summary(&index), summary(&fresh));
    let report = index.lock().unwrap().check().unwrap();
    prop_assert!(report.is_ok(), "{:?}", report.problems);
    prop_assert_eq!(held_pages(&index), unlocked_pages(&source));
    Ok(())
}

/// Every page the index holds, with its place and revision, and what a search for each word finds.
fn summary(index: &SharedIndex) -> (Vec<Summary>, Vec<BTreeSet<u64>>) {
    let index = index.lock().unwrap();
    let mut pages: Vec<_> = index
        .indexed_pages()
        .unwrap()
        .into_iter()
        .map(|p| (p.page, p.notebook, p.section, p.title, p.revision))
        .collect();
    pages.sort();
    let searches = VOCAB
        .iter()
        .map(|word| {
            let query = Query {
                limit: 500,
                ..Query::text(format!("{word} "))
            };
            pages_of(&index.search(&query).unwrap())
        })
        .collect();
    (pages, searches)
}

type Summary = (
    opennote_core::PageId,
    opennote_core::NotebookId,
    opennote_core::SectionId,
    String,
    Option<RevisionId>,
);

fn held_pages(index: &SharedIndex) -> BTreeSet<u64> {
    let held = index.lock().unwrap().indexed_pages().unwrap();
    held.into_iter().map(|p| p.page.id().time_ms() - 1_000).collect()
}

/// The pages of the notes that are not locked, which is what the index should hold.
fn unlocked_pages(source: &MemSource) -> BTreeSet<u64> {
    let world = source.world();
    world
        .pages
        .values()
        .filter(|doc| !doc.locked && !world.locked_sections.contains(&doc.section))
        .map(|doc| doc.page.id().time_ms() - 1_000)
        .collect()
}

impl WorldStep {
    /// Changes the notes, or tells the indexer what the core would.
    fn apply(&self, source: &MemSource, indexer: &mut Indexer<MemSource>) {
        match self {
            WorldStep::Save(spec) => source.world().save(spec.doc()),
            WorldStep::Remove(page) => source.world().remove(page_id(*page)),
            WorldStep::Lock(section) => {
                source.world().locked_sections.insert(section_id(*section));
            }
            WorldStep::Unlock(section) => {
                source.world().locked_sections.remove(&section_id(*section));
            }
            WorldStep::Move(page, section) => {
                if let Some(doc) = source.world().pages.get_mut(&page_id(*page)) {
                    doc.section = section_id(*section);
                }
            }
            WorldStep::Hint(page) => {
                indexer.enqueue(Job::Reload {
                    page: page_id(*page),
                    notebook: None,
                });
                indexer.run(Instant::now());
            }
            WorldStep::Reconcile => {
                indexer.enqueue(Job::Reconcile {
                    notebook: notebook_id(1),
                });
                indexer.enqueue(Job::Reconcile {
                    notebook: notebook_id(2),
                });
                indexer.run(Instant::now());
            }
        }
    }
}
