use super::typo::{edit_distance, slip};
use super::*;

fn find(query: &str, title: &str) -> Option<FuzzyMatch> {
    fuzzy_match(&Needle::new(query)?, &Haystack::new(title))
}

fn kind(query: &str, title: &str) -> Option<MatchKind> {
    find(query, title).map(|found| found.kind)
}

fn highlighted<'a>(title: &'a str, found: &FuzzyMatch) -> Vec<&'a str> {
    found.ranges.iter().map(|range| &title[range.clone()]).collect()
}

#[test]
fn each_kind_of_match_is_found() {
    let title = "Physics Lab Notes";
    assert_eq!(kind("physics lab notes", title), Some(MatchKind::Exact));
    assert_eq!(kind("phys", title), Some(MatchKind::Prefix));
    assert_eq!(kind("phys la", title), Some(MatchKind::Prefix));
    assert_eq!(kind("lab", title), Some(MatchKind::WordPrefix));
    assert_eq!(kind("lab no", title), Some(MatchKind::WordPrefix));
    assert_eq!(kind("notes phys", title), Some(MatchKind::Words));
    assert_eq!(kind("sics", title), Some(MatchKind::Substring));
    assert_eq!(kind("pln", title), Some(MatchKind::Subsequence));
    assert_eq!(kind("reactoin", "Reaction rates"), Some(MatchKind::Typo));
    assert_eq!(kind("mitosys", "Mitosis"), Some(MatchKind::Typo));
}

#[test]
fn nothing_matches_unrelated_text() {
    assert_eq!(kind("xyz", "Physics"), None);
    assert_eq!(kind("physicsxyz", "Physics"), None);
    assert_eq!(
        kind("physicsx", "Physics"),
        Some(MatchKind::Typo),
        "one extra letter is a slip"
    );
    assert_eq!(kind("cta", "cat"), None, "a short word gets no typo allowance");
    assert!(Needle::new("  - ! ").is_none());
    assert!(Needle::new("").is_none());
    assert_eq!(kind("a", ""), None);
    assert_eq!(kind("a", " - "), None);
    assert!(Haystack::new("...").is_blank());
}

#[test]
fn better_kinds_score_higher() {
    let title = "Physics Lab Notes";
    let scores: Vec<u32> = ["physics lab notes", "phys", "lab", "notes phys", "sics", "pln"]
        .into_iter()
        .map(|query| find(query, title).unwrap().score)
        .collect();
    assert!(scores.windows(2).all(|pair| pair[0] > pair[1]), "{scores:?}");
    let typo = find("reactoin", "Reaction rates").unwrap().score;
    assert!(typo < *scores.last().unwrap());
}

#[test]
fn a_shorter_title_beats_a_longer_one_of_the_same_kind() {
    let short = find("bio", "Biology").unwrap();
    let long = find("bio", "Biology of the cell and its many parts").unwrap();
    assert_eq!((short.kind, long.kind), (MatchKind::Prefix, MatchKind::Prefix));
    assert!(short.score > long.score);
}

#[test]
fn letters_at_word_starts_beat_letters_inside_words() {
    let starts = find("fn", "File Notes").unwrap();
    let inside = find("fn", "Often").unwrap();
    assert_eq!(
        (starts.kind, inside.kind),
        (MatchKind::Subsequence, MatchKind::Subsequence)
    );
    assert!(starts.score > inside.score);
    let in_a_row = find("abc", "xx abc").unwrap();
    assert_eq!(in_a_row.kind, MatchKind::WordPrefix);
    let spread = find("abc", "a1b1c1").unwrap();
    assert_eq!(spread.kind, MatchKind::Subsequence);
}

#[test]
fn highlights_follow_the_title_in_bytes_even_with_accents() {
    let title = "\u{c9}cole Normale";
    let found = find("ecole", title).unwrap();
    assert_eq!(found.kind, MatchKind::Prefix);
    assert_eq!(highlighted(title, &found), ["\u{c9}cole"]);
    let found = find("norm", title).unwrap();
    assert_eq!(highlighted(title, &found), ["Norm"]);
    let found = find("pln", "Physics Lab Notes").unwrap();
    assert_eq!(highlighted("Physics Lab Notes", &found), ["P", "L", "N"]);
    let found = find("notes phys", "Physics Lab Notes").unwrap();
    assert_eq!(highlighted("Physics Lab Notes", &found), ["Phys", "Notes"]);
}

#[test]
fn case_punctuation_and_spacing_do_not_matter() {
    assert_eq!(kind("LAB-NOTES", "lab   notes"), Some(MatchKind::Exact));
    assert_eq!(kind("don't", "Don't panic"), Some(MatchKind::Prefix));
    assert!(kind("dont", "Don't panic").is_some());
    assert_eq!(kind("c++", "C notes"), Some(MatchKind::Prefix));
    assert_eq!(kind("ecole", "\u{c9}COLE"), Some(MatchKind::Exact));
}

#[test]
fn digits_count_as_letters() {
    assert_eq!(kind("2026", "Budget 2026"), Some(MatchKind::WordPrefix));
    assert_eq!(kind("q3 rev", "Q3 review"), Some(MatchKind::Prefix));
}

#[test]
fn long_titles_and_queries_are_cut_short_not_rejected() {
    let title = format!("{} end", "word ".repeat(200));
    assert_eq!(kind("word", &title), Some(MatchKind::Prefix));
    let query = "a".repeat(500);
    assert!(Needle::new(&query).is_some());
    assert_eq!(kind(&query, "short"), None);
}

#[test]
fn a_swap_costs_one_edit() {
    let chars = |text: &str| text.chars().collect::<Vec<_>>();
    assert_eq!(edit_distance(&chars("form"), &chars("from")), 1);
    assert_eq!(edit_distance(&chars("kitten"), &chars("sitting")), 3);
    assert_eq!(edit_distance(&chars(""), &chars("abc")), 3);
    assert_eq!(edit_distance(&chars("same"), &chars("same")), 0);
}

#[test]
fn a_word_still_being_typed_is_close_to_the_full_word() {
    let chars = |text: &str| text.chars().collect::<Vec<_>>();
    assert_eq!(slip(&chars("photosyntes"), &chars("photosynthesis")), 1);
    assert_eq!(slip(&chars("photosyntes"), &chars("zzz")), 11);
}

#[test]
fn ranges_never_overlap_and_stay_in_order() {
    for (query, title) in [
        ("a", "banana"),
        ("an", "banana"),
        ("bnn", "banana"),
        ("ban nan", "banana banana"),
        ("na ba", "banana banana"),
    ] {
        let found = find(query, title).unwrap();
        assert!(
            found.ranges.windows(2).all(|pair| pair[0].end < pair[1].start),
            "{query} {found:?}"
        );
        assert!(found
            .ranges
            .iter()
            .all(|range| title.is_char_boundary(range.start) && title.is_char_boundary(range.end)));
    }
}
