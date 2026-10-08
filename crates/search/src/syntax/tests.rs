use opennote_core::{Id, NotebookId, SectionId};

use super::*;

const NOW: i64 = 1_772_713_200_000; // 2026-03-05 12:20 UTC

fn notebook(n: u64) -> NotebookId {
    NotebookId::from(Id::from_parts(n, u128::from(n)))
}

fn section(n: u64) -> SectionId {
    SectionId::from(Id::from_parts(100 + n, u128::from(n)))
}

fn places() -> PlaceList {
    let mut list = PlaceList::new();
    list.notebook("Biology 201", notebook(1))
        .notebook("Chemistry", notebook(2))
        .section("Labs", section(1))
        .section("Biology notes", section(2))
        .section("Labs", section(3));
    list
}

fn read(text: &str) -> TypedSearch {
    let places = places();
    parse(
        text,
        &SyntaxContext {
            now: Timestamp::from_unix_ms(NOW),
            utc_offset_minutes: 0,
            places: &places,
        },
    )
}

#[test]
fn plain_text_stays_text_in_boolean_mode() {
    let found = read("cell -wall \"light reactions\" OR (a b)");
    assert_eq!(found.query.text, "cell -wall \"light reactions\" OR (a b)");
    assert_eq!(found.query.mode, TextMode::Boolean);
    assert!(found.notes.is_empty());
    assert_eq!(found.query.tags, Vec::<String>::new());
}

#[test]
fn operators_leave_the_text_and_set_filters() {
    let found = read("tag:School/Biology photosynthesis type:table in:chemistry mitosis");
    let query = found.query;
    assert_eq!(query.text, "photosynthesis mitosis");
    assert_eq!(query.tags, ["school/biology"]);
    assert_eq!(query.block_types, [BlockKind::Table]);
    assert_eq!(query.notebooks, [notebook(2)]);
    assert!(found.notes.is_empty());
}

#[test]
fn the_last_word_stays_a_prefix_unless_an_operator_follows_it() {
    assert_eq!(read("photo").query.text, "photo");
    assert_eq!(read("photo ").query.text, "photo ");
    assert_eq!(
        read("photo tag:x").query.text,
        "photo ",
        "the person is typing the operator now"
    );
    assert_eq!(read("tag:x photo").query.text, "photo");
}

#[test]
fn quoted_values_hold_spaces() {
    let found = read("in:\"biology 201\" tag:\"my tag\" \"in:not an operator\"");
    assert_eq!(found.query.notebooks, [notebook(1)]);
    assert_eq!(found.query.tags, ["my tag"]);
    assert_eq!(found.query.text, "\"in:not an operator\"");
}

#[test]
fn a_place_name_matches_in_full_before_it_matches_the_start() {
    assert_eq!(read("in:labs").query.sections, [section(1), section(3)]);
    let by_start = read("in:bio").query;
    assert_eq!(by_start.notebooks, [notebook(1)]);
    assert_eq!(by_start.sections, [section(2)]);
    assert_eq!(read("notebook:bio").query.sections, Vec::<SectionId>::new());
    assert_eq!(read("section:bio").query.notebooks, Vec::<NotebookId>::new());
}

#[test]
fn an_unknown_place_is_reported_and_left_out() {
    let found = read("in:Physics cell");
    assert_eq!(
        found.notes,
        [SyntaxNote::UnknownPlace {
            operator: "in".into(),
            value: "Physics".into()
        }]
    );
    assert!(found.notes[0].message().contains("Physics"));
    assert_eq!(found.query.text, "cell");
    assert!(found.query.notebooks.is_empty());
}

#[test]
fn block_types_have_friendly_names() {
    let query = read("type:handwriting type:alt is:text type:ink").query;
    assert_eq!(
        query.block_types,
        [BlockKind::Ink, BlockKind::Image, BlockKind::File, BlockKind::Text]
    );
    let found = read("type:video");
    assert_eq!(found.notes, [SyntaxNote::UnknownType { value: "video".into() }]);
}

#[test]
fn dates_set_a_half_open_range_in_local_time() {
    let day = |text: &str| read(text).query.date.unwrap();
    let march_first = dates::days_from_civil(2026, 3, 1) * 86_400_000;
    let range = day("after:2026-03-01 before:2026-04");
    assert_eq!(range.field, DateField::Modified);
    assert_eq!(range.from, Some(Timestamp::from_unix_ms(march_first)));
    assert_eq!(
        range.to,
        Some(Timestamp::from_unix_ms(dates::days_from_civil(2026, 4, 1) * 86_400_000))
    );
    let on = day("on:2026-03");
    assert_eq!(on.from, range.from);
    assert_eq!(on.to, range.to);
    let created = day("created-after:7d");
    assert_eq!(created.field, DateField::Created);
    assert_eq!(
        created.from,
        Some(Timestamp::from_unix_ms(
            dates::days_from_civil(2026, 2, 26) * 86_400_000
        ))
    );
    assert_eq!(created.to, None);
}

#[test]
fn a_bad_date_and_a_second_date_field_are_reported() {
    let found = read("after:soon");
    assert_eq!(
        found.notes,
        [SyntaxNote::BadDate {
            operator: "after".into(),
            value: "soon".into()
        }]
    );
    assert_eq!(found.query.date, None);
    let found = read("after:today created-before:today");
    assert_eq!(
        found.notes,
        [SyntaxNote::TwoDateFields {
            operator: "created-before".into()
        }]
    );
    assert_eq!(found.query.date.unwrap().field, DateField::Modified);
}

#[test]
fn an_operator_without_a_value_yet_is_not_a_mistake() {
    let found = read("cell tag: in: type: after:");
    assert!(found.notes.is_empty(), "{:?}", found.notes);
    assert_eq!(found.query.text, "cell ");
    assert_eq!(
        found.query,
        Query {
            text: "cell ".into(),
            mode: TextMode::Boolean,
            ..Query::default()
        }
    );
}

#[test]
fn other_colons_stay_in_the_text() {
    for text in [
        "10:30 meeting",
        "http://example.com",
        "title:review",
        "-tag:x",
        "(tag:x OR y)",
    ] {
        assert_eq!(read(text).query.text, text, "{text}");
    }
}

#[test]
fn every_operator_in_the_help_line_is_understood() {
    let examples = [
        "tag:school/biology",
        "in:\"Biology 201\"",
        "type:table",
        "before:2026-03-01",
        "after:7d",
        "on:2026-03",
        "created-before:2026-03-01",
    ];
    for example in examples {
        let found = read(example);
        assert!(found.notes.is_empty(), "{example}: {:?}", found.notes);
        assert_eq!(found.query.text.trim(), "", "{example}");
    }
    assert_eq!(OPERATORS.len(), 12);
    for operator in OPERATORS {
        assert!(!operator.syntax.is_empty() && !operator.example.is_empty() && !operator.meaning.is_empty());
    }
}
