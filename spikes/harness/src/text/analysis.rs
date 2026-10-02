//! Turns the page's raw timings into summaries: per-key times, Event Timing entries, and frame intervals.
//! Everything here is pure, so it's unit tested without a window.

use serde_json::{json, Map, Value};

use crate::common::stats::{share_within, summarize};

/// The typing budget in docs/BRAND.md section 10: a key press shows within 16 ms.
pub const TYPING_BUDGET_MS: f64 = 16.0;
/// One frame at 60 frames per second, the frame rate budget for zooming and scrolling.
pub const FRAME_60_MS: f64 = 1000.0 / 60.0;
/// Frame intervals jitter a little around whole display refreshes, so a limit only counts intervals longer
/// than it by this much. Two 120 Hz refreshes (16.67 ms) then don't count as slower than 60 frames per second.
const JITTER_MS: f64 = 1.0;

/// A number from a JSON object, or NaN when it's missing or null, so it drops out of summaries.
fn number(value: &Value, key: &str) -> f64 {
    value[key].as_f64().unwrap_or(f64::NAN)
}

/// Summarizes samples as JSON with values rounded to 0.01 ms, or null when there are none.
pub fn summary_json(samples: &[f64]) -> Value {
    match summarize(samples) {
        Some(summary) => {
            let round = |value: f64| (value * 100.0).round() / 100.0;
            json!({
                "count": summary.count,
                "min": round(summary.min),
                "p50": round(summary.p50),
                "p90": round(summary.p90),
                "p95": round(summary.p95),
                "p99": round(summary.p99),
                "max": round(summary.max),
                "mean": round(summary.mean),
                "stddev": round(summary.stddev),
            })
        }
        None => Value::Null,
    }
}

/// Rounds samples to 0.1 ms, to keep a modest sample in the results file.
pub fn rounded(samples: &[f64]) -> Vec<f64> {
    samples.iter().map(|value| (value * 10.0).round() / 10.0).collect()
}

/// Milliseconds from each key's keydown timestamp to `field` in the page's key records.
pub fn key_times(records: &[Value], field: &str) -> Vec<f64> {
    records
        .iter()
        .map(|record| number(record, field) - number(record, "stamp"))
        .collect()
}

/// Summaries of the page's per-key records: input delay, editor update, and painted.
pub fn key_summary(records: &[Value]) -> Value {
    let painted = key_times(records, "painted");
    let finite: Vec<f64> = painted.iter().copied().filter(|value| value.is_finite()).collect();
    json!({
        "keys": records.len(),
        "input_delay_ms": summary_json(&key_times(records, "handler")),
        "to_editor_update_ms": summary_json(&key_times(records, "update")),
        "to_painted_ms": summary_json(&painted),
        "painted_within_budget": share_within(&finite, TYPING_BUDGET_MS),
        "painted_sample_ms": rounded(&painted),
    })
}

/// Counts Event Timing durations by their 8 ms bucket, such as `{"16": 40, "24": 3}`.
fn duration_histogram(durations: &[f64]) -> Value {
    let mut buckets = std::collections::BTreeMap::new();
    for duration in durations {
        *buckets.entry(duration.round() as i64).or_insert(0usize) += 1;
    }
    let map: Map<String, Value> = buckets
        .into_iter()
        .map(|(bucket, count)| (bucket.to_string(), count.into()))
        .collect();
    Value::Object(map)
}

/// Summarizes the Event Timing entries named `name`. `dispatched` is how many such events the page saw in all.
/// Durations are rounded to 8 ms, and only 16 ms or more is reported, so the rest took under about 12 ms.
pub fn event_summary(entries: &[Value], name: &str, dispatched: u64) -> Value {
    let matching: Vec<&Value> = entries.iter().filter(|entry| entry["name"] == name).collect();
    let field = |key: &str| -> Vec<f64> { matching.iter().map(|entry| number(entry, key)).collect() };
    let differences = |end: &str, start: &str| -> Vec<f64> {
        matching
            .iter()
            .map(|entry| number(entry, end) - number(entry, start))
            .collect()
    };
    let durations = field("duration");
    let over_budget = durations
        .iter()
        .filter(|duration| **duration > TYPING_BUDGET_MS)
        .count();
    let mut summary = json!({
        "dispatched": dispatched,
        "reported_16ms_or_more": matching.len(),
        "over_16ms": over_budget,
        "duration_histogram_ms": duration_histogram(&durations),
        "duration_ms": summary_json(&durations),
        "input_delay_ms": summary_json(&differences("processingStart", "startTime")),
        "handler_ms": summary_json(&differences("processingEnd", "processingStart")),
    });
    // Newer browsers add exact paint and presentation times to each entry. Keep them when they're there.
    for (field, key) in [("paintTime", "to_paint_ms"), ("presentationTime", "to_presentation_ms")] {
        let times = summary_json(&differences(field, "startTime"));
        if !times.is_null() {
            summary[key] = times;
        }
    }
    summary
}

/// Frame pacing during a zoom or pan animation, from requestAnimationFrame intervals.
pub fn frame_summary(intervals: &[f64], refresh_hz: u32) -> Value {
    let vsync = 1000.0 / f64::from(refresh_hz.max(1));
    let seconds = intervals.iter().sum::<f64>() / 1000.0;
    let dropped: Vec<i64> = intervals
        .iter()
        .map(|interval| ((interval / vsync).round() as i64 - 1).max(0))
        .collect();
    let count_over = |limit: f64| {
        intervals
            .iter()
            .filter(|interval| **interval > limit + JITTER_MS)
            .count()
    };
    json!({
        "frames": intervals.len() + 1,
        "seconds": (seconds * 1000.0).round() / 1000.0,
        "frames_per_second": if seconds > 0.0 { (intervals.len() as f64 / seconds * 10.0).round() / 10.0 } else { 0.0 },
        "interval_ms": summary_json(intervals),
        "over_16_7ms": count_over(FRAME_60_MS),
        "over_33_3ms": count_over(2.0 * FRAME_60_MS),
        "display_refresh_hz": refresh_hz,
        "missed_display_refreshes": dropped.iter().sum::<i64>(),
        // docs/BRAND.md: "never two dropped frames in a row", at the display's own rate.
        "two_or_more_dropped_in_a_row": dropped.iter().filter(|count| **count >= 2).count(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_keys_from_their_keydown_stamp() {
        let records = vec![
            json!({ "stamp": 100.0, "handler": 101.0, "update": 103.0, "frame": 104.0, "painted": 110.0 }),
            json!({ "stamp": 200.0, "handler": 200.5, "update": null, "frame": 205.0, "painted": 220.0 }),
        ];
        assert_eq!(key_times(&records, "painted"), vec![10.0, 20.0]);
        let summary = key_summary(&records);
        assert_eq!(summary["keys"], 2);
        assert_eq!(summary["to_editor_update_ms"]["count"], 1);
        assert_eq!(summary["painted_within_budget"], 0.5);
        assert_eq!(summary["painted_sample_ms"], json!([10.0, 20.0]));
    }

    #[test]
    fn summarizes_event_timing_entries() {
        let entry = |name: &str, start: f64, processing: (f64, f64), duration: f64| {
            json!({
                "name": name,
                "startTime": start,
                "processingStart": processing.0,
                "processingEnd": processing.1,
                "duration": duration,
            })
        };
        let entries = vec![
            entry("keydown", 10.0, (11.0, 13.0), 16.0),
            entry("keydown", 50.0, (52.0, 53.0), 24.0),
            entry("input", 10.0, (12.0, 12.5), 16.0),
        ];
        let summary = event_summary(&entries, "keydown", 100);
        assert_eq!(summary["dispatched"], 100);
        assert_eq!(summary["reported_16ms_or_more"], 2);
        assert_eq!(summary["over_16ms"], 1);
        assert_eq!(summary["duration_histogram_ms"], json!({ "16": 1, "24": 1 }));
        assert_eq!(summary["input_delay_ms"]["max"], 2.0);
        assert!(summary.get("to_presentation_ms").is_none());
    }

    #[test]
    fn counts_slow_frames_and_missed_refreshes() {
        // At 120 Hz, a 16.7 ms interval misses one refresh and a 33.3 ms interval misses three.
        let intervals = [8.33, 8.34, 16.67, 33.33, 8.33];
        let summary = frame_summary(&intervals, 120);
        assert_eq!(summary["frames"], 6);
        assert_eq!(summary["over_16_7ms"], 1);
        assert_eq!(summary["over_33_3ms"], 0);
        assert_eq!(summary["missed_display_refreshes"], 4);
        assert_eq!(summary["two_or_more_dropped_in_a_row"], 1);
        assert_eq!(summary["seconds"], 0.075);
    }

    #[test]
    fn rounds_samples_for_the_results_file() {
        assert_eq!(rounded(&[1.234, 5.678]), vec![1.2, 5.7]);
        assert_eq!(summary_json(&[]), Value::Null);
    }
}
