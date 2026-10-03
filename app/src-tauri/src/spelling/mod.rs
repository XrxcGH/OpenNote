//! Spell check through the Windows Spell Checking API (Phase 4 ARCHITECTURE.md section 16; ADR 0023).
//! Ranges are in UTF-16 units, which equal JavaScript string indices. One thread owns the COM objects
//! (`windows.rs`); this module holds the commands and the rules that don't need Windows: several languages at
//! once, the personal dictionary, and the words the settings skip.

pub mod windows;

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::events;
use crate::ipc::{IpcError, IpcResult};
use crate::settings::{editing::Spelling, SettingsChanged, SettingsStore};

pub use self::windows::SpellService;

/// At most this many items in one `spell_check`.
pub const MAX_ITEMS: usize = 200;
/// At most this much text, in UTF-8 bytes, in one `spell_check`.
pub const MAX_BYTES: usize = 256 * 1024;
/// At most this many suggestions for a word, merged across languages.
pub const MAX_SUGGESTIONS: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellLanguage {
    pub tag: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpellItem {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpellResult {
    pub id: String,
    pub errors: Vec<SpellError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SpellError {
    pub start: u32,
    pub length: u32,
}

impl SpellError {
    fn end(self) -> u32 {
        self.start + self.length
    }

    fn overlaps(self, other: SpellError) -> bool {
        self.start < other.end() && other.start < self.end()
    }
}

/// The words a check never flags: the personal dictionary, and by default words in all capitals or with digits.
#[derive(Debug, Clone, Default)]
pub struct Rules {
    any_case: HashSet<String>,
    exact: HashSet<String>,
    ignore_uppercase: bool,
    ignore_with_digits: bool,
}

impl Rules {
    pub fn new(spelling: &Spelling) -> Self {
        let (lower, other): (Vec<&String>, Vec<&String>) = spelling
            .personal_words
            .iter()
            .partition(|word| word.chars().all(|c| !c.is_uppercase()));
        Self {
            any_case: lower.into_iter().cloned().collect(),
            exact: other.into_iter().cloned().collect(),
            ignore_uppercase: spelling.ignore_uppercase,
            ignore_with_digits: spelling.ignore_with_digits,
        }
    }

    /// An all-lowercase personal word matches any capitalization; any other matches exactly.
    pub fn skips(&self, word: &str) -> bool {
        if self.exact.contains(word) || self.any_case.contains(&word.to_lowercase()) {
            return true;
        }
        let mut letters = word.chars().filter(|c| c.is_alphabetic()).peekable();
        let uppercase = letters.peek().is_some() && letters.all(char::is_uppercase);
        (self.ignore_uppercase && uppercase) || (self.ignore_with_digits && word.chars().any(|c| c.is_numeric()))
    }

    /// The errors whose words the rules don't skip. `units` is the checked text in UTF-16.
    pub fn filter(&self, units: &[u16], errors: Vec<SpellError>) -> Vec<SpellError> {
        errors
            .into_iter()
            .filter(|error| !self.skips(&word_at(units, *error)))
            .collect()
    }
}

/// The text an error covers.
pub fn word_at(units: &[u16], error: SpellError) -> String {
    let start = (error.start as usize).min(units.len());
    let end = (error.end() as usize).min(units.len());
    String::from_utf16_lossy(&units[start..end])
}

/// With several languages, a range is an error only when every language flags it: a range from the first list
/// stays when every other list has one that overlaps it.
pub fn common_errors(per_language: &[Vec<SpellError>]) -> Vec<SpellError> {
    let Some((first, others)) = per_language.split_first() else {
        return Vec::new();
    };
    first
        .iter()
        .copied()
        .filter(|error| {
            others
                .iter()
                .all(|list| list.iter().any(|other| error.overlaps(*other)))
        })
        .collect()
}

/// Takes suggestions from each language in turn, without repeats, up to `max`.
pub fn merge_suggestions(lists: Vec<Vec<String>>, max: usize) -> Vec<String> {
    let mut merged: Vec<String> = Vec::new();
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    for index in 0..longest {
        for list in &lists {
            if let Some(word) = list.get(index) {
                if merged.len() < max && !merged.contains(word) {
                    merged.push(word.clone());
                }
            }
        }
    }
    merged
}

/// Rejects a request over the item or size limit.
pub fn check_limits(items: &[SpellItem]) -> IpcResult<()> {
    if items.len() > MAX_ITEMS {
        return Err(IpcError::invalid("items", "A spelling check takes at most 200 items."));
    }
    if items.iter().map(|item| item.text.len()).sum::<usize>() > MAX_BYTES {
        return Err(IpcError::invalid(
            "items",
            "A spelling check takes at most 256 KB of text.",
        ));
    }
    Ok(())
}

/// The personal words with `word` added or removed, or None when nothing changes.
pub fn edit_personal_words(words: &[String], word: &str, add: bool) -> IpcResult<Option<Vec<String>>> {
    let word = word.trim();
    if word.is_empty() || word.chars().count() > 64 || word.chars().any(char::is_whitespace) {
        return Err(IpcError::invalid(
            "word",
            "A dictionary word is one word of up to 64 characters.",
        ));
    }
    let present = words.iter().any(|known| known == word);
    match (add, present) {
        (true, true) | (false, false) => Ok(None),
        (true, false) => Ok(Some(words.iter().cloned().chain([word.to_owned()]).collect())),
        (false, true) => Ok(Some(words.iter().filter(|known| *known != word).cloned().collect())),
    }
}

#[tauri::command]
pub async fn spell_languages(svc: State<'_, SpellService>) -> IpcResult<Vec<SpellLanguage>> {
    let svc = *svc.inner();
    tauri::async_runtime::spawn_blocking(move || svc.languages())
        .await
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?
}

/// At most 200 items and 256 KB of text in one call.
#[tauri::command]
pub async fn spell_check(
    svc: State<'_, SpellService>,
    store: State<'_, SettingsStore>,
    items: Vec<SpellItem>,
    languages: Vec<String>,
) -> IpcResult<Vec<SpellResult>> {
    check_limits(&items)?;
    let rules = Rules::new(&store.get().editing.spelling);
    let svc = *svc.inner();
    tauri::async_runtime::spawn_blocking(move || svc.check(items, languages, &rules))
        .await
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?
}

#[tauri::command]
pub async fn spell_suggest(
    svc: State<'_, SpellService>,
    word: String,
    languages: Vec<String>,
) -> IpcResult<Vec<String>> {
    let svc = *svc.inner();
    tauri::async_runtime::spawn_blocking(move || svc.suggest(&word, &languages))
        .await
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?
}

#[tauri::command]
pub async fn spell_add_word(app: AppHandle, word: String) -> IpcResult<()> {
    change_personal_words(&app, &word, true)
}

#[tauri::command]
pub async fn spell_remove_word(app: AppHandle, word: String) -> IpcResult<()> {
    change_personal_words(&app, &word, false)
}

/// Updates `settings.editing.spelling.personalWords` and tells every window, as `settings_update` does.
fn change_personal_words(app: &AppHandle, word: &str, add: bool) -> IpcResult<()> {
    let store = app.state::<SettingsStore>();
    let words = store.get().editing.spelling.personal_words;
    let Some(next) = edit_personal_words(&words, word, add)? else {
        return Ok(());
    };
    let patch = json!({ "editing": { "spelling": { "personalWords": next } } });
    let settings = store.update(patch, "spelling")?;
    let payload = SettingsChanged {
        settings,
        origin: "spelling".to_owned(),
    };
    if let Err(error) = app.emit(events::SETTINGS_CHANGED, payload) {
        log::warn!("Couldn't send {}: {error}", events::SETTINGS_CHANGED);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
