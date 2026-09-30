//! Lenient parsing (ARCHITECTURE.md section 16.5). Each field deserializes on its own. A wrong type, an unknown
//! enum value, or a value that fails its check falls back to that field's default, and its path is reported.
//! The rest of the file is kept. Map entries and list items that don't parse are dropped one by one.
//!
//! It works on JSON values against the type's own defaults, so every settings and device state type gets it
//! from its serde derive. Unknown keys aren't part of the typed view; the raw document keeps them.

use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

/// A typed view and the paths of the fields that fell back to their defaults.
#[derive(Debug)]
pub struct Parsed<T> {
    pub value: T,
    pub repaired: Vec<Vec<String>>,
}

/// Parses `raw` as `T`. `check` validates what serde can't; a candidate it rejects counts as unparseable.
pub fn parse<T, C>(raw: &Value, check: C) -> Parsed<T>
where
    T: DeserializeOwned + Serialize + Default,
    C: Fn(&T) -> bool,
{
    let accepts = |candidate: &Value| T::deserialize(candidate).is_ok_and(|value| check(&value));
    // Serde would also read a struct from a list, so anything but an object counts as unreadable here.
    if !raw.is_object() {
        return Parsed {
            value: T::default(),
            repaired: vec![Vec::new()],
        };
    }
    if let Ok(value) = T::deserialize(raw) {
        if check(&value) {
            return Parsed {
                value,
                repaired: Vec::new(),
            };
        }
    }
    let defaults = serde_json::to_value(T::default()).unwrap_or(Value::Null);
    let mut walk = Walk {
        candidate: defaults.clone(),
        path: Vec::new(),
        repaired: Vec::new(),
        accepts: &accepts,
    };
    walk.fields(raw, &defaults);
    let value = T::deserialize(&walk.candidate).unwrap_or_default();
    Parsed {
        value,
        repaired: walk.repaired,
    }
}

struct Walk<'a> {
    /// Starts as the defaults, and takes each field from the raw document that the type accepts.
    candidate: Value,
    path: Vec<String>,
    repaired: Vec<Vec<String>>,
    accepts: &'a dyn Fn(&Value) -> bool,
}

impl Walk<'_> {
    /// Adopts the object's known fields one by one.
    fn fields(&mut self, raw: &Value, defaults: &Value) {
        let (Value::Object(raw), Value::Object(defaults)) = (raw, defaults) else {
            self.repaired.push(self.path.clone());
            return;
        };
        for (key, default) in defaults {
            if let Some(value) = raw.get(key) {
                self.path.push(key.clone());
                self.adopt(value, default);
                self.path.pop();
            }
        }
    }

    /// Takes the value at the current path whole when the type accepts it, and otherwise part by part.
    fn adopt(&mut self, value: &Value, default: &Value) {
        if self.try_set(value.clone()) {
            return;
        }
        self.set(default.clone());
        match (value, default) {
            // A struct: take each field on its own.
            (Value::Object(_), Value::Object(fields)) if !fields.is_empty() => self.fields(value, default),
            // A map: keep the entries that parse.
            (Value::Object(entries), Value::Object(_)) => self.entries(entries),
            (Value::Array(items), Value::Array(_)) => self.items(items, default),
            _ => self.repaired.push(self.path.clone()),
        }
    }

    fn entries(&mut self, entries: &serde_json::Map<String, Value>) {
        for (key, value) in entries {
            self.path.push(key.clone());
            if !self.try_set(value.clone()) {
                self.remove_last();
                self.repaired.push(self.path.clone());
            }
            self.path.pop();
        }
    }

    fn items(&mut self, items: &[Value], default: &Value) {
        let mut kept = Vec::new();
        for item in items {
            kept.push(item.clone());
            if !self.try_set(Value::Array(kept.clone())) {
                kept.pop();
            }
        }
        if !self.try_set(Value::Array(kept)) {
            self.set(default.clone());
        }
        self.repaired.push(self.path.clone());
    }

    fn try_set(&mut self, value: Value) -> bool {
        let before = self.get().cloned();
        self.set(value);
        if (self.accepts)(&self.candidate) {
            return true;
        }
        match before {
            Some(before) => self.set(before),
            None => self.remove_last(),
        }
        false
    }

    fn get(&self) -> Option<&Value> {
        self.path.iter().try_fold(&self.candidate, |node, key| node.get(key))
    }

    fn set(&mut self, value: Value) {
        let Some((last, parents)) = self.path.split_last() else {
            self.candidate = value;
            return;
        };
        let last = last.clone();
        if let Some(fields) = object_at(&mut self.candidate, parents) {
            fields.insert(last, value);
        }
    }

    fn remove_last(&mut self) {
        let Some((last, parents)) = self.path.split_last() else {
            return;
        };
        let last = last.clone();
        if let Some(fields) = object_at(&mut self.candidate, parents) {
            fields.remove(&last);
        }
    }
}

/// The object at `path`, when there is one.
fn object_at<'a>(root: &'a mut Value, path: &[String]) -> Option<&'a mut serde_json::Map<String, Value>> {
    path.iter()
        .try_fold(root, |node, key| node.get_mut(key))?
        .as_object_mut()
}

/// True when one path is the other or contains it.
pub fn related(a: &[String], b: &[String]) -> bool {
    a.iter().zip(b).all(|(x, y)| x == y)
}

/// Joins a path for messages and errors: `appearance.textSize`.
pub fn display(path: &[String]) -> String {
    path.join(".")
}

#[cfg(test)]
#[path = "lenient_tests.rs"]
mod tests;
