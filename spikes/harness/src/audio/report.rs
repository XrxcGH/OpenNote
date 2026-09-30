//! Turns a recording session into the results: per-stream timing and clock rates, what loopback did in
//! each phase, and how the test tone arrived.

use std::collections::BTreeMap;
use std::ops::Range;

use serde_json::{json, Value};

use super::analysis::{self, dbfs, frame_ns, Fit, TimeBase};
use super::detect;
use super::devices;
use super::session::{Captured, Phase, Session};
use super::streams::{ticks_to_ns, Packet, StreamError};
use crate::common::clock;
use crate::common::stats::summarize;

/// A callback this long after the last one starts a new run: the stream paused.
const PAUSE_MS: f64 = 100.0;

/// The capture run: each stream, what loopback did in each phase, and how the tone arrived.
pub fn capture(session: &Session) -> Value {
    let mut results = clock(session);
    if let Ok(captured) = &session.loopback {
        results["loopback"]["phases"] = loopback_phases(captured, session);
    }
    results["tone"] = session
        .phases
        .iter()
        .filter_map(|phase| detect::tone_arrival(phase, session))
        .collect();
    results
}

/// The clock run: each stream's timing, and the clocks compared.
pub fn clock(session: &Session) -> Value {
    let describe = |captured: &Result<Captured, String>| match captured {
        Ok(captured) => stream(captured, session.origin),
        Err(error) => json!({ "error": error }),
    };
    json!({
        "microphone": describe(&session.microphone),
        "loopback": describe(&session.loopback),
        "output": session.phases.iter().filter_map(|phase| output(phase, session.origin)).collect::<Vec<_>>(),
        "clocks": clocks(session.microphone.as_ref().ok(), session.loopback.as_ref().ok()),
    })
}

fn seconds_since(origin: i64, at: i64) -> f64 {
    clock::elapsed_ms(origin, at) / 1000.0
}

fn ms(from: i64, to: i64) -> f64 {
    clock::elapsed_ms(from, to)
}

/// The callback period the stream asked for, in milliseconds.
fn period_ms(captured: &Captured) -> f64 {
    let frames = captured.period_frames.unwrap_or_else(|| {
        let mut sizes: Vec<u32> = captured.packets.iter().map(|packet| packet.frames).collect();
        sizes.sort_unstable();
        sizes.get(sizes.len() / 2).copied().unwrap_or(0)
    });
    f64::from(frames) * frame_ns(captured.config.sample_rate()) / 1e6
}

fn breaks(captured: &Captured) -> Vec<analysis::Break> {
    let tolerance_ms = (period_ms(captured) / 2.0).max(2.0);
    analysis::breaks(&captured.packets, captured.config.sample_rate(), tolerance_ms)
}

/// Runs of packets with no break in capture and no pause in delivery.
fn runs(captured: &Captured) -> Vec<Range<usize>> {
    let runs = analysis::runs(captured.packets.len(), &breaks(captured));
    analysis::split_at_pauses(&captured.packets, &runs, PAUSE_MS)
}

fn fit(captured: &Captured, base: TimeBase) -> Option<Fit> {
    analysis::fit_rate(&captured.packets, &runs(captured), captured.config.sample_rate(), base)
}

fn stream(captured: &Captured, origin: i64) -> Value {
    let packets = &captured.packets;
    let runs = runs(captured);
    let intervals = analysis::intervals_within(packets, &runs);
    let period = period_ms(captured);
    let per_packet = |value: fn(&Packet) -> f64| summarize(&packets.iter().map(value).collect::<Vec<_>>());
    let stamped: Vec<f64> = packets
        .iter()
        .filter(|packet| packet.callback_ns > 0)
        .map(|packet| (packet.callback_ns as f64 - packet.capture_ns as f64) / 1e6)
        .collect();
    json!({
        "config": devices::config(&captured.config),
        "period_frames": captured.period_frames,
        "started_s": seconds_since(origin, captured.started),
        "packets": packets.len(),
        "frames": packets.iter().map(|packet| u64::from(packet.frames)).sum::<u64>(),
        "frames_per_packet": per_packet(|packet| f64::from(packet.frames)),
        "callback_interval_ms": summarize(&intervals),
        "late_callbacks": intervals.iter().filter(|interval| **interval > 2.0 * period).count(),
        "pauses": runs.len().saturating_sub(1),
        "breaks": breaks_report(captured, origin),
        "rate": {
            "by_capture_time": fit(captured, TimeBase::Capture),
            "by_arrival_time": fit(captured, TimeBase::Arrival),
        },
        "zero_fill": analysis::zero_fill(packets, &breaks(captured), captured.config.sample_rate()),
        "first_frame_age_ms": per_packet(|p| (ticks_to_ns(p.arrival) as f64 - p.capture_ns as f64) / 1e6),
        "callback_minus_capture_ms": summarize(&stamped),
        "packets_without_callback_time": packets.len() - stamped.len(),
        "callback_work_us": per_packet(|p| clock::ticks_to_ms(p.work) * 1000.0),
        "levels": levels(packets),
        "errors": errors(&captured.errors),
    })
}

fn breaks_report(captured: &Captured, origin: i64) -> Value {
    let mut breaks = breaks(captured);
    let missing_ms: f64 = breaks.iter().map(|b| b.missing_ms).sum();
    let count = breaks.len();
    breaks.sort_by(|a, b| b.missing_ms.abs().total_cmp(&a.missing_ms.abs()));
    let largest: Vec<Value> = breaks
        .iter()
        .take(5)
        .map(|b| {
            let at_s = seconds_since(origin, captured.packets[b.packet].arrival);
            json!({ "at_s": at_s, "missing_ms": b.missing_ms })
        })
        .collect();
    json!({ "count": count, "missing_ms": missing_ms, "largest": largest })
}

fn levels(packets: &[Packet]) -> Value {
    let peak = packets.iter().map(|packet| packet.peak).fold(0.0, f32::max);
    let power = packets.iter().map(|packet| f64::from(packet.rms).powi(2)).sum::<f64>() / packets.len().max(1) as f64;
    json!({
        "peak_dbfs": dbfs(f64::from(peak)),
        "rms_dbfs": dbfs(power.sqrt()),
        "silent_packets": packets.iter().filter(|packet| packet.peak == 0.0).count(),
    })
}

fn errors(errors: &[StreamError]) -> Value {
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    for error in errors {
        *kinds.entry(error.kind.as_str()).or_default() += 1;
    }
    json!({ "count": errors.len(), "kinds": kinds, "first": errors.iter().take(10).collect::<Vec<_>>() })
}

/// What loopback delivered in each phase, and how quickly it started and stopped with the output.
fn loopback_phases(captured: &Captured, session: &Session) -> Value {
    let packets = &captured.packets;
    let phases: Vec<Value> = session
        .phases
        .iter()
        .map(|phase| {
            let inside: Vec<Packet> = packets
                .iter()
                .filter(|p| (phase.start..phase.end).contains(&p.arrival))
                .copied()
                .collect();
            let mut entry = json!({
                "phase": phase.name,
                "start_s": seconds_since(session.origin, phase.start),
                "seconds": seconds_since(phase.start, phase.end),
                "packets": inside.len(),
                "levels": levels(&inside),
            });
            if let Some(Ok(played)) = &phase.played {
                let first = packets.iter().find(|p| p.arrival >= played.started);
                entry["first_packet_after_output_start_ms"] = json!(first.map(|p| ms(played.started, p.arrival)));
                entry["last_packet_after_output_stop_ms"] = json!(last_before_pause(packets, played.stopped));
            }
            entry
        })
        .collect();
    json!(phases)
}

/// When the stream stopped delivering after `stopped`, in milliseconds from it (negative when it had
/// already stopped): the last callback of the chain that runs past `stopped` with no pause longer than
/// `PAUSE_MS`.
fn last_before_pause(packets: &[Packet], stopped: i64) -> Option<f64> {
    let mut last = packets.iter().rposition(|packet| packet.arrival < stopped)?;
    while last + 1 < packets.len() && ms(packets[last].arrival, packets[last + 1].arrival) <= PAUSE_MS {
        last += 1;
    }
    Some(ms(stopped, packets[last].arrival))
}

fn output(phase: &Phase, origin: i64) -> Option<Value> {
    let played = match phase.played.as_ref()? {
        Ok(played) => played,
        Err(error) => return Some(json!({ "phase": phase.name, "error": error })),
    };
    let renders = &played.renders;
    let intervals: Vec<f64> = renders
        .windows(2)
        .map(|pair| ms(pair[0].arrival, pair[1].arrival))
        .collect();
    let lead: Vec<f64> = renders
        .iter()
        .filter(|render| render.callback_ns > 0)
        .map(|render| (render.playback_ns as f64 - render.callback_ns as f64) / 1e6)
        .collect();
    Some(json!({
        "phase": phase.name,
        "config": devices::config(&played.config),
        "period_frames": played.period_frames,
        "started_s": seconds_since(origin, played.started),
        "seconds": seconds_since(played.started, played.stopped),
        "callbacks": renders.len(),
        "callback_interval_ms": summarize(&intervals),
        "playback_minus_callback_ms": summarize(&lead),
        "tone": {
            "frequency_hz": played.tone.frequency_hz,
            "peak_dbfs": dbfs(f64::from(played.tone.amplitude)),
            "bursts": played.tone.bursts,
            "burst_ms": played.tone.on_frames as f64 * frame_ns(played.tone.sample_rate) / 1e6,
            "seconds_of_tone": played.tone.total_seconds(),
        },
        "errors": errors(&played.errors),
    }))
}

/// Each stream's clock against QPC, and against each other, with what that drift adds up to in 3 hours.
fn clocks(microphone: Option<&Captured>, loopback: Option<&Captured>) -> Value {
    let ppm = |captured: Option<&Captured>| fit(captured?, TimeBase::Capture).map(|fit| fit.ppm);
    let (mic, lo) = (ppm(microphone), ppm(loopback));
    let between = mic.zip(lo).map(|(mic, lo)| mic - lo);
    let three_hours = |ppm: Option<f64>| ppm.map(analysis::drift_over_three_hours_ms);
    json!({
        "microphone_ppm": mic,
        "loopback_ppm": lo,
        "microphone_minus_loopback_ppm": between,
        "microphone_ppm_each_minute": each_minute(microphone),
        "loopback_ppm_each_minute": each_minute(loopback),
        "drift_after_3_hours_ms": {
            "microphone_vs_qpc": three_hours(mic),
            "loopback_vs_qpc": three_hours(lo),
            "microphone_vs_loopback": three_hours(between),
        },
        "ppm_that_uses_up_100_ms_in_3_hours": 100.0 * 1000.0 / analysis::THREE_HOURS_S,
    })
}

/// The clock rate fitted over each minute on its own. The spread shows how far a short measurement
/// can be trusted.
fn each_minute(captured: Option<&Captured>) -> Value {
    let Some(captured) = captured else {
        return Value::Null;
    };
    let rate = captured.config.sample_rate();
    let ppm: Vec<f64> = analysis::windows(&captured.packets, &runs(captured), 60.0)
        .iter()
        .filter_map(|window| {
            let window = std::slice::from_ref(window);
            analysis::fit_rate(&captured.packets, window, rate, TimeBase::Capture).map(|fit| fit.ppm)
        })
        .collect();
    json!(summarize(&ppm))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arriving_at(ms: &[i64]) -> Vec<Packet> {
        ms.iter()
            .map(|at| Packet {
                arrival: at * clock::frequency() / 1000,
                capture_ns: 0,
                callback_ns: 0,
                frames: 480,
                peak: 0.0,
                rms: 0.0,
                work: 0,
            })
            .collect()
    }

    #[test]
    fn finds_when_delivery_stopped() {
        let stopped = 1_000 * clock::frequency() / 1000;
        let stops_early = arriving_at(&[970, 980, 990, 2_000]);
        assert!((last_before_pause(&stops_early, stopped).unwrap() + 10.0).abs() < 0.01);
        let runs_on = arriving_at(&[990, 1_000, 1_010, 1_020, 1_900]);
        assert!((last_before_pause(&runs_on, stopped).unwrap() - 20.0).abs() < 0.01);
        assert!(last_before_pause(&arriving_at(&[1_500]), stopped).is_none());
    }
}
