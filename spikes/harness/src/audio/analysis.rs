//! Pure analysis of what the streams recorded: clock rates, breaks in the audio, callback timing, and
//! levels. Nothing here touches a device, so all of it has unit tests.

use std::ops::Range;

use serde::Serialize;

use super::streams::{ticks_to_ns, Packet};
use crate::common::stats::{self, Summary};

/// Seconds in the 3-hour recording that Phase 9 must keep in sync.
pub const THREE_HOURS_S: f64 = 3.0 * 3600.0;

/// A stream's clock rate measured against the QPC clock.
#[derive(Clone, Debug, Serialize)]
pub struct Fit {
    pub rate_hz: f64,
    /// How far the rate is from nominal, in parts per million. Positive means the stream runs fast.
    pub ppm: f64,
    /// How far each packet's time sits from the fitted line, in milliseconds.
    pub residual_ms: Option<Summary>,
    pub span_s: f64,
    pub packets: usize,
}

/// A break in capture: the stream's next packet started later (or earlier) than the last one ended.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Break {
    pub packet: usize,
    pub missing_ms: f64,
}

/// Which time to fit frames against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeBase {
    /// cpal's capture timestamp of each packet's first frame (from WASAPI).
    Capture,
    /// When the callback ran, against the frames delivered by then.
    Arrival,
}

/// What zero-filling the breaks would do to a track built from this stream.
#[derive(Clone, Debug, Serialize)]
pub struct ZeroFill {
    pub inserted_ms: f64,
    /// How far each packet would sit from its capture time in a track built at the nominal rate.
    pub drift_at_end_ms: f64,
    pub worst_ms: f64,
}

pub fn frame_ns(sample_rate: u32) -> f64 {
    1e9 / f64::from(sample_rate)
}

/// Milliseconds between one callback and the next.
pub fn intervals_ms(packets: &[Packet]) -> Vec<f64> {
    packets
        .windows(2)
        .map(|pair| (ticks_to_ns(pair[1].arrival) as f64 - ticks_to_ns(pair[0].arrival) as f64) / 1e6)
        .collect()
}

/// Breaks in capture larger than `tolerance_ms`, where audio was lost or the stream paused.
pub fn breaks(packets: &[Packet], sample_rate: u32, tolerance_ms: f64) -> Vec<Break> {
    let frame = frame_ns(sample_rate);
    packets
        .windows(2)
        .enumerate()
        .filter_map(|(index, pair)| {
            let expected = pair[0].capture_ns as f64 + f64::from(pair[0].frames) * frame;
            let missing_ms = (pair[1].capture_ns as f64 - expected) / 1e6;
            (missing_ms.abs() > tolerance_ms).then_some(Break {
                packet: index + 1,
                missing_ms,
            })
        })
        .collect()
}

/// The unbroken runs of packets between breaks.
pub fn runs(count: usize, breaks: &[Break]) -> Vec<Range<usize>> {
    let mut starts: Vec<usize> = std::iter::once(0).chain(breaks.iter().map(|b| b.packet)).collect();
    starts.push(count);
    starts
        .windows(2)
        .map(|pair| pair[0]..pair[1])
        .filter(|run| !run.is_empty())
        .collect()
}

/// Splits runs wherever a callback came more than `pause_ms` after the one before. Loopback can hold its
/// last packet until something plays again, so a run with no break in capture can still pause.
pub fn split_at_pauses(packets: &[Packet], runs: &[Range<usize>], pause_ms: f64) -> Vec<Range<usize>> {
    let mut split = Vec::new();
    for run in runs {
        let mut start = run.start;
        for index in run.start + 1..run.end {
            let gap =
                (ticks_to_ns(packets[index].arrival) as f64 - ticks_to_ns(packets[index - 1].arrival) as f64) / 1e6;
            if gap > pause_ms {
                split.push(start..index);
                start = index;
            }
        }
        split.push(start..run.end);
    }
    split
}

/// Cuts runs into windows of `seconds` of capture time, and drops a last piece shorter than 90% of
/// that. Fitting each window on its own shows how steady a clock's rate is.
pub fn windows(packets: &[Packet], runs: &[Range<usize>], seconds: f64) -> Vec<Range<usize>> {
    let span = |from: usize, to: usize| (packets[to].capture_ns as f64 - packets[from].capture_ns as f64) / 1e9;
    let mut windows = Vec::new();
    for run in runs.iter().filter(|run| !run.is_empty()) {
        let mut start = run.start;
        for index in run.clone() {
            if span(start, index) >= seconds {
                windows.push(start..index);
                start = index;
            }
        }
        if span(start, run.end - 1) >= 0.9 * seconds {
            windows.push(start..run.end);
        }
    }
    windows
}

/// Milliseconds between callbacks within each run, leaving out the pauses between runs.
pub fn intervals_within(packets: &[Packet], runs: &[Range<usize>]) -> Vec<f64> {
    runs.iter()
        .flat_map(|run| intervals_ms(&packets[run.clone()]))
        .collect()
}

/// Fits time against frame count within each run (one slope, an offset per run), so pauses between
/// runs don't bend the line. Returns the stream's real rate on the QPC clock.
pub fn fit_rate(packets: &[Packet], runs: &[Range<usize>], sample_rate: u32, base: TimeBase) -> Option<Fit> {
    let points: Vec<Vec<(f64, f64)>> = runs.iter().map(|run| run_points(&packets[run.clone()], base)).collect();
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for run in &points {
        let (mx, my) = means(run);
        for (x, y) in run {
            sxy += (x - mx) * (y - my);
            sxx += (x - mx) * (x - mx);
        }
    }
    if sxx <= 0.0 {
        return None;
    }
    let seconds_per_frame = sxy / sxx;
    let mut residuals = Vec::new();
    for run in &points {
        let (mx, my) = means(run);
        residuals.extend(
            run.iter()
                .map(|(x, y)| ((y - my) - seconds_per_frame * (x - mx)).abs() * 1000.0),
        );
    }
    let span_s = points
        .iter()
        .filter_map(|run| Some(run.last()?.1 - run.first()?.1))
        .sum();
    let rate_hz = 1.0 / seconds_per_frame;
    Some(Fit {
        rate_hz,
        ppm: (rate_hz / f64::from(sample_rate) - 1.0) * 1e6,
        residual_ms: stats::summarize(&residuals),
        span_s,
        packets: residuals.len(),
    })
}

/// (frames so far, seconds) for each packet in a run.
fn run_points(run: &[Packet], base: TimeBase) -> Vec<(f64, f64)> {
    let mut frames = 0u64;
    run.iter()
        .map(|packet| {
            let point = match base {
                TimeBase::Capture => (frames as f64, packet.capture_ns as f64 / 1e9),
                TimeBase::Arrival => (
                    (frames + u64::from(packet.frames)) as f64,
                    ticks_to_ns(packet.arrival) as f64 / 1e9,
                ),
            };
            frames += u64::from(packet.frames);
            point
        })
        .collect()
}

fn means(points: &[(f64, f64)]) -> (f64, f64) {
    let count = points.len().max(1) as f64;
    let (sx, sy) = points.iter().fold((0.0, 0.0), |(sx, sy), (x, y)| (sx + x, sy + y));
    (sx / count, sy / count)
}

/// Builds a track the way a recorder would: packets back to back at the nominal rate, with silence
/// inserted wherever the capture times show a break. Reports how far the track drifts from the
/// capture times.
pub fn zero_fill(packets: &[Packet], breaks: &[Break], sample_rate: u32) -> Option<ZeroFill> {
    let first = packets.first()?;
    let frame = frame_ns(sample_rate);
    let (mut position, mut inserted, mut worst) = (0.0f64, 0.0f64, 0.0f64);
    let mut offset = 0.0;
    for (index, packet) in packets.iter().enumerate() {
        if let Some(gap) = breaks.iter().find(|b| b.packet == index) {
            let silence = (gap.missing_ms * 1e6 / frame).round().max(0.0) * frame;
            position += silence;
            inserted += silence;
        }
        offset = (packet.capture_ns as f64 - first.capture_ns as f64) - position;
        worst = worst.max(offset.abs());
        position += f64::from(packet.frames) * frame;
    }
    Some(ZeroFill {
        inserted_ms: inserted / 1e6,
        drift_at_end_ms: offset / 1e6,
        worst_ms: worst / 1e6,
    })
}

/// Milliseconds a clock that runs `ppm` fast or slow gains or loses over 3 hours.
pub fn drift_over_three_hours_ms(ppm: f64) -> f64 {
    ppm * THREE_HOURS_S / 1000.0
}

/// A level in decibels relative to full scale.
pub fn dbfs(level: f64) -> f64 {
    if level > 0.0 {
        20.0 * level.log10()
    } else {
        f64::NEG_INFINITY
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::clock;

    const RATE: u32 = 48_000;

    /// Packets of 480 frames from a clock that runs `ppm` fast, with a pause after packet `pause_at`.
    fn packets(count: usize, ppm: f64, pause_at: usize, pause_ms: f64) -> Vec<Packet> {
        let frame = 1e9 / (f64::from(RATE) * (1.0 + ppm / 1e6));
        let mut time = 1e9;
        (0..count)
            .map(|index| {
                if index == pause_at {
                    time += pause_ms * 1e6;
                }
                let capture_ns = time as u64;
                time += 480.0 * frame;
                let arrival_ns = capture_ns + 12_000_000;
                Packet {
                    arrival: (i128::from(arrival_ns as i64) * i128::from(clock::frequency()) / 1_000_000_000) as i64,
                    capture_ns,
                    callback_ns: arrival_ns,
                    frames: 480,
                    peak: 0.5,
                    rms: 0.1,
                    work: 0,
                }
            })
            .collect()
    }

    #[test]
    fn measures_a_clock_that_runs_fast() {
        let log = packets(6_000, 40.0, usize::MAX, 0.0);
        let breaks = breaks(&log, RATE, 2.0);
        assert!(breaks.is_empty());
        let runs = runs(log.len(), &breaks);
        let fit = fit_rate(&log, &runs, RATE, TimeBase::Capture).unwrap();
        assert!((fit.ppm - 40.0).abs() < 0.01, "measured {} ppm", fit.ppm);
        assert!(fit.residual_ms.unwrap().max < 0.001);
        let by_arrival = fit_rate(&log, &runs, RATE, TimeBase::Arrival).unwrap();
        assert!((by_arrival.ppm - 40.0).abs() < 0.1);
        let fill = zero_fill(&log, &breaks, RATE).unwrap();
        assert!(
            (fill.drift_at_end_ms + 2.4).abs() < 0.01,
            "drift {}",
            fill.drift_at_end_ms
        );
        assert_eq!(drift_over_three_hours_ms(40.0), 432.0);
    }

    #[test]
    fn finds_pauses_and_fits_across_them() {
        let log = packets(3_000, -20.0, 1_000, 2_500.0);
        let breaks = breaks(&log, RATE, 2.0);
        assert_eq!(breaks.len(), 1);
        assert_eq!(breaks[0].packet, 1_000);
        assert!((breaks[0].missing_ms - 2_500.0).abs() < 0.01);
        let runs = runs(log.len(), &breaks);
        assert_eq!(runs, vec![0..1_000, 1_000..3_000]);
        let fit = fit_rate(&log, &runs, RATE, TimeBase::Capture).unwrap();
        assert!((fit.ppm + 20.0).abs() < 0.01);
        let fill = zero_fill(&log, &breaks, RATE).unwrap();
        assert!((fill.inserted_ms - 2_500.0).abs() < 0.03);
        assert!(fill.worst_ms < 1.0);
    }

    #[test]
    fn cuts_runs_into_windows_of_capture_time() {
        let log = packets(1_000, 0.0, 400, 3_000.0);
        let runs = runs(log.len(), &breaks(&log, RATE, 2.0));
        let windows = windows(&log, &runs, 0.995);
        assert_eq!(windows[..2], [0..100, 100..200]);
        assert_eq!(windows[3..5], [300..400, 400..500]);
        assert_eq!(windows.len(), 10, "{windows:?}");
        assert!(windows.iter().all(|window| window.len() >= 90));
        for window in &windows {
            let fit = fit_rate(&log, std::slice::from_ref(window), RATE, TimeBase::Capture).unwrap();
            assert!(fit.ppm.abs() < 0.01);
        }
    }

    #[test]
    fn splits_runs_where_callbacks_pause() {
        let mut log = packets(10, 0.0, usize::MAX, 0.0);
        for packet in &mut log[6..] {
            packet.arrival += clock::frequency();
        }
        let runs = split_at_pauses(&log, &runs(10, &[]), 100.0);
        assert_eq!(runs, vec![0..6, 6..10]);
        let intervals = intervals_within(&log, &runs);
        assert_eq!(intervals.len(), 8);
        assert!(intervals.iter().all(|interval| (interval - 10.0).abs() < 0.001));
    }

    #[test]
    fn measures_callback_intervals_and_levels() {
        let log = packets(3, 0.0, usize::MAX, 0.0);
        let intervals = intervals_ms(&log);
        assert_eq!(intervals.len(), 2);
        assert!((intervals[0] - 10.0).abs() < 0.001);
        assert!((dbfs(0.01) + 40.0).abs() < 1e-9);
        assert_eq!(dbfs(0.0), f64::NEG_INFINITY);
        assert!(fit_rate(&log[..1], &runs(1, &[]), RATE, TimeBase::Capture).is_none());
    }
}
