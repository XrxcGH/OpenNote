//! Summaries and keywords on recorded note texts in `tests/fixtures/texts`, plus properties on any text.
//! Runs on every platform: the summarizer is plain Rust.

use opennote_intel::summarize::{
    default_summarizer, find_action_items, make_chapters, ActionKind, ChapterOptions, ExtractiveSummarizer,
    KeywordOptions, Summarizer, Summary, SummaryOptions, MAX_TEXT_BYTES,
};
use opennote_intel::transcribe::{Device, Segment, Transcript};
use opennote_intel::IntelError;
use proptest::prelude::*;

const PHOTOSYNTHESIS: &str = include_str!("fixtures/texts/photosynthesis.txt");
const MEETING: &str = include_str!("fixtures/texts/meeting.txt");
const WRAPPED: &str = include_str!("fixtures/texts/wrapped.txt");
const SPANISH: &str = include_str!("fixtures/texts/spanish.txt");

fn summarize(text: &str, max_sentences: usize) -> Summary {
    let options = SummaryOptions {
        max_sentences,
        ..Default::default()
    };
    ExtractiveSummarizer::new().summarize(text, &options).unwrap()
}

fn keywords(text: &str) -> Vec<String> {
    ExtractiveSummarizer::new()
        .keywords(text, &KeywordOptions::default())
        .unwrap()
        .into_iter()
        .map(|k| k.text)
        .collect()
}

/// The text that a span of UTF-16 units points at.
fn slice(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start..end]).expect("the span holds whole characters")
}

#[test]
fn a_lecture_summary_opens_with_the_definition_and_covers_the_main_terms() {
    let summary = summarize(PHOTOSYNTHESIS, 3);
    assert_eq!(summary.language.as_str(), "en");
    assert_eq!(summary.input_sentences, 19);
    let texts: Vec<&str> = summary.sentences.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(
        texts[0],
        "Photosynthesis is the process plants use to turn light energy into chemical energy."
    );
    assert_eq!(texts.len(), 3);
    assert!(summary.text().contains("carbon dioxide"));
    // The title and the bullet markers are never part of a sentence.
    assert!(!summary.text().contains("Biology 101"));
    assert!(summary.sentences.iter().all(|s| !s.text.starts_with("- ")));
}

#[test]
fn the_keywords_of_a_lecture_are_its_terms() {
    let found = keywords(PHOTOSYNTHESIS);
    for expected in ["photosynthesis", "carbon dioxide", "Calvin cycle"] {
        assert!(
            found.iter().any(|k| k == expected),
            "{expected:?} is missing from {found:?}"
        );
    }
    // A word that is mostly part of a longer chosen phrase is not repeated on its own.
    assert!(!found.iter().any(|k| k == "dioxide"), "{found:?}");
}

#[test]
fn meeting_notes_summary_covers_the_scope_and_the_concern() {
    let summary = summarize(MEETING, 3);
    let text = summary.text();
    assert!(
        text.contains("first release will cover note taking, search, and export"),
        "{text}"
    );
    assert!(text.contains("security review"), "{text}");
    let found = keywords(MEETING);
    assert!(found.iter().any(|k| k == "PDF library"), "{found:?}");
}

#[test]
fn a_hard_wrapped_paragraph_is_read_as_whole_sentences() {
    let summary = summarize(WRAPPED, 9);
    assert_eq!(summary.input_sentences, 9);
    assert_eq!(summary.sentences.len(), 9);
    assert!(summary.sentences.iter().all(|s| !s.text.contains('\n')));
    assert!(summary.sentences[1]
        .text
        .starts_with("Every living thing is made of cells, and the cell is the smallest"));
    // Singular and plural forms count as one term.
    let found = keywords(WRAPPED);
    assert_eq!(found[0], "cell");
    assert!(!found.iter().any(|k| k == "cells"), "{found:?}");
}

#[test]
fn spanish_text_is_detected_and_summarized_with_spanish_stop_words() {
    let summary = summarize(SPANISH, 2);
    assert_eq!(summary.language.as_str(), "es");
    assert!(summary.sentences[0].text.starts_with("La fotosíntesis es el proceso"));
    let found = keywords(SPANISH);
    assert!(found.iter().any(|k| k == "dióxido de carbono"), "{found:?}");
    assert!(!found.iter().any(|k| k == "el" || k == "de" || k == "la"), "{found:?}");
}

#[test]
fn spans_point_at_the_sentences_in_the_original_text() {
    // Emoji and accents make UTF-16 offsets differ from byte offsets.
    let text = "\u{1F600} Início do dia. Café com leite é bom. Café com leite é ótimo para o café da manhã.";
    let summary = summarize(text, 3);
    for sentence in &summary.sentences {
        assert_eq!(slice(text, sentence.span.start, sentence.span.end), sentence.text);
    }
    let spans: Vec<_> = summary.sentences.iter().map(|s| s.span).collect();
    assert!(
        spans.windows(2).all(|w| w[0].end <= w[1].start),
        "in text order, not overlapping"
    );
}

#[test]
fn limits_on_sentences_and_characters_are_kept() {
    let two = summarize(PHOTOSYNTHESIS, 2);
    assert_eq!(two.sentences.len(), 2);
    let options = SummaryOptions {
        max_sentences: 10,
        max_chars: Some(150),
        ..Default::default()
    };
    let short = ExtractiveSummarizer::new().summarize(PHOTOSYNTHESIS, &options).unwrap();
    let chars: usize = short.sentences.iter().map(|s| s.text.chars().count()).sum();
    assert!(!short.sentences.is_empty() && chars <= 150, "{chars}: {short:?}");
    let none = SummaryOptions {
        max_sentences: 0,
        ..Default::default()
    };
    assert!(ExtractiveSummarizer::new()
        .summarize(PHOTOSYNTHESIS, &none)
        .unwrap()
        .sentences
        .is_empty());
}

#[test]
fn a_summary_of_a_short_text_is_the_text() {
    let summary = summarize("One short note about milk.", 3);
    assert_eq!(summary.text(), "One short note about milk.");
    assert_eq!(summary.sentences[0].score, 1.0);
}

#[test]
fn near_duplicate_sentences_are_not_both_chosen_when_something_else_is_available() {
    let text = "The server restarts every night at midnight. The server restarts every night at midnight again. \
                Backups are copied to the archive before dawn. The archive keeps ninety days of backups.";
    let summary = summarize(text, 2);
    let said_restart = summary.sentences.iter().filter(|s| s.text.contains("restarts")).count();
    assert_eq!(said_restart, 1, "{summary:?}");
}

#[test]
fn text_without_words_gives_nothing_and_does_not_fail() {
    let summarizer = default_summarizer();
    for text in ["", "   \n\n", "!!! ??? ...", "12 34 56"] {
        let summary = summarizer.summarize(text, &SummaryOptions::default()).unwrap();
        assert!(summary.sentences.len() <= 1, "{text:?}");
        let found = summarizer.keywords(text, &KeywordOptions::default()).unwrap();
        assert!(found.is_empty(), "{text:?}: {found:?}");
    }
}

#[test]
fn east_asian_text_is_summarized_by_position() {
    let text = "今日は朝から雨が降っていました。午後には雨が止みました。夕方に友達と会いました。";
    let summary = summarize(text, 1);
    assert_eq!(summary.sentences[0].text, "今日は朝から雨が降っていました。");
    assert!(keywords(text).is_empty());
}

#[test]
fn oversized_text_and_bad_options_are_refused() {
    let summarizer = default_summarizer();
    let huge = "a ".repeat(MAX_TEXT_BYTES / 2 + 1);
    assert!(matches!(
        summarizer.summarize(&huge, &SummaryOptions::default()),
        Err(IntelError::InvalidInput(_))
    ));
    for bad in [
        KeywordOptions {
            max_keywords: 0,
            ..Default::default()
        },
        KeywordOptions {
            max_words: 5,
            ..Default::default()
        },
        KeywordOptions {
            max_words: 0,
            ..Default::default()
        },
    ] {
        assert!(summarizer.keywords("some text here", &bad).is_err(), "{bad:?}");
    }
}

#[test]
fn keywords_are_best_first_and_scored_from_zero_to_one() {
    let found = ExtractiveSummarizer::new()
        .keywords(PHOTOSYNTHESIS, &KeywordOptions::default())
        .unwrap();
    assert_eq!(found.len(), 8);
    assert!((found[0].score - 1.0).abs() < f32::EPSILON);
    assert!(found.windows(2).all(|w| w[0].score >= w[1].score));
    assert!(found.iter().all(|k| k.count >= 1 && k.score > 0.0 && k.score <= 1.0));
    let one_word = ExtractiveSummarizer::new()
        .keywords(
            PHOTOSYNTHESIS,
            &KeywordOptions {
                max_words: 1,
                max_keywords: 5,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(one_word.iter().all(|k| !k.text.contains(' ')), "{one_word:?}");
}

/// A transcript with one segment of ten seconds for each non-empty line of the text.
fn transcript_of(text: &str) -> Transcript {
    let segments = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .enumerate()
        .map(|(i, line)| Segment {
            start_ms: i as u64 * 10_000,
            end_ms: i as u64 * 10_000 + 9_000,
            text: line.trim().trim_start_matches("- ").to_owned(),
        })
        .collect();
    Transcript {
        language: None,
        device: Device::Cpu,
        segments,
    }
}

#[test]
fn a_meeting_transcript_gives_its_decisions_and_tasks_with_owners_and_deadlines() {
    let items = find_action_items(&transcript_of(MEETING));
    let shape: Vec<(ActionKind, Option<&str>, Option<&str>)> = items
        .iter()
        .map(|i| (i.kind, i.owner.as_deref(), i.due.as_deref()))
        .collect();
    use ActionKind::{Decision, Task};
    assert_eq!(
        shape,
        [
            (Decision, None, None),
            (Task, Some("Maria"), None),
            (Task, Some("Maria"), Some("by Friday")),
            (Task, Some("Dev"), None),
            (Task, Some("Priya"), None),
            (Task, Some("Chen"), None),
            (Decision, None, None),
        ],
        "{items:#?}"
    );
    assert!(items[0].text.starts_with("We agreed the first release"));
    assert!(items[6].text.starts_with("Decision: the beta will go ahead"));
    assert!(
        items.windows(2).all(|w| w[0].start_ms <= w[1].start_ms),
        "in the order said"
    );
}

#[test]
fn a_lecture_with_a_change_of_subject_is_cut_into_titled_chapters() {
    let lecture = format!(
        "{PHOTOSYNTHESIS}
{PHOTOSYNTHESIS}
{}
{}",
        database_talk(),
        database_talk()
    );
    let mut transcript = transcript_of(&lecture);
    // Give each segment twenty seconds, as speech has.
    for (i, s) in transcript.segments.iter_mut().enumerate() {
        s.start_ms = i as u64 * 20_000;
        s.end_ms = s.start_ms + 19_000;
    }
    let chapters = make_chapters(&transcript, &ChapterOptions::default()).unwrap();
    assert!(chapters.len() >= 2, "{chapters:?}");
    let last = chapters.last().unwrap();
    let said = |words: &[String], any: &[&str]| words.iter().any(|w| any.iter().any(|a| w.to_lowercase().contains(a)));
    assert!(said(&last.keywords, &["database", "index"]), "{:?}", last.keywords);
    let biology = [
        "photosynthesis",
        "carbon dioxide",
        "calvin",
        "glucose",
        "oxygen",
        "chlorophyll",
        "energy",
    ];
    assert!(said(&chapters[0].keywords, &biology), "{:?}", chapters[0].keywords);
    assert!(!chapters[0].title.is_empty() && !said(&chapters[0].keywords, &["database"]));
}

fn database_talk() -> String {
    [
        "A database index speeds up queries on a large table.",
        "The index stores sorted keys, so the database avoids scanning every row of the table.",
        "Writing a row means the database must update each index on that table.",
        "Choose the index columns by the queries that your database runs most often.",
        "A composite index covers several columns, and the database reads the leftmost columns first.",
        "Too many indexes slow down writes, so drop any index that no query uses.",
    ]
    .join(
        "
",
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Whatever the text, the summary is made of its own sentences at valid positions, and nothing panics.
    #[test]
    fn any_text_summarizes_to_its_own_sentences(text in "\\PC{0,400}", n in 0usize..6) {
        let options = SummaryOptions { max_sentences: n, ..Default::default() };
        let summary = ExtractiveSummarizer::new().summarize(&text, &options).unwrap();
        prop_assert!(summary.sentences.len() <= n);
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut last_end = 0;
        for sentence in &summary.sentences {
            prop_assert!(sentence.span.start >= last_end && sentence.span.end <= units.len());
            prop_assert!(sentence.span.start < sentence.span.end);
            prop_assert!((0.0..=1.0).contains(&sentence.score));
            let original = String::from_utf16(&units[sentence.span.start..sentence.span.end]).unwrap();
            prop_assert_eq!(original.replace(['\n', '\r'], " "), sentence.text.clone());
            last_end = sentence.span.end;
        }
    }

    /// Keywords are unique, bounded, and scored in range for any text.
    #[test]
    fn any_text_gives_bounded_unique_keywords(text in "[A-Za-z .,\\n]{0,600}", words in 1usize..5) {
        let options = KeywordOptions { max_keywords: 6, max_words: words, language: None };
        let found = ExtractiveSummarizer::new().keywords(&text, &options).unwrap();
        prop_assert!(found.len() <= 6);
        let mut texts: Vec<&str> = found.iter().map(|k| k.text.as_str()).collect();
        texts.sort_unstable();
        texts.dedup();
        prop_assert_eq!(texts.len(), found.len());
        prop_assert!(found.iter().all(|k| k.score > 0.0 && k.score <= 1.0 && k.text.split(' ').count() <= words));
    }
}
