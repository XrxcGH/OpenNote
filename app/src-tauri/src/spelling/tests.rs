use super::*;

fn err(start: u32, length: u32) -> SpellError {
    SpellError { start, length }
}

fn rules(words: &[&str]) -> Rules {
    Rules::new(&Spelling {
        personal_words: words.iter().map(|word| (*word).to_owned()).collect(),
        ..Spelling::default()
    })
}

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[test]
fn an_error_needs_every_language_to_flag_it() {
    let english = vec![err(0, 5), err(10, 4)];
    let german = vec![err(10, 4), err(20, 3)];
    assert_eq!(common_errors(&[english.clone(), german]), vec![err(10, 4)]);
    assert_eq!(common_errors(std::slice::from_ref(&english)), english);
    assert!(common_errors(&[]).is_empty());
}

#[test]
fn personal_words_match_by_case_as_the_architecture_says() {
    let rules = rules(&["opennote", "McCoy"]);
    assert!(rules.skips("OpenNote"));
    assert!(rules.skips("opennote"));
    assert!(rules.skips("McCoy"));
    assert!(!rules.skips("mccoy"));
    assert!(!rules.skips("teh"));
}

#[test]
fn capitals_and_digits_are_skipped_only_when_the_settings_say_so() {
    let on = rules(&[]);
    assert!(on.skips("NASA"));
    assert!(on.skips("abc123"));
    assert!(!on.skips("Teh"));
    let off = Rules::new(&Spelling {
        ignore_uppercase: false,
        ignore_with_digits: false,
        ..Spelling::default()
    });
    assert!(!off.skips("NASA"));
    assert!(!off.skips("abc123"));
}

#[test]
fn filtering_reads_words_in_utf16_units() {
    let text = "😀 teh NASA";
    let found = vec![err(3, 3), err(7, 4)];
    assert_eq!(word_at(&units(text), err(3, 3)), "teh");
    assert_eq!(rules(&[]).filter(&units(text), found), vec![err(3, 3)]);
}

#[test]
fn suggestions_alternate_languages_without_repeats() {
    let merged = merge_suggestions(
        vec![
            vec!["the".into(), "tea".into(), "ten".into()],
            vec!["the".into(), "teh".into()],
        ],
        4,
    );
    assert_eq!(merged, ["the", "tea", "teh", "ten"]);
}

#[test]
fn a_check_over_the_limits_is_refused() {
    let item = |text: &str| SpellItem {
        id: "a".into(),
        text: text.into(),
    };
    assert!(check_limits(&vec![item("x"); MAX_ITEMS]).is_ok());
    assert!(check_limits(&vec![item("x"); MAX_ITEMS + 1]).is_err());
    assert!(check_limits(&[item(&"x".repeat(MAX_BYTES + 1))]).is_err());
}

#[test]
fn personal_words_are_added_once_and_removed() {
    let words = vec!["alpha".to_owned()];
    assert_eq!(
        edit_personal_words(&words, "beta", true).unwrap(),
        Some(vec!["alpha".to_owned(), "beta".to_owned()])
    );
    assert_eq!(edit_personal_words(&words, "alpha", true).unwrap(), None);
    assert_eq!(edit_personal_words(&words, "alpha", false).unwrap(), Some(vec![]));
    assert_eq!(edit_personal_words(&words, "gamma", false).unwrap(), None);
    assert!(edit_personal_words(&words, "two words", true).is_err());
    assert!(edit_personal_words(&words, "", true).is_err());
}

/// The Windows checker with en-US. Machines without the language skip rather than fail.
#[test]
fn windows_flags_misspellings_in_english() {
    let svc = SpellService;
    let languages = svc.languages().unwrap_or_default();
    if !languages
        .iter()
        .any(|language| language.tag.eq_ignore_ascii_case("en-US"))
    {
        eprintln!("skipped: no en-US spell checker on this machine");
        return;
    }
    let english = vec!["en-US".to_owned()];
    let text = "I recieve teh 😀 letters from NASA and abc123.";
    let items = vec![SpellItem {
        id: "p1".into(),
        text: text.into(),
    }];
    let results = svc.check(items, english.clone(), &rules(&[])).expect("check");
    let words: Vec<String> = results[0]
        .errors
        .iter()
        .map(|error| word_at(&units(text), *error))
        .collect();
    assert_eq!(words, ["recieve", "teh"]);

    let personal = svc
        .check(
            vec![SpellItem {
                id: "p2".into(),
                text: "teh recieve".into(),
            }],
            english.clone(),
            &rules(&["teh"]),
        )
        .expect("check");
    assert_eq!(personal[0].errors, vec![err(4, 7)]);

    let suggestions = svc.suggest("recieve", &english).expect("suggest");
    assert!(suggestions.len() <= MAX_SUGGESTIONS);
    assert!(suggestions.iter().any(|word| word == "receive"), "{suggestions:?}");
    assert!(svc.suggest("receive", &english).expect("suggest").is_empty());
}
