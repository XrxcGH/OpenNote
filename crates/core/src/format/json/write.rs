//! The canonical JSON writer (spec 2.2 and 2.3).
//!
//! A file writer builds a [`Json`] tree with known keys in the spec's order, then adds the object's unknown
//! keys with [`Obj::finish`], which sorts them. [`write_document`] writes the tree in canonical form.

use std::borrow::Cow;
use std::fmt::Write as _;

use serde_json::Value;

use crate::model::JsonMap;

/// A value to write. Known keys come first, in the order the file writer adds them.
#[derive(Clone, Debug, PartialEq)]
pub enum Json<'a> {
    /// `null`.
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// An integer.
    Int(i128),
    /// A geometry value, rounded to 0.01 (spec 2.3).
    Geometry(f64),
    /// A number written with at most this many decimals, and no exponent.
    Fixed(f64, u32),
    /// A string.
    Str(Cow<'a, str>),
    /// Unknown data, written with sorted keys at every level.
    Raw(&'a Value),
    /// An array.
    Array(Vec<Json<'a>>),
    /// An object, in the order its keys were added.
    Object(Vec<(Cow<'a, str>, Json<'a>)>),
}

impl<'a> Json<'a> {
    /// A borrowed string.
    pub fn str(text: &'a str) -> Json<'a> {
        Json::Str(Cow::Borrowed(text))
    }

    /// An owned string.
    pub fn string(text: String) -> Json<'a> {
        Json::Str(Cow::Owned(text))
    }

    /// An object keyed by owned keys, such as IDs, in the order given.
    pub fn keyed(items: impl IntoIterator<Item = (String, Json<'a>)>) -> Json<'a> {
        Json::Object(items.into_iter().map(|(key, value)| (Cow::Owned(key), value)).collect())
    }

    /// An array of strings made from each item.
    pub fn strings<T: ToString>(items: impl IntoIterator<Item = T>) -> Json<'a> {
        Json::Array(items.into_iter().map(|item| Json::string(item.to_string())).collect())
    }

    fn is_scalar(&self) -> bool {
        match self {
            Json::Array(_) | Json::Object(_) => false,
            Json::Raw(value) => !matches!(value, Value::Array(_) | Value::Object(_)),
            _ => true,
        }
    }
}

/// An object under construction: known keys first, then unknown keys.
#[derive(Clone, Debug, Default)]
pub struct Obj<'a> {
    fields: Vec<(Cow<'a, str>, Json<'a>)>,
}

impl<'a> Obj<'a> {
    /// An empty object.
    pub fn new() -> Obj<'a> {
        Obj::default()
    }

    /// Adds a key.
    pub fn put(&mut self, key: &'a str, value: Json<'a>) -> &mut Obj<'a> {
        self.fields.push((Cow::Borrowed(key), value));
        self
    }

    /// Adds a key when the value is present.
    pub fn opt(&mut self, key: &'a str, value: Option<Json<'a>>) -> &mut Obj<'a> {
        if let Some(value) = value {
            self.fields.push((Cow::Borrowed(key), value));
        }
        self
    }

    /// Adds a key unless the value equals its default, which the canonical form leaves out.
    pub fn unless(&mut self, key: &'a str, is_default: bool, value: impl FnOnce() -> Json<'a>) -> &mut Obj<'a> {
        if !is_default {
            self.fields.push((Cow::Borrowed(key), value()));
        }
        self
    }

    /// Whether no key was added yet.
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    /// Returns the object, for objects that keep no unknown keys.
    pub fn done(self) -> Json<'a> {
        Json::Object(self.fields)
    }

    /// Adds the unknown keys in code point order, skipping any that repeat a known key, and returns the
    /// object.
    pub fn finish(mut self, extra: &'a JsonMap) -> Json<'a> {
        let mut unknown: Vec<(&'a String, &'a Value)> = extra
            .iter()
            .filter(|(key, _)| !self.fields.iter().any(|(known, _)| known == key.as_str()))
            .collect();
        unknown.sort_by(|a, b| a.0.cmp(b.0));
        self.fields.extend(
            unknown
                .into_iter()
                .map(|(key, value)| (Cow::Borrowed(key.as_str()), Json::Raw(value))),
        );
        Json::Object(self.fields)
    }
}

/// Writes a document in canonical form: 2-space indentation, LF line endings, and a final newline.
pub fn write_document(json: &Json<'_>) -> Vec<u8> {
    let mut out = String::with_capacity(4096);
    write_value(&mut out, json, 0);
    out.push('\n');
    out.into_bytes()
}

fn newline(out: &mut String, indent: usize) {
    out.push('\n');
    for _ in 0..indent {
        out.push_str("  ");
    }
}

fn write_value(out: &mut String, json: &Json<'_>, indent: usize) {
    match json {
        Json::Null => out.push_str("null"),
        Json::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Json::Int(value) => {
            let _ = write!(out, "{value}");
        }
        Json::Geometry(value) => out.push_str(&fixed(*value, 2)),
        Json::Fixed(value, decimals) => out.push_str(&fixed(*value, *decimals)),
        Json::Str(text) => write_string(out, text),
        Json::Raw(value) => write_raw(out, value, indent),
        Json::Array(items) => write_array(out, items, indent),
        Json::Object(fields) => {
            let fields = fields.iter().map(|(key, value)| (key.as_ref(), value));
            write_object(out, fields, indent, |out, value, indent| {
                write_value(out, value, indent)
            });
        }
    }
}

fn write_raw(out: &mut String, value: &Value, indent: usize) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Value::Number(number) => {
            let _ = write!(out, "{number}");
        }
        Value::String(text) => write_string(out, text),
        Value::Array(items) => {
            let items: Vec<Json<'_>> = items.iter().map(Json::Raw).collect();
            write_array(out, &items, indent);
        }
        Value::Object(map) => {
            let mut fields: Vec<(&str, &Value)> = map.iter().map(|(k, v)| (k.as_str(), v)).collect();
            fields.sort_by(|a, b| a.0.cmp(b.0));
            write_object(out, fields.into_iter(), indent, write_raw);
        }
    }
}

fn write_array(out: &mut String, items: &[Json<'_>], indent: usize) {
    if items.is_empty() {
        out.push_str("[]");
        return;
    }
    let inner = indent.saturating_add(1);
    let scalar = items.iter().all(Json::is_scalar);
    out.push('[');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
            if scalar {
                out.push(' ');
            }
        }
        if !scalar {
            newline(out, inner);
        }
        write_value(out, item, inner);
    }
    if !scalar {
        newline(out, indent);
    }
    out.push(']');
}

fn write_object<'v, V: 'v, I, T>(out: &mut String, fields: I, indent: usize, write: T)
where
    I: Iterator<Item = (&'v str, V)>,
    T: Fn(&mut String, V, usize),
{
    let inner = indent.saturating_add(1);
    let mut empty = true;
    out.push('{');
    for (key, value) in fields {
        if !empty {
            out.push(',');
        }
        empty = false;
        newline(out, inner);
        write_string(out, key);
        out.push_str(": ");
        write(out, value, inner);
    }
    if !empty {
        newline(out, indent);
    }
    out.push('}');
}

/// Writes a JSON string, escaping only `"`, `\`, and control characters (spec 2.2).
pub fn write_string(out: &mut String, text: &str) {
    out.push('"');
    let mut rest = text;
    while let Some(at) = rest.find(|c: char| c == '"' || c == '\\' || c < '\u{20}') {
        let (plain, tail) = rest.split_at(at);
        out.push_str(plain);
        let mut chars = tail.chars();
        if let Some(c) = chars.next() {
            push_escape(out, c);
        }
        rest = chars.as_str();
    }
    out.push_str(rest);
    out.push('"');
}

fn push_escape(out: &mut String, c: char) {
    match c {
        '"' => out.push_str("\\\""),
        '\\' => out.push_str("\\\\"),
        '\u{8}' => out.push_str("\\b"),
        '\u{c}' => out.push_str("\\f"),
        '\n' => out.push_str("\\n"),
        '\r' => out.push_str("\\r"),
        '\t' => out.push_str("\\t"),
        c => {
            let _ = write!(out, "\\u{:04x}", u32::from(c));
        }
    }
}

/// Formats a number rounded to `decimals` decimals, in the shortest form: no exponent, no trailing zeros,
/// and `0` instead of `-0`. Values that are not finite are written as `0`, which validation never lets
/// through.
///
/// Values too large for the decimals to matter are written as whole numbers, saturating at the range of
/// `i128`. They are far past the limits of spec 16. Writing what was read then gives the same text again.
pub fn fixed(value: f64, decimals: u32) -> String {
    if !value.is_finite() {
        return "0".to_owned();
    }
    let scale = 10u64.checked_pow(decimals).unwrap_or(1);
    let scaled = (value * scale as f64).round();
    if !scaled.is_finite() || scaled.abs() >= 9_007_199_254_740_992.0 {
        // A saturating cast.
        return format!("{}", value.round() as i128);
    }
    let n = scaled as i64;
    let magnitude = n.unsigned_abs();
    let whole = magnitude.checked_div(scale).unwrap_or(0);
    let fraction = magnitude.checked_rem(scale).unwrap_or(0);
    let mut out = String::new();
    if n < 0 {
        out.push('-');
    }
    let _ = write!(out, "{whole}");
    if fraction > 0 {
        let digits = format!("{fraction:0width$}", width = decimals as usize);
        out.push('.');
        out.push_str(digits.trim_end_matches('0'));
    }
    out
}
