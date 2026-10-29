//! Tags: normal form and nesting. A `/` nests a tag, so `a/b/c` sits inside `a/b`, which sits inside `a`.

use std::collections::HashSet;

use crate::text::fold;

/// The most characters a tag keeps, as the format limits them (spec 16).
const MAX_TAG_CHARS: usize = 200;

/// The form a tag is stored and matched in: no leading `#`, folded case, and no empty path parts.
///
/// Returns `None` when nothing is left, for example for `#` or `//`.
pub fn normalize(tag: &str) -> Option<String> {
    let parts: Vec<String> = tag
        .trim()
        .trim_start_matches('#')
        .split('/')
        .map(|part| fold(part.trim()))
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    let joined = parts.join("/");
    Some(joined.chars().take(MAX_TAG_CHARS).collect())
}

/// Normalizes each tag, drops the empty ones and repeats, and keeps the order.
pub fn normalize_all<'a>(tags: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        if let Some(tag) = normalize(tag) {
            if seen.insert(tag.clone()) {
                out.push(tag);
            }
        }
    }
    out
}

/// Every parent of a normalized tag, outermost first: `a/b/c` gives `a` and `a/b`.
pub fn ancestors(tag: &str) -> Vec<&str> {
    tag.match_indices('/').map(|(at, _)| &tag[..at]).collect()
}

/// The range of stored tags inside a normalized tag, for an indexed comparison.
///
/// A tag `t` is inside `a/b` when `a/b/` is at most `t` and `t` is below `a/b0`. The character `0` follows `/`
/// in byte order, so the range holds exactly the tags that start with `a/b/`.
pub fn inside_bounds(tag: &str) -> (String, String) {
    (format!("{tag}/"), format!("{tag}0"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_case_hashes_and_empty_parts() {
        assert_eq!(normalize("#Exam/Unit-3 "), Some("exam/unit-3".into()));
        assert_eq!(normalize(" a // b "), Some("a/b".into()));
        assert_eq!(normalize("Caf\u{e9}"), Some("cafe".into()));
        assert_eq!(normalize("#"), None);
        assert_eq!(normalize("//"), None);
    }

    #[test]
    fn removes_repeats_but_keeps_order() {
        assert_eq!(normalize_all(["B", "a", "b", "#A"]), ["b", "a"]);
    }

    #[test]
    fn lists_ancestors_outermost_first() {
        assert_eq!(ancestors("a/b/c"), ["a", "a/b"]);
        assert!(ancestors("a").is_empty());
    }

    #[test]
    fn bounds_hold_only_nested_tags() {
        let (low, high) = inside_bounds("a/b");
        let inside = |tag: &str| tag >= low.as_str() && tag < high.as_str();
        assert!(inside("a/b/c"));
        assert!(inside("a/b/c/d"));
        assert!(!inside("a/b"));
        assert!(!inside("a/bc"));
        assert!(!inside("a/b-2"));
    }
}
