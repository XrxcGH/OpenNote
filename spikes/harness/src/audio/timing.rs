//! Times the test tone from the output stream to the loopback and microphone streams. Each burst edge
//! has three times. The first is when the output callback wrote it, and the second is when cpal
//! predicted it would play. The third is when a capture stream's timestamps say it was captured.

use serde::Serialize;

use super::analysis::frame_ns;
use super::streams::{ticks_to_ns, Packet, Render};
use super::tone::{self, Block, Crossing, Tone};
use crate::common::stats::{self, Summary};

/// A tone edge as written by the output stream.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Written {
    pub rising: bool,
    /// When the output callback that wrote the edge ran.
    pub written_ns: f64,
    /// When cpal predicted the edge would play.
    pub playback_ns: f64,
}

/// How the tone arrived in one capture stream.
#[derive(Clone, Debug, Serialize)]
pub struct Arrival {
    pub edges: usize,
    pub found: usize,
    /// Level at the tone frequency while the tone is on and while it's off, in dBFS.
    pub on_dbfs: Option<f64>,
    pub off_dbfs: Option<f64>,
    /// On level over off level, in decibels.
    pub snr_db: Option<f64>,
    /// The level inside each burst, in dBFS, which shows any gain that changes over time.
    pub burst_dbfs: Vec<f64>,
    /// The first burst after the output starts, which can fade in: capture minus playback for its
    /// rising and falling edges, in milliseconds.
    pub first_burst_minus_playback_ms: [Option<f64>; 2],
    /// The rest, from here on. Capture timestamp minus cpal's predicted playback time.
    pub capture_minus_playback_ms: Option<Summary>,
    /// Capture timestamp minus the time the output callback wrote the edge.
    pub capture_minus_write_ms: Option<Summary>,
    /// When the capture callback delivered the edge, minus when it was written.
    pub delivery_minus_write_ms: Option<Summary>,
}

/// Where each edge of `tone` went out, from the output stream's callbacks.
pub fn written_edges(tone: &Tone, renders: &[Render]) -> Vec<Written> {
    let frame = frame_ns(tone.sample_rate);
    tone.edges()
        .into_iter()
        .filter_map(|edge| {
            let render = renders.iter().find(|render| {
                let first = render.first_frame as f64;
                (first..first + f64::from(render.frames)).contains(&edge.frame)
            })?;
            // Before the device clock starts, cpal reports a callback time of zero.
            if render.callback_ns == 0 {
                return None;
            }
            Some(Written {
                rising: edge.rising,
                written_ns: ticks_to_ns(render.arrival) as f64,
                playback_ns: render.playback_ns as f64 + (edge.frame - render.first_frame as f64) * frame,
            })
        })
        .collect()
}

/// The tone level while on (the 95th percentile) and the noise floor (the median) between two times.
/// The bursts are on less than half the time, so the median falls between them.
pub fn levels(blocks: &[Block], from_ns: f64, to_ns: f64) -> Option<(f64, f64)> {
    let window = amplitudes(blocks, from_ns, to_ns);
    (window.len() >= 10).then(|| (stats::percentile(&window, 95.0), stats::percentile(&window, 50.0)))
}

/// Level measurements skip this much at each burst edge, so an offset that is off by a little still
/// measures the right parts.
const EDGE_NS: f64 = 20e6;
/// The level between bursts is measured up to this long after a burst ends.
const GAP_NS: f64 = 250e6;
/// A burst's edges must lie this close to where the offset puts them.
const SEARCH_NS: f64 = 75e6;

/// Edges found burst by burst, and the level inside each burst.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Local {
    pub found: Vec<Option<f64>>,
    pub levels: Vec<f64>,
}

/// The rising and falling edge of each whole burst, as indexes into `written`.
fn bursts(written: &[Written]) -> impl Iterator<Item = (usize, usize)> + '_ {
    (1..written.len())
        .filter(|&index| written[index - 1].rising && !written[index].rising)
        .map(|index| (index - 1, index))
}

/// The block amplitudes that start between two times, sorted.
fn amplitudes(blocks: &[Block], from_ns: f64, to_ns: f64) -> Vec<f64> {
    let mut values: Vec<f64> = blocks
        .iter()
        .filter(|block| (from_ns..to_ns).contains(&(block.start_ns as f64)))
        .map(|block| f64::from(block.amplitude))
        .collect();
    values.sort_by(f64::total_cmp);
    values
}

fn median(sorted: &[f64]) -> Option<f64> {
    (sorted.len() >= 5).then(|| stats::percentile(sorted, 50.0))
}

/// The median level inside the bursts and between them, with the bursts moved by `offset_ns`.
pub fn burst_levels(blocks: &[Block], written: &[Written], offset_ns: f64) -> Option<(f64, f64)> {
    let (mut on, mut off) = (Vec::new(), Vec::new());
    for (rise, fall) in bursts(written) {
        let start = written[rise].playback_ns + offset_ns;
        let end = written[fall].playback_ns + offset_ns;
        on.extend(amplitudes(blocks, start + EDGE_NS, end - EDGE_NS - 2e6));
        off.extend(amplitudes(blocks, end + 2.0 * EDGE_NS, end + GAP_NS));
    }
    on.sort_by(f64::total_cmp);
    off.sort_by(f64::total_cmp);
    Some((median(&on)?, median(&off)?))
}

/// Finds each burst's edges with its own threshold, halfway between the level inside the burst and
/// the level after it. A gain that changes slowly, such as an automatic gain control, then can't move
/// the edges. Bursts that don't stand `min_snr` times over the level after them are skipped.
pub fn local_edges(blocks: &[Block], written: &[Written], offset_ns: f64, block_ns: f64, min_snr: f64) -> Local {
    let mut local = Local {
        found: vec![None; written.len()],
        levels: Vec::new(),
    };
    for (rise, fall) in bursts(written) {
        let start = written[rise].playback_ns + offset_ns;
        let end = written[fall].playback_ns + offset_ns;
        let on = median(&amplitudes(blocks, start + EDGE_NS, end - EDGE_NS - block_ns));
        let off = median(&amplitudes(blocks, end + 2.0 * EDGE_NS, end + GAP_NS));
        let (Some(on), Some(off)) = (on, off) else {
            continue;
        };
        local.levels.push(on);
        if on < min_snr * off {
            continue;
        }
        let nearby: Vec<Block> = blocks
            .iter()
            .copied()
            .filter(|block| (start - SEARCH_NS..end + SEARCH_NS).contains(&(block.start_ns as f64)))
            .collect();
        let crossings = tone::crossings(&nearby, ((on + off) / 2.0) as f32, block_ns);
        local.found[rise] = nearest(&crossings, true, start, SEARCH_NS);
        local.found[fall] = nearest(&crossings, false, end, SEARCH_NS);
    }
    local
}

/// The crossing in the given direction nearest to `time_ns`, if one is within `within_ns`.
fn nearest(crossings: &[Crossing], rising: bool, time_ns: f64, within_ns: f64) -> Option<f64> {
    crossings
        .iter()
        .filter(|crossing| crossing.rising == rising && (crossing.time_ns - time_ns).abs() <= within_ns)
        .map(|crossing| crossing.time_ns)
        .min_by(|a, b| (a - time_ns).abs().total_cmp(&(b - time_ns).abs()))
}

/// Pairs each written edge with the nearest detected edge in the same direction, within `window_ns`.
pub fn match_edges(written: &[Written], found: &[Crossing], window_ns: f64) -> Vec<Option<f64>> {
    written
        .iter()
        .map(|edge| nearest(found, edge.rising, edge.playback_ns, window_ns))
        .collect()
}

/// When the callback that delivered the frame captured at `time_ns` ran, in nanoseconds.
pub fn delivered_ns(packets: &[Packet], time_ns: f64, sample_rate: u32) -> Option<f64> {
    let frame = frame_ns(sample_rate);
    packets
        .iter()
        .find(|packet| {
            let start = packet.capture_ns as f64;
            (start..start + f64::from(packet.frames) * frame).contains(&time_ns)
        })
        .map(|packet| ticks_to_ns(packet.arrival) as f64)
}

/// Summarizes how the edges arrived, given the edges detected in a capture stream. The first burst is
/// reported on its own, and the summaries cover the bursts after it.
pub fn arrival(written: &[Written], found: &[Option<f64>], packets: &[Packet], sample_rate: u32) -> Arrival {
    let first_burst = [0, 1].map(|index| {
        let edge = written.get(index)?;
        Some((found.get(index).copied().flatten()? - edge.playback_ns) / 1e6)
    });
    let pairs: Vec<(&Written, f64)> = written
        .iter()
        .zip(found)
        .skip(2)
        .filter_map(|(w, f)| Some((w, (*f)?)))
        .collect();
    let ms = |values: Vec<f64>| stats::summarize(&values);
    let delivery = pairs
        .iter()
        .filter_map(|(edge, time)| Some((delivered_ns(packets, *time, sample_rate)? - edge.written_ns) / 1e6))
        .collect();
    Arrival {
        edges: written.len(),
        found: found.iter().flatten().count(),
        on_dbfs: None,
        off_dbfs: None,
        snr_db: None,
        burst_dbfs: Vec::new(),
        first_burst_minus_playback_ms: first_burst,
        capture_minus_playback_ms: ms(pairs
            .iter()
            .map(|(edge, time)| (time - edge.playback_ns) / 1e6)
            .collect()),
        capture_minus_write_ms: ms(pairs
            .iter()
            .map(|(edge, time)| (time - edge.written_ns) / 1e6)
            .collect()),
        delivery_minus_write_ms: ms(delivery),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(first_frame: u64, playback_ns: u64) -> Render {
        Render {
            arrival: 0,
            callback_ns: 1,
            playback_ns,
            first_frame,
            frames: 480,
        }
    }

    #[test]
    fn maps_edges_to_the_callbacks_that_wrote_them() {
        let tone = Tone::new(48_000, 5, 1);
        let renders = [render(0, 1_000_000_000), render(480, 1_010_000_000)];
        let written = written_edges(&tone, &renders);
        assert_eq!(written.len(), 1, "the falling edge was never written");
        assert!(written[0].rising);
        let expected = 1_000_000_000.0 + 288.0 * 1e9 / 48_000.0;
        assert!((written[0].playback_ns - expected).abs() < 1.0);
    }

    #[test]
    fn matches_the_nearest_edge_in_the_same_direction() {
        let edge = |rising, playback_ns| Written {
            rising,
            written_ns: 0.0,
            playback_ns,
        };
        let written = [edge(true, 1e9), edge(false, 1.15e9), edge(true, 2e9)];
        let found = [
            Crossing {
                time_ns: 0.99e9,
                rising: true,
            },
            Crossing {
                time_ns: 1.14e9,
                rising: false,
            },
            Crossing {
                time_ns: 1.3e9,
                rising: true,
            },
        ];
        let matched = match_edges(&written, &found, 0.2e9);
        assert_eq!(matched, vec![Some(0.99e9), Some(1.14e9), None]);
    }

    #[test]
    fn reports_the_first_burst_on_its_own() {
        let edge = |rising, playback_ns| Written {
            rising,
            written_ns: playback_ns - 40e6,
            playback_ns,
        };
        let written = [
            edge(true, 1e9),
            edge(false, 1.15e9),
            edge(true, 1.5e9),
            edge(false, 1.65e9),
        ];
        let found = [Some(1.1e9), Some(1.18e9), Some(1.53e9), Some(1.68e9)];
        let arrival = arrival(&written, &found, &[], 48_000);
        assert_eq!(arrival.found, 4);
        let [rise, fall] = arrival.first_burst_minus_playback_ms;
        assert!((rise.unwrap() - 100.0).abs() < 1e-6 && (fall.unwrap() - 30.0).abs() < 1e-6);
        let steady = arrival.capture_minus_playback_ms.unwrap();
        assert_eq!(steady.count, 2);
        assert!((steady.p50 - 30.0).abs() < 1e-6);
        assert!((arrival.capture_minus_write_ms.unwrap().p50 - 70.0).abs() < 1e-6);
        assert!(arrival.delivery_minus_write_ms.is_none());
    }

    #[test]
    fn compares_the_level_inside_and_between_bursts() {
        let tone = Tone::new(48_000, 100, 3);
        let renders: Vec<Render> = (0..400).map(|index| render(index * 480, index * 10_000_000)).collect();
        let written = written_edges(&tone, &renders);
        assert_eq!(written.len(), 6);
        let blocks: Vec<Block> = (0..1_000)
            .map(|index| {
                let frame = index * 96;
                let on = tone.envelope(frame + 48) > 0.5;
                Block {
                    start_ns: frame * 1_000_000_000 / 48_000 + 30_000_000,
                    amplitude: if on { 0.01 } else { 0.001 },
                }
            })
            .collect();
        let (on, off) = burst_levels(&blocks, &written, 30e6).unwrap();
        assert_eq!((on, off), (0.01f32 as f64, 0.001f32 as f64));
    }

    #[test]
    fn finds_each_bursts_edges_while_the_gain_rises() {
        let tone = Tone::new(48_000, 100, 3);
        let renders: Vec<Render> = (0..400).map(|index| render(index * 480, index * 10_000_000)).collect();
        let written = written_edges(&tone, &renders);
        let offset_ns = 30e6;
        let mut filter = tone::Goertzel::new(19_000.0, 48_000.0, 96);
        let mut blocks = Vec::new();
        for frame in 0..48_000u64 * 2 {
            let gain = (0.05 + frame as f32 / 38_400.0).min(1.0);
            if let Some(amplitude) = filter.push(gain * tone.sample(frame)) {
                let start_ns = ((frame + 1 - 96) as f64 * 1e9 / 48_000.0 + offset_ns) as u64;
                blocks.push(Block { start_ns, amplitude });
            }
        }
        let local = local_edges(&blocks, &written, offset_ns, 2e6, 3.162);
        assert_eq!(local.levels.len(), 3);
        assert!(local.levels[0] < local.levels[2] / 2.0);
        // The gain doubles during the first burst here, which moves its edges by about 1 ms.
        for (edge, found) in written.iter().zip(&local.found) {
            let error_ms = (found.unwrap() - edge.playback_ns - offset_ns).abs() / 1e6;
            assert!(error_ms < 1.5, "edge off by {error_ms} ms");
        }
    }

    #[test]
    fn finds_levels_and_delivery_times() {
        let blocks: Vec<Block> = (0..100)
            .map(|index| Block {
                start_ns: index * 2_000_000,
                amplitude: if index % 4 == 0 { 0.01 } else { 0.0001 },
            })
            .collect();
        let (plateau, floor) = levels(&blocks, 0.0, 1e9).unwrap();
        assert_eq!((plateau, floor), (0.01f32 as f64, 0.0001f32 as f64));
        let packet = Packet {
            arrival: 0,
            capture_ns: 1_000_000,
            callback_ns: 0,
            frames: 480,
            peak: 0.0,
            rms: 0.0,
            work: 0,
        };
        assert_eq!(delivered_ns(&[packet], 5_000_000.0, 48_000), Some(0.0));
        assert_eq!(delivered_ns(&[packet], 12_000_000.0, 48_000), None);
    }
}
