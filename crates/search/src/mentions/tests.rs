use opennote_core::Id;

use super::*;
use crate::links;

fn target() -> PageId {
    PageId::from(Id::from_parts(1_001, 1))
}

fn texts(markdown: &str, title: &str) -> Vec<String> {
    find_mentions(markdown, title).into_iter().map(|m| m.text).collect()
}

#[test]
fn finds_whole_words_ignoring_case_accents_and_spacing() {
    let markdown = "We read \u{c9}cole  Normale today. ecole normale again, but not ecole normales or the ecoles.";
    assert_eq!(
        texts(markdown, "Ecole Normale"),
        ["\u{c9}cole  Normale", "ecole normale"]
    );
    assert!(texts("Leafy anatomy", "Leaf anatomy").is_empty());
    assert!(
        texts("Leaf\nanatomy", "Leaf anatomy").is_empty(),
        "a mention stays on one line"
    );
}

#[test]
fn the_punctuation_between_words_must_match_the_title() {
    assert_eq!(texts("Use C++ notes now", "C++ notes"), ["C++ notes"]);
    assert!(texts("Use C notes now", "C++ notes").is_empty());
    assert_eq!(texts("Don't panic!", "Don't panic"), ["Don't panic"]);
    assert!(texts("Dont panic", "Don't panic").is_empty());
}

#[test]
fn titles_with_too_few_letters_have_no_mentions() {
    assert!(texts("go go go", "Go").is_empty());
    assert!(texts("it is", "It").is_empty());
    assert_eq!(texts("the cat sat", "Cat"), ["cat"]);
    assert!(texts("anything", "").is_empty());
    assert!(texts("anything", "!!!").is_empty());
}

#[test]
fn text_that_is_not_prose_is_skipped() {
    let skipped = [
        "`leaf anatomy` in code",
        "```\nleaf anatomy\n```",
        "an existing [[Leaf anatomy]] link",
        r"an escaped \[\[Leaf anatomy\]\] link",
        "[leaf anatomy](https://example.com/a)",
        "[see](https://example.com/leaf anatomy)",
        "[leaf anatomy][ref]",
        "an ID link [leaf anatomy](opennote:page/00000000000000000000000000)",
        "![leaf anatomy](picture.png)",
        "<https://example.com/leaf anatomy>",
        "<span title=\"leaf anatomy\">x</span>",
        "https://example.com/leaf-anatomy and www.example.com/leaf anatomy",
        "$leaf anatomy$ in math",
        "#leaf anatomy as a tag",
    ];
    for markdown in skipped {
        assert!(texts(markdown, "Leaf anatomy").is_empty(), "{markdown}");
    }
}

#[test]
fn a_mention_near_a_link_is_still_found() {
    let markdown = "Leaf anatomy, then [[Leaf anatomy]], then `code`, then leaf anatomy.";
    let found = find_mentions(markdown, "Leaf anatomy");
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].range, 0..12);
    assert_eq!(found[1].after, ".");
}

#[test]
fn mentions_inside_emphasis_headings_lists_and_tables_are_found() {
    for markdown in [
        "**Leaf anatomy** matters",
        "# Leaf anatomy",
        "- [ ] review leaf anatomy",
        "| topic | note |\n| --- | --- |\n| leaf anatomy | x |",
        "> a quote about leaf anatomy",
    ] {
        assert_eq!(texts(markdown, "leaf anatomy").len(), 1, "{markdown}");
    }
}

#[test]
fn the_preview_shows_a_little_context() {
    let long = format!("{}leaf anatomy{}", "word ".repeat(30), " more".repeat(30));
    let found = find_mentions(&long, "Leaf anatomy");
    assert_eq!(found.len(), 1);
    assert!(found[0].before.starts_with('\u{2026}') && found[0].before.ends_with("word "));
    assert!(found[0].after.ends_with('\u{2026}') && found[0].after.starts_with(" more"));
    assert!(found[0].before.chars().count() <= 42 && found[0].after.chars().count() <= 42);
    let short = find_mentions("a leaf anatomy b", "leaf anatomy");
    assert_eq!((short[0].before.as_str(), short[0].after.as_str()), ("a ", " b"));
}

#[test]
fn linking_keeps_the_words_as_typed_and_makes_an_id_link() {
    let markdown = "Read Leaf  Anatomy and leaf anatomy.";
    let done = link_mentions(markdown, "Leaf anatomy", target(), None).unwrap();
    assert_eq!(
        done.markdown,
        format!(
            "Read {} and {}.",
            id_link("Leaf  Anatomy", target()),
            id_link("leaf anatomy", target())
        )
    );
    assert_eq!(done.linked.len(), 2);
    let parsed = links::parse(&done.markdown);
    assert_eq!(parsed.len(), 2);
    assert!(parsed.iter().all(|link| link.target == Some(target())));
    assert!(
        find_mentions(&done.markdown, "Leaf anatomy").is_empty(),
        "nothing is left to link"
    );
}

#[test]
fn linking_one_mention_leaves_the_others() {
    let markdown = "one leaf anatomy, two leaf anatomy, three leaf anatomy";
    let done = link_mentions(markdown, "Leaf anatomy", target(), Some(&[1])).unwrap();
    assert_eq!(find_mentions(&done.markdown, "Leaf anatomy").len(), 2);
    assert_eq!(done.linked.len(), 1);
    assert_eq!(done.linked[0].range, 22..34);
    assert!(link_mentions(markdown, "Leaf anatomy", target(), Some(&[7])).is_none());
    assert!(link_mentions("no mention here", "Leaf anatomy", target(), None).is_none());
}

#[test]
fn text_that_would_break_a_link_is_not_a_mention() {
    assert!(texts("see a[b] c[d]", "a[b] c[d]").is_empty());
}
