//! The spell check engine on macOS and Linux: it asks the system's own checker (`macos.rs`, `linux.rs`) and keeps
//! the same shape as the Windows engine, so the service above it doesn't know the difference. Any other system
//! reports no languages, and every word passes.

use super::{SpellError, SpellLanguage};

/// The installed tags that match the person's preferred languages, matching a neutral language to its first region.
/// With no preference that matches, the first installed tag.
pub fn default_tags(supported: &[String], preferred: &[String]) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for want in preferred {
        let want = want.replace('_', "-");
        let primary = want.split('-').next().unwrap_or_default().to_ascii_lowercase();
        let found = supported
            .iter()
            .find(|tag| tag.eq_ignore_ascii_case(&want))
            .or_else(|| {
                supported
                    .iter()
                    .find(|tag| tag.split('-').next().unwrap_or_default().eq_ignore_ascii_case(&primary))
            });
        if let Some(tag) = found {
            if !tags.contains(tag) {
                tags.push(tag.clone());
            }
        }
    }
    if tags.is_empty() {
        tags.extend(supported.first().cloned());
    }
    tags
}

/// The languages in `LC_ALL`, `LANG` and `LANGUAGE` form (`de_DE.UTF-8:en`) as web tags.
pub fn languages_from_env(vars: &[&str]) -> Vec<String> {
    vars.iter()
        .flat_map(|value| value.split(':'))
        .map(|part| part.split(['.', '@']).next().unwrap_or_default().replace('_', "-"))
        .filter(|tag| !tag.is_empty() && tag != "C" && tag != "POSIX")
        .collect()
}

pub struct Engine {
    supported: Vec<String>,
    preferred: Vec<String>,
}

impl Engine {
    pub fn start() -> Self {
        let (supported, preferred) = discover();
        Self { supported, preferred }
    }

    pub fn languages(&self) -> Vec<SpellLanguage> {
        let defaults = default_tags(&self.supported, &self.preferred);
        self.supported
            .iter()
            .map(|tag| SpellLanguage {
                is_default: defaults.contains(tag),
                name: tag.clone(),
                tag: tag.clone(),
            })
            .collect()
    }

    /// The installed tags among `wanted`, or the defaults when `wanted` is empty.
    pub fn resolve(&self, wanted: &[String]) -> Vec<String> {
        if wanted.is_empty() {
            return default_tags(&self.supported, &self.preferred);
        }
        wanted
            .iter()
            .filter_map(|tag| {
                self.supported
                    .iter()
                    .find(|known| known.eq_ignore_ascii_case(tag))
                    .cloned()
            })
            .collect()
    }

    pub fn check(&mut self, tag: &str, text: &str) -> Vec<SpellError> {
        check(tag, text)
    }

    pub fn suggest(&mut self, tag: &str, word: &str) -> Vec<String> {
        if check(tag, word).is_empty() {
            return Vec::new();
        }
        suggest(tag, word)
    }
}

#[cfg(target_os = "macos")]
fn discover() -> (Vec<String>, Vec<String>) {
    let found = super::macos::languages();
    let mut supported: Vec<String> = found.available.iter().map(|tag| super::macos::web_tag(tag)).collect();
    supported.sort();
    supported.dedup();
    (supported, found.preferred)
}

#[cfg(target_os = "linux")]
fn discover() -> (Vec<String>, Vec<String>) {
    let vars: Vec<String> = ["LC_ALL", "LANGUAGE", "LANG"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .collect();
    let refs: Vec<&str> = vars.iter().map(String::as_str).collect();
    (super::linux::installed(), languages_from_env(&refs))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn discover() -> (Vec<String>, Vec<String>) {
    (Vec::new(), Vec::new())
}

#[cfg(target_os = "macos")]
fn check(tag: &str, text: &str) -> Vec<SpellError> {
    super::macos::check(tag, text)
}
#[cfg(target_os = "linux")]
fn check(tag: &str, text: &str) -> Vec<SpellError> {
    super::linux::check(tag, text)
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn check(_tag: &str, _text: &str) -> Vec<SpellError> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn suggest(tag: &str, word: &str) -> Vec<String> {
    super::macos::suggest(tag, word)
}
#[cfg(target_os = "linux")]
fn suggest(tag: &str, word: &str) -> Vec<String> {
    super::linux::suggest(tag, word)
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn suggest(_tag: &str, _word: &str) -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn tags(list: &[&str]) -> Vec<String> {
        list.iter().map(|tag| (*tag).to_owned()).collect()
    }

    #[test]
    fn the_defaults_follow_the_preferred_languages() {
        let supported = tags(&["de-DE", "en-GB", "en-US"]);
        assert_eq!(default_tags(&supported, &tags(&["en_US"])), ["en-US"]);
        assert_eq!(default_tags(&supported, &tags(&["en", "de"])), ["en-GB", "de-DE"]);
        assert_eq!(default_tags(&supported, &tags(&["ja"])), ["de-DE"]);
        assert!(default_tags(&[], &tags(&["en"])).is_empty());
    }

    #[test]
    fn reads_the_environment_language_forms() {
        assert_eq!(
            languages_from_env(&["de_DE.UTF-8:en", "C", "fr_FR@euro"]),
            ["de-DE", "en", "fr-FR"]
        );
    }

    #[test]
    fn resolve_keeps_only_installed_tags() {
        let engine = Engine {
            supported: tags(&["en-US"]),
            preferred: tags(&["en"]),
        };
        assert_eq!(engine.resolve(&tags(&["EN-us", "xx"])), ["en-US"]);
        assert_eq!(engine.resolve(&[]), ["en-US"]);
        assert!(engine.languages()[0].is_default);
    }
}
