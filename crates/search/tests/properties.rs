//! Property tests: the index agrees with a plain model after any sequence of operations, in memory and in a
//! file, and its searches page and order consistently.

mod common;

use std::collections::BTreeSet;

use common::spec::{agree, apply_index, apply_model, config, graph_agrees, op, spec, Model, Spec, VOCAB};
use opennote_search::{MatchKind, PageDoc, Query, SearchIndex, SwitchContext, Switcher};
use proptest::prelude::*;

proptest! {
    #![proptest_config(config())]

    #[test]
    fn the_index_agrees_with_a_model_after_any_operations(ops in prop::collection::vec(op(), 1..25)) {
        let mut index = SearchIndex::open_in_memory().unwrap();
        let mut model = Model::new();
        for op in &ops {
            apply_model(&mut model, op);
            apply_index(&mut index, op);
            agree(&index, &model)?;
        }
        graph_agrees(&index)?;
    }

    #[test]
    fn a_file_index_agrees_with_the_model_across_restarts_and_crashes(
        ops in prop::collection::vec(op(), 1..16),
        restart_at in 0usize..16,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search.db");
        let mut index = SearchIndex::open(&path).unwrap();
        let mut model = Model::new();
        for (at, op) in ops.iter().enumerate() {
            apply_model(&mut model, op);
            apply_index(&mut index, op);
            if at == restart_at {
                index.close().unwrap();
                index = SearchIndex::open(&path).unwrap();
                prop_assert!(!index.was_created());
                agree(&index, &model)?;
            }
        }
        agree(&index, &model)?;
        // What a crash would leave: the files as they are, while the index is still open.
        let image = tempfile::tempdir().unwrap();
        for suffix in ["", "-wal"] {
            let from = format!("{}{suffix}", path.display());
            if std::path::Path::new(&from).exists() {
                std::fs::copy(&from, image.path().join(format!("search.db{suffix}"))).unwrap();
            }
        }
        let recovered = SearchIndex::open(&image.path().join("search.db")).unwrap();
        prop_assert!(!recovered.was_created(), "{:?}", recovered.status());
        agree(&recovered, &model)?;
    }

    #[test]
    fn results_are_ordered_and_paging_is_consistent(
        specs in prop::collection::vec(spec(), 1..12),
        word in 0..VOCAB.len(),
        step in 1usize..6,
    ) {
        let mut index = SearchIndex::open_in_memory().unwrap();
        let docs: Vec<PageDoc> = specs.iter().map(Spec::doc).collect();
        index.upsert_many(&docs).unwrap();
        let text = format!("{} ", VOCAB[word]);
        let all = index.search(&Query { limit: 100, ..Query::text(&text) }).unwrap();
        prop_assert!(all.windows(2).all(|pair| pair[0].score >= pair[1].score));
        prop_assert!(all.iter().all(|hit| (hit.rank.total - hit.score).abs() < 1e-9));
        let mut paged = Vec::new();
        let mut offset = 0;
        loop {
            let page = index.search(&Query { limit: step, offset, ..Query::text(&text) }).unwrap();
            prop_assert!(page.len() <= step);
            if page.is_empty() { break; }
            offset += page.len();
            paged.extend(page);
        }
        let ids = |hits: &[opennote_search::SearchHit]| hits.iter().map(|hit| hit.page).collect::<Vec<_>>();
        prop_assert_eq!(ids(&paged), ids(&all));
        let unique: BTreeSet<_> = ids(&all).into_iter().collect();
        prop_assert_eq!(unique.len(), all.len(), "a page appears once");
    }

    #[test]
    fn the_switcher_finds_every_page_by_its_own_title(specs in prop::collection::vec(spec(), 1..12)) {
        let mut index = SearchIndex::open_in_memory().unwrap();
        let docs: Vec<PageDoc> = specs.iter().filter(|spec| !spec.locked).map(Spec::doc).collect();
        index.upsert_many(&docs).unwrap();
        let mut switcher = Switcher::new();
        switcher.refresh(&index).unwrap();
        for entry in index.switch_entries().unwrap() {
            let found = switcher.find(&entry.title, &SwitchContext { limit: 100, ..SwitchContext::default() });
            let hit = found.hits.iter().find(|hit| hit.page == entry.page);
            prop_assert!(hit.is_some(), "{} is not found by its title", entry.title);
            prop_assert_eq!(hit.unwrap().kind, Some(MatchKind::Exact));
        }
    }
}
