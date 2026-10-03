use opennote_core::Id;

use super::*;

fn block(n: u128, text: &str) -> StoredBlock {
    StoredBlock {
        id: BlockId::from(Id::from_parts(1, n)),
        kind: BlockKind::Text,
        text: text.into(),
    }
}

fn term(words: &[&str], prefix: bool) -> Term {
    Term {
        words: words.iter().map(|w| w.to_string()).collect(),
        prefix,
    }
}

fn marked(snippet: &Snippet) -> Vec<&str> {
    snippet.highlights.iter().map(|r| &snippet.text[r.clone()]).collect()
}

#[test]
fn marks_matched_words_and_prefixes() {
    let blocks = [block(1, "The Thylakoid membrane holds chlorophyll")];
    let snippet = best(&blocks, &[term(&["thylak"], true), term(&["chlorophyll"], false)]).unwrap();
    assert_eq!(snippet.text, "The Thylakoid membrane holds chlorophyll");
    assert_eq!(marked(&snippet), ["Thylakoid", "chlorophyll"]);
}

#[test]
fn a_prefix_marks_only_the_last_word_of_a_phrase() {
    let blocks = [block(1, "light reactions, lighter reaction")];
    let snippet = best(&blocks, &[term(&["light", "react"], true)]).unwrap();
    assert_eq!(marked(&snippet), ["light", "reactions", "reaction"]);
}

#[test]
fn picks_the_block_with_the_most_terms() {
    let blocks = [block(1, "alpha only"), block(2, "alpha and beta together")];
    let snippet = best(&blocks, &[term(&["alpha"], false), term(&["beta"], false)]).unwrap();
    assert_eq!(snippet.block, blocks[1].id);
}

#[test]
fn cuts_long_text_around_the_first_match() {
    let filler = (0..60).map(|n| format!("word{n}")).collect::<Vec<_>>().join(" ");
    let text = format!("{filler} needle {filler}");
    let snippet = best(&[block(1, &text)], &[term(&["needle"], false)]).unwrap();
    assert!(snippet.text.starts_with('\u{2026}') && snippet.text.ends_with('\u{2026}'));
    assert_eq!(marked(&snippet), ["needle"]);
    assert!(snippet.text.split_whitespace().count() <= WORDS_TOTAL + 1);
}

#[test]
fn without_a_match_the_snippet_is_the_start_of_the_text() {
    let snippet = best(
        &[block(1, "  "), block(2, "first words here")],
        &[term(&["absent"], false)],
    )
    .unwrap();
    assert_eq!(snippet.text, "first words here");
    assert!(snippet.highlights.is_empty());
    assert!(best(&[], &[]).is_none());
}

#[test]
fn line_breaks_become_spaces_without_moving_highlights() {
    let snippet = best(&[block(1, "one\ntwo\nthree")], &[term(&["three"], false)]).unwrap();
    assert_eq!(snippet.text, "one two three");
    assert_eq!(marked(&snippet), ["three"]);
}

#[test]
fn highlights_titles() {
    let ranges = highlights("Cell Division notes", &[term(&["divis"], true)]);
    assert_eq!((ranges.len(), ranges[0].clone()), (1, 5..13));
}
