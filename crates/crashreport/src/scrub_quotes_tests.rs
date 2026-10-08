use crate::scrub::Scrubber;

/// A scrubber that knows a made-up person and computer.
fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber.add_private("Taxes 2025");
    scrubber
}

/// Asserts that none of `leaks` survives scrubbing `input`, in any letter case.
fn assert_gone(input: &str, leaks: &[&str]) {
    let output = scrubber().text(input);
    for leak in leaks {
        assert!(
            !output.to_lowercase().contains(&leak.to_lowercase()),
            "{leak:?} survived in {output:?} (from {input:?})"
        );
    }
}

#[test]
fn removes_quoted_note_text() {
    let out = scrubber().text(r#"called `Result::unwrap()` on an `Err` value: Parse("my diary: I miss her")"#);
    assert_eq!(out, "called `Result::unwrap()` on an `Err` value: Parse(\"<text>\")");
    assert_gone(
        r#"text: "she said \"hello\" and left", id: 4"#,
        &["she said", "hello", "left"],
    );
    assert_gone(r#"never closed: "the start of a secret"#, &["secret", "start of"]);
}

#[test]
fn removes_text_in_every_common_quote_mark() {
    assert_gone("could not save “Holiday Plans” today", &["holiday", "plans"]);
    assert_gone("could not save „Holiday Plans“ today", &["holiday", "plans"]);
    assert_gone("could not save ‘Holiday Plans’ today", &["holiday", "plans"]);
    assert_gone("could not save «Holiday Plans» today", &["holiday", "plans"]);
    assert_gone("could not save 'Holiday Plans' today", &["holiday", "plans"]);
    assert_gone("could not save 'Holiday Plans", &["holiday", "plans"]);
    assert_eq!(
        scrubber().text("could not save 'Holiday Plans' today"),
        "could not save \"<text>\" today"
    );
}

#[test]
fn removes_text_in_backticks_and_in_marks_written_either_way() {
    let cases: [(&str, &[&str]); 9] = [
        (
            "no such page `Holiday plans` in section `Taxes 2026`",
            &["holiday", "plans", "2026"],
        ),
        ("unknown variant `Holiday`, expected `Draft`", &["holiday"]),
        ("Seite »Geheime Plaene« nicht gefunden", &["geheime", "plaene"]),
        ("Seite ‚Geheime Plaene‘ fehlt", &["geheime", "plaene"]),
        ("sidan ”Hemliga planer” saknas", &["hemliga", "planer"]),
        ("sidan ’Hemliga planer’ saknas", &["hemliga", "planer"]),
        ("page ›Secret plans‹ is gone", &["secret", "plans"]),
        ("ページ「秘密の計画」がありません", &["秘密", "計画"]),
        ("ページ『秘密の計画』がありません", &["秘密", "計画"]),
    ];
    for (input, leaks) in cases {
        assert_gone(input, leaks);
    }
    assert_eq!(
        scrubber().text("Seite »Geheime Plaene« nicht gefunden"),
        "Seite \"<text>\" nicht gefunden"
    );
    assert_eq!(scrubber().text("it’s the users’ list"), "it’s the users’ list");
}

#[test]
fn a_stray_mark_cannot_swap_what_is_inside_and_outside() {
    assert_eq!(
        scrubber().text(r#"renamed page "15" MacBook review" to "Laptop""#),
        "renamed page \"<text>\""
    );
    // The text between two quotes goes too, because a stray mark may have swapped it.
    assert_eq!(
        scrubber().text("copied 'Plans' to 'Holiday' today"),
        "copied \"<text>\" today"
    );
    assert_gone("moved «A» b «Holiday» c» d", &["holiday"]);
}

#[test]
fn an_apostrophe_is_not_a_quote() {
    for message in [
        "can't open the notebook's folder",
        "the users' list is empty",
        "it's 5 o'clock",
    ] {
        assert_eq!(scrubber().text(message), message);
    }
    // A quote that holds an apostrophe still closes at the real end.
    assert_eq!(
        scrubber().text("could not save 'Mum's plans' now"),
        "could not save \"<text>\" now"
    );
}
