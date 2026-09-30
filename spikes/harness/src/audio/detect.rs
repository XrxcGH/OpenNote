//! Finds the test tone in the loopback and microphone streams, and times its edges against the output
//! stream that played it.

use serde_json::{json, Value};

use super::analysis::{dbfs, frame_ns};
use super::session::{Captured, Phase, Played, Session};
use super::streams;
use super::timing::{self, Written};
use super::tone::{self, Block};
use crate::common::stats;

/// Look this far on each side of the tone.
const MARGIN_NS: f64 = 300e6;
/// A detected edge must be this close to when the output stream played it.
const MATCH_WINDOW_NS: f64 = 200e6;
/// The tone must stand 10 dB over the level between bursts to be timed.
const MIN_SNR: f64 = 3.162;

/// Times one tone stretch in the loopback and microphone streams.
///
/// The sound reaches both at about the same time. So the microphone's burst windows use the offset
/// measured in loopback.
pub fn tone_arrival(phase: &Phase, session: &Session) -> Option<Value> {
    let played: &Played = phase.played.as_ref()?.as_ref().ok()?;
    let written = timing::written_edges(&played.tone, &played.renders);
    let loopback = session
        .loopback
        .as_ref()
        .ok()
        .map(|captured| detect(captured, &written, None));
    let offset = loopback.as_ref().and_then(|(_, offset)| *offset).unwrap_or(0.0);
    let microphone = session
        .microphone
        .as_ref()
        .ok()
        .map(|captured| detect(captured, &written, Some(offset)));
    Some(json!({
        "phase": phase.name,
        "edges_written": written.len(),
        "loopback": loopback.map(|(value, _)| value),
        "microphone": microphone.map(|(value, _)| value),
    }))
}

/// Times the tone in one stream. With `offset_ns`, it compares the level inside and between the bursts
/// placed at that offset. Without it, it compares the loudest blocks with the typical ones, and finds
/// the offset itself. Then it times each burst with its own threshold. Returns the results and the
/// median offset of the capture times from cpal's playback times.
fn detect(captured: &Captured, written: &[Written], offset_ns: Option<f64>) -> (Value, Option<f64>) {
    let (Some(first), Some(last)) = (written.first(), written.last()) else {
        return (Value::Null, None);
    };
    let (from, to) = (first.playback_ns - MARGIN_NS, last.playback_ns + MARGIN_NS);
    let window: Vec<Block> = captured
        .blocks
        .iter()
        .copied()
        .filter(|block| (from..to).contains(&(block.start_ns as f64)))
        .collect();
    let levels = match offset_ns {
        Some(offset) => timing::burst_levels(&window, written, offset),
        None => timing::levels(&window, from, to),
    };
    let Some((on, off)) = levels else {
        return (
            json!({ "error": "The stream delivered too little audio while the tone played." }),
            None,
        );
    };
    let snr = on / off.max(1e-7);
    let rate = captured.config.sample_rate();
    let block_ns = streams::block_frames(rate) as f64 * frame_ns(rate);
    let offset = offset_ns.or_else(|| typical_offset(&window, written, (on + off) / 2.0, block_ns));
    let local = match offset {
        Some(offset) if snr >= MIN_SNR => timing::local_edges(&window, written, offset, block_ns, MIN_SNR),
        _ => timing::Local {
            found: vec![None; written.len()],
            levels: Vec::new(),
        },
    };
    let mut arrival = timing::arrival(written, &local.found, &captured.packets, rate);
    arrival.on_dbfs = Some(dbfs(on));
    arrival.off_dbfs = Some(dbfs(off));
    arrival.snr_db = Some(dbfs(snr));
    arrival.burst_dbfs = local.levels.iter().map(|level| dbfs(*level)).collect();
    let offset = arrival
        .capture_minus_playback_ms
        .as_ref()
        .map(|summary| summary.p50 * 1e6);
    (json!(arrival), offset)
}

/// The median offset of the edges from their playback times, found with one threshold for the whole
/// stretch. Most bursts are steady, so a few that fade in don't move the median.
fn typical_offset(window: &[Block], written: &[Written], threshold: f64, block_ns: f64) -> Option<f64> {
    let crossings = tone::crossings(window, threshold as f32, block_ns);
    let matched = timing::match_edges(written, &crossings, MATCH_WINDOW_NS);
    let mut offsets: Vec<f64> = written
        .iter()
        .zip(matched)
        .filter_map(|(edge, time)| Some(time? - edge.playback_ns))
        .collect();
    offsets.sort_by(f64::total_cmp);
    (!offsets.is_empty()).then(|| stats::percentile(&offsets, 50.0))
}
