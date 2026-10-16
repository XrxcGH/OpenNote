//! Boolean search, `title:`, title-only search, and regular expression search against a real index.

mod common;

use common::{doc, notebook_id, titles, DocExt};
use opennote_search::{BlockKind, PageDoc, Query, SearchError, SearchHit, SearchIndex};

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

fn sample() -> SearchIndex {
    index_of(&[
        doc(1, "Photosynthesis")
            .text("Chlorophyll absorbs light in the thylakoid.")
            .tags(&["biology"]),
        doc(2, "Cell division").text("Mitosis has four phases. Draft: check the diagram."),
        doc(3, "Cellular respiration").text("Mitochondria make ATP from glucose and oxygen."),
        doc(4, "Lab draft")
            .text("Measure the light and the oxygen.")
            .block(BlockKind::Table, "sodium\n12"),
        doc(5, "Exam plan").text("Review mitosis and photosynthesis before Friday."),
    ])
}

fn sorted(hits: &[SearchHit]) -> Vec<&str> {
    let mut found = titles(hits);
    found.sort_unstable();
    found
}

fn found(index: &SearchIndex, query: Query) -> Vec<String> {
    let hits = index.search(&query).unwrap();
    sorted(&hits).into_iter().map(String::from).collect()
}

fn boolean(index: &SearchIndex, text: &str) -> Vec<String> {
    found(index, Query::boolean(text))
}

#[test]
fn or_finds_pages_with_either_word() {
    let index = sample();
    assert_eq!(
        boolean(&index, "chlorophyll OR mitochondria "),
        ["Cellular respiration", "Photosynthesis"]
    );
    assert_eq!(boolean(&index, "oxygen "), ["Cellular respiration", "Lab draft"]);
    assert_eq!(
        boolean(&index, "(chlorophyll OR mitosis) phases "),
        ["Cell division"],
        "a group needs the words outside it as well"
    );
    assert_eq!(boolean(&index, "light AND oxygen "), ["Lab draft"]);
}

#[test]
fn not_and_a_minus_sign_leave_pages_out() {
    let index = sample();
    assert_eq!(boolean(&index, "oxygen NOT glucose "), ["Lab draft"]);
    assert_eq!(boolean(&index, "oxygen -glucose "), ["Lab draft"]);
    assert_eq!(boolean(&index, "light -oxygen "), ["Photosynthesis"]);
    assert_eq!(
        boolean(&index, "light NOT (oxygen OR chlorophyll) "),
        Vec::<String>::new()
    );
    assert_eq!(
        boolean(&index, "(light OR mitosis) -oxygen "),
        ["Cell division", "Exam plan", "Photosynthesis"]
    );
}

#[test]
fn a_text_that_only_leaves_words_out_lists_every_other_page_newest_first() {
    let index = sample();
    let hits = index.search(&Query::boolean("-oxygen")).unwrap();
    assert_eq!(titles(&hits), ["Exam plan", "Cell division", "Photosynthesis"]);
    let query = Query {
        limit: 1,
        offset: 1,
        ..Query::boolean("-oxygen")
    };
    assert_eq!(titles(&index.search(&query).unwrap()), ["Cell division"]);
    let query = Query {
        tags: vec!["biology".into()],
        ..Query::boolean("NOT glucose")
    };
    assert_eq!(titles(&index.search(&query).unwrap()), ["Photosynthesis"]);
}

#[test]
fn the_word_being_typed_is_a_prefix_but_a_word_left_out_is_not() {
    let index = sample();
    assert_eq!(boolean(&index, "mitoc"), ["Cellular respiration"]);
    assert_eq!(boolean(&index, "mitoc "), Vec::<String>::new());
    assert_eq!(boolean(&index, "light -ox"), ["Lab draft", "Photosynthesis"]);
    assert_eq!(boolean(&index, "light OR "), ["Lab draft", "Photosynthesis"]);
}

#[test]
fn title_limits_where_a_word_may_match() {
    let index = sample();
    assert_eq!(boolean(&index, "draft "), ["Cell division", "Lab draft"]);
    assert_eq!(boolean(&index, "title:draft "), ["Lab draft"]);
    assert_eq!(boolean(&index, "draft -title:draft "), ["Cell division"]);
    assert_eq!(boolean(&index, "title:(cell OR exam) "), ["Cell division", "Exam plan"]);
    assert_eq!(
        boolean(&index, "title:(exam OR cell"),
        ["Cell division", "Cellular respiration", "Exam plan"]
    );
    assert_eq!(boolean(&index, "title:light "), Vec::<String>::new());
}

#[test]
fn a_title_only_search_ignores_the_text() {
    let index = sample();
    let query = |text: &str| Query {
        title_only: true,
        ..Query::text(text)
    };
    assert_eq!(found(&index, query("draft ")), ["Lab draft"]);
    assert_eq!(found(&index, query("light ")), Vec::<String>::new());
    assert_eq!(found(&index, query("cell")), ["Cell division", "Cellular respiration"]);
}

#[test]
fn matches_carry_snippets_for_the_words_to_find() {
    let index = sample();
    let hits = index.search(&Query::boolean("chlorophyll OR atp -oxygen ")).unwrap();
    assert_eq!(titles(&hits), ["Photosynthesis"]);
    let snippet = hits[0].snippet.as_ref().unwrap();
    let marked: Vec<&str> = snippet
        .highlights
        .iter()
        .map(|range| &snippet.text[range.clone()])
        .collect();
    assert_eq!(marked, ["Chlorophyll"]);
}

#[test]
fn a_regular_expression_matches_titles_and_text() {
    let index = sample();
    let hits = index.search(&Query::regex("mito\\w+")).unwrap();
    assert_eq!(sorted(&hits), ["Cell division", "Cellular respiration", "Exam plan"]);
    let hit = hits.iter().find(|hit| hit.title == "Cell division").unwrap();
    let snippet = hit.snippet.as_ref().unwrap();
    assert_eq!(&snippet.text[snippet.highlights[0].clone()], "Mitosis");
    let hits = index.search(&Query::regex("^cell")).unwrap();
    assert_eq!(sorted(&hits), ["Cell division", "Cellular respiration"]);
    assert_eq!(hits[0].title_highlights, vec![0..4]);
}

#[test]
fn a_pattern_ignores_case_unless_it_says_not_to() {
    let index = sample();
    assert_eq!(found(&index, Query::regex("(?-i)\\bMitosis")), ["Cell division"]);
    assert_eq!(
        found(&index, Query::regex("\\bMITOSIS")),
        ["Cell division", "Exam plan"]
    );
}

#[test]
fn a_pattern_obeys_the_filters() {
    let index = index_of(&[
        doc(1, "One").text("mitosis in notebook one").tags(&["biology"]),
        doc(2, "Two").text("mitosis in notebook two").notebook(2),
        doc(3, "Three")
            .text("no match here")
            .block(BlockKind::Table, "mitosis 42"),
    ]);
    let query = |filters: Query| Query {
        text: "mitosis".into(),
        ..filters
    };
    let regex = |filters: Query| {
        found(
            &index,
            query(Query {
                mode: opennote_search::TextMode::Regex,
                ..filters
            }),
        )
    };
    assert_eq!(regex(Query::default()), ["One", "Three", "Two"]);
    assert_eq!(
        regex(Query {
            notebooks: vec![notebook_id(2)],
            ..Query::default()
        }),
        ["Two"]
    );
    assert_eq!(
        regex(Query {
            tags: vec!["biology".into()],
            ..Query::default()
        }),
        ["One"]
    );
    let tables = Query {
        block_types: vec![BlockKind::Table],
        ..Query::default()
    };
    let hits = index
        .search(&query(Query {
            mode: opennote_search::TextMode::Regex,
            ..tables
        }))
        .unwrap();
    assert_eq!(titles(&hits), ["Three"]);
    assert_eq!(hits[0].snippet.as_ref().unwrap().kind, BlockKind::Table);
}

#[test]
fn a_pattern_can_be_limited_to_titles_and_an_empty_one_lists_pages() {
    let index = sample();
    let query = Query {
        title_only: true,
        ..Query::regex("phot|lab")
    };
    assert_eq!(found(&index, query), ["Lab draft", "Photosynthesis"]);
    assert_eq!(index.search(&Query::regex("  ")).unwrap().len(), 5);
}

#[test]
fn a_bad_pattern_is_an_error_with_a_plain_message() {
    let index = sample();
    let error = index.search(&Query::regex("(open")).unwrap_err();
    assert!(
        matches!(&error, SearchError::Pattern(message) if message == "Unclosed group"),
        "{error}"
    );
}

#[test]
fn matches_rank_by_count_and_then_by_age() {
    let index = index_of(&[
        doc(1, "Once").text("a lemma"),
        doc(2, "Thrice").text("lemma lemma lemma"),
        doc(3, "Twice").text("lemma and a lemma"),
    ]);
    let hits = index.search(&Query::regex("lemma")).unwrap();
    assert_eq!(titles(&hits), ["Thrice", "Twice", "Once"]);
}

#[test]
fn typed_text_becomes_a_working_search() {
    use opennote_core::Timestamp;
    use opennote_search::syntax::parse;
    use opennote_search::{PlaceList, SyntaxContext};

    let index = index_of(&[
        doc(1, "Photosynthesis")
            .text("Chlorophyll absorbs light.")
            .tags(&["biology/plants"]),
        doc(2, "Lab draft")
            .text("Measure the light and the oxygen.")
            .tags(&["biology"]),
        doc(3, "Painting").text("Light and shadow.").notebook(2),
    ]);
    let mut places = PlaceList::new();
    places
        .notebook("Science", notebook_id(1))
        .notebook("Art", notebook_id(2));
    let context = SyntaxContext {
        now: Timestamp::from_unix_ms(90_000_000),
        utc_offset_minutes: 0,
        places: &places,
    };
    let run = |text: &str| {
        let typed = parse(text, &context);
        assert!(typed.notes.is_empty(), "{:?}", typed.notes);
        sorted_owned(&index.search(&typed.query).unwrap())
    };
    assert_eq!(run("light "), ["Lab draft", "Painting", "Photosynthesis"]);
    assert_eq!(run("light -oxygen in:science tag:biology "), ["Photosynthesis"]);
    assert_eq!(run("light in:art"), ["Painting"]);
    assert_eq!(
        run("tag:biology type:text title:draft OR title:photo"),
        ["Lab draft", "Photosynthesis"]
    );
    assert_eq!(run("light on:1970-01-01"), ["Lab draft", "Painting", "Photosynthesis"]);
    assert_eq!(run("light after:1970-01-02"), Vec::<String>::new());
    assert_eq!(run("light before:1970-01-02 tag:biology/plants"), ["Photosynthesis"]);
}

fn sorted_owned(hits: &[SearchHit]) -> Vec<String> {
    sorted(hits).into_iter().map(String::from).collect()
}
