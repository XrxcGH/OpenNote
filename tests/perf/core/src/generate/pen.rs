//! Synthetic handwriting, standing in for the Phase 1 pen recordings, which were not kept.
//!
//! Each stroke follows a smooth curve at handwriting speed, sampled at the digitizer's report rate. Positions
//! carry sensor noise. Pressure has as many levels as the pen reports, and rises and falls with the stroke. Tilt
//! changes slowly, in the whole degrees that Pointer Events report. Measurement M2 encodes these strokes.

use std::f64::consts::PI;
use std::sync::Arc;

use opennote_core::format::points::encode_points;
use opennote_core::model::{Channels, Point, Stroke, StrokeStyle};
use opennote_core::{BlockId, StrokeId, Timestamp};

use super::Rng;

/// A pen and digitizer, as their recordings look through Pointer Events.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PenProfile {
    /// A short name for reports.
    pub name: &'static str,
    /// Reports per second.
    pub rate_hz: f64,
    /// Pressure levels the pen reports.
    pub pressure_levels: u32,
    /// The step of reported tilt, in degrees.
    pub tilt_step: f64,
    /// Sensor noise of positions, in page units.
    pub position_noise: f64,
    /// Jitter of report times, as a fraction of the report interval.
    pub time_jitter: f64,
}

/// A Surface Pen on a Surface device: 4,096 pressure levels, reported at about 240 Hz through Windows Ink.
pub const SURFACE_PEN: PenProfile = PenProfile {
    name: "surface_pen",
    rate_hz: 240.0,
    pressure_levels: 4_096,
    tilt_step: 1.0,
    position_noise: 0.02,
    time_jitter: 0.08,
};

/// A Wacom tablet: 8,192 pressure levels at about 200 Hz, with a quieter sensor.
pub const WACOM: PenProfile = PenProfile {
    name: "wacom",
    rate_hz: 200.0,
    pressure_levels: 8_192,
    tilt_step: 1.0,
    position_noise: 0.01,
    time_jitter: 0.05,
};

/// A worst case: tilt with 1/100 degree resolution, as a later API might report it.
pub const FINE_TILT: PenProfile = PenProfile {
    name: "fine_tilt",
    tilt_step: 0.01,
    ..SURFACE_PEN
};

/// Page units per centimeter.
const UNITS_PER_CM: f64 = 96.0 / 2.54;

/// The points of one stroke that starts at `(x, y)`, in 1/64 page units, with every channel.
pub fn stroke_points(rng: &mut Rng, pen: &PenProfile, (x0, y0): (f64, f64), count: usize) -> Vec<Point> {
    let dt = 1.0 / pen.rate_hz;
    let speed = rng.range(2.0, 9.0) * UNITS_PER_CM;
    let (turn, turn_hz, turn_phase) = (rng.range(4.0, 14.0), rng.range(1.5, 4.0), rng.range(0.0, 2.0 * PI));
    let (press, press_phase) = (rng.range(0.35, 0.65), rng.range(0.0, 2.0 * PI));
    let (tilt_x, tilt_y) = (rng.range(15.0, 45.0), rng.range(-25.0, 5.0));
    let mut angle = rng.range(-PI, PI);
    let (mut x, mut y, mut time) = (x0, y0, 0.0f64);
    let mut last_t = rng.below(10) as u32;
    let mut points = Vec::with_capacity(count);
    for i in 0..count {
        let u = i as f64 / (count.max(2) - 1) as f64;
        let seconds = i as f64 * dt;
        let envelope = (PI * u).sin().max(0.0).sqrt();
        if i > 0 {
            let step = speed * (0.35 + 0.65 * envelope) * dt;
            angle += turn * (2.0 * PI * turn_hz * seconds + turn_phase).sin() * dt;
            x += step * angle.cos();
            y += step * angle.sin();
            time += dt * 1_000.0 * (1.0 + rng.noise(pen.time_jitter));
            last_t = last_t.max((time * 10.0).round() as u32);
        }
        let level = (press + 0.12 * (2.0 * PI * 1.3 * seconds + press_phase).sin()) * envelope.max(0.15);
        let level = (level * f64::from(pen.pressure_levels - 1) + rng.noise(1.0)).round();
        let level = level.clamp(0.0, f64::from(pen.pressure_levels - 1));
        let tilt = |base: f64, hz: f64| {
            let degrees = base + 4.0 * (2.0 * PI * hz * seconds).sin();
            ((degrees / pen.tilt_step).round() * pen.tilt_step * 100.0).round() as i16
        };
        points.push(Point {
            x: ((x + rng.noise(pen.position_noise)) * 64.0).round() as i32,
            y: ((y + rng.noise(pen.position_noise)) * 64.0).round() as i32,
            pressure: (level / f64::from(pen.pressure_levels - 1) * 65_535.0).round() as u16,
            tilt_x: tilt(tilt_x, 0.7),
            tilt_y: tilt(tilt_y, 0.5),
            t: last_t,
        });
    }
    points
}

/// Handwritten lines of strokes in one ink block, starting at `(left, top)`, each stroke about 80 points.
pub fn handwriting(rng: &mut Rng, pen: &PenProfile, block: BlockId, count: usize, top: f64) -> Vec<Stroke> {
    let mut strokes = Vec::with_capacity(count);
    let (mut x, mut y) = (96.0, top);
    let mut start = 1_790_777_000_000i64;
    for _ in 0..count {
        let count = rng.between(20, 140) as usize;
        let points = stroke_points(rng, pen, (x, y), count);
        let channels = Channels(Channels::PRESSURE | Channels::TILT | Channels::TIME);
        let mut encoded = Vec::new();
        let Ok(bbox) = encode_points(&points, channels, &mut encoded) else {
            continue;
        };
        strokes.push(Stroke {
            id: rng.id::<StrokeId>(start as u64),
            block,
            start: Timestamp::from_unix_ms(start),
            start_unknown: false,
            style: StrokeStyle {
                tool: 0,
                palette: 1,
                color: [0x2b, 0x25, 0x21, 0xff],
                width: 2.0,
            },
            transform: None,
            origin: None,
            bbox,
            channels,
            point_count: points.len() as u32,
            points: Arc::from(encoded),
        });
        start += (points.len() as f64 * 1_000.0 / pen.rate_hz) as i64 + rng.between(80, 400) as i64;
        x += rng.range(10.0, 26.0);
        if x > 700.0 {
            x = 96.0;
            y += 32.0;
        }
    }
    strokes
}
