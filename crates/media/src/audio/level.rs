//! Level metering: how loud a track is right now, and how long it has been quiet.
//!
//! The writer thread observes every packet it records, and the screen reads a snapshot a few times a
//! second. The two share atomics, so neither waits for the other. Meters follow what the person hears
//! on the recording, so they read the samples after the pause filter, before conversion to 48 kHz.
//!
//! The snapshot reports the loudest sample since the last snapshot, which is what a peak meter shows,
//! and the root mean square (RMS) of the latest packet. The screen adds hold and fall-off.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

/// Below this peak, a packet counts as silent: about -60 dBFS (decibels relative to full scale).
pub const SILENCE_FLOOR: f32 = 0.001;
/// At or above this peak, a packet counts as clipped.
pub const CLIP_LEVEL: f32 = 0.999;
/// The lowest level a snapshot reports, in decibels.
pub const FLOOR_DB: f32 = -96.0;

/// What a track's meter reports.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    /// The largest absolute sample since the previous snapshot, from 0 to 1.
    pub peak: f32,
    /// The RMS of the latest packet, from 0 to 1.
    pub rms: f32,
    /// Whether any packet since the previous snapshot reached full scale.
    pub clipped: bool,
    /// Milliseconds since a packet last rose above the silence floor.
    pub silent_ms: u64,
    /// Milliseconds since the last packet arrived. This grows when a device stalls or disconnects.
    pub idle_ms: u64,
}

impl Level {
    pub fn peak_db(&self) -> f32 {
        to_db(self.peak)
    }

    pub fn rms_db(&self) -> f32 {
        to_db(self.rms)
    }
}

/// A linear level in decibels, never below [`FLOOR_DB`].
pub fn to_db(level: f32) -> f32 {
    if level <= 0.0 {
        FLOOR_DB
    } else {
        (20.0 * level.log10()).max(FLOOR_DB)
    }
}

/// The shared state of one track's meter.
#[derive(Debug)]
pub struct Meter {
    /// The bits of an `f32` that is never negative, so integer order is numeric order.
    peak: AtomicU32,
    rms: AtomicU32,
    clipped: AtomicBool,
    last_packet_ns: AtomicU64,
    last_loud_ns: AtomicU64,
}

impl Meter {
    /// A meter for a track that starts at `now_ns`, which counts as the last time it was loud.
    pub fn new(now_ns: u64) -> Self {
        Meter {
            peak: AtomicU32::new(0),
            rms: AtomicU32::new(0),
            clipped: AtomicBool::new(false),
            last_packet_ns: AtomicU64::new(now_ns),
            last_loud_ns: AtomicU64::new(now_ns),
        }
    }

    /// Takes in one packet of mono samples that was captured at `capture_ns`.
    pub fn observe(&self, capture_ns: u64, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let (mut peak, mut sum) = (0f32, 0f64);
        for sample in samples {
            peak = peak.max(sample.abs());
            sum += f64::from(*sample) * f64::from(*sample);
        }
        let rms = (sum / samples.len() as f64).sqrt() as f32;
        self.peak.fetch_max(peak.to_bits(), Ordering::Relaxed);
        self.rms.store(rms.to_bits(), Ordering::Relaxed);
        if peak >= CLIP_LEVEL {
            self.clipped.store(true, Ordering::Relaxed);
        }
        self.last_packet_ns.fetch_max(capture_ns, Ordering::Relaxed);
        if peak >= SILENCE_FLOOR {
            self.last_loud_ns.fetch_max(capture_ns, Ordering::Relaxed);
        }
    }

    /// Starts the silence and idle counts again at `now_ns`, after a pause or a change of device.
    pub fn restart(&self, now_ns: u64) {
        self.last_packet_ns.store(now_ns, Ordering::Relaxed);
        self.last_loud_ns.store(now_ns, Ordering::Relaxed);
    }

    /// Milliseconds since the track was last loud, and since its last packet, at capture time
    /// `now_ns`. Unlike [`Meter::snapshot`], reading these changes nothing.
    pub fn timing(&self, now_ns: u64) -> (u64, u64) {
        let since = |last: &AtomicU64| now_ns.saturating_sub(last.load(Ordering::Relaxed)) / 1_000_000;
        (since(&self.last_loud_ns), since(&self.last_packet_ns))
    }

    /// Reads the meter at capture time `now_ns`, and starts the next peak from zero.
    pub fn snapshot(&self, now_ns: u64) -> Level {
        let (silent_ms, idle_ms) = self.timing(now_ns);
        Level {
            peak: f32::from_bits(self.peak.swap(0, Ordering::Relaxed)),
            rms: f32::from_bits(self.rms.load(Ordering::Relaxed)),
            clipped: self.clipped.swap(false, Ordering::Relaxed),
            silent_ms,
            idle_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: u64 = 1_000_000;

    #[test]
    fn the_peak_is_the_loudest_sample_since_the_last_snapshot() {
        let meter = Meter::new(0);
        meter.observe(10 * MS, &[0.1, -0.4, 0.2]);
        meter.observe(20 * MS, &[0.3, 0.05]);
        let level = meter.snapshot(30 * MS);
        assert!((level.peak - 0.4).abs() < 1e-6);
        // The RMS is the latest packet's: sqrt((0.09 + 0.0025) / 2).
        assert!((level.rms - 0.2150).abs() < 1e-3);
        assert!(!level.clipped);
        assert_eq!(meter.snapshot(40 * MS).peak, 0.0);
    }

    #[test]
    fn decibels_follow_the_usual_scale() {
        assert!((to_db(1.0)).abs() < 1e-6);
        assert!((to_db(0.5) + 6.02).abs() < 0.01);
        assert_eq!(to_db(0.0), FLOOR_DB);
        assert_eq!(to_db(1e-9), FLOOR_DB);
    }

    #[test]
    fn clipping_is_reported_once() {
        let meter = Meter::new(0);
        meter.observe(MS, &[1.0, 0.0]);
        assert!(meter.snapshot(2 * MS).clipped);
        assert!(!meter.snapshot(3 * MS).clipped);
    }

    #[test]
    fn silence_counts_from_the_last_loud_packet() {
        let meter = Meter::new(1_000 * MS);
        meter.observe(2_000 * MS, &[0.0; 480]);
        let level = meter.snapshot(25_000 * MS);
        assert_eq!(level.silent_ms, 24_000);
        assert_eq!(level.idle_ms, 23_000);
        meter.observe(26_000 * MS, &[0.2; 480]);
        let level = meter.snapshot(26_500 * MS);
        assert_eq!((level.silent_ms, level.idle_ms), (500, 500));
        meter.restart(40_000 * MS);
        let level = meter.snapshot(41_000 * MS);
        assert_eq!((level.silent_ms, level.idle_ms), (1_000, 1_000));
    }

    #[test]
    fn an_empty_packet_changes_nothing() {
        let meter = Meter::new(5);
        meter.observe(MS, &[]);
        assert_eq!(meter.snapshot(5).peak, 0.0);
    }
}
