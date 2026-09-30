//! Where typing time goes, from a DevTools trace. For a few conditions, the harness records a trace while typing
//! and reports the page main thread's busiest trace events, by self time per key.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use serde_json::{json, Value};
use webview2_com::DevToolsProtocolEventReceivedEventHandler;
use windows::core::{HSTRING, PWSTR};
use wry::WebViewExtWindows;

use super::conditions::{Condition, Tweak, CONDITIONS};
use super::keys::{setup, type_key, WARM_UP};
use super::screen_timing::ScreenTimer;
use super::sharpness::decode_base64;
use crate::common::webview::Controller;
use crate::common::Result;

/// The conditions traced: a short note, the 20-page note, the 20-page note with each change that might speed it
/// up, and the plain 20-page note again as a control.
const TRACED: &[&str] = &[
    "baseline",
    "long",
    "long-content-visibility",
    "long-contain-paint",
    "long-accessibility",
    "long-control",
];
const KEYS: usize = 30;
/// How many trace events to report per condition.
const TOP: usize = 12;
const CATEGORIES: &[&str] = &[
    "toplevel",
    "blink",
    "cc",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "accessibility",
];

pub const METHOD: &str = "For each traced condition, the harness types 10 warm-up keys, then records a DevTools \
trace (Tracing.start, streamed) while typing 30 more. It reports the page main thread's trace events with the most \
self time (time not spent in nested events), in milliseconds per key.";

/// Subscribes to a DevTools event and returns a channel of its parameters as JSON text.
fn subscribe(controller: &Controller, event: &str) -> Result<Receiver<String>> {
    let (sender, events) = channel();
    let name = HSTRING::from(event);
    let outcome = controller.on_ui(move |webview, _| -> std::result::Result<(), String> {
        let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut json = PWSTR::null();
                unsafe { args.ParameterObjectAsJson(&mut json)? };
                let _ = sender.send(webview2_com::take_pwstr(json));
            }
            Ok(())
        }));
        let mut token = 0i64;
        unsafe {
            let receiver = webview.webview().GetDevToolsProtocolEventReceiver(&name);
            receiver.and_then(|receiver| receiver.add_DevToolsProtocolEventReceived(&handler, &mut token))
        }
        .map_err(|error| error.to_string())
    })?;
    outcome.map_err(|error| format!("Couldn't subscribe to {event}: {error}"))?;
    Ok(events)
}

/// Reads a DevTools stream to the end.
fn read_stream(controller: &Controller, handle: &str) -> Result<String> {
    let mut text = String::new();
    loop {
        let chunk = controller.cdp("IO.read", json!({ "handle": handle, "size": 4 << 20 }))?;
        let data = chunk["data"].as_str().unwrap_or_default();
        if chunk["base64Encoded"].as_bool() == Some(true) {
            let bytes = decode_base64(data).ok_or("A trace chunk wasn't valid base64.")?;
            text.push_str(&String::from_utf8_lossy(&bytes));
        } else {
            text.push_str(data);
        }
        if chunk["eof"].as_bool() != Some(false) {
            break;
        }
    }
    controller.cdp("IO.close", json!({ "handle": handle }))?;
    Ok(text)
}

/// Records a trace while typing `KEYS` keys, and returns its events.
fn record(controller: &Controller, complete: &Receiver<String>, condition: &Condition) -> Result<Vec<Value>> {
    let mut screen = ScreenTimer::off();
    for n in 0..WARM_UP {
        type_key(controller, super::input::typed_char(n), &mut screen, condition.zoom)?;
    }
    let config = json!({ "recordMode": "recordAsMuchAsPossible", "includedCategories": CATEGORIES });
    controller.cdp(
        "Tracing.start",
        json!({ "transferMode": "ReturnAsStream", "traceConfig": config }),
    )?;
    for n in 0..KEYS {
        type_key(
            controller,
            super::input::typed_char(WARM_UP + n),
            &mut screen,
            condition.zoom,
        )?;
    }
    controller.cdp("Tracing.end", json!({}))?;
    let done: Value = serde_json::from_str(&complete.recv_timeout(Duration::from_secs(60))?)?;
    let handle = done["stream"].as_str().ok_or("The trace came back without a stream.")?;
    let trace: Value = serde_json::from_str(&read_stream(controller, handle)?)?;
    let events = match trace {
        Value::Array(events) => events,
        mut document => document["traceEvents"].take().as_array().cloned().unwrap_or_default(),
    };
    Ok(events)
}

/// The (process, thread) of the busiest renderer main thread in the trace.
fn renderer_main(events: &[Value]) -> Option<(i64, i64)> {
    let named: Vec<(i64, i64)> = events
        .iter()
        .filter(|event| {
            event["ph"] == "M" && event["name"] == "thread_name" && event["args"]["name"] == "CrRendererMain"
        })
        .filter_map(|event| Some((event["pid"].as_i64()?, event["tid"].as_i64()?)))
        .collect();
    let busy = |thread: &(i64, i64)| {
        events
            .iter()
            .filter(|event| event["ph"] == "X" && event["pid"] == thread.0 && event["tid"] == thread.1)
            .count()
    };
    named.into_iter().max_by_key(busy)
}

/// Self time and count by event name for complete ("X") events on one thread, in microseconds.
pub fn self_times(events: &[Value], thread: (i64, i64)) -> HashMap<String, (f64, usize)> {
    let mut spans: Vec<(f64, f64, String)> = events
        .iter()
        .filter(|event| event["ph"] == "X" && event["pid"] == thread.0 && event["tid"] == thread.1)
        .filter_map(|event| {
            let name = event["name"].as_str()?.to_string();
            Some((event["ts"].as_f64()?, event["dur"].as_f64().unwrap_or(0.0), name))
        })
        .collect();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0).then(b.1.total_cmp(&a.1)));
    let mut own: Vec<f64> = spans.iter().map(|span| span.1).collect();
    let mut stack: Vec<usize> = Vec::new();
    for (index, (start, duration, _)) in spans.iter().enumerate() {
        while stack
            .last()
            .is_some_and(|&open| spans[open].0 + spans[open].1 <= *start)
        {
            stack.pop();
        }
        if let Some(&parent) = stack.last() {
            own[parent] -= duration;
        }
        stack.push(index);
    }
    let mut totals: HashMap<String, (f64, usize)> = HashMap::new();
    for ((_, _, name), time) in spans.iter().zip(own) {
        let entry = totals.entry(name.clone()).or_default();
        entry.0 += time.max(0.0);
        entry.1 += 1;
    }
    totals
}

/// The `TOP` names with the most self time, in milliseconds and calls per key.
fn top(totals: &HashMap<String, (f64, usize)>, keys: usize) -> Value {
    let mut sorted: Vec<(&String, &(f64, usize))> = totals.iter().collect();
    sorted.sort_by(|a, b| b.1 .0.total_cmp(&a.1 .0));
    let per_key = |value: f64| (value / keys as f64 * 1000.0).round() / 1000.0;
    let rows = sorted.into_iter().take(TOP).map(|(name, (time, count))| {
        json!({ "event": name, "self_ms_per_key": per_key(time / 1000.0), "calls_per_key": per_key(*count as f64) })
    });
    Value::Array(rows.collect())
}

/// Traces each condition in `TRACED` and returns the `trace` section of the results.
pub fn run(controller: &Controller) -> Result<Value> {
    let complete = subscribe(controller, "Tracing.tracingComplete")?;
    let mut traced = Vec::new();
    for condition in CONDITIONS.iter().filter(|condition| TRACED.contains(&condition.name)) {
        println!("Tracing: {}", condition.name);
        setup(controller, condition)?;
        let events = record(controller, &complete, condition)?;
        if condition.tweak == Tweak::Accessibility {
            controller.cdp("Accessibility.disable", json!({}))?;
        }
        let thread = renderer_main(&events).ok_or("The trace has no renderer main thread.")?;
        traced.push(json!({
            "name": condition.name,
            "events": events.len(),
            "top_self_time": top(&self_times(&events, thread), KEYS),
        }));
    }
    Ok(json!({ "status": "complete", "method": METHOD, "keys": KEYS, "conditions": traced }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(name: &str, ts: f64, dur: f64) -> Value {
        json!({ "ph": "X", "pid": 1, "tid": 2, "name": name, "ts": ts, "dur": dur })
    }

    #[test]
    fn subtracts_nested_events_from_self_time() {
        let events = vec![
            event("Task", 0.0, 100.0),
            event("Paint", 10.0, 60.0),
            event("Text", 20.0, 10.0),
            event("Task", 200.0, 50.0),
            json!({ "ph": "X", "pid": 9, "tid": 2, "name": "Other", "ts": 0.0, "dur": 999.0 }),
        ];
        let times = self_times(&events, (1, 2));
        assert_eq!(times["Task"], (90.0, 2));
        assert_eq!(times["Paint"], (50.0, 1));
        assert_eq!(times["Text"], (10.0, 1));
        assert!(!times.contains_key("Other"));
    }

    #[test]
    fn finds_the_busiest_renderer_main_thread() {
        let name = |pid: i64| {
            let args = json!({ "name": "CrRendererMain" });
            json!({ "ph": "M", "name": "thread_name", "pid": pid, "tid": 1, "args": args })
        };
        let work = |pid: i64| json!({ "ph": "X", "pid": pid, "tid": 1, "name": "Task", "ts": 0.0, "dur": 1.0 });
        let events = vec![name(1), name(2), work(2), work(2), work(1)];
        assert_eq!(renderer_main(&events), Some((2, 1)));
    }
}
