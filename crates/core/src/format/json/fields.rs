//! Taking the known keys out of a JSON object. What is left are the object's unknown keys (spec 2.9).

use std::fmt::Display;

use serde_json::Value;

use crate::error::{FormatError, FormatErrorKind};
use crate::id::Id;
use crate::model::{Color, JsonMap, Named, NamedValue};
use crate::order::OrderKey;
use crate::time::Timestamp;

/// The fields of one JSON object, taken out one known key at a time.
#[derive(Debug)]
pub struct Fields {
    map: JsonMap,
    context: String,
}

/// The object inside a value, or an error that names `context`.
pub fn expect_object(value: Value, context: impl Display) -> Result<JsonMap, FormatError> {
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(invalid(format!("{context}: expected an object"))),
    }
}

fn invalid(detail: String) -> FormatError {
    FormatError::new(FormatErrorKind::Validation, detail)
}

impl Fields {
    /// The fields of an object. `context` names it in errors, such as `"page"` or `"block <ID>"`.
    pub fn new(value: Value, context: impl Display) -> Result<Fields, FormatError> {
        let context = context.to_string();
        let map = expect_object(value, &context)?;
        Ok(Fields { map, context })
    }

    /// The fields of a map.
    pub fn from_map(map: JsonMap, context: impl Display) -> Fields {
        Fields {
            map,
            context: context.to_string(),
        }
    }

    /// An error about a key of this object.
    pub fn error(&self, key: &str, problem: &str) -> FormatError {
        invalid(format!("{}.{key}: {problem}", self.context))
    }

    /// Takes a key out, if it is there.
    pub fn take(&mut self, key: &str) -> Option<Value> {
        self.map.remove(key)
    }

    /// Takes a key that must be there.
    pub fn required(&mut self, key: &str) -> Result<Value, FormatError> {
        self.take(key).ok_or_else(|| self.error(key, "missing"))
    }

    /// The unknown keys: everything not taken.
    pub fn rest(self) -> JsonMap {
        self.map
    }

    /// Whether any key is left.
    pub fn has_rest(&self) -> bool {
        !self.map.is_empty()
    }

    /// A required string.
    pub fn str(&mut self, key: &str) -> Result<String, FormatError> {
        let value = self.required(key)?;
        self.as_string(key, value)
    }

    /// An optional string.
    pub fn opt_str(&mut self, key: &str) -> Result<Option<String>, FormatError> {
        self.take(key).map(|v| self.as_string(key, v)).transpose()
    }

    fn as_string(&self, key: &str, value: Value) -> Result<String, FormatError> {
        match value {
            Value::String(text) => Ok(text),
            _ => Err(self.error(key, "expected a string")),
        }
    }

    /// A required ID of any kind.
    pub fn id<T: From<Id>>(&mut self, key: &str) -> Result<T, FormatError> {
        let text = self.str(key)?;
        self.parse_id(key, &text)
    }

    /// An optional ID.
    pub fn opt_id<T: From<Id>>(&mut self, key: &str) -> Result<Option<T>, FormatError> {
        let text = self.opt_str(key)?;
        text.map(|text| self.parse_id(key, &text)).transpose()
    }

    /// Parses an ID found under `key`.
    pub fn parse_id<T: From<Id>>(&self, key: &str, text: &str) -> Result<T, FormatError> {
        Id::parse(text).map(T::from).map_err(|_| self.error(key, "not an ID"))
    }

    /// An array of IDs, empty when missing.
    pub fn ids<T: From<Id>>(&mut self, key: &str) -> Result<Vec<T>, FormatError> {
        let items = self.array(key)?;
        items
            .into_iter()
            .map(|item| match item {
                Value::String(text) => self.parse_id(key, &text),
                _ => Err(self.error(key, "expected IDs")),
            })
            .collect()
    }

    /// A required timestamp.
    pub fn time(&mut self, key: &str) -> Result<Timestamp, FormatError> {
        let text = self.str(key)?;
        Timestamp::parse(&text).map_err(|_| self.error(key, "not a timestamp"))
    }

    /// A required order key.
    pub fn order(&mut self, key: &str) -> Result<OrderKey, FormatError> {
        let text = self.str(key)?;
        OrderKey::parse(&text).map_err(|_| self.error(key, "not an order key"))
    }

    /// A boolean, or `default` when missing.
    pub fn bool_or(&mut self, key: &str, default: bool) -> Result<bool, FormatError> {
        match self.take(key) {
            None => Ok(default),
            Some(Value::Bool(value)) => Ok(value),
            Some(_) => Err(self.error(key, "expected true or false")),
        }
    }

    /// A required integer from 0 to `u64::MAX`.
    pub fn u64(&mut self, key: &str) -> Result<u64, FormatError> {
        let value = self.required(key)?;
        value.as_u64().ok_or_else(|| self.error(key, "expected a whole number"))
    }

    /// An optional integer that fits `u32`.
    pub fn opt_u32(&mut self, key: &str) -> Result<Option<u32>, FormatError> {
        match self.take(key) {
            None => Ok(None),
            Some(value) => value
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .map(Some)
                .ok_or_else(|| self.error(key, "expected a whole number")),
        }
    }

    /// A required integer that fits `u32`.
    pub fn u32(&mut self, key: &str) -> Result<u32, FormatError> {
        self.opt_u32(key)?.ok_or_else(|| self.error(key, "missing"))
    }

    /// An optional number.
    pub fn opt_f64(&mut self, key: &str) -> Result<Option<f64>, FormatError> {
        self.take(key).map(|v| self.as_f64(key, &v)).transpose()
    }

    /// A number found under `key`.
    pub fn as_f64(&self, key: &str, value: &Value) -> Result<f64, FormatError> {
        value
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or_else(|| self.error(key, "expected a number"))
    }

    /// An array, empty when missing.
    pub fn array(&mut self, key: &str) -> Result<Vec<Value>, FormatError> {
        match self.take(key) {
            None => Ok(Vec::new()),
            Some(Value::Array(items)) => Ok(items),
            Some(_) => Err(self.error(key, "expected an array")),
        }
    }

    /// An array of strings, empty when missing.
    pub fn strings(&mut self, key: &str) -> Result<Vec<String>, FormatError> {
        let items = self.array(key)?;
        items.into_iter().map(|item| self.as_string(key, item)).collect()
    }

    /// An optional object.
    pub fn opt_object(&mut self, key: &str) -> Result<Option<JsonMap>, FormatError> {
        match self.take(key) {
            None => Ok(None),
            Some(Value::Object(map)) => Ok(Some(map)),
            Some(_) => Err(self.error(key, "expected an object")),
        }
    }

    /// An optional enum value, keeping unknown names (spec 2.9).
    pub fn named<T: NamedValue>(&mut self, key: &str) -> Result<Option<Named<T>>, FormatError> {
        Ok(self.opt_str(key)?.map(|text| Named::parse(&text)))
    }

    /// An optional color (spec 2.7).
    pub fn color(&mut self, key: &str) -> Result<Option<Color>, FormatError> {
        let text = self.opt_str(key)?;
        text.map(|text| Color::parse(&text).map_err(|_| self.error(key, "not a color")))
            .transpose()
    }
}
