//! Ranking through the whole index: title, heading, body, recency, and the scope of a notebook or section.

mod common;

use common::{doc, notebook_id, page_id, section_id, titles, DocExt};
use opennote_core::Timestamp;
use opennote_search::{BlockKind, Query, RankContext, RankWeights, SearchIndex, SearchScope};

const DAY: i64 = 86_400_000;

fn now() -> Timestamp {
    Timestamp::from_unix_ms(1_000 * DAY)
}

fn ranked(index: &SearchIndex, query: &Query) -> Vec<String> {
    let context = RankContext::at(now());
    index
        .search_with(query, &context)
        .unwrap()
        .into_iter()
        .map(|hit| hit.title)
        .collect()
}

#[test]
fn a_title_that_is_the_query_beats_a_longer_title_beats_a_body_match() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let recent = 999 * DAY;
    index
        .upsert_many(&[
            doc(1, "Notes")
                .text("Cellular respiration happens in the mitochondria")
                .modified(recent),
            doc(2, "Cellular respiration and fermentation").modified(recent),
            doc(3, "Respiration").text("only one of the two words").modified(recent),
            doc(4, "Cellular respiration").modified(recent),
        ])
        .unwrap();
    let found = ranked(&index, &Query::text("cellular respiration "));
    assert_eq!(
        found,
        ["Cellular respiration", "Cellular respiration and fermentation", "Notes"]
    );
}

#[test]
fn a_heading_match_beats_a_paragraph_match() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let at = 999 * DAY;
    index
        .upsert_many(&[
            doc(1, "Plain")
                .text("The enzyme works best when warm. Enzyme kinetics follow.")
                .modified(at),
            doc(2, "Headed")
                .text("# Enzyme kinetics\n\nSome notes follow.")
                .modified(at),
        ])
        .unwrap();
    let hits = index
        .search_with(&Query::text("enzyme kinetics "), &RankContext::at(now()))
        .unwrap();
    assert_eq!(titles(&hits), ["Headed", "Plain"]);
    assert!(hits[0].rank.heading > 0.0);
    assert_eq!(hits[1].rank.heading, 0.0);
}

#[test]
fn newer_pages_win_ties_and_the_age_shows_in_the_breakdown() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert_many(&[
            doc(1, "Old").text("shared words here").modified(100 * DAY),
            doc(2, "Mid").text("shared words here").modified(900 * DAY),
            doc(3, "New").text("shared words here").modified(999 * DAY),
        ])
        .unwrap();
    let hits = index
        .search_with(&Query::text("shared words "), &RankContext::at(now()))
        .unwrap();
    assert_eq!(titles(&hits), ["New", "Mid", "Old"]);
    assert!(hits[0].rank.recency > hits[1].rank.recency && hits[1].rank.recency > hits[2].rank.recency);
    assert!(hits[0].score > hits[1].score);
}

#[test]
fn turning_recency_off_leaves_the_text_to_decide() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert_many(&[
            doc(1, "Old but dense")
                .text("tide tide tide tide tide")
                .modified(100 * DAY),
            doc(2, "New but thin")
                .text("tide among many other words that dilute the page and make it long enough to matter")
                .modified(999 * DAY),
        ])
        .unwrap();
    let context = RankContext {
        weights: RankWeights {
            recency: 0.0,
            ..RankWeights::default()
        },
        now: now(),
    };
    let hits = index.search_with(&Query::text("tide "), &context).unwrap();
    assert_eq!(titles(&hits), ["Old but dense", "New but thin"]);
}

#[test]
fn a_scope_boosts_its_section_then_its_notebook_and_hides_nothing() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let at = 500 * DAY;
    index
        .upsert_many(&[
            doc(1, "Elsewhere")
                .text("budget review")
                .notebook(2)
                .section(5)
                .modified(at),
            doc(2, "Same notebook")
                .text("budget review")
                .notebook(1)
                .section(2)
                .modified(at),
            doc(3, "Same section")
                .text("budget review")
                .notebook(1)
                .section(1)
                .modified(at),
        ])
        .unwrap();
    let scoped = Query {
        scope: Some(SearchScope {
            notebook: Some(notebook_id(1)),
            section: Some(section_id(1)),
        }),
        ..Query::text("budget review ")
    };
    assert_eq!(ranked(&index, &scoped), ["Same section", "Same notebook", "Elsewhere"]);
    let unscoped = ranked(&index, &Query::text("budget review "));
    assert_eq!(unscoped.len(), 3);
    let notebook_only = Query {
        scope: Some(SearchScope {
            notebook: Some(notebook_id(2)),
            section: None,
        }),
        ..Query::text("budget review ")
    };
    assert_eq!(ranked(&index, &notebook_only)[0], "Elsewhere");
}

#[test]
fn a_scope_orders_a_query_without_words_too() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert_many(&[
            doc(1, "Newest elsewhere").notebook(2).section(9).modified(3_000),
            doc(2, "Newer notebook").notebook(1).section(2).modified(2_000),
            doc(3, "Older section").notebook(1).section(1).modified(1_000),
        ])
        .unwrap();
    let query = Query {
        scope: Some(SearchScope {
            notebook: Some(notebook_id(1)),
            section: Some(section_id(1)),
        }),
        ..Query::default()
    };
    assert_eq!(
        ranked(&index, &query),
        ["Older section", "Newer notebook", "Newest elsewhere"]
    );
    assert_eq!(
        ranked(&index, &Query::default()),
        ["Newest elsewhere", "Newer notebook", "Older section"]
    );
}

#[test]
fn paging_through_ranked_results_matches_one_long_page() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let docs: Vec<_> = (1..=40)
        .map(|n| {
            doc(n, &format!("Page {n} about waves"))
                .text(&format!("waves {}", "tide ".repeat((n % 7) as usize)))
                .modified((n as i64 % 11) * DAY)
        })
        .collect();
    index.upsert_many(&docs).unwrap();
    let context = RankContext::at(now());
    let long = index
        .search_with(
            &Query {
                limit: 40,
                ..Query::text("waves ")
            },
            &context,
        )
        .unwrap();
    let mut paged = Vec::new();
    for offset in (0..40).step_by(7) {
        paged.extend(
            index
                .search_with(
                    &Query {
                        limit: 7,
                        offset,
                        ..Query::text("waves ")
                    },
                    &context,
                )
                .unwrap(),
        );
    }
    let pages = |hits: &[opennote_search::SearchHit]| hits.iter().map(|hit| hit.page).collect::<Vec<_>>();
    assert_eq!(pages(&paged), pages(&long));
    assert_eq!(long.len(), 40);
}

#[test]
fn the_scores_are_in_order_and_equal_scores_break_by_date_then_page() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let docs: Vec<_> = (1..=12)
        .map(|n| doc(n, "Same title").text("same text").modified(10 * DAY))
        .collect();
    index.upsert_many(&docs).unwrap();
    let hits = index
        .search_with(
            &Query {
                limit: 20,
                ..Query::text("same ")
            },
            &RankContext::at(now()),
        )
        .unwrap();
    assert!(hits.windows(2).all(|pair| pair[0].score >= pair[1].score));
    let order: Vec<_> = hits.iter().map(|hit| hit.page).collect();
    let expected: Vec<_> = (1..=12).map(page_id).collect();
    assert_eq!(order, expected, "equal pages come in the order they were indexed");
}

#[test]
fn a_block_type_filter_leaves_the_title_out_of_the_score() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert(&doc(1, "Photosynthesis").block(BlockKind::Table, "photosynthesis rate"))
        .unwrap();
    let query = Query {
        block_types: vec![BlockKind::Table],
        ..Query::text("photosynthesis")
    };
    let hits = index.search_with(&query, &RankContext::at(now())).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].rank.title, 0.0);
    assert_eq!(hits[0].rank.heading, 0.0);
}

#[test]
fn queries_with_a_scope_still_read_old_saved_files() {
    let query: Query = serde_json::from_str("{\"text\":\"x\"}").unwrap();
    assert_eq!(query.scope, None);
    let scoped = Query {
        scope: Some(SearchScope {
            notebook: Some(notebook_id(1)),
            section: None,
        }),
        ..Query::text("x")
    };
    let json = serde_json::to_string(&scoped).unwrap();
    assert_eq!(serde_json::from_str::<Query>(&json).unwrap(), scoped);
}
