//! Spell check on macOS through NSSpellChecker, driven by a short JavaScript for Automation script that `osascript`
//! runs (it ships with every Mac, and its Objective-C bridge reaches AppKit without a native binding to build).
//! NSString ranges are UTF-16 units, which equal JavaScript string indices. This file holds the scripts and the
//! reading of their answers, which need no Mac to test.

use std::process::{Command, Stdio};

use super::SpellError;

/// Prints the languages NSSpellChecker has dictionaries for, then the person's preferred ones, as JSON.
pub const LANGUAGES_SCRIPT: &str = "ObjC.import('AppKit');\
function run() { var c = $.NSSpellChecker.sharedSpellChecker;\
return JSON.stringify({ available: ObjC.deepUnwrap(c.availableLanguages),\
preferred: ObjC.deepUnwrap($.NSLocale.preferredLanguages) }); }";

/// Prints `[[start, length], ...]` for the misspelled words of argv[1] in the language argv[0].
pub const CHECK_SCRIPT: &str = "ObjC.import('AppKit');\
function run(argv) { var c = $.NSSpellChecker.sharedSpellChecker; c.automaticallyIdentifiesLanguages = false;\
c.setLanguage($(argv[0])); var s = $(argv[1]); var n = s.length; var out = []; var at = 0;\
while (at < n) { var r = c.checkSpellingOfStringStartingAt(s, at); if (r.length === 0) { break; }\
out.push([r.location, r.length]); at = r.location + r.length; } return JSON.stringify(out); }";

/// Prints the guesses for the word argv[1] in the language argv[0].
pub const SUGGEST_SCRIPT: &str = "ObjC.import('AppKit');\
function run(argv) { var c = $.NSSpellChecker.sharedSpellChecker; var s = $(argv[1]);\
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

/// Runs one script with arguments and returns what it printed, or `None` when it fails.
pub fn run(script: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn languages() -> Languages {
    run(LANGUAGES_SCRIPT, &[])
        .map(|out| parse_languages(&out))
        .unwrap_or_default()
}

pub fn check(tag: &str, text: &str) -> Vec<SpellError> {
    run(CHECK_SCRIPT, &[tag, text])
        .map(|out| parse_ranges(&out))
        .unwrap_or_default()
}

pub fn suggest(tag: &str, word: &str) -> Vec<String> {
    run(SUGGEST_SCRIPT, &[tag, word])
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

    #[test]
    fn the_scripts_read_their_arguments_in_the_order_the_code_passes_them() {
        assert!(CHECK_SCRIPT.contains("argv[0]") && CHECK_SCRIPT.contains("argv[1]"));
        assert!(CHECK_SCRIPT.contains("checkSpellingOfStringStartingAt"));
        assert!(SUGGEST_SCRIPT.contains("guessesForWordRange"));
    }
}
