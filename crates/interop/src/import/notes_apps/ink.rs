//! Turning the curves read from a notes app into OpenNote strokes (spec 8.2 and 9.4).
//!
//! The apps measure in points (1/72 inch). OpenNote's page units are 1/96 inch, and stroke points are stored in
//! 1/64 page units. A curve that is clearly see-through, or wide and a little see-through, is a highlighter stroke,
//! drawn under the others. Any other curve is a pen stroke that keeps its color's alpha.

use std::sync::Arc;
use std::time::Duration;

use opennote_core::format::points::{encode_points, MAX_COORD, MAX_POINTS};
use opennote_core::model::{stroke::tool, Channels, Point, Stroke, StrokeStyle};
use opennote_core::{BlockId, StrokeId, Timestamp};

use crate::sink::ImportEnv;

/// The highest alpha a highlighter of any width has.
pub const HIGHLIGHTER_ALPHA: u8 = 200;
/// The narrowest width, in points, at which any see-through curve is a highlighter.
pub const HIGHLIGHTER_WIDTH: f32 = 8.0;

/// Whether a curve of this color and width, in points, is a highlighter stroke.
pub fn is_highlighter(color: [u8; 4], width: f32) -> bool {
    let alpha = color[3];
    alpha <= HIGHLIGHTER_ALPHA || (alpha < 255 && width >= HIGHLIGHTER_WIDTH)
}

/// Page units in one point.
pub const UNITS_PER_POINT: f64 = 96.0 / 72.0;
/// The most strokes one page takes.
pub const MAX_STROKES: usize = 50_000;
/// The most points one page takes, over all its strokes.
pub const MAX_PAGE_POINTS: usize = 2_000_000;

/// One curve as the app stores it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Curve {
    /// The points, in points.
    pub points: Vec<(f32, f32)>,
    /// Pressure from 0 to 1 for each point, when the app keeps it.
    pub pressure: Option<Vec<f32>>,
    /// The nominal width, in points.
    pub width: f32,
    /// Red, green, blue, and alpha.
    pub color: [u8; 4],
}

/// What converting a page's curves did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct InkStats {
    /// Strokes made.
    pub strokes: usize,
    /// Of those, highlighter strokes.
    pub highlighter: usize,
    /// Curves with no usable point, or beyond the page's limits, that were left out.
    pub dropped: usize,
}

fn quantize(value: f32) -> Option<i32> {
    let units = f64::from(value) * UNITS_PER_POINT * 64.0;
    #[allow(clippy::cast_precision_loss)]
    let max = MAX_COORD as f64;
    #[allow(clippy::cast_possible_truncation)]
    (units.is_finite() && units.abs() <= max).then(|| units.round() as i32)
}

/// Converts curves into strokes for the layer `block`, in order. `start` is the time the first stroke gets; each
/// later one starts a millisecond after, so they keep the app's order.
pub fn strokes(curves: &[Curve], block: BlockId, start: Timestamp, env: &ImportEnv<'_>) -> (Vec<Stroke>, InkStats) {
    let mut out = Vec::new();
    let mut stats = InkStats::default();
    let mut budget = MAX_PAGE_POINTS;
    for curve in curves {
        if out.len() >= MAX_STROKES || curve.points.len() > budget {
            stats.dropped += 1;
            continue;
        }
        let pressure = curve.pressure.as_ref().filter(|p| p.len() == curve.points.len());
        let points: Vec<Point> = curve
            .points
            .iter()
            .enumerate()
            .filter_map(|(n, (x, y))| {
                let p = pressure.and_then(|p| p.get(n)).copied().unwrap_or(0.5);
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let pressure = (f64::from(p).clamp(0.0, 1.0) * 65_535.0).round() as u16;
                Some(Point {
                    x: quantize(*x)?,
                    y: quantize(*y)?,
                    pressure,
                    ..Point::default()
                })
            })
            .collect();
        if points.is_empty() {
            stats.dropped += 1;
            continue;
        }
        budget -= points.len();
        let channels = Channels(if pressure.is_some() { Channels::PRESSURE } else { 0 });
        let highlighter = is_highlighter(curve.color, curve.width);
        let width = f64::from(curve.width) * UNITS_PER_POINT;
        #[allow(clippy::cast_possible_truncation)]
        let width = if width.is_finite() && width > 0.0 {
            width.clamp(0.25, 200.0) as f32
        } else {
            2.0
        };
        let [r, g, b, a] = curve.color;
        let style = StrokeStyle {
            tool: if highlighter { tool::HIGHLIGHTER } else { tool::PEN },
            palette: 0,
            color: [r, g, b, if highlighter { 255 } else { a }],
            width,
        };
        // A curve longer than a stroke may be goes in pieces that share their end points.
        let chunk = usize::try_from(MAX_POINTS)
            .unwrap_or(usize::MAX)
            .saturating_sub(1)
            .max(1);
        let mut from = 0usize;
        while from < points.len() {
            let to = (from + chunk + 1).min(points.len());
            let piece = &points[from..to];
            let mut encoded = Vec::new();
            if let Ok(bbox) = encode_points(piece, channels, &mut encoded) {
                let n = out.len() as u64;
                out.push(Stroke {
                    id: StrokeId::generate(env.clock),
                    block,
                    start: start.saturating_add(Duration::from_millis(n)),
                    start_unknown: true,
                    style,
                    transform: None,
                    origin: None,
                    bbox,
                    channels,
                    point_count: u32::try_from(piece.len()).unwrap_or(u32::MAX),
                    points: Arc::from(encoded),
                });
                stats.strokes += 1;
                stats.highlighter += usize::from(highlighter);
            } else {
                stats.dropped += 1;
            }
            if to == points.len() {
                break;
            }
            from = to - 1;
        }
    }
    (out, stats)
}
