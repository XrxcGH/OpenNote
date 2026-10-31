//! Equation numbers and cross-references in exports.
//!
//! A display equation is numbered when its source holds `\label{key}`; its number is its place among the labeled
//! equations of the page, in reading order. A reference is the inline equation `$\eqref{key}$`. Before a page is
//! converted, each labeled equation loses its label and gains `\tag{n}`, and each reference becomes the text "(n)", so
//! the number is in the Markdown, HTML, and Word exports alike. The app's own exporter does the same in TypeScript
//! (`editor/equations.ts`); the two agree on these rules.

use std::collections::HashMap;

const UNRESOLVED: &str = "(??)";

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'_' | b'.' | b'-'))
}

/// The key of the first `\label{key}` in the source.
fn label_of(source: &str) -> Option<String> {
    let mut rest = source;
    while let Some(at) = rest.find("\\label{") {
        let after = &rest[at + 7..];
        if let Some(end) = after.find('}') {
            if valid_key(&after[..end]) {
                return Some(after[..end].to_owned());
            }
        }
        rest = after;
    }
    None
}

/// The source without its labels, and with trailing space removed.
fn strip_labels(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(at) = rest.find("\\label{") {
        let after = &rest[at + 7..];
        match after.find('}') {
            Some(end) if valid_key(&after[..end]) => {
                out.push_str(rest[..at].trim_end_matches([' ', '\t']));
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str(&rest[..at + 7]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out.trim_end().to_owned()
}

enum Segment {
    Text(String),
    Math {
        open: String,
        body: Vec<String>,
        close: Option<String>,
    },
}

pub(super) fn fence_of(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let c = trimmed.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = trimmed.chars().take_while(|&x| x == c).count();
    (n >= 3).then_some((c, n))
}

fn segments(markdown: &str) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut text: Vec<&str> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut i = 0;
    let flush = |text: &mut Vec<&str>, out: &mut Vec<Segment>| {
        if !text.is_empty() {
            out.push(Segment::Text(text.join("\n")));
            text.clear();
        }
    };
    while i < lines.len() {
        let line = lines[i];
        let found = fence_of(line);
        if let Some((c, n)) = fence {
            if matches!(found, Some((fc, fnum)) if fc == c && fnum >= n) {
                fence = None;
            }
            text.push(line);
        } else if found.is_some() {
            fence = found;
            text.push(line);
        } else if line.trim() == "$$" {
            flush(&mut text, &mut out);
            let mut body = Vec::new();
            let mut close = None;
            i += 1;
            while i < lines.len() {
                if lines[i].trim() == "$$" {
                    close = Some(lines[i].to_owned());
                    break;
                }
                body.push(lines[i].to_owned());
                i += 1;
            }
            out.push(Segment::Math {
                open: line.to_owned(),
                body,
                close,
            });
        } else {
            text.push(line);
        }
        i += 1;
    }
    flush(&mut text, &mut out);
    out
}

/// Replaces `$\eqref{key}$` outside inline code with its number.
fn resolve_refs(text: &str, numbers: &HashMap<String, usize>) -> String {
    replace_refs(text, &|key| match numbers.get(key) {
        Some(n) => format!("({n})"),
        None => UNRESOLVED.to_owned(),
    })
}

/// Replaces `$\eqref{key}$` outside inline code with whatever `with` makes of the key.
fn replace_refs(text: &str, with: &dyn Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while !rest.is_empty() {
        let next_code = rest.find('`');
        let next_ref = rest.find('$');
        match (next_code, next_ref) {
            (Some(c), r) if r.is_none_or(|r| c < r) => {
                // A code span: copy it as it is, to its closing backtick on the same line.
                let after = &rest[c + 1..];
                let line_end = after.find('\n').unwrap_or(after.len());
                match after[..line_end].find('`') {
                    Some(close) => {
                        out.push_str(&rest[..c + close + 2]);
                        rest = &rest[c + close + 2..];
                    }
                    None => {
                        out.push_str(&rest[..c + 1]);
                        rest = after;
                    }
                }
            }
            (_, Some(r)) => {
                let after = &rest[r + 1..];
                let inner_end = after.find(['$', '\n']);
                let hit = inner_end.filter(|&e| after.as_bytes()[e] == b'$').and_then(|e| {
                    let inner = after[..e].trim();
                    let key = inner.strip_prefix("\\eqref{")?.strip_suffix('}')?;
                    valid_key(key).then(|| (key.to_owned(), e))
                });
                match hit {
                    Some((key, e)) => {
                        out.push_str(&rest[..r]);
                        out.push_str(&with(&key));
                        rest = &after[e + 1..];
                    }
                    None => {
                        out.push_str(&rest[..r + 1]);
                        rest = after;
                    }
                }
            }
            _ => {
                out.push_str(rest);
                rest = "";
            }
        }
    }
    out
}

/// The texts (in reading order) with numbers: labeled display equations gain `\tag{n}` and lose their labels, and
/// references become "(n)". Texts with no label and no reference come back unchanged.
pub fn number_texts(texts: &[&str]) -> Vec<String> {
    if !texts.iter().any(|t| t.contains("\\label{") || t.contains("\\eqref{")) {
        return texts.iter().map(|t| (*t).to_owned()).collect();
    }
    let parts: Vec<Vec<Segment>> = texts.iter().map(|t| segments(t)).collect();
    let mut numbers: HashMap<String, usize> = HashMap::new();
    let mut per_equation: Vec<Option<usize>> = Vec::new();
    for segment in parts.iter().flatten() {
        if let Segment::Math { body, .. } = segment {
            let number = label_of(&body.join("\n")).and_then(|key| {
                if numbers.contains_key(&key) {
                    None
                } else {
                    let n = numbers.len() + 1;
                    numbers.insert(key, n);
                    Some(n)
                }
            });
            per_equation.push(number);
        }
    }
    let mut next = 0;
    parts
        .into_iter()
        .map(|list| {
            list.into_iter()
                .map(|segment| match segment {
                    Segment::Text(text) => resolve_refs(&text, &numbers),
                    Segment::Math { open, body, close } => {
                        let number = per_equation[next];
                        next += 1;
                        let clean = strip_labels(&body.join("\n"));
                        let source = match number {
                            Some(n) => format!("{clean} \\tag{{{n}}}"),
                            None => clean,
                        };
                        let mut lines = vec![open, source];
                        lines.extend(close);
                        lines.join("\n")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .collect()
}

/// The source with its first valid label prefixed. Later labels in it are removed.
fn relabel(source: &str, prefix: &str) -> String {
    let mut out = String::with_capacity(source.len() + prefix.len() + 2);
    let mut rest = source;
    let mut first = true;
    while let Some(at) = rest.find("\\label{") {
        let after = &rest[at + 7..];
        match after.find('}') {
            Some(end) if valid_key(&after[..end]) => {
                out.push_str(&rest[..at]);
                if first {
                    out.push_str(&format!("\\label{{{prefix}:{}}}", &after[..end]));
                    first = false;
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str(&rest[..at + 7]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The texts (in reading order) for LaTeX. The first label of each display equation stays a `\label`, with the
/// prefix added so labels stay unique across the pages of one document, and each reference becomes
/// `$\eqref{prefix:key}$`. A reference to a label that no equation holds becomes "(??)". A label that an earlier
/// equation already holds is dropped, as the numbered exports do.
pub fn prefixed_texts(texts: &[&str], prefix: &str) -> Vec<String> {
    if !texts.iter().any(|t| t.contains("\\label{") || t.contains("\\eqref{")) {
        return texts.iter().map(|t| (*t).to_owned()).collect();
    }
    let parts: Vec<Vec<Segment>> = texts.iter().map(|t| segments(t)).collect();
    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut first: Vec<bool> = Vec::new();
    for segment in parts.iter().flatten() {
        if let Segment::Math { body, .. } = segment {
            first.push(label_of(&body.join("\n")).is_some_and(|key| known.insert(key)));
        }
    }
    let mut next = 0;
    parts
        .into_iter()
        .map(|list| {
            list.into_iter()
                .map(|segment| match segment {
                    Segment::Text(text) => replace_refs(&text, &|key| {
                        if known.contains(key) {
                            format!("$\\eqref{{{prefix}:{key}}}$")
                        } else {
                            UNRESOLVED.to_owned()
                        }
                    }),
                    Segment::Math { open, body, close } => {
                        let keep = first[next];
                        next += 1;
                        let joined = body.join("\n");
                        let source = if keep {
                            relabel(&joined, prefix)
                        } else {
                            strip_labels(&joined)
                        };
                        let mut lines = vec![open, source];
                        lines.extend(close);
                        lines.join("\n")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latex_labels_get_the_page_prefix_and_references_follow() {
        let out = prefixed_texts(
            &[
                "See $\\eqref{b}$, $\\eqref{zz}$.",
                "$$\na=1 \\label{a}\n$$\n\n$$\nb=2 \\label{b}\\label{c}\n$$\n\n$$\nd \\label{a}\n$$",
            ],
            "p2",
        );
        assert_eq!(out[0], "See $\\eqref{p2:b}$, (??).");
        assert_eq!(
            out[1],
            "$$\na=1 \\label{p2:a}\n$$\n\n$$\nb=2 \\label{p2:b}\n$$\n\n$$\nd\n$$"
        );
    }

    #[test]
    fn tags_equations_and_resolves_references_across_blocks() {
        let out = number_texts(&[
            "Intro, see $\\eqref{b}$ and $\\eqref{zz}$.",
            "$$\na=1 \\label{a}\n$$\n\n$$\nb=2 \\label{b}\n$$",
        ]);
        assert_eq!(out[0], "Intro, see (2) and (??).");
        assert_eq!(out[1], "$$\na=1 \\tag{1}\n$$\n\n$$\nb=2 \\tag{2}\n$$");
    }

    #[test]
    fn leaves_code_and_plain_text_alone() {
        let code = "```\n$$\nx \\label{a}\n$$\n```\n`$\\eqref{a}$`";
        assert_eq!(number_texts(&[code])[0], code);
        assert_eq!(number_texts(&["plain $x$ text"])[0], "plain $x$ text");
    }

    #[test]
    fn a_repeated_label_is_numbered_once() {
        let out = number_texts(&["$$\na \\label{k}\n$$\n$$\nb \\label{k}\n$$"]);
        assert_eq!(out[0], "$$\na \\tag{1}\n$$\n$$\nb\n$$");
    }

    #[test]
    fn prices_are_not_references() {
        assert_eq!(
            number_texts(&["It costs $5 and $\\eqref{a}$.\n$$\nx \\label{a}\n$$"])[0],
            "It costs $5 and (1).\n$$\nx \\tag{1}\n$$"
        );
    }
}
