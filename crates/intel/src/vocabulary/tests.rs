use super::matcher::within;
use super::*;

const LIST: &str = "# Biology 101\nATP\nCalvin cycle | calvin psyche, kelvin cycle\nPriya Raghunathan\nchloroplast\n";

fn fixed(text: &str) -> String {
    Vocabulary::parse(LIST).correct(text).text
}

#[test]
fn the_plain_text_form_round_trips_and_skips_comments() {
    let list = Vocabulary::parse(LIST);
    assert_eq!(list.entries().len(), 4);
    assert_eq!(list.entries()[1].heard_as, ["calvin psyche", "kelvin cycle"]);
    let again = Vocabulary::parse(&list.to_text());
    assert_eq!(again, list);
    assert!(!list.to_text().contains('#'));
}

#[test]
fn terms_are_added_merged_removed_and_limited() {
    let mut list = Vocabulary::default();
    assert!(list.add("  Mitochondria ", None));
    assert!(!list.add("mitochondria", None), "a repeated term changes nothing");
    assert!(
        list.add("mitochondria", Some("my to condria")),
        "but gains the mishearing"
    );
    assert_eq!(list.entries().len(), 1);
    assert_eq!(list.entries()[0].term, "Mitochondria");
    assert!(!list.add("", None) && !list.add("!!!", None));
    assert!(!list.add(&"x".repeat(MAX_TERM_CHARS + 1), None));
    assert!(list.contains("MITOCHONDRIA") && list.remove("mitochondria") && !list.remove("mitochondria"));
}

#[test]
fn the_prompt_lists_terms_within_the_limit() {
    let list = Vocabulary::parse(LIST);
    assert_eq!(list.prompt(1000), "ATP, Calvin cycle, Priya Raghunathan, chloroplast");
    assert_eq!(list.prompt(20), "ATP, Calvin cycle");
    assert_eq!(list.prompt(2), "");
}

#[test]
fn listed_mishearings_and_case_are_corrected() {
    assert_eq!(
        fixed("In the calvin psyche, the atp is spent."),
        "In the Calvin cycle, the ATP is spent."
    );
    assert_eq!(fixed("Then Kelvin-cycle reactions."), "Then Calvin cycle reactions.");
    assert_eq!(fixed("Ask priya raghunathan."), "Ask Priya Raghunathan.");
}

#[test]
fn near_misses_of_single_words_are_corrected_and_other_words_are_not() {
    assert_eq!(
        fixed("The chloroplasts and a chlorplast."),
        "The chloroplasts and a chloroplast."
    );
    assert_eq!(fixed("A chloroplast sat there."), "A chloroplast sat there.");
    assert_eq!(
        fixed("Chlorplast first."),
        "Chloroplast first.",
        "a capital at the start of a sentence stays"
    );
    // Too short, a different first letter, or a phrase: left alone.
    assert_eq!(fixed("ATM, the cycle, and plasts."), "ATM, the cycle, and plasts.");
    let common = Vocabulary::parse("there\nwhere\nthree");
    assert_eq!(common.correct("There, where, three.").text, "There, where, three.");
}

#[test]
fn changes_report_what_was_replaced_and_where_in_utf16_units() {
    let result = Vocabulary::parse(LIST).correct("\u{1F600} the atp");
    assert_eq!(result.text, "\u{1F600} the ATP");
    let change = Change {
        from: "atp".into(),
        to: "ATP".into(),
        span: Span { start: 7, end: 10 },
    };
    assert_eq!(result.changes, [change]);
    assert!(Vocabulary::parse(LIST)
        .correct("Nothing to fix here.")
        .changes
        .is_empty());
}

#[test]
fn a_whole_transcript_is_corrected_segment_by_segment() {
    let segment = Segment {
        start_ms: 0,
        end_ms: 1000,
        text: " The atp again".into(),
    };
    let transcript = Transcript {
        language: None,
        device: crate::transcribe::Device::Cpu,
        segments: vec![segment],
    };
    let fixed = Vocabulary::parse(LIST).correct_transcript(&transcript);
    assert_eq!(fixed.segments[0].text, " The ATP again");
    assert_eq!((fixed.segments[0].start_ms, fixed.segments[0].end_ms), (0, 1000));
}

#[test]
fn a_fixed_word_is_offered_unless_the_list_has_it_or_it_is_common() {
    let list = Vocabulary::parse(LIST);
    let offer = list
        .offer("raghunathan", "Raghunathan")
        .expect("a name is worth offering");
    assert_eq!(
        (offer.term.as_str(), offer.heard_as.as_str()),
        ("Raghunathan", "raghunathan")
    );
    assert!(list.offer("adp", "ADP").is_some(), "an acronym is");
    assert!(list.offer("calvin psyche", "Calvin cycle").is_none(), "already listed");
    assert!(list.offer("then", "than").is_none(), "a common word");
    assert!(
        list.offer("fiber", "Fiber").is_none(),
        "only the case of a short ordinary word"
    );
    assert!(list.offer("x", "y").is_none());
}

#[test]
fn edit_distance_allows_one_change_insert_or_delete() {
    assert!(within("plant", "plants", 1) && within("plant", "plent", 1) && within("plant", "pant", 1));
    assert!(!within("plant", "plans!", 1) && !within("plant", "plantings", 1));
    assert!(within("abcdefghij", "abcdefghxx", 2));
}

proptest::proptest! {
    #[test]
    fn any_text_corrects_without_panicking_and_reports_true_spans(text in r"\PC{0,200}") {
        let result = Vocabulary::parse(LIST).correct(&text);
        let units: Vec<u16> = text.encode_utf16().collect();
        for change in &result.changes {
            proptest::prop_assert!(change.span.end <= units.len());
            let original = String::from_utf16(&units[change.span.start..change.span.end]).unwrap();
            proptest::prop_assert_eq!(original, change.from.clone());
        }
    }
}
