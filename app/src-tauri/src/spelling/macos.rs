//! Spell check on macOS through NSSpellChecker, driven by a short JavaScript for Automation script that `osascript`
//! runs (it ships with every Mac, and its Objective-C bridge reaches AppKit without a native binding to build).
//! NSString ranges are UTF-16 units, which equal JavaScript string indices. This file holds the scripts and the
//! reading of their answers, which need no Mac to test.
//!
//! AppKit is only ever touched inside `osascript`, on that process's own main thread, never on a thread of the app.
//! Spell check must never hold the app up, so every run has a time limit. A run that passes it is stopped: the text
//! gets no flags, the word no suggestions, and the reason is logged. The checker is then left alone for a while, so
//! one that stopped answering costs one limit, not one for every paragraph.

use std::{
    process::Command,
    sync::Mutex,
    time::{Duration, Instant},
};

use super::SpellError;
use crate::child_process::{output_within, Failure};

/// The first run may start the spelling service, so the language list gets longer than a check.
pub const LANGUAGES_LIMIT: Duration = Duration::from_secs(15);
/// One paragraph's check, or one word's suggestions.
pub const CHECK_LIMIT: Duration = Duration::from_secs(5);
/// How long the checker is left alone after a run that ran past its limit.
const PAUSE: Duration = Duration::from_secs(60);

/// Prints the languages NSSpellChecker has dictionaries for, then the person's preferred ones, as JSON.
pub const LANGUAGES_SCRIPT: &str = "ObjC.import('AppKit');\
function run() { var c = $.NSSpellChecker.sharedSpellChecker;\
return JSON.stringify({ available: ObjC.deepUnwrap(c.availableLanguages),\
preferred: ObjC.deepUnwrap($.NSLocale.preferredLanguages) }); }";

/// Prints `[[start, length], ...]` for the misspelled words of argv[1] in the language argv[0].
/// `checkSpellingOfString:startingAt:` wraps: past the last misspelling it starts over at the beginning and finds
/// the first one again. A range before `at` is that wrap, so the loop ends there instead of running forever.
pub const CHECK_SCRIPT: &str = "ObjC.import('AppKit');\
function run(argv) { var c = $.NSSpellChecker.sharedSpellChecker; c.automaticallyIdentifiesLanguages = false;\
c.setLanguage($(argv[0])); var s = $(argv[1]); var n = s.length; var out = []; var at = 0;\
while (at < n) { var r = c.checkSpellingOfStringStartingAt(s, at); if (r.length === 0 || r.location < at) { break; }\
out.push([r.location, r.length]); at = r.location + r.length; } return JSON.stringify(out); }";

/// Prints the guesses for the word argv[1] in the language argv[0], and none when the word is spelled right.
pub const SUGGEST_SCRIPT: &str = "ObjC.import('AppKit');\
function run(argv) { var c = $.NSSpellChecker.sharedSpellChecker; var s = $(argv[1]);\
c.automaticallyIdentifiesLanguages = false; c.setLanguage($(argv[0]));\
if (c.checkSpellingOfStringStartingAt(s, 0).length === 0) { return '[]'; }\
var g = c.guessesForWordRangeInStringLanguageInSpellDocumentWithTag($.NSMakeRange(0, s.length), s, $(argv[0]), 0);\
return JSON.stringify(g ? ObjC.deepUnwrap(g) : []); }";

/// What `LANGUAGES_SCRIPT` prints.
#[derive(Debug, Default, PartialEq, Eq, serde::Deserialize)]
pub struct Languages {
    #[serde(default)]
    pub available: Vec<String>,
    #[serde(default)]
    pub preferred: Vec<String>,
}

/// Language tags in the web form: `en_US` is `en-US`.
pub fn web_tag(tag: &str) -> String {
    tag.replace('_', "-")
}

pub fn parse_languages(output: &str) -> Languages {
    serde_json::from_str::<Languages>(output.trim()).unwrap_or_default()
}

pub fn parse_ranges(output: &str) -> Vec<SpellError> {
    serde_json::from_str::<Vec<(u32, u32)>>(output.trim())
        .unwrap_or_default()
        .into_iter()
        .map(|(start, length)| SpellError { start, length })
        .collect()
}

pub fn parse_words(output: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(output.trim()).unwrap_or_default()
}

/// Runs one script with arguments within `limit` and returns what it printed.
pub fn run_within(script: &str, args: &[&str], limit: Duration) -> Result<String, Failure> {
    output_within(
        Command::new("osascript")
            .args(["-l", "JavaScript", "-e", script])
            .args(args),
        limit,
    )
}

/// When the checker may be asked again, after a run that ran past its limit.
static PAUSED_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

fn paused_until() -> std::sync::MutexGuard<'static, Option<Instant>> {
    PAUSED_UNTIL.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Runs one script for the app, or `None`, with the reason logged, when it fails, runs past `limit`, or the
/// checker is being left alone.
pub fn run(script: &str, args: &[&str], limit: Duration) -> Option<String> {
    if paused_until().is_some_and(|until| Instant::now() < until) {
        return None;
    }
    match run_within(script, args, limit) {
        Ok(out) => Some(out),
        Err(failure) => {
            if failure.timed_out {
                *paused_until() = Some(Instant::now() + PAUSE);
                log::warn!("Spell check is off for {} s: {failure}", PAUSE.as_secs());
            } else {
                log::warn!("Spell check gave no answer: {failure}");
            }
            None
        }
    }
}

pub fn languages() -> Languages {
    run(LANGUAGES_SCRIPT, &[], LANGUAGES_LIMIT)
        .map(|out| parse_languages(&out))
        .unwrap_or_default()
}

pub fn check(tag: &str, text: &str) -> Vec<SpellError> {
    run(CHECK_SCRIPT, &[tag, text], CHECK_LIMIT)
        .map(|out| parse_ranges(&out))
        .unwrap_or_default()
}

pub fn suggest(tag: &str, word: &str) -> Vec<String> {
    run(SUGGEST_SCRIPT, &[tag, word], CHECK_LIMIT)
        .map(|out| parse_words(&out))
        .unwrap_or_default()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_ranges_a_check_prints() {
        assert_eq!(
            parse_ranges("[[0,3],[10,4]]\n"),
            vec![SpellError { start: 0, length: 3 }, SpellError { start: 10, length: 4 }]
        );
        assert!(parse_ranges("not json").is_empty());
    }

    #[test]
    fn reads_languages_and_guesses() {
        let got = parse_languages(r#"{"available":["en_US","de"],"preferred":["en-GB"]}"#);
        assert_eq!(got.available, ["en_US", "de"]);
        assert_eq!(got.preferred, ["en-GB"]);
        assert_eq!(parse_languages("oops"), Languages::default());
        assert_eq!(parse_words(r#"["the","tea"]"#), ["the", "tea"]);
        assert_eq!(web_tag("en_US"), "en-US");
    }

    /// A script that never answers, as a checker stuck in a loop or waiting on a service would be, is stopped at
    /// its limit. Only a Mac has `osascript`.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_script_that_never_answers_is_stopped_at_its_limit() {
        let started = Instant::now();
        let failure = run_within("function run() { while (true) {} }", &[], Duration::from_secs(2)).unwrap_err();
        assert!(failure.timed_out, "{failure}");
        assert!(started.elapsed() < Duration::from_secs(10), "stopped, not waited for");
    }

    /// Runs the real scripts through `osascript` and NSSpellChecker. Whether this Mac's checker answers is probed
    /// first: a Mac whose spelling service or English dictionary is missing gets no flags and no suggestions, which
    /// the test then checks instead. CI sets OPENNOTE_REQUIRE_NATIVE_TOOLS, so there the real checker must answer.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_scripts_flag_and_suggest_on_this_mac() {
        let required = std::env::var_os("OPENNOTE_REQUIRE_NATIVE_TOOLS").is_some();
        let probe = run_within(LANGUAGES_SCRIPT, &[], LANGUAGES_LIMIT).map(|out| parse_languages(&out));
        let english = probe.as_ref().ok().and_then(|found| {
            found
                .available
                .iter()
                .find(|tag| tag.as_str() == "en_US")
                .or_else(|| found.available.iter().find(|tag| tag.starts_with("en")))
                .cloned()
        });
        let Some(english) = english else {
            assert!(!required, "the checker must answer here: {probe:?}");
            eprintln!("No English spell checker answers on this Mac ({probe:?}); checking the empty answers.");
            let started = Instant::now();
            assert!(check("en_US", "teh cat").is_empty());
            assert!(suggest("en_US", "teh").is_empty());
            assert!(started.elapsed() < LANGUAGES_LIMIT + 2 * CHECK_LIMIT + Duration::from_secs(5));
            return;
        };
        let checked =
            |text: &str| run_within(CHECK_SCRIPT, &[english.as_str(), text], CHECK_LIMIT).map(|out| parse_ranges(&out));
        let guessed = |word: &str| {
            run_within(SUGGEST_SCRIPT, &[english.as_str(), word], CHECK_LIMIT).map(|out| parse_words(&out))
        };
        assert_eq!(checked("teh cat"), Ok(vec![SpellError { start: 0, length: 3 }]));
        assert_eq!(
            checked("teh cat thier"),
            Ok(vec![
                SpellError { start: 0, length: 3 },
                SpellError { start: 8, length: 5 }
            ])
        );
        assert_eq!(checked("the cat"), Ok(Vec::new()));
        assert!(guessed("teh").unwrap().iter().any(|word| word == "the"));
        assert_eq!(guessed("cat"), Ok(Vec::new()));
    }
}
