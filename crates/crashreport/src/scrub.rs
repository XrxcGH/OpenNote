//! The scrubber: removes user names, paths, quoted text, and other private text from anything a report holds.
//!
//! A report is safe for two reasons that do not depend on each other. First, the code that builds it never
//! reads note content. A panic message is kept only when it is a string literal in the program, and the
//! backtrace holds function names and code offsets. Second, every piece of text that does go into a report
//! passes through this scrubber, which removes what could still identify the person or their notes.
//!
//! The scrubber works on text alone. It cannot know that a bare word such as `Holiday` is a page title, so
//! the application registers names it knows are private, such as the open notebook's folder name, with
//! [`Scrubber::add_private`]. The names of the person and the computer, and the home folder, are found
//! automatically by [`Scrubber::detect`].

/// What replaces a path.
pub(crate) const PATH: &str = "<path>";
/// What replaces quoted text.
pub(crate) const TEXT: &str = "\"<text>\"";
/// What replaces a person's or computer's name.
pub(crate) const USER: &str = "<user>";
/// What replaces text the application registered as private.
pub(crate) const PRIVATE: &str = "<private>";
/// What replaces a web link.
pub(crate) const URL: &str = "<url>";
/// What replaces an email address.
pub(crate) const EMAIL: &str = "<email>";

/// The longest symbol name or module name a report keeps.
const MAX_SYMBOL: usize = 300;
/// How many more times [`Scrubber::text`] runs its rules, at most, before the text stops changing.
const MAX_PASSES: usize = 4;

/// Removes private text. Clone it freely; it only holds the names to look for.
#[derive(Clone, Debug, Default)]
pub struct Scrubber {
    names: Vec<Vec<char>>,
    private: Vec<Vec<char>>,
}

impl Scrubber {
    /// A scrubber that knows no names. Paths, quoted text, addresses, and web links are still removed.
    pub fn new() -> Scrubber {
        Scrubber::default()
    }

    /// A scrubber that knows the names of the person and the computer, from the environment, and the name
    /// of the home folder, which is often the person's name too.
    pub fn detect() -> Scrubber {
        let mut scrubber = Scrubber::new();
        for var in ["USERNAME", "USER", "LOGNAME", "USERDOMAIN", "COMPUTERNAME", "HOSTNAME"] {
            if let Some(value) = std::env::var_os(var).and_then(|v| v.into_string().ok()) {
                scrubber.add_name(&value);
            }
        }
        for var in ["USERPROFILE", "HOME"] {
            if let Some(home) = std::env::var_os(var).and_then(|v| v.into_string().ok()) {
                scrubber.add_private(&home);
                if let Some(last) = home.rsplit(['\\', '/']).find(|part| !part.is_empty()) {
                    scrubber.add_name(last);
                }
            }
        }
        scrubber
    }

    /// Also removes `name`, a user or computer name, wherever it appears as a word.
    pub fn add_name(&mut self, name: &str) {
        add_needle(&mut self.names, name);
    }

    /// Also removes `text`, such as a notebook name or folder, wherever it appears as a word. Never pass
    /// note content here: the scrubber would keep a copy of it in memory.
    pub fn add_private(&mut self, text: &str) {
        add_needle(&mut self.private, text);
    }

    /// Scrubs a line of free text. Paths, quoted text in any of the common quote marks, web links, email
    /// addresses, device and network identifiers, secrets, and long key-like strings are replaced. So are the
    /// registered names. Text that has no such shape, such as a bare page title, is not found. That is why a
    /// report never holds a message that was built at run time.
    ///
    /// The rules run again until the text stops changing, because a placeholder can open a shape that the text
    /// it replaced did not, such as `<email>/home/x`. So scrubbing twice changes nothing.
    pub fn text(&self, input: &str) -> String {
        let mut text = self.pass(input);
        for _ in 0..MAX_PASSES {
            let again = self.pass(&text);
            if again == text {
                break;
            }
            text = again;
        }
        text
    }

    /// One run of every rule. Paths go first: a quote mark, an address, or a placeholder inside a path would
    /// otherwise cut it short and keep the rest.
    fn pass(&self, input: &str) -> String {
        let text = replace_paths(input);
        let text = crate::scrub_quotes::replace_quoted(&text);
        let text = replace_urls(&text);
        let text = replace_emails(&text);
        let text = crate::scrub_ids::replace_ids(&text);
        let text = crate::scrub_ids::replace_secrets(&text);
        let text = crate::scrub_ids::replace_tokens(&text);
        let text = replace_needles(&text, &self.private, PRIVATE);
        replace_needles(&text, &self.names, USER)
    }

    /// Scrubs a source location such as `C:\Users\Sam\.cargo\src\de.rs:12:5` down to `de.rs:12:5`. Anything
    /// that is not a Rust file name and line numbers becomes `<path>`.
    pub fn source(&self, input: &str) -> String {
        let name = input.rsplit(['\\', '/']).next().unwrap_or("");
        let (file, numbers) = match name.split_once(':') {
            Some((file, numbers)) => (file, Some(numbers)),
            None => (name, None),
        };
        let file_ok = file.ends_with(".rs") && file.len() <= 64 && file.chars().all(is_file_char);
        let numbers_ok = numbers.is_none_or(|n| {
            n.split(':')
                .all(|p| !p.is_empty() && p.len() <= 7 && p.bytes().all(|b| b.is_ascii_digit()))
        });
        if file_ok && numbers_ok {
            replace_needles(name, &self.names, USER)
        } else {
            PATH.to_owned()
        }
    }

    /// Scrubs a function name from a backtrace. Names that hold characters no function name has, such as
    /// path separators or quotes, become `<symbol>`.
    pub fn symbol(&self, input: &str) -> String {
        let plausible = !input.is_empty() && input.len() <= MAX_SYMBOL && input.chars().all(is_symbol_char);
        if plausible {
            replace_needles(input, &self.names, USER)
        } else {
            "<symbol>".to_owned()
        }
    }

    /// The file name of a module such as `opennote.exe`, without its folder. `None` when it does not look
    /// like a module file name.
    pub fn module(&self, input: &str) -> Option<String> {
        let name = input.rsplit(['\\', '/']).next().unwrap_or("");
        let lower = name.to_ascii_lowercase();
        let known = [".exe", ".dll", ".sys", ".so", ".dylib"]
            .iter()
            .any(|ext| lower.ends_with(ext));
        let plausible = known && name.len() <= 64 && name.chars().all(is_file_char);
        plausible.then(|| replace_needles(name, &self.names, USER))
    }
}

/// A character that a Rust or module file name may hold.
fn is_file_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '+')
}

/// A character that a demangled Rust or C++ function name may hold.
fn is_symbol_char(c: char) -> bool {
    c.is_alphanumeric() || " _:<>{}()[]&*,'$.#!;=+-~".contains(c)
}

fn add_needle(list: &mut Vec<Vec<char>>, text: &str) {
    let needle: Vec<char> = text.trim().chars().flat_map(char::to_lowercase).collect();
    if needle.len() >= 2 && !list.contains(&needle) {
        list.push(needle);
        // Longest first, so a folder name is removed before the shorter name inside it.
        list.sort_by_key(|n| std::cmp::Reverse(n.len()));
    }
}

/// Replaces each needle where it is a whole word, ignoring case.
fn replace_needles(text: &str, needles: &[Vec<char>], replacement: &str) -> String {
    if needles.is_empty() {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut previous: Option<char> = None;
    let mut rest = text;
    while let Some(first) = rest.chars().next() {
        let matched = needles.iter().find_map(|needle| {
            let len = match_len(rest, needle)?;
            let after = rest[len..].chars().next();
            let edge = |c: Option<char>| c.is_none_or(|c| !c.is_alphanumeric());
            (edge(previous) && edge(after)).then_some(len)
        });
        match matched {
            Some(len) => {
                out.push_str(replacement);
                previous = rest[..len].chars().next_back();
                rest = &rest[len..];
            }
            None => {
                out.push(first);
                previous = Some(first);
                rest = &rest[first.len_utf8()..];
            }
        }
    }
    out
}

/// How many bytes at the start of `text` equal `needle`, a lowercase character list, ignoring case.
fn match_len(text: &str, needle: &[char]) -> Option<usize> {
    let mut wanted = needle.iter();
    let mut used = 0;
    for c in text.chars() {
        for lower in c.to_lowercase() {
            if wanted.next() != Some(&lower) {
                return None;
            }
        }
        used += c.len_utf8();
        if wanted.as_slice().is_empty() {
            return Some(used);
        }
    }
    None
}

/// Replaces `http://` and `https://` links up to the next space or closing mark.
fn replace_urls(text: &str) -> String {
    replace_spans(text, |rest, _| {
        if !starts_with_ignore_case(rest, "http://") && !starts_with_ignore_case(rest, "https://") {
            return None;
        }
        let end = rest
            .find(|c: char| c.is_whitespace() || "\"'<>)]}".contains(c))
            .unwrap_or(rest.len());
        Some((end, URL))
    })
}

/// Replaces anything that looks like `name@host.tld`.
fn replace_emails(text: &str) -> String {
    let local = |c: char| c.is_alphanumeric() || "._%+-".contains(c);
    let domain = |c: char| c.is_alphanumeric() || ".-".contains(c);
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('@') {
        let (before, after) = (&rest[..at], &rest[at + 1..]);
        let start = before
            .char_indices()
            .rev()
            .take_while(|&(_, c)| local(c))
            .last()
            .map_or(at, |(i, _)| i);
        let host_len = after.find(|c: char| !domain(c)).unwrap_or(after.len());
        let host = after[..host_len].trim_end_matches('.');
        if start < at && host.contains('.') && !host.starts_with('.') {
            out.push_str(&before[..start]);
            out.push_str(EMAIL);
            rest = &after[host.len()..];
        } else {
            out.push_str(&rest[..=at]);
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// Replaces file system paths: `C:\...`, `\\server\...`, `\\?\...`, `\Windows\...`, `file://...`, `/home/...`,
/// `~/...`, `%USERPROFILE%\...`, and relative ones such as `notebooks\a.json` and `..\a.json`. A path may hold
/// spaces, so it runs to the end of the line, to a colon that ends a clause, or to a mark that no path holds.
/// That removes more than the path at times, which is the safe way to be wrong.
fn replace_paths(text: &str) -> String {
    replace_spans(text, |rest, previous| {
        if !path_starts(rest, previous) {
            return None;
        }
        // The `?` of a verbatim or device prefix is part of the path, not a mark that ends it.
        let prefix = if rest.starts_with(r"\\?\") || rest.starts_with(r"\\.\") {
            4
        } else {
            0
        };
        let mut end = rest.len();
        let mut chars = rest[prefix..].char_indices().peekable();
        while let Some((i, c)) = chars.next() {
            let next = chars.peek().map(|&(_, n)| n);
            let clause = c == ':' && next.is_none_or(char::is_whitespace);
            if clause || matches!(c, '\n' | '\r' | '\t' | '"' | '|' | '*' | '?' | '<' | '>') {
                end = prefix + i;
                break;
            }
        }
        Some((end, PATH))
    })
}

fn path_starts(rest: &str, previous: Option<char>) -> bool {
    let mut chars = rest.chars();
    let (first, second, third) = (chars.next(), chars.next(), chars.next());
    let boundary = previous.is_none_or(|p| !p.is_alphanumeric());
    let after_space = previous.is_none_or(|p| p.is_whitespace() || "([{=,;'`>".contains(p));
    match (first, second, third) {
        (Some(d), Some(':'), Some('\\' | '/')) => d.is_ascii_alphabetic() && boundary,
        (Some('\\'), Some('\\'), Some(_)) => previous != Some('\\'),
        (Some('\\'), Some(c), _) => after_space && is_name_char(c),
        (Some('~'), Some('/' | '\\'), _) => after_space,
        (Some('/'), Some(c), _) => after_space && (c.is_alphanumeric() || "._~-".contains(c)),
        (Some('%'), _, _) => boundary && is_variable_path(rest),
        _ => (starts_with_ignore_case(rest, "file://") && boundary) || is_relative_path(rest, previous),
    }
}

/// A character that a folder or file name may hold, for finding where a relative path starts.
fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || "_-.$~+@#".contains(c)
}

/// Whether `rest` starts with an environment variable and a separator, as in `%USERPROFILE%\Documents`. The
/// app's log writes the profile folder that way.
fn is_variable_path(rest: &str) -> bool {
    let Some(name) = rest.strip_prefix('%') else {
        return false;
    };
    let len = name
        .find(|c: char| !(c.is_ascii_alphanumeric() || "_()".contains(c)))
        .unwrap_or(name.len());
    let after = &name[len..];
    (1..=64).contains(&len) && (after.starts_with("%\\") || after.starts_with("%/"))
}

/// Whether a relative Windows path starts here: names joined by backslashes, as in `notebooks\Holiday\a.json`,
/// `.\a.json`, and `..\a.json`. Forward slashes alone don't count, because `and/or` and `1/2` are words.
fn is_relative_path(rest: &str, previous: Option<char>) -> bool {
    if previous.is_some_and(|p| is_name_char(p) || p == '\\' || p == '/') {
        return false;
    }
    let len = rest
        .find(|c: char| !(is_name_char(c) || c == '\\' || c == '/'))
        .unwrap_or(rest.len());
    let run = &rest[..len];
    run.match_indices('\\').any(|(i, _)| {
        run[..i].chars().next_back().is_some_and(is_name_char)
            && run[i..]
                .trim_start_matches('\\')
                .chars()
                .next()
                .is_some_and(is_name_char)
    })
}

/// Whether `text` starts with `prefix`, an ASCII string, ignoring case.
fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.as_bytes()
        .get(..prefix.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(prefix.as_bytes()))
}

/// Walks `text` and calls `find(rest, previous_char)` at every character. When it returns a length and a
/// replacement, that many bytes are replaced and the walk goes on after them.
pub(crate) fn replace_spans(text: &str, find: impl Fn(&str, Option<char>) -> Option<(usize, &'static str)>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous = None;
    let mut rest = text;
    while let Some(first) = rest.chars().next() {
        match find(rest, previous) {
            Some((len, replacement)) if len > 0 => {
                out.push_str(replacement);
                previous = rest[..len].chars().next_back();
                rest = &rest[len..];
            }
            _ => {
                out.push(first);
                previous = Some(first);
                rest = &rest[first.len_utf8()..];
            }
        }
    }
    out
}

#[cfg(test)]
#[path = "scrub_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "scrub_property_tests.rs"]
mod property_tests;
