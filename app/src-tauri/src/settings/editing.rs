//! The `editing` settings group that Phase 4's typed notes read (change P2-9 in Phase 4's plan, section 3.11).
//! It holds Markdown shortcuts, the slash menu, the formatting bar, AutoCorrect, paste, spelling, read aloud,
//! and page history. It was added with defaults, so the schema version stays 1.

use serde::{Deserialize, Serialize};

use super::validate::{self, Check};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct EditingSettings {
    pub markdown_shortcuts: bool,
    pub slash_menu: bool,
    pub formatting_bar: FormattingBar,
    /// Put the date and time under the title of a new page.
    pub new_page_date_time: bool,
    #[cfg_attr(test, ts(inline))]
    pub autocorrect: Autocorrect,
    #[cfg_attr(test, ts(inline))]
    pub paste: Paste,
    #[cfg_attr(test, ts(inline))]
    pub spelling: Spelling,
    #[cfg_attr(test, ts(inline))]
    pub read_aloud: ReadAloud,
    #[cfg_attr(test, ts(inline))]
    pub history: History,
}

impl Default for EditingSettings {
    fn default() -> Self {
        Self {
            markdown_shortcuts: true,
            slash_menu: true,
            formatting_bar: FormattingBar::TouchAndPen,
            new_page_date_time: true,
            autocorrect: Autocorrect::default(),
            paste: Paste::default(),
            spelling: Spelling::default(),
            read_aloud: ReadAloud::default(),
            history: History::default(),
        }
    }
}

impl EditingSettings {
    /// The most AutoCorrect pairs and personal dictionary words the settings hold.
    pub const MAX_AUTOCORRECT: usize = 2_000;
    pub const MAX_PERSONAL_WORDS: usize = 10_000;

    pub fn check(&self, check: &mut Check) {
        let entries = &self.autocorrect.entries;
        check.that(
            "editing.autocorrect.entries",
            entries.len() <= Self::MAX_AUTOCORRECT,
            "There are too many AutoCorrect entries.",
        );
        for entry in entries {
            check.chars("editing.autocorrect.entries", &entry.from, (1, 32));
            check.chars("editing.autocorrect.entries", &entry.to, (1, 256));
        }
        let spelling = &self.spelling;
        let tags_ok = spelling.languages.len() <= 20 && spelling.languages.iter().all(|t| validate::language_tag(t));
        check.that(
            "editing.spelling.languages",
            tags_ok,
            "A spelling language isn't a language tag.",
        );
        check.that(
            "editing.spelling.personalWords",
            spelling.personal_words.len() <= Self::MAX_PERSONAL_WORDS,
            "The personal dictionary has too many words.",
        );
        for word in &spelling.personal_words {
            check.chars("editing.spelling.personalWords", word, (1, 64));
        }
        let rate = self.read_aloud.rate;
        check.range("editing.readAloud.rate", rate, (0.5, 2.0));
        check.that(
            "editing.readAloud.rate",
            (rate * 4.0).fract() == 0.0,
            "The reading rate goes in steps of 0.25.",
        );
        if let Some(voice) = &self.read_aloud.voice {
            check.chars("editing.readAloud.voice", voice, (1, 256));
        }
    }
}

/// When the floating formatting bar shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum FormattingBar {
    #[default]
    TouchAndPen,
    Always,
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Autocorrect {
    pub enabled: bool,
    /// The person's own pairs; empty means the built-in list.
    pub entries: Vec<AutocorrectEntry>,
}

impl Default for Autocorrect {
    fn default() -> Self {
        Self {
            enabled: true,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct AutocorrectEntry {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Paste {
    #[cfg_attr(test, ts(inline))]
    pub source_link: SourceLink,
    pub save_web_images: bool,
    pub join_pdf_lines: bool,
}

impl Default for Paste {
    fn default() -> Self {
        Self {
            source_link: SourceLink::Ask,
            save_web_images: true,
            join_pdf_lines: true,
        }
    }
}

/// Whether a paste from the web adds a link to where it came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum SourceLink {
    #[default]
    Ask,
    Always,
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Spelling {
    pub enabled: bool,
    /// BCP 47 tags; empty means the Windows defaults.
    pub languages: Vec<String>,
    pub personal_words: Vec<String>,
    pub ignore_uppercase: bool,
    pub ignore_with_digits: bool,
}

impl Default for Spelling {
    fn default() -> Self {
        Self {
            enabled: true,
            languages: Vec::new(),
            personal_words: Vec::new(),
            ignore_uppercase: true,
            ignore_with_digits: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ReadAloud {
    /// A voice id, or `None` for the Windows default.
    pub voice: Option<String>,
    /// From 0.5 to 2, in steps of 0.25.
    pub rate: f64,
    pub read_code: bool,
}

impl Default for ReadAloud {
    fn default() -> Self {
        Self {
            voice: None,
            rate: 1.0,
            read_code: false,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct History {
    #[cfg_attr(test, ts(inline))]
    pub keep: HistoryKeep,
}

/// How long page history keeps versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum HistoryKeep {
    Month,
    #[default]
    Year,
    Forever,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn defaults_match_phase_4s_schema() {
        let expected = json!({
            "markdownShortcuts": true,
            "slashMenu": true,
            "formattingBar": "touchAndPen",
            "newPageDateTime": true,
            "autocorrect": { "enabled": true, "entries": [] },
            "paste": { "sourceLink": "ask", "saveWebImages": true, "joinPdfLines": true },
            "spelling": {
                "enabled": true, "languages": [], "personalWords": [], "ignoreUppercase": true,
                "ignoreWithDigits": true
            },
            "readAloud": { "voice": null, "rate": 1.0, "readCode": false },
            "history": { "keep": "year" }
        });
        assert_eq!(
            serde_json::to_value(EditingSettings::default()).expect("serializes"),
            expected
        );
    }

    fn checked(settings: &EditingSettings) -> Option<String> {
        let mut check = Check::default();
        settings.check(&mut check);
        check.finish().err().and_then(|error| error.field)
    }

    #[test]
    fn checks_lengths_rates_and_language_tags() {
        let mut settings = EditingSettings::default();
        assert_eq!(checked(&settings), None);
        settings.read_aloud.rate = 1.1;
        assert_eq!(checked(&settings).as_deref(), Some("editing.readAloud.rate"));
        settings.read_aloud.rate = 2.25;
        assert_eq!(checked(&settings).as_deref(), Some("editing.readAloud.rate"));
        settings.read_aloud.rate = 1.75;
        settings.spelling.languages = vec!["en-US".into(), "not a tag".into()];
        assert_eq!(checked(&settings).as_deref(), Some("editing.spelling.languages"));
        settings.spelling.languages.clear();
        settings.autocorrect.entries = vec![AutocorrectEntry {
            from: "x".repeat(33),
            to: "y".into(),
        }];
        assert_eq!(checked(&settings).as_deref(), Some("editing.autocorrect.entries"));
    }
}
