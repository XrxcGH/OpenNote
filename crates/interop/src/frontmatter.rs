//! The front matter that Obsidian and Joplin put at the top of a Markdown note: a small, flat subset of YAML.
//!
//! Only top-level keys with text or list values matter to a note. Nested values are kept as their key name, so
//! a report can say that they were skipped.

use opennote_core::Timestamp;

use crate::dates::parse_date;

/// A value of a front matter key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    /// A text, number, or date.
    Text(String),
    /// A list of texts.
    List(Vec<String>),
    /// Something nested that notes cannot use.
    Nested,
}

/// The keys of a front matter block, in order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FrontMatter {
    /// The keys and values.
    pub fields: Vec<(String, Value)>,
}

impl FrontMatter {
    /// The text of the first of these keys that has one.
    pub fn text(&self, keys: &[&str]) -> Option<&str> {
        keys.iter().find_map(|key| {
            self.fields.iter().find_map(|(k, v)| match v {
                Value::Text(text) if k.eq_ignore_ascii_case(key) && !text.is_empty() => Some(text.as_str()),
                _ => None,
            })
        })
    }

    /// The first of these keys that holds a date.
    pub fn date(&self, keys: &[&str]) -> Option<Timestamp> {
        keys.iter().filter_map(|key| self.text(&[key])).find_map(parse_date)
    }

    /// The tags: a list, or a text split at commas and spaces. Leading `#` marks are dropped.
    pub fn tags(&self) -> Vec<String> {
        let Some((_, value)) = self
            .fields
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("tags") || k.eq_ignore_ascii_case("tag"))
        else {
            return Vec::new();
        };
        let items: Vec<String> = match value {
            Value::List(items) => items.clone(),
            Value::Text(text) => text.split([',', ' ']).map(str::to_owned).collect(),
            Value::Nested => Vec::new(),
        };
        items
            .iter()
            .map(|tag| tag.trim().trim_start_matches('#').to_owned())
            .filter(|tag| !tag.is_empty())
            .collect()
    }

    /// Other names the note answers to, from `aliases` or `alias`, so links by those names find it.
    pub fn aliases(&self) -> Vec<String> {
        let found = self
            .fields
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("aliases") || k.eq_ignore_ascii_case("alias"));
        match found.map(|(_, v)| v) {
            Some(Value::List(items)) => items
                .iter()
                .map(|a| a.trim().to_owned())
                .filter(|a| !a.is_empty())
                .collect(),
            Some(Value::Text(text)) => text
                .split(',')
                .map(|a| a.trim().to_owned())
                .filter(|a| !a.is_empty())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Keys that a note does not use, for the report.
    pub fn unused_keys(&self) -> Vec<&str> {
        const USED: [&str; 10] = [
            "title",
            "created",
            "updated",
            "modified",
            "date",
            "tags",
            "tag",
            "created_time",
            "aliases",
            "alias",
        ];
        self.fields
            .iter()
            .map(|(key, _)| key.as_str())
            .filter(|key| !USED.iter().any(|used| used.eq_ignore_ascii_case(key)))
            .collect()
    }
}

/// Splits a note into its front matter and its body. Text with no front matter comes back whole.
pub fn split(text: &str) -> (Option<FrontMatter>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text.strip_prefix("---") else {
        return (None, text);
    };
    let Some(rest) = rest.strip_prefix("\r\n").or_else(|| rest.strip_prefix('\n')) else {
        return (None, text);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end();
        if trimmed == "---" || trimmed == "..." {
            let body = &rest[offset + line.len()..];
            return (
                Some(parse_block(&rest[..offset])),
                body.trim_start_matches(['\r', '\n']),
            );
        }
        offset += line.len();
    }
    (None, text)
}

fn parse_block(block: &str) -> FrontMatter {
    let mut fields: Vec<(String, Value)> = Vec::new();
    for line in block.lines() {
        let indented = line.starts_with([' ', '\t']);
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ").or_else(|| (trimmed == "-").then_some("")) {
            push_item(&mut fields, item);
        } else if indented {
            if let Some((_, value)) = fields.last_mut() {
                *value = Value::Nested;
            }
        } else if let Some((key, value)) = trimmed.split_once(':') {
            fields.push((key.trim().to_owned(), parse_value(value.trim())));
        }
    }
    FrontMatter { fields }
}

/// Adds a `- item` line to the list of the key above it.
fn push_item(fields: &mut [(String, Value)], item: &str) {
    let Some((_, value)) = fields.last_mut() else {
        return;
    };
    let item = unquote(item.trim());
    match value {
        Value::Text(text) if text.is_empty() => *value = Value::List(vec![item]),
        Value::List(items) => items.push(item),
        _ => *value = Value::Nested,
    }
}

fn parse_value(value: &str) -> Value {
    if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        return Value::List(
            inner
                .split(',')
                .map(|item| unquote(item.trim()))
                .filter(|i| !i.is_empty())
                .collect(),
        );
    }
    if value.starts_with(['{', '|', '>']) {
        return Value::Nested;
    }
    Value::Text(unquote(value))
}

fn unquote(text: &str) -> String {
    if let Some(inner) = text.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
        return unescape_double(inner);
    }
    if let Some(inner) = text.strip_prefix('\'').and_then(|t| t.strip_suffix('\'')) {
        return inner.replace("''", "'");
    }
    text.to_owned()
}

fn unescape_double(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                out.push(
                    u32::from_str_radix(&hex, 16)
                        .ok()
                        .and_then(char::from_u32)
                        .unwrap_or('\u{fffd}'),
                );
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// Writes a YAML text: bare when that is safe, and double-quoted otherwise.
pub fn yaml_text(text: &str) -> String {
    let bare = !text.is_empty()
        && text.chars().next().is_some_and(|c| c.is_alphabetic())
        && text.chars().all(|c| c.is_alphanumeric() || " _./-".contains(c))
        && !text.ends_with(' ')
        && !matches!(
            text.to_ascii_lowercase().as_str(),
            "true" | "false" | "null" | "yes" | "no" | "on" | "off"
        );
    if bare {
        return text.to_owned();
    }
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Writes the front matter of an exported page, including the closing line and a blank line after it.
pub fn write(title: &str, created: Timestamp, modified: Timestamp, tags: &[String]) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("title: {}\n", yaml_text(title)));
    out.push_str(&format!("created: {}\n", created.to_rfc3339()));
    out.push_str(&format!("updated: {}\n", modified.to_rfc3339()));
    if !tags.is_empty() {
        out.push_str("tags:\n");
        for tag in tags {
            out.push_str(&format!("  - {}\n", yaml_text(tag)));
        }
    }
    out.push_str("---\n\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_obsidian_and_joplin_front_matter() {
        let note = concat!(
            "---\ntitle: \"Mitosis: phases\"\ncreated: 2024-01-05 14:30:00Z\n",
            "tags:\n  - bio\n  - 'unit/3'\naliases: [A, B]\nprops:\n  a: 1\n---\n\nBody"
        );
        let (front, body) = split(note);
        let front = front.expect("front matter is found");
        assert_eq!(body, "Body");
        assert_eq!(front.text(&["title"]), Some("Mitosis: phases"));
        assert!(front.date(&["created"]).is_some());
        assert_eq!(front.tags(), vec!["bio", "unit/3"]);
        assert_eq!(front.unused_keys(), vec!["props"]);
        assert_eq!(front.aliases(), vec!["A", "B"]);
    }

    #[test]
    fn text_without_front_matter_is_returned_whole() {
        let (front, body) = split("# Title\n\n---\nnot front matter\n---");
        assert!(front.is_none());
        assert!(body.starts_with("# Title"));
    }

    #[test]
    fn written_front_matter_reads_back() {
        let created = Timestamp::parse("2026-09-30T14:00:00.000Z").expect("a valid time");
        let tags = vec!["biology".to_owned(), "exam/unit 3".to_owned()];
        let text = format!("{}Body", write("Plants: \"light\"", created, created, &tags));
        let (front, body) = split(&text);
        let front = front.expect("front matter is found");
        assert_eq!(body, "Body");
        assert_eq!(front.text(&["title"]), Some("Plants: \"light\""));
        assert_eq!(front.date(&["created"]), Some(created));
        assert_eq!(front.tags(), tags);
    }
}
