use super::*;
use crate::query::parse_simple;

fn terms(text: &str) -> Vec<Term> {
    parse_simple(text, &[]).unwrap().terms
}

fn signals() -> Signals {
    Signals {
        bm25: 0.0,
        title: 0.0,
        heading: 0.0,
        age_ms: 0,
        same_notebook: false,
        same_section: false,
    }
}

fn total(signals: Signals) -> f64 {
    score(&signals, &RankWeights::default()).total
}

#[test]
fn a_title_that_is_the_query_beats_one_that_starts_with_it_beats_one_that_holds_it() {
    let query = terms("light reactions ");
    let exact = title_score("Light reactions", &query);
    let starts = title_score("Light reactions of photosynthesis", &query);
    let holds = title_score("Notes on the light reactions", &query);
    let one_word = title_score("Light", &query);
    assert_eq!(exact, 1.0);
    assert_eq!(starts, 0.9);
    assert_eq!(holds, 0.75, "both words are in the title, in any place");
    assert!(exact > starts && starts > holds);
    assert!(one_word < holds, "half the terms is less than all of them");
}

#[test]
fn a_prefix_counts_less_than_a_whole_word_and_only_while_typing() {
    let typing = terms("photo");
    let done = terms("photo ");
    assert_eq!(title_score("Photosynthesis", &typing), 0.85);
    assert_eq!(title_score("Photosynthesis", &done), 0.0);
    assert!((title_score("Notes on photosynthesis", &typing) - 0.525).abs() < 1e-12);
    assert_eq!(title_score("Photo", &typing), 1.0);
}

#[test]
fn unrelated_titles_score_nothing() {
    assert_eq!(title_score("Chemistry", &terms("physics")), 0.0);
    assert_eq!(title_score("", &terms("physics")), 0.0);
    assert_eq!(heading_score(["Cells", "Energy"], &terms("physics")), 0.0);
}

#[test]
fn a_phrase_must_match_in_order() {
    let query = terms("\"light reactions\"");
    assert_eq!(title_score("Light reactions", &query), 1.0);
    assert_eq!(title_score("Reactions to light", &query), 0.0);
}

#[test]
fn the_best_heading_counts() {
    let query = terms("energy cycle ");
    assert_eq!(heading_score(["Intro", "The energy cycle"], &query), 1.0);
    assert_eq!(heading_score(["Energy", "Water cycle"], &query), 0.5);
    assert_eq!(heading_score(Vec::<&str>::new(), &query), 0.0);
}

#[test]
fn accents_and_case_do_not_matter() {
    assert_eq!(title_score("\u{c9}COLE Normale", &terms("ecole normale")), 1.0);
}

#[test]
fn recency_halves_every_half_life() {
    let day = 86_400_000;
    assert_eq!(recency(0, 30.0), 1.0);
    assert_eq!(recency(-5 * day, 30.0), 1.0);
    assert!((recency(30 * day, 30.0) - 0.5).abs() < 1e-12);
    assert!((recency(60 * day, 30.0) - 0.25).abs() < 1e-12);
    assert_eq!(recency(10 * day, 0.0), 1.0);
}

#[test]
fn signals_add_up_in_the_order_title_heading_body() {
    let body_only = total(Signals { bm25: 3.0, ..signals() });
    let heading = total(Signals {
        bm25: 3.0,
        heading: 1.0,
        ..signals()
    });
    let title = total(Signals {
        bm25: 3.0,
        title: 1.0,
        ..signals()
    });
    assert!(body_only < heading && heading < title);
}

#[test]
fn the_body_signal_saturates() {
    let body = |bm25| score(&Signals { bm25, ..signals() }, &RankWeights::default()).body;
    let (weak, strong, huge) = (body(0.5), body(50.0), body(5_000.0));
    assert!(weak < strong && strong < huge);
    assert!(huge < RankWeights::default().body);
}

#[test]
fn age_breaks_a_tie_but_does_not_beat_a_much_better_match() {
    let day = 86_400_000;
    let fresh = total(Signals {
        bm25: 4.0,
        age_ms: 0,
        ..signals()
    });
    let old = total(Signals {
        bm25: 4.0,
        age_ms: 400 * day,
        ..signals()
    });
    let better_but_old = total(Signals {
        bm25: 40.0,
        age_ms: 400 * day,
        ..signals()
    });
    assert!(fresh > old);
    assert!(better_but_old > fresh, "{better_but_old} against {fresh}");
}

#[test]
fn scope_boosts_the_section_over_the_notebook_over_the_rest() {
    let base = Signals { bm25: 4.0, ..signals() };
    let elsewhere = total(base);
    let notebook = total(Signals {
        same_notebook: true,
        ..base
    });
    let section = total(Signals {
        same_notebook: true,
        same_section: true,
        ..base
    });
    assert!(elsewhere < notebook && notebook < section);
}

#[test]
fn the_breakdown_sums_to_the_total() {
    let parts = score(
        &Signals {
            bm25: 2.0,
            title: 0.5,
            heading: 1.0,
            age_ms: 86_400_000,
            same_notebook: true,
            same_section: false,
        },
        &RankWeights::default(),
    );
    let sum = parts.body + parts.title + parts.heading + parts.recency + parts.scope;
    assert!((sum - parts.total).abs() < 1e-12);
}

#[test]
fn weights_round_trip_and_accept_partial_files() {
    let weights = RankWeights {
        recency: 0.0,
        ..RankWeights::default()
    };
    let json = serde_json::to_string(&weights).unwrap();
    assert_eq!(serde_json::from_str::<RankWeights>(&json).unwrap(), weights);
    let partial: RankWeights = serde_json::from_str("{\"recency\":0.5}").unwrap();
    assert_eq!(partial.recency, 0.5);
    assert_eq!(partial.title, RankWeights::default().title);
}
