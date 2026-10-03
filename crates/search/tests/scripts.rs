//! Words beyond Latin: Cyrillic, Greek, Hangul, kana, Devanagari, and scripts written without spaces.

mod common;

use common::{doc, titles, DocExt};
use opennote_search::{Query, SearchIndex};

fn index_of(pages: &[(&str, &str)]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let docs: Vec<_> = pages
        .iter()
        .enumerate()
        .map(|(n, (title, text))| doc(n as u64 + 1, title).text(text))
        .collect();
    index.upsert_many(&docs).unwrap();
    index
}

fn found(index: &SearchIndex, text: &str) -> Vec<String> {
    let hits = index.search(&Query::text(text)).unwrap();
    titles(&hits).into_iter().map(String::from).collect()
}

fn sample() -> SearchIndex {
    index_of(&[
        (
            "Russian",
            "\u{43c}\u{43e}\u{439} \u{440}\u{430}\u{439}\u{43e}\u{43d} \u{435}\u{449}\u{451}",
        ),
        (
            "Greek",
            "\u{3ba}\u{3b1}\u{3bb}\u{3b7}\u{3bc}\u{3ad}\u{3c1}\u{3b1} \u{3ba}\u{3cc}\u{3c3}\u{3bc}\u{3b5}",
        ),
        ("Korean", "\u{d55c}\u{ad6d}\u{c5b4}\u{b97c} \u{acf5}\u{bd80}"),
        (
            "Hindi",
            "\u{92e}\u{947}\u{930}\u{940} \u{915}\u{93f}\u{924}\u{93e}\u{92c}",
        ),
        (
            "Kana",
            "\u{304c}\u{3063}\u{3053}\u{3046} \u{30ac}\u{30e9}\u{30b9} \u{30d1}\u{30f3}",
        ),
        ("Lotus", "\u{915}\u{92e}\u{932}"),
    ])
}

#[test]
fn whole_words_of_every_script_are_found() {
    let index = sample();
    for (query, page) in [
        ("\u{43c}\u{43e}\u{439}", "Russian"),
        ("\u{440}\u{430}\u{439}\u{43e}\u{43d}", "Russian"),
        ("\u{435}\u{449}\u{451}", "Russian"),
        ("\u{435}\u{449}\u{435}", "Russian"),
        ("\u{3ba}\u{3b1}\u{3bb}\u{3b7}\u{3bc}\u{3ad}\u{3c1}\u{3b1}", "Greek"),
        ("\u{39a}\u{391}\u{39b}\u{397}\u{39c}\u{395}\u{3a1}\u{391}", "Greek"),
        ("\u{d55c}\u{ad6d}\u{c5b4}", "Korean"),
        ("\u{915}\u{93f}\u{924}\u{93e}\u{92c}", "Hindi"),
        ("\u{304c}\u{3063}\u{3053}\u{3046}", "Kana"),
        ("\u{30ac}\u{30e9}\u{30b9}", "Kana"),
        ("\u{30d1}\u{30f3}", "Kana"),
    ] {
        assert_eq!(found(&index, query), [page], "{query} as a prefix");
        assert_eq!(found(&index, &format!("{query} ")), [page], "{query} as a whole word");
    }
}

#[test]
fn prefixes_match_while_typing() {
    let index = sample();
    assert_eq!(found(&index, "\u{440}\u{430}\u{439}"), ["Russian"]);
    assert_eq!(found(&index, "\u{915}\u{93f}\u{924}"), ["Hindi"]);
    assert_eq!(found(&index, "\u{d55c}\u{ad6d}"), ["Korean"]);
}

#[test]
fn marks_that_are_part_of_a_letter_keep_words_apart() {
    let index = sample();
    assert!(
        found(&index, "\u{30cf}\u{30f3} ").is_empty(),
        "a word with a different voicing mark"
    );
    assert!(found(&index, "\u{304b}\u{3063}\u{3053}\u{3046} ").is_empty());
    assert_eq!(
        found(&index, "\u{915}\u{92e}\u{932} "),
        ["Lotus"],
        "not the word with a vowel sign"
    );
    assert!(found(&index, "\u{915}\u{92e}\u{93e}\u{932} ").is_empty());
}

#[test]
fn a_word_inside_a_sentence_without_spaces_is_found() {
    let index = index_of(&[
        (
            "Trip",
            "\u{4eca}\u{65e5}\u{306f}\u{6771}\u{4eac}\u{306b}\u{884c}\u{304d}\u{307e}\u{3059}\u{3002}\
             \u{660e}\u{65e5}\u{306f}\u{5927}\u{962a}\u{3067}\u{3059}",
        ),
        (
            "Meeting",
            "\u{6211}\u{4eec}\u{660e}\u{5929}\u{53bb}\u{5317}\u{4eac}\u{5f00}\u{4f1a}",
        ),
        ("Rice", "\u{e01}\u{e34}\u{e19}\u{e02}\u{e49}\u{e32}\u{e27}"),
    ]);
    assert_eq!(found(&index, "\u{6771}\u{4eac}"), ["Trip"]);
    assert_eq!(found(&index, "\u{5927}\u{962a} "), ["Trip"]);
    assert_eq!(found(&index, "\u{5317}\u{4eac}"), ["Meeting"]);
    let mut capital = found(&index, "\u{4eac}");
    capital.sort();
    assert_eq!(capital, ["Meeting", "Trip"]);
    assert!(found(&index, "\u{4e0a}\u{6d77}").is_empty());
    assert!(
        found(&index, "\u{4eac}\u{6771}").is_empty(),
        "the letters must be in order"
    );
    assert_eq!(found(&index, "\u{e02}\u{e49}\u{e32}\u{e27}"), ["Rice"]);
}

#[test]
fn snippets_highlight_the_letters_that_matched() {
    let index = index_of(&[(
        "Trip",
        "\u{4eca}\u{65e5}\u{306f}\u{6771}\u{4eac}\u{306b}\u{884c}\u{304d}\u{307e}\u{3059}",
    )]);
    let hits = index.search(&Query::text("\u{6771}\u{4eac} ")).unwrap();
    let snippet = hits[0].snippet.as_ref().unwrap();
    let marked: Vec<&str> = snippet
        .highlights
        .iter()
        .map(|range| &snippet.text[range.clone()])
        .collect();
    assert_eq!(marked, ["\u{6771}", "\u{4eac}"]);
}
