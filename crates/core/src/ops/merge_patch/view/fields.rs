//! Small readers and writers for the JSON objects of block data.

use std::str::FromStr;

use serde_json::Value;

use crate::id::IdError;
use crate::model::{JsonMap, Named, NamedValue};

/// Reads the members of one JSON object, and keeps every member it doesn't know as unknown keys.
pub(crate) struct Fields<'a> {
    map: &'a JsonMap,
    what: &'static str,
    known: &'static [&'static str],
}

impl<'a> Fields<'a> {
    /// Reads `map`, the object named `what` in messages, whose known keys are `known`.
    pub fn new(map: &'a JsonMap, what: &'static str, known: &'static [&'static str]) -> Fields<'a> {
        Fields { map, what, known }
    }

    fn wrong(&self, key: &str, expected: &str) -> String {
        format!("{}.{key} must be {expected}", self.what)
    }

    /// A string member, if present.
    pub fn str(&self, key: &str) -> Result<Option<&'a str>, String> {
        match self.map.get(key) {
            None => Ok(None),
            Some(Value::String(text)) => Ok(Some(text)),
            Some(_) => Err(self.wrong(key, "a string")),
        }
    }

    /// A string member, or `default`.
    pub fn string_or(&self, key: &str, default: &str) -> Result<String, String> {
        Ok(self.str(key)?.unwrap_or(default).to_owned())
    }

    /// A string member that must be present.
    pub fn required_str(&self, key: &str) -> Result<&'a str, String> {
        self.str(key)?.ok_or_else(|| self.wrong(key, "present"))
    }

    /// A boolean member, or `false`.
    pub fn flag(&self, key: &str) -> Result<bool, String> {
        match self.map.get(key) {
            None => Ok(false),
            Some(Value::Bool(value)) => Ok(*value),
            Some(_) => Err(self.wrong(key, "true or false")),
        }
    }

    /// A finite number member, if present.
    pub fn number(&self, key: &str) -> Result<Option<f64>, String> {
        match self.map.get(key) {
            None => Ok(None),
            Some(value) => match value.as_f64() {
                Some(number) if number.is_finite() => Ok(Some(number)),
                _ => Err(self.wrong(key, "a finite number")),
            },
        }
    }

    /// A finite number member that must be present.
    pub fn required_number(&self, key: &str) -> Result<f64, String> {
        self.number(key)?.ok_or_else(|| self.wrong(key, "present"))
    }

    /// A whole number member from 0 to 2^32 − 1, if present.
    pub fn count(&self, key: &str) -> Result<Option<u32>, String> {
        match self.map.get(key) {
            None => Ok(None),
            Some(value) => value
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .map(Some)
                .ok_or_else(|| self.wrong(key, "a whole number from 0 to 4294967295")),
        }
    }

    /// An ID member, if present.
    pub fn id<T: FromStr<Err = IdError>>(&self, key: &str) -> Result<Option<T>, String> {
        self.str(key)?
            .map(|text| text.parse().map_err(|_| self.wrong(key, "an ID")))
            .transpose()
    }

    /// An ID member that must be present.
    pub fn required_id<T: FromStr<Err = IdError>>(&self, key: &str) -> Result<T, String> {
        self.id(key)?.ok_or_else(|| self.wrong(key, "present"))
    }

    /// A named enum member, or its default.
    pub fn named<T: NamedValue + Default>(&self, key: &str) -> Result<Named<T>, String> {
        Ok(self.str(key)?.map(Named::parse).unwrap_or_default())
    }

    /// An array member, or an empty one.
    pub fn array(&self, key: &str) -> Result<&'a [Value], String> {
        match self.map.get(key) {
            None => Ok(&[]),
            Some(Value::Array(items)) => Ok(items),
            Some(_) => Err(self.wrong(key, "an array")),
        }
    }

    /// An object member, if present.
    pub fn object(&self, key: &str) -> Result<Option<&'a JsonMap>, String> {
        match self.map.get(key) {
            None => Ok(None),
            Some(Value::Object(map)) => Ok(Some(map)),
            Some(_) => Err(self.wrong(key, "an object")),
        }
    }

    /// Every member whose key isn't known.
    pub fn extra(&self) -> JsonMap {
        self.map
            .iter()
            .filter(|(key, _)| !self.known.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    }
}

/// An item of an array that must be an object.
pub(crate) fn item_object<'a>(value: &'a Value, what: &str) -> Result<&'a JsonMap, String> {
    value
        .as_object()
        .ok_or_else(|| format!("each item of {what} must be an object"))
}

/// An item of an array that must be an ID.
pub(crate) fn item_id<T: FromStr<Err = IdError>>(value: &Value, what: &str) -> Result<T, String> {
    value
        .as_str()
        .and_then(|text| text.parse().ok())
        .ok_or_else(|| format!("each item of {what} must be an ID"))
}

/// An item of an array that must be a string.
pub(crate) fn item_string(value: &Value, what: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("each item of {what} must be a string"))
}

/// Builds a JSON object: unknown keys first, so known keys always win.
pub(crate) struct Out(JsonMap);

impl Out {
    /// An object that starts with the unknown keys.
    pub fn new(extra: &JsonMap) -> Out {
        Out(extra.clone())
    }

    /// Sets a member.
    pub fn put(&mut self, key: &str, value: impl Into<Value>) {
        self.0.insert(key.to_owned(), value.into());
    }

    /// Sets a member when `write` holds, as writers leave out values equal to their defaults.
    pub fn put_if(&mut self, write: bool, key: &str, value: impl FnOnce() -> Value) {
        if write {
            self.0.insert(key.to_owned(), value());
        }
    }

    /// The object.
    pub fn done(self) -> JsonMap {
        self.0
    }
}

/// A number as JSON. Non-finite numbers never reach the model, and would become `null`.
pub(crate) fn number(value: f64) -> Value {
    Value::from(value)
}

/// IDs as a JSON array of strings.
pub(crate) fn id_array<T: ToString>(ids: impl IntoIterator<Item = T>) -> Value {
    Value::Array(ids.into_iter().map(|id| Value::String(id.to_string())).collect())
}
