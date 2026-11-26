//! The notes, comments, and suggestions of a text block (spec 6.10).

use std::collections::BTreeMap;

use serde_json::Value;

use super::super::values::is_id;
use super::{boolean, token, unknown, Check};
use crate::limits::Limits;
use crate::model::{Comment, JsonMap, Note, NoteKind, Reply, Suggestion, SuggestionKind, TextFormatting};
use crate::time::Timestamp;

/// The longest Markdown of a note, comment, reply, or suggestion (spec 16).
const RECORD_MARKDOWN_BYTES: usize = 64 * 1024;

const MARKDOWN: &str = "inline Markdown of at most 64 KiB";
const AUTHOR: &str = "1 to 100 characters";

/// Reads `notes`, `comments`, and `suggestions`, with their limits.
pub(super) fn read_records(data: &JsonMap, limits: &Limits, out: &mut TextFormatting) {
    out.notes = records(data, "notes", limits, out, |map, path, check, _| note(map, path, check));
    out.comments = records(data, "comments", limits, out, |map, path, check, over| {
        comment(map, path, check, over, limits)
    });
    out.suggestions = records(data, "suggestions", limits, out, |map, path, check, _| {
        suggestion(map, path, check)
    });
}

fn author(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|a| (1..=100).contains(&a.chars().count()))
        .map(str::to_owned)
}

fn time(v: &Value) -> Option<Timestamp> {
    v.as_str().and_then(|t| Timestamp::parse(t).ok())
}

fn markdown(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|m| m.len() <= RECORD_MARKDOWN_BYTES)
        .map(str::to_owned)
}

fn note(map: &JsonMap, path: &str, check: &mut Check<'_>) -> Option<Note> {
    let kind = check
        .key(map, path, "kind", "foot or end", token::<NoteKind>)
        .unwrap_or(NoteKind::Foot);
    Some(Note {
        kind,
        markdown: check.key(map, path, "markdown", MARKDOWN, markdown)?,
        extra: unknown(map, &["kind", "markdown"]),
    })
}

fn replies(map: &JsonMap, path: &str, check: &mut Check<'_>, over: &mut Vec<String>, limits: &Limits) -> Vec<Reply> {
    let Some(list) = map.get("replies").and_then(Value::as_array) else {
        return Vec::new();
    };
    if list.len() > limits.replies_per_comment as usize {
        let most = limits.replies_per_comment;
        over.push(format!("{path}.replies: {} replies, at most {most}", list.len()));
    }
    let mut found = Vec::new();
    for (at, reply) in list.iter().enumerate() {
        let path = format!("{path}.replies[{at}]");
        let Some(reply) = reply.as_object() else {
            continue;
        };
        let parts = (
            check.key(reply, &path, "author", AUTHOR, author),
            check.key(reply, &path, "time", "a timestamp", time),
            check.key(reply, &path, "markdown", MARKDOWN, markdown),
        );
        if let (Some(author), Some(time), Some(markdown)) = parts {
            found.push(Reply { author, time, markdown });
        }
    }
    found
}

fn comment(
    map: &JsonMap,
    path: &str,
    check: &mut Check<'_>,
    over: &mut Vec<String>,
    limits: &Limits,
) -> Option<Comment> {
    let replies = replies(map, path, check, over, limits);
    Some(Comment {
        author: check.key(map, path, "author", AUTHOR, author)?,
        time: check.key(map, path, "time", "a timestamp", time)?,
        markdown: check.key(map, path, "markdown", MARKDOWN, markdown)?,
        replies,
        resolved: check
            .key(map, path, "resolved", "true or false", boolean)
            .unwrap_or(false),
        extra: unknown(map, &["author", "time", "markdown", "replies", "resolved"]),
    })
}

fn suggestion(map: &JsonMap, path: &str, check: &mut Check<'_>) -> Option<Suggestion> {
    Some(Suggestion {
        kind: check.key(map, path, "kind", "ins, del, or fmt", token::<SuggestionKind>)?,
        author: check.key(map, path, "author", AUTHOR, author)?,
        time: check.key(map, path, "time", "a timestamp", time)?,
        before: check.key(map, path, "before", MARKDOWN, markdown),
        extra: unknown(map, &["kind", "author", "time", "before"]),
    })
}

/// Reads the records of `key` (notes, comments, or suggestions), keyed by IDs, with the count limit.
fn records<T>(
    data: &JsonMap,
    key: &str,
    limits: &Limits,
    out: &mut TextFormatting,
    mut read: impl FnMut(&JsonMap, &str, &mut Check<'_>, &mut Vec<String>) -> Option<T>,
) -> BTreeMap<String, T> {
    let mut found = BTreeMap::new();
    let Some(value) = data.get(key) else {
        return found;
    };
    let Some(map) = value.as_object() else {
        out.problems.push(format!("{key}: a map from IDs to records"));
        return found;
    };
    if map.len() > limits.records_per_block as usize {
        let most = limits.records_per_block;
        out.over_limits
            .push(format!("{key}: {} records, at most {most}", map.len()));
    }
    for (id, record) in map {
        let path = format!("{key}.{id}");
        let Some(record) = record.as_object().filter(|_| is_id(id)) else {
            out.problems.push(format!("{path}: a record under an ID"));
            continue;
        };
        let mut over = Vec::new();
        let mut check = Check::new(&mut out.problems);
        if let Some(parsed) = read(record, &path, &mut check, &mut over) {
            found.insert(id.clone(), parsed);
        }
        out.over_limits.extend(over);
    }
    found
}
