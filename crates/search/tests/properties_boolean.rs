//! Property tests: boolean and regular expression searches agree with a plain model of the pages, after any
//! sequence of index operations.

mod common;

use std::collections::BTreeSet;

use common::spec::{apply_index, apply_model, config, op, pages_of, Model, Spec, VOCAB};
use opennote_search::{Query, SearchIndex};
use proptest::prelude::*;

/// A search expression in which every group has a word to find, so its meaning is plain logic.
#[derive(Clone, Debug)]
enum Expr {
    Word(usize),
    /// Every first part, and none of the second.
    And(Vec<Expr>, Vec<Expr>),
    Or(Vec<Expr>),
}

fn expr() -> impl Strategy<Value = Expr> {
    let leaf = (0..VOCAB.len()).prop_map(Expr::Word);
    leaf.prop_recursive(3, 12, 3, |inner| {
        prop_oneof![
            (
                prop::collection::vec(inner.clone(), 1..3),
                prop::collection::vec(inner.clone(), 0..3)
            )
                .prop_map(|(wanted, left_out)| Expr::And(wanted, left_out)),
            prop::collection::vec(inner, 2..4).prop_map(Expr::Or),
        ]
    })
}

/// The text a person would type. `minus` picks between `-` and `NOT` for the words left out.
fn render(expr: &Expr, minus: bool) -> String {
    match expr {
        Expr::Word(i) => VOCAB[*i].to_string(),
        Expr::Or(parts) => {
            let parts: Vec<String> = parts.iter().map(|part| render(part, minus)).collect();
            format!("({})", parts.join(" OR "))
        }
        Expr::And(wanted, left_out) => {
            let mut parts: Vec<String> = wanted.iter().map(|part| render(part, minus)).collect();
            for part in left_out {
                let inner = render(part, minus);
                parts.push(if minus {
                    format!("-({inner})")
                } else {
                    format!("NOT ({inner})")
                });
            }
            format!("({})", parts.join(" "))
        }
    }
}

fn holds(expr: &Expr, spec: &Spec) -> bool {
    match expr {
        Expr::Word(i) => spec.words().contains(VOCAB[*i]),
        Expr::Or(parts) => parts.iter().any(|part| holds(part, spec)),
        Expr::And(wanted, left_out) => {
            wanted.iter().all(|part| holds(part, spec)) && !left_out.iter().any(|part| holds(part, spec))
        }
    }
}

fn built(ops: &[common::spec::Op]) -> (SearchIndex, Model) {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let mut model = Model::new();
    for op in ops {
        apply_model(&mut model, op);
        apply_index(&mut index, op);
    }
    (index, model)
}

fn found(index: &SearchIndex, query: Query) -> BTreeSet<u64> {
    pages_of(&index.search(&Query { limit: 500, ..query }).unwrap())
}

proptest! {
    #![proptest_config(config())]

    #[test]
    fn a_boolean_search_finds_the_pages_that_satisfy_the_expression(
        ops in prop::collection::vec(op(), 1..20),
        expr in expr(),
        minus in any::<bool>(),
    ) {
        let (index, model) = built(&ops);
        let text = format!("{} ", render(&expr, minus));
        let wanted: BTreeSet<u64> = model
            .iter()
            .filter(|(_, spec)| holds(&expr, spec))
            .map(|(n, _)| *n)
            .collect();
        prop_assert_eq!(found(&index, Query::boolean(&text)), wanted, "text {}", text);
    }

    #[test]
    fn a_text_that_only_leaves_words_out_finds_every_other_page(
        ops in prop::collection::vec(op(), 1..20),
        left_out in prop::collection::vec(0..VOCAB.len(), 1..4),
    ) {
        let (index, model) = built(&ops);
        let text: String = left_out.iter().map(|i| format!("-{} ", VOCAB[*i])).collect();
        let wanted: BTreeSet<u64> = model
            .iter()
            .filter(|(_, spec)| left_out.iter().all(|i| !spec.words().contains(VOCAB[*i])))
            .map(|(n, _)| *n)
            .collect();
        prop_assert_eq!(found(&index, Query::boolean(&text)), wanted, "text {}", text);
    }

    #[test]
    fn a_pattern_for_a_whole_word_agrees_with_the_word_search(
        ops in prop::collection::vec(op(), 1..20),
        word in 0..VOCAB.len(),
    ) {
        let (index, model) = built(&ops);
        let wanted: BTreeSet<u64> = model
            .iter()
            .filter(|(_, spec)| spec.words().contains(VOCAB[word]))
            .map(|(n, _)| *n)
            .collect();
        let pattern = format!("\\b{}\\b", VOCAB[word]);
        prop_assert_eq!(found(&index, Query::regex(pattern)), wanted);
    }

    #[test]
    fn any_text_reads_as_a_boolean_search_without_failing(text in ".{0,40}") {
        let index = SearchIndex::open_in_memory().unwrap();
        prop_assert!(index.search(&Query::boolean(&text)).is_ok());
    }
}
