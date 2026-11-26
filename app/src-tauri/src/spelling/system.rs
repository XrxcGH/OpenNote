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

/// A language's name for people: `English (US)` for `en-US`, or the tag itself when it isn't one we know.
pub fn display_name(tag: &str) -> String {
    const NAMES: [(&str, &str); 24] = [
        ("af", "Afrikaans"),
        ("ca", "Catalan"),
        ("cs", "Czech"),
        ("da", "Danish"),
        ("de", "German"),
        ("el", "Greek"),
        ("en", "English"),
        ("es", "Spanish"),
        ("fi", "Finnish"),
        ("fr", "French"),
        ("hu", "Hungarian"),
        ("it", "Italian"),
        ("ja", "Japanese"),
        ("ko", "Korean"),
        ("nb", "Norwegian Bokmal"),
        ("nl", "Dutch"),
        ("pl", "Polish"),
        ("pt", "Portuguese"),
        ("ro", "Romanian"),
        ("ru", "Russian"),
        ("sv", "Swedish"),
        ("tr", "Turkish"),
        ("uk", "Ukrainian"),
        ("zh", "Chinese"),
    ];
    let mut parts = tag.split('-');
    let primary = parts.next().unwrap_or_default().to_ascii_lowercase();
    let Some((_, name)) = NAMES.iter().find(|(code, _)| *code == primary) else {
        return tag.to_owned();
    };
    let rest: Vec<String> = parts
        .map(|part| {
            if part.len() == 2 {
                part.to_ascii_uppercase()
            } else {
                part.to_owned()
            }
        })
        .collect();
    if rest.is_empty() {
        (*name).to_owned()
    } else {
        format!("{name} ({})", rest.join(" "))
    }
}

pub struct Engine {
    supported: Vec<String>,
    preferred: Vec<String>,
    /// The checker's own name for a web tag where they differ: NSSpellChecker lists `en_US` for `en-US` and
    /// rejects the hyphen form, which would make every word pass.
    native: std::collections::HashMap<String, String>,
}

impl Engine {
    pub fn start() -> Self {
        let (supported, native, preferred) = discover();
        Self {
            supported,
            preferred,
            native,
        }
    }

    /// The name to hand the checker for a web tag.
    fn native_name(&self, tag: &str) -> String {
        self.native.get(tag).cloned().unwrap_or_else(|| tag.to_owned())
    }

    pub fn languages(&self) -> Vec<SpellLanguage> {
        let defaults = default_tags(&self.supported, &self.preferred);
        self.supported
            .iter()
            .map(|tag| SpellLanguage {
                is_default: defaults.contains(tag),
                name: display_name(tag),
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
        check(&self.native_name(tag), text)
    }

    /// The guesses for a word, none when it is spelled right. One run of the checker, not two.
    pub fn suggest(&mut self, tag: &str, word: &str) -> Vec<String> {
        suggest(&self.native_name(tag), word)
    }
}

#[cfg(target_os = "macos")]
fn discover() -> (Vec<String>, std::collections::HashMap<String, String>, Vec<String>) {
    let found = super::macos::languages();
    let native: std::collections::HashMap<String, String> = found
        .available
        .iter()
        .map(|tag| (super::macos::web_tag(tag), tag.clone()))
        .collect();
    let mut supported: Vec<String> = native.keys().cloned().collect();
    supported.sort();
    (supported, native, found.preferred)
}

#[cfg(target_os = "linux")]
fn discover() -> (Vec<String>, std::collections::HashMap<String, String>, Vec<String>) {
    let vars: Vec<String> = ["LC_ALL", "LANGUAGE", "LANG"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .collect();
    let refs: Vec<&str> = vars.iter().map(String::as_str).collect();
    (super::linux::installed(), Default::default(), languages_from_env(&refs))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn discover() -> (Vec<String>, std::collections::HashMap<String, String>, Vec<String>) {
    (Vec::new(), Default::default(), Vec::new())
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
    fn languages_have_names_for_people_and_the_checker_gets_its_own_name() {
        assert_eq!(display_name("en-US"), "English (US)");
        assert_eq!(display_name("pt-br"), "Portuguese (BR)");
        assert_eq!(display_name("de"), "German");
        assert_eq!(display_name("xx-YY"), "xx-YY");
        let engine = Engine {
            supported: tags(&["en-US", "de"]),
            preferred: Vec::new(),
            native: [("en-US".to_owned(), "en_US".to_owned())].into(),
        };
        assert_eq!(engine.native_name("en-US"), "en_US");
        assert_eq!(engine.native_name("de"), "de");
        assert_eq!(engine.languages()[0].name, "English (US)");
    }

    #[test]
    fn resolve_keeps_only_installed_tags() {
        let engine = Engine {
            supported: tags(&["en-US"]),
            preferred: tags(&["en"]),
            native: Default::default(),
        };
        assert_eq!(engine.resolve(&tags(&["EN-us", "xx"])), ["en-US"]);
        assert_eq!(engine.resolve(&[]), ["en-US"]);
        assert!(engine.languages()[0].is_default);
    }
}
