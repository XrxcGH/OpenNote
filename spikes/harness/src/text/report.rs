//! Keeps `spikes/results/text.json` whole when only some modes run. A run replaces its own sections and keeps the
//! others from the last run. `--mode keys-screen` adds screen timing next to each condition's earlier in-page
//! numbers, without redoing or replacing them. A mode that fails as a whole keeps its earlier section and notes the
//! failure.

use std::path::Path;

use serde_json::{json, Map, Value};

use crate::common::{results, Result};

/// What one mode produced for its section of the results.
#[derive(Clone, Debug, PartialEq)]
pub enum Section {
    /// A new section that replaces the earlier one.
    Replace(Value),
    /// A keys-screen run, whose `screen` entries go into the earlier `keys` section condition by condition.
    Screen(Value),
    /// The mode failed as a whole, for this reason.
    Failed(String),
}

/// The `results` object of an earlier results file, or an empty one.
pub fn previous(path: &Path) -> Map<String, Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|document| document["results"].as_object().cloned())
        .unwrap_or_default()
}

/// Puts each new section into the earlier results.
pub fn merge(mut earlier: Map<String, Value>, sections: Vec<(String, Section)>) -> Value {
    for (name, section) in sections {
        let old = earlier.remove(&name);
        let new = match section {
            Section::Replace(value) => value,
            Section::Screen(run) => add_screen(old, &run),
            Section::Failed(reason) => keep_after_failure(old, &reason),
        };
        earlier.insert(name, new);
    }
    Value::Object(earlier)
}

/// Adds a keys-screen run to the earlier `keys` section. Each condition keeps everything it had and gets the
/// run's `screen` entry, or the run's failure for that condition. A condition the earlier section lacks is added
/// whole. Conditions the run didn't reach keep any earlier screen numbers.
fn add_screen(earlier: Option<Value>, run: &Value) -> Value {
    let mut keys = match earlier {
        Some(section @ Value::Object(_)) => section,
        _ => json!({}),
    };
    if !keys["conditions"].is_array() {
        keys["conditions"] = json!([]);
    }
    let attempted = run["conditions"].as_array().cloned().unwrap_or_default();
    if let Some(conditions) = keys["conditions"].as_array_mut() {
        for new in &attempted {
            match conditions
                .iter_mut()
                .find(|old| old["name"] == new["name"] && old.is_object())
            {
                Some(old) => old["screen"] = screen_entry(new),
                None => conditions.push(new.clone()),
            }
        }
        let why = match &run["status"] {
            Value::String(status) => status.clone(),
            _ => run["screen_status"].as_str().unwrap_or("the run stopped").to_string(),
        };
        for old in conditions.iter_mut().filter(|old| old.is_object()) {
            let reached = attempted.iter().any(|new| new["name"] == old["name"]);
            if !reached && old["screen"].get("to_screen_ms").is_none() {
                old["screen"] = json!({ "status": "not run", "reason": why });
            }
        }
    }
    keys["screen_status"] = run["screen_status"].clone();
    keys["screen_run"] = json!({
        "date": run["date"],
        "status": run["status"],
        "samples_per_condition": run["samples_per_condition"],
        "method": run["screen_method"],
        "placement": run["placement"],
    });
    keys
}

/// A condition's screen entry from a keys-screen run, or the condition's own failure when it has none.
fn screen_entry(condition: &Value) -> Value {
    match condition.get("screen") {
        Some(screen) => screen.clone(),
        None => json!({ "status": condition["status"], "reason": condition["reason"] }),
    }
}

/// The earlier section with the failure noted, or just the failure when there's no earlier section.
fn keep_after_failure(earlier: Option<Value>, reason: &str) -> Value {
    match earlier {
        Some(mut section @ Value::Object(_)) => {
            section["last_run"] = format!("failed: {reason}").into();
            section
        }
        _ => json!({ "status": format!("failed: {reason}") }),
    }
}

/// Writes the merged results with the date and machine.
pub fn write(path: &Path, sections: Vec<(String, Section)>) -> Result<()> {
    results::write(path, "text", merge(previous(path), sections))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn earlier() -> Map<String, Value> {
        let condition = |name: &str, p50: f64| {
            json!({
                "name": name,
                "page": { "to_painted_ms": { "p50": p50 } },
                "event_timing": { "keydown": { "over_16ms": 3 } },
                "screen": { "status": "pending: screen capture not available in this branch" },
            })
        };
        let keys = json!({
            "status": "complete",
            "method": "in-page",
            "samples_per_condition": 100,
            "screen_status": "pending: screen capture not available in this branch",
            "conditions": [condition("baseline", 10.3), condition("long", 17.0), condition("long-control", 16.8)],
        });
        json!({ "keys": keys, "zoom": { "kept": true } })
            .as_object()
            .cloned()
            .unwrap()
    }

    fn screen_run(conditions: Value) -> Section {
        Section::Screen(json!({
            "status": "incomplete: 1 of 2 conditions failed",
            "date": "2026-09-30",
            "samples_per_condition": 100,
            "screen_status": "measured",
            "screen_method": "screen",
            "placement": { "window_fits": true },
            "conditions": conditions,
        }))
    }

    #[test]
    fn replaces_only_the_sections_that_ran() {
        let merged = merge(
            earlier(),
            vec![("zoom".into(), Section::Replace(json!({ "new": true })))],
        );
        assert_eq!(merged["zoom"], json!({ "new": true }));
        assert_eq!(merged["keys"], earlier()["keys"]);
    }

    #[test]
    fn adds_screen_numbers_next_to_the_page_numbers() {
        let run = screen_run(json!([
            { "name": "baseline", "page": { "to_painted_ms": { "p50": 99.0 } },
              "screen": { "status": "measured", "to_screen_ms": { "p50": 21.5 } } },
            { "name": "long", "status": "failed", "reason": "setup timed out" },
        ]));
        let merged = merge(earlier(), vec![("keys".into(), run)]);
        let keys = &merged["keys"];
        let conditions = keys["conditions"].as_array().unwrap();
        assert_eq!(conditions.len(), 3);
        // Every earlier in-page number stays, and the run's own page numbers don't replace them.
        for (condition, p50) in conditions.iter().zip([10.3, 17.0, 16.8]) {
            assert_eq!(condition["page"]["to_painted_ms"]["p50"], p50);
            assert_eq!(condition["event_timing"]["keydown"]["over_16ms"], 3);
        }
        assert_eq!(conditions[0]["screen"]["to_screen_ms"]["p50"], 21.5);
        // The failure stays in its own condition.
        assert_eq!(
            conditions[1]["screen"],
            json!({ "status": "failed", "reason": "setup timed out" })
        );
        assert_eq!(
            conditions[2]["screen"],
            json!({ "status": "not run", "reason": "incomplete: 1 of 2 conditions failed" })
        );
        assert_eq!(
            (&keys["status"], &keys["method"]),
            (&json!("complete"), &json!("in-page"))
        );
        assert_eq!(keys["samples_per_condition"], 100);
        assert_eq!(keys["screen_status"], "measured");
        assert_eq!(keys["screen_run"]["status"], "incomplete: 1 of 2 conditions failed");
        assert_eq!(merged["zoom"], json!({ "kept": true }));
    }

    #[test]
    fn keeps_earlier_screen_numbers_when_a_screen_run_fails() {
        let first = screen_run(json!([
            { "name": "baseline", "screen": { "status": "measured", "to_screen_ms": { "p50": 21.5 } } },
        ]));
        let once = merge(earlier(), vec![("keys".into(), first)]);
        let failed = Section::Screen(json!({ "screen_status": "failed: Desktop Duplication isn't available" }));
        let twice = merge(once.as_object().cloned().unwrap(), vec![("keys".into(), failed)]);
        let conditions = twice["keys"]["conditions"].as_array().unwrap();
        assert_eq!(conditions[0]["screen"]["to_screen_ms"]["p50"], 21.5);
        assert_eq!(conditions[1]["page"]["to_painted_ms"]["p50"], 17.0);
        assert_eq!(
            conditions[1]["screen"]["reason"],
            "failed: Desktop Duplication isn't available"
        );
        assert_eq!(
            twice["keys"]["screen_status"],
            "failed: Desktop Duplication isn't available"
        );
    }

    #[test]
    fn adds_screen_timing_without_an_earlier_keys_section() {
        let run = screen_run(json!([{ "name": "baseline", "screen": { "status": "measured" } }]));
        for keys in [None, Some(json!("failed: an old error"))] {
            let mut results = Map::new();
            if let Some(keys) = keys {
                results.insert("keys".into(), keys);
            }
            let merged = merge(results, vec![("keys".into(), run.clone())]);
            assert_eq!(merged["keys"]["conditions"][0]["screen"]["status"], "measured");
        }
    }

    #[test]
    fn keeps_a_section_when_its_mode_fails() {
        let merged = merge(
            earlier(),
            vec![("zoom".into(), Section::Failed("window closed".into()))],
        );
        assert_eq!(
            merged["zoom"],
            json!({ "kept": true, "last_run": "failed: window closed" })
        );
        let fresh = merge(Map::new(), vec![("trace".into(), Section::Failed("no trace".into()))]);
        assert_eq!(fresh["trace"], json!({ "status": "failed: no trace" }));
    }

    #[test]
    fn starts_empty_without_an_earlier_file() {
        let path = std::env::temp_dir().join("opennote-text-missing-results.json");
        assert!(previous(&path).is_empty());
    }
}
