//! Keeps `spikes/results/text.json` whole when only some modes run: a run replaces its own sections and keeps
//! the others from the last run. That way `--mode keys-screen` can add screen timing later without redoing the
//! zoom measurements.

use std::path::Path;

use serde_json::{Map, Value};

use crate::common::{results, Result};

/// The `results` object of an earlier results file, or an empty one.
pub fn previous(path: &Path) -> Map<String, Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|document| document["results"].as_object().cloned())
        .unwrap_or_default()
}

/// Puts each new section into the earlier results, replacing a section of the same name.
pub fn merge(mut earlier: Map<String, Value>, sections: Vec<(String, Value)>) -> Value {
    for (name, section) in sections {
        earlier.insert(name, section);
    }
    Value::Object(earlier)
}

/// Writes the merged results with the date and machine.
pub fn write(path: &Path, sections: Vec<(String, Value)>) -> Result<()> {
    results::write(path, "text", merge(previous(path), sections))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn replaces_only_the_sections_that_ran() {
        let earlier = json!({ "keys": { "old": true }, "zoom": { "kept": true } });
        let merged = merge(
            earlier.as_object().cloned().unwrap(),
            vec![("keys".into(), json!({ "new": true }))],
        );
        assert_eq!(merged, json!({ "keys": { "new": true }, "zoom": { "kept": true } }));
    }

    #[test]
    fn starts_empty_without_an_earlier_file() {
        let path = std::env::temp_dir().join("opennote-text-missing-results.json");
        assert!(previous(&path).is_empty());
    }
}
