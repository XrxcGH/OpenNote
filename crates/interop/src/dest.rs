//! Link and image destinations, read the way a browser reads them.
//!
//! A browser removes tabs and line breaks from a URL, and the control characters and spaces at its ends, before
//! it looks for the scheme. A check that looks at the raw text can therefore be passed by `java&#9;script:`.
//! Every check here cleans the destination first.

/// A destination as a browser reads it: without tabs and line breaks anywhere, and without the control
/// characters and spaces at its ends.
pub fn clean(dest: &str) -> String {
    let kept: String = dest.chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect();
    kept.trim_matches(|c: char| c <= ' ').to_owned()
}

/// The scheme of a cleaned destination, such as `https`: the text before a `:` that comes before any `/`, `?`,
/// or `#`, whatever characters it holds. A leading `:`, as in Joplin's `:/id` links, starts no scheme, for a
/// browser as well.
pub fn scheme(dest: &str) -> Option<&str> {
    let end = dest.find([':', '/', '?', '#'])?;
    let is_colon = dest.get(end..).is_some_and(|rest| rest.starts_with(':'));
    (is_colon && end > 0).then(|| dest.get(..end)).flatten()
}

/// Whether a cleaned destination has one of these schemes, compared without case.
pub fn has_scheme(dest: &str, allowed: &[&str]) -> bool {
    scheme(dest).is_some_and(|scheme| allowed.iter().any(|s| scheme.eq_ignore_ascii_case(s)))
}

/// Whether a destination still holds a control character after [`clean`].
pub fn has_control(dest: &str) -> bool {
    dest.chars().any(char::is_control)
}

/// A link or image source that an exported page may hold: a web or email address, or a path, cleaned. Other
/// schemes, such as `javascript:`, could run code when the exported page is opened, so they give `None`.
pub fn for_export(dest: &str) -> Option<String> {
    let cleaned = clean(dest);
    if has_control(&cleaned) {
        return None;
    }
    match scheme(&cleaned) {
        Some(_) if !has_scheme(&cleaned, &["http", "https", "mailto"]) => None,
        _ => Some(cleaned),
    }
}

/// The schemes an imported link may keep: web, email, and phone addresses, and OpenNote's own forms.
const IMPORT_SCHEMES: [&str; 7] = ["http", "https", "mailto", "tel", "wiki", "asset", "opennote"];

/// What an import does with a link destination.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImportLink {
    /// A destination with an allowed scheme, cleaned. It is kept as it is.
    Keep(String),
    /// A destination without a scheme, cleaned: a path to resolve against the files of the import.
    Path(String),
    /// Anything else, such as `javascript:`, `file:`, `data:`, or another app's scheme. Only its text is kept.
    Refuse,
}

/// Sorts an imported link destination with one allowlist for every importer (see [`ImportLink`]). A path that
/// starts with two slashes names another computer, such as a file share, so it is refused like a Windows drive.
pub fn for_import(dest: &str) -> ImportLink {
    let cleaned = clean(dest);
    if has_control(&cleaned) {
        return ImportLink::Refuse;
    }
    let remote = cleaned.chars().take(2).filter(|c| matches!(c, '/' | '\\')).count() == 2;
    match scheme(&cleaned) {
        None if !remote => ImportLink::Path(cleaned),
        Some(_) if has_scheme(&cleaned, &IMPORT_SCHEMES) => ImportLink::Keep(cleaned),
        _ => ImportLink::Refuse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scheme_ends_at_the_first_colon_before_a_path() {
        assert_eq!(scheme("https://example.org"), Some("https"));
        assert_eq!(scheme("java script:x"), Some("java script"));
        assert_eq!(scheme("pages/a:b.md"), None);
        assert_eq!(scheme("#x:y"), None);
        assert_eq!(scheme("a?b:c"), None);
        assert_eq!(scheme("plain"), None);
        assert_eq!(scheme(":/0123abcd"), None);
    }

    #[test]
    fn cleaning_removes_what_a_browser_ignores() {
        assert_eq!(clean(" \u{1}java\tscr\r\nipt:x \u{0}"), "javascript:x");
        assert_eq!(for_export("\u{1}JavaScript:x"), None);
        assert_eq!(for_export("https://a/\u{7f}"), None);
        assert_eq!(for_export(" HTTP://a/b ").as_deref(), Some("HTTP://a/b"));
    }

    #[test]
    fn imports_keep_only_allowed_schemes() {
        let keep = |d: &str| ImportLink::Keep(d.to_owned());
        assert_eq!(for_import("Tel:+15551234"), keep("Tel:+15551234"));
        assert_eq!(for_import(" https://a.org "), keep("https://a.org"));
        assert_eq!(for_import("opennote:page/x"), keep("opennote:page/x"));
        assert_eq!(for_import("notes/a b.md"), ImportLink::Path("notes/a b.md".to_owned()));
        for refused in [
            "javascript:alert(1)",
            "java\tscript:alert(1)",
            "\u{1}JavaScript:x",
            "file:///C:/Windows/system32/calc.exe",
            "data:text/html,x",
            "onenote:x",
            "slack://open",
            "a\u{7}b",
            "C:/Windows/notepad.exe",
            "//server/share/x.exe",
            "\\\\server\\share",
        ] {
            assert_eq!(for_import(refused), ImportLink::Refuse, "{refused:?}");
        }
    }
}
