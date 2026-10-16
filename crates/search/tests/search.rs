//! Matching, ranking, snippets, and filters.

mod common;

use common::{block_id, doc, notebook_id, page_id, section_id, titles, DocExt};
use opennote_core::Timestamp;
use opennote_search::{BlockKind, DateField, DateRange, PageDoc, Query, SearchHit, SearchIndex};

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

fn run(index: &SearchIndex, text: &str) -> Vec<SearchHit> {
    index.search(&Query::text(text)).unwrap()
}

fn sample() -> SearchIndex {
    index_of(&[
        doc(1, "Photosynthesis")
            .text("Chlorophyll absorbs **light** in the thylakoid membrane.")
            .tags(&["biology", "exam/unit-3"]),
        doc(2, "Cell division")
            .text("Mitosis has four phases.")
            .tags(&["biology"]),
        doc(3, "Caf\u{e9} Cr\u{e8}me recipe").text("Whisk the eggs."),
    ])
}

#[test]
fn finds_words_in_titles_tags_and_text() {
    let index = sample();
    assert_eq!(titles(&run(&index, "chlorophyll")), ["Photosynthesis"]);
    assert_eq!(titles(&run(&index, "division")), ["Cell division"]);
    assert_eq!(run(&index, "biology").len(), 2);
    assert_eq!(titles(&run(&index, "unit")), ["Photosynthesis"]);
    assert!(run(&index, "absent").is_empty());
}

#[test]
fn matches_prefixes_only_while_the_person_is_still_typing() {
    let index = sample();
    assert_eq!(run(&index, "chloro").len(), 1);
    assert_eq!(run(&index, "chlor").len(), 1);
    assert_eq!(run(&index, "thylak").len(), 1);
    assert_eq!(run(&index, "chlor ").len(), 0, "a finished word must match whole words");
    assert_eq!(run(&index, "chlorophyll ").len(), 1);
}

#[test]
fn ignores_case_and_accents() {
    let index = sample();
    assert_eq!(titles(&run(&index, "CAFE creme")), ["Caf\u{e9} Cr\u{e8}me recipe"]);
    assert_eq!(run(&index, "caf\u{e9}").len(), 1);
}

#[test]
fn every_word_must_match_even_across_blocks() {
    let index = index_of(&[doc(1, "Two boxes").text("alpha here").text("beta there")]);
    assert_eq!(run(&index, "alpha beta").len(), 1);
    assert_eq!(run(&index, "boxes beta").len(), 1, "title and text can share the query");
    assert!(run(&index, "alpha gamma").is_empty());
}

#[test]
fn quoted_words_match_as_a_phrase() {
    let index = index_of(&[doc(1, "A").text("the light reactions occur first")]);
    assert_eq!(run(&index, "\"light reactions\"").len(), 1);
    assert!(run(&index, "\"reactions light\"").is_empty());
    assert_eq!(run(&index, "\"light react").len(), 1);
}

#[test]
fn a_title_match_ranks_above_a_text_match() {
    let index = index_of(&[
        doc(1, "Notes").text("Notes on mitosis and mitosis again, and mitosis"),
        doc(2, "Mitosis").text("Phases"),
    ]);
    let hits = run(&index, "mitosis");
    assert_eq!(titles(&hits), ["Mitosis", "Notes"]);
    assert!(hits[0].score > hits[1].score);
    assert_eq!(hits[0].title_highlights.len(), 1);
    assert_eq!(hits[0].title_highlights[0], 0..7);
}

#[test]
fn a_snippet_points_at_the_block_that_matches() {
    let index = index_of(&[doc(7, "Long page")
        .text("Intro words")
        .text("The **thylakoid** holds chlorophyll")
        .text("Outro")]);
    let hit = &run(&index, "thylakoid chlorophyll")[0];
    let snippet = hit.snippet.as_ref().unwrap();
    assert_eq!(snippet.block, block_id(7, 1));
    assert_eq!(snippet.text, "The thylakoid holds chlorophyll");
    let marked: Vec<&str> = snippet.highlights.iter().map(|r| &snippet.text[r.clone()]).collect();
    assert_eq!(marked, ["thylakoid", "chlorophyll"]);
}

#[test]
fn a_title_only_match_still_gets_a_snippet_of_the_text() {
    let index = index_of(&[doc(1, "Mitosis").text("Phases of division")]);
    let snippet = run(&index, "mitosis")[0].snippet.clone().unwrap();
    assert_eq!(snippet.text, "Phases of division");
    assert!(snippet.highlights.is_empty());
}

#[test]
fn odd_input_never_fails() {
    let index = sample();
    for text in [
        "\"",
        "*",
        "a OR",
        "NEAR(",
        ")",
        "{",
        "title:x",
        "'",
        "",
        "  ",
        "-",
        "a AND NOT b",
        "\u{0}",
        "%_",
    ] {
        assert!(index.search(&Query::text(text)).is_ok(), "{text:?}");
    }
    assert!(index.search(&Query::text("word ".repeat(500))).is_ok());
}

#[test]
fn filters_by_notebook_and_section() {
    let index = index_of(&[
        doc(1, "One").text("shared").notebook(1).section(1),
        doc(2, "Two").text("shared").notebook(2).section(2),
        doc(3, "Three").text("shared").notebook(2).section(3),
    ]);
    let in_notebook = Query {
        notebooks: vec![notebook_id(2)],
        ..Query::text("shared")
    };
    assert_eq!(index.search(&in_notebook).unwrap().len(), 2);
    let in_section = Query {
        sections: vec![section_id(3)],
        ..in_notebook.clone()
    };
    assert_eq!(titles(&index.search(&in_section).unwrap()), ["Three"]);
    let either = Query {
        notebooks: vec![notebook_id(1), notebook_id(2)],
        ..Query::text("shared")
    };
    assert_eq!(index.search(&either).unwrap().len(), 3);
}

#[test]
fn a_tag_filter_includes_nested_tags_but_not_lookalikes() {
    let index = index_of(&[
        doc(1, "Root").tags(&["exam"]),
        doc(2, "Child").tags(&["Exam/Unit-3"]),
        doc(3, "Deep").tags(&["exam/unit-3/lab"]),
        doc(4, "Lookalike").tags(&["examine", "exam-prep", "exam0"]),
        doc(5, "Inline").text("Remember #exam/final for Friday"),
    ]);
    let tagged = |tag: &str| {
        let mut found = titles(
            &index
                .search(&Query {
                    tags: vec![tag.into()],
                    ..Query::default()
                })
                .unwrap(),
        )
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
        found.sort();
        found
    };
    assert_eq!(tagged("exam"), ["Child", "Deep", "Inline", "Root"]);
    assert_eq!(tagged("#EXAM/unit-3"), ["Child", "Deep"]);
    assert_eq!(tagged("exam/unit-3/lab"), ["Deep"]);
    let both = Query {
        tags: vec!["exam".into(), "exam/unit-3/lab".into()],
        ..Query::default()
    };
    assert_eq!(titles(&index.search(&both).unwrap()), ["Deep"]);
}

#[test]
fn filters_by_a_half_open_date_range() {
    let index = index_of(&[
        doc(1, "Old").text("note").modified(1_000),
        doc(2, "Middle").text("note").modified(2_000),
        doc(3, "New").text("note").modified(3_000),
    ]);
    let range = |from: Option<i64>, to: Option<i64>, field| {
        let date = DateRange {
            field,
            from: from.map(Timestamp::from_unix_ms),
            to: to.map(Timestamp::from_unix_ms),
        };
        let hits = index
            .search(&Query {
                date: Some(date),
                ..Query::text("note")
            })
            .unwrap();
        titles(&hits).into_iter().map(String::from).collect::<Vec<_>>()
    };
    assert_eq!(range(Some(2_000), Some(3_000), DateField::Modified), ["Middle"]);
    assert_eq!(range(Some(2_000), None, DateField::Modified), ["New", "Middle"]);
    assert_eq!(range(None, Some(2_000), DateField::Modified), ["Old"]);
    assert_eq!(range(Some(3_000), None, DateField::Created), ["New"]);
}

#[test]
fn a_block_type_limits_where_words_may_match() {
    let index = index_of(&[
        doc(1, "Has table").block(BlockKind::Table, "mitosis\nanaphase"),
        doc(2, "Has text").text("mitosis in text"),
        doc(3, "Mitosis").block(BlockKind::Image, "A diagram of a cell"),
    ]);
    let only = |kinds: &[BlockKind], text: &str| {
        let query = Query {
            block_types: kinds.to_vec(),
            ..Query::text(text)
        };
        titles(&index.search(&query).unwrap())
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
    };
    assert_eq!(only(&[BlockKind::Table], "mitosis"), ["Has table"]);
    assert_eq!(only(&[BlockKind::Text], "mitosis"), ["Has text"]);
    assert_eq!(only(&[BlockKind::Text, BlockKind::Table], "mitosis").len(), 2);
    assert_eq!(only(&[BlockKind::Image], "diagram"), ["Mitosis"]);
    assert!(
        only(&[BlockKind::Image], "mitosis").is_empty(),
        "the title is not an image"
    );
    assert_eq!(
        only(&[BlockKind::Table], ""),
        ["Has table"],
        "without words, pages that hold such a block"
    );
}

#[test]
fn a_query_without_words_lists_the_newest_pages_with_paging() {
    let docs: Vec<PageDoc> = (1..=5)
        .map(|n| doc(n, &format!("Page {n}")).text("body text"))
        .collect();
    let index = index_of(&docs);
    let page = |offset| {
        let query = Query {
            limit: 2,
            offset,
            ..Query::default()
        };
        titles(&index.search(&query).unwrap())
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
    };
    assert_eq!(page(0), ["Page 5", "Page 4"]);
    assert_eq!(page(2), ["Page 3", "Page 2"]);
    assert_eq!(page(4), ["Page 1"]);
    assert!(index
        .search(&Query {
            limit: 0,
            ..Query::default()
        })
        .unwrap()
        .is_empty());
    assert_eq!(
        index.search(&Query::default()).unwrap()[0]
            .snippet
            .as_ref()
            .unwrap()
            .text,
        "body text"
    );
    assert_eq!(index.search(&Query::default()).unwrap()[0].page, page_id(5));
}
