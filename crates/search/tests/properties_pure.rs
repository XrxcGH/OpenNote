//! Property tests for the pure modules: fuzzy matching, ranking, linking mentions, and rewriting links.

mod common;

use common::page_id;
use common::spec::config;
use opennote_search::fuzzy::{fuzzy_match, Haystack, MatchKind, Needle};
use opennote_search::links::parse;
use opennote_search::mentions::{find_mentions, link_mentions};
use opennote_search::rank::{score, Signals};
use opennote_search::{RankWeights, Rename};
use proptest::prelude::*;

proptest! {
    #![proptest_config(config())]

    #[test]
    fn fuzzy_matches_have_valid_highlights(
        title in "[A-Za-z0-9 \u{e9}\u{c9}'.+-]{0,40}",
        query in "[A-Za-z0-9 \u{e9}]{0,12}",
    ) {
        highlights_are_valid(&title, &query)?;
    }

    #[test]
    fn a_title_always_matches_itself_and_its_own_prefixes(title in "[a-z]{2,8}( [a-z]{2,8}){0,3}", cut in 1usize..20) {
        let hay = Haystack::new(&title);
        let own = fuzzy_match(&Needle::new(&title).unwrap(), &hay).unwrap();
        prop_assert_eq!(own.kind, MatchKind::Exact);
        let letters: Vec<char> = title.chars().collect();
        let prefix: String = letters.iter().take(cut.min(letters.len())).collect();
        if let Some(needle) = Needle::new(&prefix) {
            let found = fuzzy_match(&needle, &hay).unwrap();
            let kind = found.kind;
            prop_assert!(matches!(kind, MatchKind::Exact | MatchKind::Prefix), "{prefix:?} in {title:?} is {kind:?}");
        }
    }

    #[test]
    fn a_better_signal_never_lowers_the_score(input in signal_input()) {
        better_signals_never_lower_the_score(input)?;
    }

    #[test]
    fn linking_mentions_leaves_none_and_changes_nothing_else(
        before in "[a-z ]{0,20}",
        between in "[a-z ,.]{0,20}",
        after in "[a-z ]{0,20}",
        pad in 0usize..3,
    ) {
        linking_is_clean(&before, &between, &after, pad)?;
    }

    #[test]
    fn a_rewritten_link_reads_back_as_the_new_title(
        title in "[a-zA-Z0-9 #\\[\\]\\\\*_&;`|<>~=$!{}()\u{e9}\u{6f22}]{1,24}",
        spelling in 0usize..5,
    ) {
        rewrite_reads_back(&title, spelling)?;
    }
}

fn rewrite_reads_back(title: &str, spelling: usize) -> Result<(), TestCaseError> {
    let target = page_id(1);
    let old = match spelling {
        0 => "[[Leaf]]".to_string(),
        1 => "[[Leaf#Veins]]".to_string(),
        2 => "\\[\\[Leaf\\]\\]".to_string(),
        3 => "\\[\\[Leaf#Veins\\]\\]".to_string(),
        _ => format!("[Leaf](opennote:page/{target})"),
    };
    let wanted = title.split_whitespace().collect::<Vec<_>>().join(" ");
    prop_assume!(!wanted.is_empty());
    let rename = Rename {
        page: target,
        old_title: "Leaf".into(),
        new_title: title.into(),
    };
    let out = rename.rewrite(&old);
    let found = parse(&out);
    prop_assert_eq!(found.len(), 1, "{:?} became {:?}", title, out);
    prop_assert_eq!(&found[0].raw, &out);
    prop_assert_eq!(&found[0].title, &wanted, "{:?}", out);
    prop_assert_eq!(&found[0].fragment, &parse(&old)[0].fragment, "{:?}", out);
    Ok(())
}

fn highlights_are_valid(title: &str, query: &str) -> Result<(), TestCaseError> {
    let Some(needle) = Needle::new(query) else {
        return Ok(());
    };
    let Some(found) = fuzzy_match(&needle, &Haystack::new(title)) else {
        return Ok(());
    };
    let mut last_end = 0;
    for range in &found.ranges {
        prop_assert!(range.start >= last_end && range.start < range.end && range.end <= title.len());
        prop_assert!(title.is_char_boundary(range.start) && title.is_char_boundary(range.end));
        last_end = range.end;
    }
    prop_assert!(!found.ranges.is_empty());
    prop_assert!(found.score >= found.kind.base_score().saturating_sub(40));
    // Case does not matter.
    let upper = Needle::new(&query.to_uppercase()).unwrap();
    let again = fuzzy_match(&upper, &Haystack::new(title)).unwrap();
    prop_assert_eq!((again.kind, again.score), (found.kind, found.score));
    Ok(())
}

/// The numbers that go into one score.
#[derive(Clone, Debug)]
struct SignalInput {
    bm25: f64,
    title: f64,
    heading: f64,
    age: i64,
    more: f64,
    same_notebook: bool,
    same_section: bool,
}

fn signal_input() -> impl Strategy<Value = SignalInput> {
    (
        0.0f64..50.0,
        0.0f64..1.0,
        0.0f64..1.0,
        0i64..1_000_000_000_000,
        0.0f64..10.0,
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(
            |(bm25, title, heading, age, more, same_notebook, same_section)| SignalInput {
                bm25,
                title,
                heading,
                age,
                more,
                same_notebook,
                same_section,
            },
        )
}

fn better_signals_never_lower_the_score(input: SignalInput) -> Result<(), TestCaseError> {
    let SignalInput {
        bm25,
        title,
        heading,
        age,
        more,
        same_notebook,
        same_section,
    } = input;
    let weights = RankWeights::default();
    let base = Signals {
        bm25,
        title,
        heading,
        age_ms: age,
        same_notebook,
        same_section,
    };
    let total = |signals: Signals| score(&signals, &weights).total;
    let base_total = total(base);
    let with = |change: &dyn Fn(&mut Signals)| {
        let mut changed = base;
        change(&mut changed);
        changed
    };
    let better = [
        with(&|s| s.bm25 = bm25 + more),
        with(&|s| s.title = (title + more).min(1.0)),
        with(&|s| s.heading = (heading + more).min(1.0)),
        with(&|s| s.age_ms = (age - 1_000).max(0)),
        with(&|s| s.same_notebook = true),
        with(&|s| {
            s.same_notebook = true;
            s.same_section = true;
        }),
    ];
    for signals in better {
        let improved = total(signals);
        prop_assert!(improved >= base_total, "{improved} against {base_total}");
    }
    Ok(())
}

fn linking_is_clean(before: &str, between: &str, after: &str, pad: usize) -> Result<(), TestCaseError> {
    let title = "leaf anatomy";
    let spacer = " ".repeat(pad + 1);
    let markdown = format!("{before} Leaf{spacer}Anatomy {between} leaf anatomy {after}");
    let found = find_mentions(&markdown, title);
    let mut last_end = 0;
    for mention in &found {
        prop_assert!(mention.range.start >= last_end && mention.range.end <= markdown.len());
        prop_assert!(markdown.is_char_boundary(mention.range.start));
        prop_assert!(markdown.is_char_boundary(mention.range.end));
        last_end = mention.range.end;
    }
    prop_assert!(found.len() >= 2);
    let target = page_id(1);
    let done = link_mentions(&markdown, title, target, None).unwrap();
    prop_assert!(find_mentions(&done.markdown, title).is_empty());
    // Undoing each link gives the original text back.
    let mut restored = done.markdown.clone();
    for mention in &found {
        let link = format!("[{}](opennote:page/{target})", mention.text);
        restored = restored.replacen(&link, &mention.text, 1);
    }
    prop_assert_eq!(restored, markdown);
    Ok(())
}
