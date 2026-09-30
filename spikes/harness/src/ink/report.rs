//! Turns samples, page events, and frame intervals into the summaries in spikes/results/ink.json.

use serde_json::{json, Value};

use super::measure::{Outcome, Pacing, Sample};
use super::page::PageEvent;
use crate::common::stats;

/// The budget from docs/BRAND.md section 10, in milliseconds.
pub const BUDGET_MS: f64 = 25.0;
/// How many raw latencies each method keeps, as a modest sample of the distribution.
const KEPT_LATENCIES: usize = 40;
/// A page event matches a sample when it lands this close to the target, in CSS pixels.
const MATCH_DISTANCE: f64 = 2.0;

/// A summary with values rounded to microseconds, or null when there are no values.
pub fn summary(values: &[f64]) -> Value {
    let Some(summary) = stats::summarize(values) else {
        return Value::Null;
    };
    let mut value = serde_json::to_value(summary).unwrap_or(Value::Null);
    if let Value::Object(fields) = &mut value {
        for (_, field) in fields.iter_mut() {
            if let Some(number) = field.as_f64().filter(|_| field.is_f64()) {
                *field = json!(round(number, 3));
            }
        }
    }
    value
}

pub fn round(value: f64, places: i32) -> f64 {
    let scale = 10f64.powi(places);
    (value * scale).round() / scale
}

fn mean(values: &[f64]) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    json!(round(values.iter().sum::<f64>() / values.len() as f64, 3))
}

/// The display's refresh interval: the page's median animation frame interval while idle, else the
/// nominal refresh rate. Desktop presents aren't used, because a desynchronized canvas can present
/// more often than the display refreshes.
pub fn refresh_ms(idle_raf_ms: &[f64], nominal_hz: u32) -> f64 {
    (idle_raf_ms.len() >= 20)
        .then(|| stats::summarize(idle_raf_ms).map(|summary| summary.p50))
        .flatten()
        .unwrap_or(1000.0 / f64::from(nominal_hz.max(1)))
}

/// The first page move at the sample's target that the page handled after the input was sent.
pub fn match_event<'a>(sample: &Sample, events: &'a [PageEvent], offset_ms: f64) -> Option<&'a PageEvent> {
    events.iter().find(|event| {
        event.k == "m"
            && (event.x - sample.point.x).abs() <= MATCH_DISTANCE
            && (event.y - sample.point.y).abs() <= MATCH_DISTANCE
            && event.s + offset_ms >= sample.t0_ms - 1.0
    })
}

/// Where the time went, from the page's own timestamps lined up with the performance counter.
#[derive(Default)]
struct Breakdown {
    input_to_handler: Vec<f64>,
    event_queue: Vec<f64>,
    handler: Vec<f64>,
    drawn_to_present: Vec<f64>,
}

impl Breakdown {
    fn add(&mut self, sample: &Sample, present_ms: f64, event: &PageEvent, offset_ms: f64) {
        self.input_to_handler.push(event.s + offset_ms - sample.t0_ms);
        self.event_queue.push(event.s - event.t);
        self.handler.push(event.e - event.s);
        if event.d > 0.0 {
            self.drawn_to_present.push(present_ms - (event.d + offset_ms));
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "matched": self.handler.len(),
            "input_to_handler_ms": summary(&self.input_to_handler),
            "event_timestamp_to_handler_ms": summary(&self.event_queue),
            "handler_ms": summary(&self.handler),
            "drawn_to_present_ms": summary(&self.drawn_to_present),
        })
    }
}

/// The latency results for one injection method.
pub fn latency_report(samples: &[Sample], events: &[PageEvent], offset_ms: f64, frame_ms: f64) -> Value {
    let (mut latency, mut single, mut timeouts) = (Vec::new(), Vec::new(), 0);
    let not_blank = samples.iter().filter(|sample| !sample.blank).count();
    let mut invalid: Vec<String> = Vec::new();
    let mut breakdown = Breakdown::default();
    for sample in samples {
        match &sample.outcome {
            Outcome::Shown {
                present_ms,
                accumulated: count,
            } => {
                latency.push(present_ms - sample.t0_ms);
                if *count <= 1 {
                    single.push(present_ms - sample.t0_ms);
                }
                if let Some(event) = match_event(sample, events, offset_ms) {
                    breakdown.add(sample, *present_ms, event, offset_ms);
                }
            }
            Outcome::Timeout => timeouts += 1,
            Outcome::Invalid(reason) => invalid.push(reason.clone()),
        }
    }
    let frames: Vec<f64> = latency.iter().map(|ms| ms / frame_ms).collect();
    invalid.dedup();
    json!({
        "attempted": samples.len(),
        "shown": latency.len(),
        "timeouts": timeouts,
        "invalid": samples.len() - latency.len() - timeouts,
        "invalid_reasons": invalid.iter().take(3).collect::<Vec<_>>(),
        "shown_in_combined_frames": latency.len() - single.len(),
        "started_with_ink_in_region": not_blank,
        "latency_ms": summary(&latency),
        "latency_ms_single_update_frames": summary(&single),
        "latency_frames": summary(&frames),
        "within_25_ms": round(stats::share_within(&latency, BUDGET_MS), 3),
        "within_1_frame": round(stats::share_within(&frames, 1.0), 3),
        "within_2_frames": round(stats::share_within(&frames, 2.0), 3),
        "breakdown": breakdown.to_json(),
        "first_latencies_ms": latency.iter().take(KEPT_LATENCIES).map(|ms| round(*ms, 2)).collect::<Vec<_>>(),
    })
}

/// Counts long frames in a list of frame intervals: those over 1.5 frames, the frames they missed,
/// and those that missed two or more frames in a row. The frame rate budget forbids the last kind.
pub fn dropped_frames(intervals: &[f64], frame_ms: f64) -> (usize, usize, usize) {
    let missed = |interval: &f64| ((interval / frame_ms).round() as usize).saturating_sub(1);
    let long = intervals.iter().filter(|interval| **interval > 1.5 * frame_ms).count();
    let total = intervals.iter().map(missed).sum();
    let double = intervals.iter().filter(|interval| **interval >= 2.5 * frame_ms).count();
    (long, total, double)
}

/// Frame pacing and page costs during the continuous stroke.
pub fn pacing_report(pacing: &Pacing, events: &[PageEvent], frame_ms: f64) -> Value {
    let moves: Vec<&PageEvent> = events.iter().filter(|event| event.k == "m").collect();
    let durations = |from: fn(&PageEvent) -> f64| -> Vec<f64> {
        moves
            .iter()
            .map(|event| from(event))
            .filter(|ms| ms.is_finite() && *ms >= 0.0)
            .collect()
    };
    let (long, missed, double) = dropped_frames(&pacing.raf_ms, frame_ms);
    let (present_long, present_missed, present_double) = dropped_frames(&pacing.present_ms, frame_ms);
    json!({
        "injected_moves": pacing.injected,
        "page_move_events": moves.len(),
        "points_delivered": moves.iter().map(|event| event.n).sum::<f64>(),
        "coalesced_per_event": mean(&moves.iter().map(|event| event.n).collect::<Vec<_>>()),
        "predicted_per_event": mean(&moves.iter().map(|event| event.p).collect::<Vec<_>>()),
        "raf_interval_ms": summary(&pacing.raf_ms),
        "raf_long_frames": long,
        "raf_missed_frames": missed,
        "raf_two_or_more_missed_in_a_row": double,
        "present_interval_ms": summary(&pacing.present_ms),
        "present_long_frames": present_long,
        "present_missed_frames": present_missed,
        "present_two_or_more_missed_in_a_row": present_double,
        "presents_combining_updates": pacing.accumulated,
        "handler_ms": summary(&durations(|event| event.e - event.s)),
        "event_to_drawn_ms": summary(&durations(|event| if event.d > 0.0 { event.d - event.t } else { f64::NAN })),
        "event_to_next_frame_ms": summary(&durations(|event| if event.f > 0.0 { event.f - event.t } else { f64::NAN })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::plan::PenPoint;

    fn point(x: f64, y: f64) -> PenPoint {
        PenPoint {
            x,
            y,
            pressure: 0.5,
            tilt_x: 0,
            tilt_y: 0,
        }
    }

    fn event(x: f64, s: f64) -> PageEvent {
        PageEvent {
            k: "m".into(),
            t: s - 3.0,
            s,
            e: s + 0.5,
            d: s + 0.5,
            f: s + 6.0,
            x,
            y: 50.0,
            n: 1.0,
            p: 0.0,
        }
    }

    fn shown(x: f64, t0_ms: f64, present_ms: f64) -> Sample {
        Sample {
            t0_ms,
            point: point(x, 50.0),
            blank: true,
            outcome: Outcome::Shown {
                present_ms,
                accumulated: 1,
            },
        }
    }

    #[test]
    fn matches_page_events_by_place_and_time() {
        let events = [event(78.0, 5.0), event(108.0, 40.0), event(78.0, 90.0)];
        // Page time + 100 = counter time.
        let late = shown(78.0, 185.0, 200.0);
        assert_eq!(match_event(&late, &events, 100.0), Some(&events[2]));
        let early = shown(78.0, 104.0, 120.0);
        assert_eq!(match_event(&early, &events, 100.0), Some(&events[0]));
        assert_eq!(match_event(&shown(300.0, 0.0, 9.0), &events, 100.0), None);
    }

    #[test]
    fn reports_latency_in_milliseconds_and_frames() {
        let events = [event(78.0, 5.0), event(108.0, 40.0)];
        let samples = [
            shown(78.0, 104.0, 116.0),
            shown(108.0, 138.0, 168.0),
            Sample {
                t0_ms: 200.0,
                point: point(138.0, 50.0),
                blank: false,
                outcome: Outcome::Timeout,
            },
        ];
        let report = latency_report(&samples, &events, 100.0, 8.0);
        assert_eq!(report["shown"], 2);
        assert_eq!(report["timeouts"], 1);
        assert_eq!(report["started_with_ink_in_region"], 1);
        assert_eq!(report["latency_ms"]["min"], 12.0);
        assert_eq!(report["latency_frames"]["max"], 3.75);
        assert_eq!(report["within_25_ms"], 0.5);
        assert_eq!(report["within_2_frames"], 50.0 / 100.0);
        assert_eq!(report["breakdown"]["matched"], 2);
        assert_eq!(report["breakdown"]["input_to_handler_ms"]["min"], 1.0);
        assert_eq!(report["breakdown"]["drawn_to_present_ms"]["min"], 10.5);
    }

    #[test]
    fn counts_dropped_frames() {
        let intervals = [8.3, 8.4, 16.6, 8.3, 25.0, 8.3];
        assert_eq!(dropped_frames(&intervals, 8.33), (2, 3, 1));
        assert_eq!(dropped_frames(&[], 8.33), (0, 0, 0));
    }

    #[test]
    fn picks_the_refresh_interval() {
        let frames = vec![16.7; 30];
        assert_eq!(refresh_ms(&frames, 120), 16.7);
        assert!((refresh_ms(&frames[..5], 120) - 8.333).abs() < 0.001);
        assert!((refresh_ms(&[], 60) - 16.667).abs() < 0.001);
    }

    #[test]
    fn rounds_summaries() {
        let value = summary(&[1.23456, 2.0]);
        assert_eq!(value["min"], 1.235);
        assert_eq!(value["count"], 2);
        assert_eq!(summary(&[]), Value::Null);
    }
}
