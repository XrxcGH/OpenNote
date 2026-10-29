//! Escaping text for OpenNote Markdown (spec 7.6).

/// Escapes text for a paragraph. `at_line_start` says whether the text begins a paragraph line. A line break in
/// the text becomes a hard break, because a paragraph never holds any other kind.
pub fn escape_text(text: &str, at_line_start: bool) -> String {
    let prev = if at_line_start { None } else { Some(' ') };
    escape_around(text, prev, None)
}

/// Escapes text whose neighbors are known.
///
/// `prev` is the character before the text, or `None` at the start of a paragraph line. `next` is the character
/// after the text, or `None` at the end of a line.
pub fn escape_around(text: &str, prev: Option<char>, next: Option<char>) -> String {
    let chars: Vec<char> = text.chars().filter(|c| *c != '\r').collect();
    let mut out = String::with_capacity(text.len() + 4);
    let mut digits = if prev.is_none() { Some(0usize) } else { None };
    for (i, &c) in chars.iter().enumerate() {
        let before = match i {
            0 => prev,
            _ if chars[i - 1] == '\n' => None,
            _ => Some(chars[i - 1]),
        };
        let after = match chars.get(i + 1) {
            Some('\n') => None,
            Some(&c) => Some(c),
            None => next,
        };
        let first = before.is_none();
        match c {
            '\n' => out.push_str("\\\n"),
            '\0' => out.push('\u{fffd}'),
            '\t' => out.push_str("&#9;"),
            ' ' if first || after.is_none() => out.push_str("&#32;"),
            '\\' | '`' | '*' | '~' | '$' | '[' | ']' | '{' | '<' | '|' => push_escaped(&mut out, c),
            '_' if !(before.is_some_and(char::is_alphanumeric) && after.is_some_and(char::is_alphanumeric)) => {
                push_escaped(&mut out, c);
            }
            '=' if first || before == Some('=') || after == Some('=') => push_escaped(&mut out, c),
            '&' if starts_reference(&chars[i + 1..]) => push_escaped(&mut out, c),
            '#' if before.is_none_or(char::is_whitespace) => push_escaped(&mut out, c),
            '>' | '-' | '+' if first => push_escaped(&mut out, c),
            '.' | ')' if digits.is_some_and(|n| (1..=9).contains(&n)) => push_escaped(&mut out, c),
            _ => out.push(c),
        }
        digits = match (digits, c) {
            (Some(n), '0'..='9') => Some(n + 1),
            (_, '\n') => Some(0),
            _ => None,
        };
    }
    out
}

fn push_escaped(out: &mut String, c: char) {
    out.push('\\');
    out.push(c);
}

/// Whether the characters after an `&` read as a character reference, such as `amp;` or `#35;`.
fn starts_reference(rest: &[char]) -> bool {
    let rest = rest.strip_prefix(&['#']).unwrap_or(rest);
    let name = rest.iter().take_while(|c| c.is_ascii_alphanumeric()).count();
    name > 0 && rest.get(name) == Some(&';')
}
