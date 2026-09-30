//! The strict JSON reader and the canonical JSON writer (spec 2.2 and 2.3). Owned by WP1.
//!
//! The writer is hand-written and sorts unknown keys itself, never relying on the order of `serde_json::Map`.
//! Readers reject duplicate keys, escaped lone surrogates, and nesting deeper than the limit. The file readers
//! take known keys out of each object with [`Fields`], and keep what is left as the object's unknown keys.

mod fields;
mod write;

use serde_json::{Map, Number, Value};

use crate::error::{FormatError, FormatErrorKind};
use crate::limits::Limits;

pub use fields::{expect_object, Fields};
pub use write::{fixed, write_document, write_string, Json, Obj};

/// The byte order mark that readers skip (spec 2.2).
const BOM: &[u8] = b"\xEF\xBB\xBF";

/// The deepest nesting any limit may ask for. It bounds the parser's recursion.
const MAX_DEPTH: u32 = 512;

/// Parses a whole JSON file strictly: UTF-8 with or without a byte order mark, no duplicate keys, no escaped
/// lone surrogates, no nesting deeper than `limits.json_depth`, and nothing after the value.
pub fn parse(bytes: &[u8], limits: &Limits) -> Result<Value, FormatError> {
    if bytes.len() as u64 > limits.page_json_bytes {
        let detail = format!("{} bytes, more than {}", bytes.len(), limits.page_json_bytes);
        return Err(FormatError::new(FormatErrorKind::Limit, detail));
    }
    let bytes = bytes.strip_prefix(BOM).unwrap_or(bytes);
    let text = std::str::from_utf8(bytes)
        .map_err(|err| FormatError::new(FormatErrorKind::Encoding, "invalid UTF-8").at(err.valid_up_to() as u64))?;
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: 0,
        depth: 0,
        max_depth: limits.json_depth.min(MAX_DEPTH),
    };
    parser.skip_ws();
    let value = parser.value()?;
    parser.skip_ws();
    if parser.pos < parser.bytes.len() {
        return Err(parser.error(FormatErrorKind::Syntax, "text after the JSON value"));
    }
    Ok(value)
}

/// The string value of one key of the top-level object, found without building the rest of the file. Other
/// values are skipped, not checked. `None` when the file isn't an object or the key isn't a string.
pub fn top_level_string(bytes: &[u8], key: &str) -> Option<String> {
    let bytes = bytes.strip_prefix(BOM).unwrap_or(bytes);
    let text = std::str::from_utf8(bytes).ok()?;
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: 0,
        depth: 0,
        max_depth: MAX_DEPTH,
    };
    parser.skip_ws();
    parser.expect(b'{').ok()?;
    loop {
        parser.skip_ws();
        let name = parser.string().ok()?;
        parser.skip_ws();
        parser.expect(b':').ok()?;
        parser.skip_ws();
        if name == key {
            return parser.string().ok();
        }
        parser.skip_value()?;
        parser.skip_ws();
        parser.expect(b',').ok()?;
    }
}

/// A recursive descent parser over text that is already valid UTF-8.
struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
    depth: u32,
    max_depth: u32,
}

impl Parser<'_> {
    fn error(&self, kind: FormatErrorKind, detail: &str) -> FormatError {
        FormatError::new(kind, detail).at(self.pos as u64)
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn bump(&mut self) {
        self.pos = self.pos.saturating_add(1);
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.bump();
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), FormatError> {
        if self.peek() == Some(byte) {
            self.bump();
            Ok(())
        } else {
            let detail = format!("expected {:?}", char::from(byte));
            Err(self.error(FormatErrorKind::Syntax, &detail))
        }
    }

    fn value(&mut self) -> Result<Value, FormatError> {
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(Value::String),
            Some(b't') => self.literal("true", Value::Bool(true)),
            Some(b'f') => self.literal("false", Value::Bool(false)),
            Some(b'n') => self.literal("null", Value::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => Err(self.error(FormatErrorKind::Syntax, "expected a value")),
            None => Err(self.error(FormatErrorKind::Truncated, "the JSON ended early")),
        }
    }

    fn literal(&mut self, word: &str, value: Value) -> Result<Value, FormatError> {
        if self
            .bytes
            .get(self.pos..)
            .is_some_and(|rest| rest.starts_with(word.as_bytes()))
        {
            self.pos = self.pos.saturating_add(word.len());
            Ok(value)
        } else {
            Err(self.error(FormatErrorKind::Syntax, "expected a value"))
        }
    }

    fn enter(&mut self) -> Result<(), FormatError> {
        self.depth = self.depth.saturating_add(1);
        if self.depth > self.max_depth {
            return Err(self.error(FormatErrorKind::TooDeep, "nested too deeply"));
        }
        self.bump();
        self.skip_ws();
        Ok(())
    }

    /// Parses the items of an array or object up to `close`, each with `item`, and the commas between them.
    fn items(
        &mut self,
        close: u8,
        mut item: impl FnMut(&mut Self) -> Result<(), FormatError>,
    ) -> Result<(), FormatError> {
        self.enter()?;
        let mut first = true;
        while self.peek() != Some(close) {
            if !first {
                if self.peek() != Some(b',') {
                    let detail = format!("expected ',' or '{}'", char::from(close));
                    return Err(self.error(FormatErrorKind::Syntax, &detail));
                }
                self.bump();
                self.skip_ws();
            }
            first = false;
            item(self)?;
            self.skip_ws();
        }
        self.bump();
        self.depth = self.depth.saturating_sub(1);
        Ok(())
    }

    fn object(&mut self) -> Result<Value, FormatError> {
        let mut map = Map::new();
        self.items(b'}', |parser| {
            if parser.peek() != Some(b'"') {
                return Err(parser.error(FormatErrorKind::Syntax, "expected a key"));
            }
            let at = parser.pos;
            let key = parser.string()?;
            parser.skip_ws();
            parser.expect(b':')?;
            parser.skip_ws();
            let value = parser.value()?;
            match insert_new(&mut map, key, value) {
                None => Ok(()),
                Some(key) => {
                    let detail = format!("the key {key:?} appears twice");
                    Err(FormatError::new(FormatErrorKind::DuplicateKey, detail).at(at as u64))
                }
            }
        })?;
        Ok(Value::Object(map))
    }

    fn array(&mut self) -> Result<Value, FormatError> {
        let mut items = Vec::new();
        self.items(b']', |parser| {
            items.push(parser.value()?);
            Ok(())
        })?;
        Ok(Value::Array(items))
    }

    fn string(&mut self) -> Result<String, FormatError> {
        self.bump();
        let mut out = String::new();
        loop {
            let start = self.pos;
            while matches!(self.peek(), Some(b) if b != b'"' && b != b'\\' && b >= 0x20) {
                self.bump();
            }
            out.push_str(self.text.get(start..self.pos).unwrap_or_default());
            match self.peek() {
                Some(b'"') => {
                    self.bump();
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.bump();
                    out.push(self.escape()?);
                }
                Some(_) => return Err(self.error(FormatErrorKind::Syntax, "a control character in a string")),
                None => return Err(self.error(FormatErrorKind::Truncated, "the string never ends")),
            }
        }
    }

    fn escape(&mut self) -> Result<char, FormatError> {
        let byte = self.peek();
        self.bump();
        Ok(match byte {
            Some(b'"') => '"',
            Some(b'\\') => '\\',
            Some(b'/') => '/',
            Some(b'b') => '\u{8}',
            Some(b'f') => '\u{c}',
            Some(b'n') => '\n',
            Some(b'r') => '\r',
            Some(b't') => '\t',
            Some(b'u') => return self.unicode_escape(),
            _ => return Err(self.error(FormatErrorKind::Syntax, "an unknown escape")),
        })
    }

    fn unicode_escape(&mut self) -> Result<char, FormatError> {
        let first = self.hex4()?;
        let code = match first {
            0xD800..=0xDBFF => {
                let pair = self.bytes.get(self.pos..self.pos.saturating_add(2)) == Some(b"\\u");
                if !pair {
                    return Err(self.error(FormatErrorKind::Encoding, "a lone surrogate"));
                }
                self.pos = self.pos.saturating_add(2);
                let second = self.hex4()?;
                if !(0xDC00..=0xDFFF).contains(&second) {
                    return Err(self.error(FormatErrorKind::Encoding, "a lone surrogate"));
                }
                let high = first.saturating_sub(0xD800).saturating_mul(0x400);
                high.saturating_add(second.saturating_sub(0xDC00))
                    .saturating_add(0x1_0000)
            }
            0xDC00..=0xDFFF => return Err(self.error(FormatErrorKind::Encoding, "a lone surrogate")),
            code => code,
        };
        char::from_u32(code).ok_or_else(|| self.error(FormatErrorKind::Encoding, "an invalid escape"))
    }

    fn hex4(&mut self) -> Result<u32, FormatError> {
        let digits = self
            .text
            .get(self.pos..self.pos.saturating_add(4))
            .filter(|d| d.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| self.error(FormatErrorKind::Syntax, "expected 4 hexadecimal digits"))?;
        self.pos = self.pos.saturating_add(4);
        u32::from_str_radix(digits, 16).map_err(|_| self.error(FormatErrorKind::Syntax, "bad hexadecimal digits"))
    }

    /// Skips one value without checking it closely: brackets are counted, and strings are stepped over.
    fn skip_value(&mut self) -> Option<()> {
        let mut depth = 0usize;
        loop {
            match self.peek()? {
                b'"' => self.skip_string()?,
                b'{' | b'[' => {
                    depth = depth.saturating_add(1);
                    self.bump();
                }
                b'}' | b']' => {
                    depth = depth.checked_sub(1)?;
                    self.bump();
                }
                b',' if depth == 0 => return Some(()),
                _ => self.bump(),
            }
            if depth == 0 && matches!(self.peek(), Some(b',' | b'}')) {
                return Some(());
            }
        }
    }

    /// Steps over a string, from its opening quote to just after its closing quote.
    fn skip_string(&mut self) -> Option<()> {
        self.bump();
        while self.peek()? != b'"' {
            if self.peek()? == b'\\' {
                self.bump();
            }
            self.bump();
        }
        self.bump();
        Some(())
    }

    fn digits(&mut self) -> usize {
        let start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.bump();
        }
        self.pos.saturating_sub(start)
    }

    fn number(&mut self) -> Result<Value, FormatError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.bump();
        }
        match self.peek() {
            Some(b'0') => self.bump(),
            Some(b'1'..=b'9') => {
                self.digits();
            }
            _ => return Err(self.error(FormatErrorKind::Syntax, "expected a digit")),
        }
        let mut integer = true;
        if self.peek() == Some(b'.') {
            self.bump();
            integer = false;
            if self.digits() == 0 {
                return Err(self.error(FormatErrorKind::Syntax, "expected a digit after '.'"));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.bump();
            integer = false;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.bump();
            }
            if self.digits() == 0 {
                return Err(self.error(FormatErrorKind::Syntax, "expected a digit in the exponent"));
            }
        }
        let token = self.text.get(start..self.pos).unwrap_or_default();
        number_value(token, integer).ok_or_else(|| self.error(FormatErrorKind::Syntax, "a number out of range"))
    }
}

/// Inserts a key that must be new. Returns the key when it was already there.
fn insert_new(map: &mut Map<String, Value>, key: String, value: Value) -> Option<String> {
    if map.contains_key(&key) {
        return Some(key);
    }
    map.insert(key, value);
    None
}

/// A number token as a JSON value: integers as integers where they fit, everything else as a finite `f64`.
fn number_value(token: &str, integer: bool) -> Option<Value> {
    if integer {
        if let Ok(n) = token.parse::<i64>() {
            return Some(Value::Number(n.into()));
        }
        if let Ok(n) = token.parse::<u64>() {
            return Some(Value::Number(n.into()));
        }
    }
    let float: f64 = token.parse().ok()?;
    Number::from_f64(float).map(Value::Number)
}

#[cfg(test)]
mod tests;
