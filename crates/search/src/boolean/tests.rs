use super::*;

fn expression(text: &str) -> Option<String> {
    parse(text, &[]).map(|parsed| parsed.expression)
}

#[test]
fn plain_words_are_all_required_like_a_simple_query() {
    assert_eq!(expression("phys lab ").as_deref(), Some("(\"phys\" AND \"lab\")"));
    assert_eq!(expression("phys lab").as_deref(), Some("(\"phys\" AND \"lab\" *)"));
    assert_eq!(expression("\"light react").as_deref(), Some("\"light react\" *"));
}

#[test]
fn or_joins_alternatives_and_binds_looser_than_and() {
    assert_eq!(expression("a b OR c ").as_deref(), Some("((\"a\" AND \"b\") OR \"c\")"));
    assert_eq!(
        expression("a AND b OR c d ").as_deref(),
        Some("((\"a\" AND \"b\") OR (\"c\" AND \"d\"))")
    );
    assert_eq!(expression("a or b ").as_deref(), Some("(\"a\" AND \"or\" AND \"b\")"));
}

#[test]
fn not_and_a_minus_sign_leave_words_out() {
    let expected = Some("(\"a\" NOT \"b\")");
    assert_eq!(expression("a NOT b ").as_deref(), expected);
    assert_eq!(expression("a -b ").as_deref(), expected);
    assert_eq!(
        expression("a -b -\"c d\" ").as_deref(),
        Some("(\"a\" NOT (\"b\" OR \"c d\"))")
    );
    assert_eq!(
        expression("a NOT (b OR c) ").as_deref(),
        Some("(\"a\" NOT (\"b\" OR \"c\"))")
    );
    assert_eq!(
        expression("a - b ").as_deref(),
        Some("(\"a\" AND \"b\")"),
        "a lone dash is nothing"
    );
    assert_eq!(expression("well-known ").as_deref(), Some("\"well known\""));
}

#[test]
fn a_text_that_only_leaves_words_out_has_nothing_to_find() {
    let parsed = parse("-draft -old ", &[]).unwrap();
    assert_eq!(parsed.expression, "");
    assert_eq!(parsed.exclude.as_deref(), Some("(\"draft\" OR \"old\")"));
    assert!(parsed.terms.is_empty());
    assert!(parse("NOT a", &[]).unwrap().exclude.is_some());
}

#[test]
fn a_word_that_is_left_out_is_never_a_prefix() {
    let parsed = parse("a -dra", &[]).unwrap();
    assert_eq!(parsed.expression, "(\"a\" NOT \"dra\")");
    assert!(parse("a dra", &[]).unwrap().terms[1].prefix);
}

#[test]
fn a_double_negative_is_a_positive() {
    assert_eq!(expression("NOT NOT a ").as_deref(), Some("\"a\""));
}

#[test]
fn brackets_group_and_half_written_text_still_works() {
    assert_eq!(
        expression("(a OR b) c ").as_deref(),
        Some("((\"a\" OR \"b\") AND \"c\")")
    );
    assert_eq!(expression("(a OR b").as_deref(), Some("(\"a\" OR \"b\" *)"));
    assert_eq!(expression("a OR ").as_deref(), Some("\"a\""));
    assert_eq!(expression("OR AND a ) b ").as_deref(), Some("(\"a\" AND \"b\")"));
    assert_eq!(expression("()"), None);
    assert_eq!(expression("NOT"), None);
    assert_eq!(expression("   "), None);
    assert_eq!(expression("\" - * ( \""), None);
}

#[test]
fn title_limits_the_words_after_it() {
    assert_eq!(
        expression("title:photo x ").as_deref(),
        Some("(title : (\"photo\") AND \"x\")")
    );
    assert_eq!(
        expression("TITLE:\"cell div\" ").as_deref(),
        Some("title : (\"cell div\")")
    );
    assert_eq!(
        expression("title:(a OR b) ").as_deref(),
        Some("(title : (\"a\") OR title : (\"b\"))")
    );
    assert_eq!(expression("title: x ").as_deref(), Some("\"x\""));
}

#[test]
fn columns_limit_each_word_but_not_a_title_word() {
    let parsed = parse("a OR b ", &["text", "tables"]).unwrap();
    assert_eq!(
        parsed.expression,
        "({text tables} : (\"a\") OR {text tables} : (\"b\"))"
    );
    let parsed = parse("a title:b -c ", &["text"]).unwrap();
    assert_eq!(
        parsed.expression,
        "(({text} : (\"a\") AND title : (\"b\")) NOT {text} : (\"c\"))"
    );
}

/// Runs `work` on a thread with a small stack, the way a crafted query would meet a busy thread.
fn on_small_stack<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(256 << 10)
        .spawn(work)
        .unwrap()
        .join()
        .unwrap()
}

#[test]
fn deep_brackets_and_long_runs_of_not_cannot_exhaust_the_stack() {
    let found = on_small_stack(|| {
        let brackets = expression(&format!("{}a", "(".repeat(900)));
        let nots = expression(&format!("{}a b", "NOT ".repeat(14_000)));
        (brackets, nots)
    });
    assert_eq!(found.0.as_deref(), Some("\"a\" *"));
    assert_eq!(found.1, None, "the words past the length limit are left out");
    assert_eq!(
        expression(&format!("{}a{}", "(".repeat(40), ")".repeat(40))).as_deref(),
        Some("\"a\""),
        "brackets past the limit are dropped and the words still search"
    );
}

#[test]
fn a_long_text_is_cut_to_the_word_and_length_limits() {
    let pasted = "word ".repeat(5_000);
    let parsed = parse(&pasted, &[]).unwrap();
    assert_eq!(parsed.terms.len(), MAX_QUERY_TERMS);
    let simple = crate::query::parse_simple(&pasted, &[]).unwrap();
    assert_eq!(simple.terms.len(), MAX_QUERY_TERMS);
    let long_word = "x".repeat(5_000);
    let parsed = parse(&long_word, &[]).unwrap();
    assert_eq!(parsed.terms[0].words[0].len(), crate::query::MAX_QUERY_CHARS);
}
