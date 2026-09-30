//! Where the page's main thread spends its time while typing, from the DevTools Performance domain. The harness
//! reads the running totals before and after each condition, and reports the difference per key.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::common::webview::Controller;
use crate::common::Result;

/// The totals worth reporting. Durations are in seconds in CDP and become milliseconds per key here.
const DURATIONS: &[&str] = &[
    "TaskDuration",
    "ScriptDuration",
    "RecalcStyleDuration",
    "LayoutDuration",
];
const COUNTS: &[&str] = &["RecalcStyleCount", "LayoutCount"];

/// Turns on the Performance domain, which keeps the totals.
pub fn enable(controller: &Controller) -> Result<()> {
    controller.cdp("Performance.enable", json!({}))?;
    Ok(())
}

/// The current totals by name.
pub fn totals(controller: &Controller) -> Result<BTreeMap<String, f64>> {
    let reply = controller.cdp("Performance.getMetrics", json!({}))?;
    Ok(parse(&reply))
}

fn parse(reply: &Value) -> BTreeMap<String, f64> {
    reply["metrics"]
        .as_array()
        .map(|metrics| {
            metrics
                .iter()
                .filter_map(|metric| Some((metric["name"].as_str()?.to_string(), metric["value"].as_f64()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// The change in each total between two readings, per key: milliseconds for durations, and a count for counts.
/// "OtherDuration" is task time outside script, style, and layout, which includes paint and the commit.
pub fn per_key(before: &BTreeMap<String, f64>, after: &BTreeMap<String, f64>, keys: usize) -> Value {
    let keys = keys.max(1) as f64;
    let change = |name: &str| after.get(name).unwrap_or(&0.0) - before.get(name).unwrap_or(&0.0);
    let round = |value: f64| (value * 1000.0).round() / 1000.0;
    let mut result = Map::new();
    for name in DURATIONS {
        result.insert(format!("{name}_ms"), json!(round(change(name) * 1000.0 / keys)));
    }
    let other = change("TaskDuration") - DURATIONS[1..].iter().map(|name| change(name)).sum::<f64>();
    result.insert("OtherDuration_ms".into(), json!(round(other * 1000.0 / keys)));
    for name in COUNTS {
        result.insert((*name).to_string(), json!(round(change(name) / keys)));
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_change_per_key() {
        let before = parse(&json!({ "metrics": [
            { "name": "TaskDuration", "value": 1.0 },
            { "name": "ScriptDuration", "value": 0.2 },
            { "name": "LayoutCount", "value": 10.0 },
        ] }));
        let after = parse(&json!({ "metrics": [
            { "name": "TaskDuration", "value": 1.5 },
            { "name": "ScriptDuration", "value": 0.3 },
            { "name": "LayoutDuration", "value": 0.1 },
            { "name": "LayoutCount", "value": 110.0 },
        ] }));
        let result = per_key(&before, &after, 100);
        assert_eq!(result["TaskDuration_ms"], 5.0);
        assert_eq!(result["ScriptDuration_ms"], 1.0);
        assert_eq!(result["LayoutDuration_ms"], 1.0);
        assert_eq!(result["OtherDuration_ms"], 3.0);
        assert_eq!(result["LayoutCount"], 1.0);
        assert_eq!(result["RecalcStyleCount"], 0.0);
    }
}
