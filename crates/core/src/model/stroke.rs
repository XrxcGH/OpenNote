//! Strokes (spec 8.2, 9.3, and 9.4): their fields, styles, transforms, bounding boxes, and points.

use std::sync::Arc;

use super::{Rect, HIGHLIGHTER_NAMES, PEN_NAMES};
use crate::id::{BlockId, StrokeId};
use crate::time::Timestamp;

/// Bytes in a record's frame (spec 9.2).
pub const RECORD_FRAME_BYTES: u64 = 12;
/// Fixed bytes at the start of a stroke record's body (spec 9.3).
pub const STROKE_FIXED_BYTES: u64 = 72;

/// A tool code (spec 9.3).
pub mod tool {
    /// Pen.
    pub const PEN: u8 = 0;
    /// Pencil.
    pub const PENCIL: u8 = 1;
    /// Highlighter, drawn below the other strokes of its block.
    pub const HIGHLIGHTER: u8 = 2;
    /// Marker.
    pub const MARKER: u8 = 3;
    /// Brush.
    pub const BRUSH: u8 = 4;
}

/// The name of a palette slot: 1 to 7 are pens, 32 to 36 highlighters, and anything else custom.
pub fn palette_slot_name(slot: u8) -> Option<&'static str> {
    match slot {
        1..=7 => PEN_NAMES.get(usize::from(slot) - 1).copied(),
        32..=36 => HIGHLIGHTER_NAMES.get(usize::from(slot) - 32).copied(),
        _ => None,
    }
}

/// A stroke (spec 8.2 and 9.3). Its points never change once it is finished.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    /// Unique within the page.
    pub id: StrokeId,
    /// The ink block that holds it.
    pub block: BlockId,
    /// When drawing started.
    pub start: Timestamp,
    /// Imported ink without times (flag bit 5).
    pub start_unknown: bool,
    /// Tool, palette slot, color, and width.
    pub style: StrokeStyle,
    /// Maps raw points into the ink block's coordinates. `None` is the identity.
    pub transform: Option<Affine>,
    /// The stroke a partial erase cut this one from.
    pub origin: Option<StrokeId>,
    /// Bounding box of the raw points.
    pub bbox: BBox,
    /// Which optional point channels are present.
    pub channels: Channels,
    /// The number of points, 1 to 200,000.
    pub point_count: u32,
    /// Encoded point data (spec 9.4).
    pub points: Arc<[u8]>,
}

impl Stroke {
    /// The stroke flags (spec 9.3), from the channels and the optional fields.
    pub fn flags(&self) -> u16 {
        let mut flags = self.channels.0 & Channels::ALL;
        if self.transform.is_some() {
            flags |= 1 << 3;
        }
        if self.origin.is_some() {
            flags |= 1 << 4;
        }
        if self.start_unknown {
            flags |= 1 << 5;
        }
        flags
    }

    /// The size of this stroke's record in a segment file, frame included.
    pub fn record_len(&self) -> u64 {
        let transform = if self.transform.is_some() { 24 } else { 0 };
        let origin = if self.origin.is_some() { 16 } else { 0 };
        RECORD_FRAME_BYTES + STROKE_FIXED_BYTES + transform + origin + self.points.len() as u64
    }

    /// Whether it is drawn with the highlighter, below the block's other strokes.
    pub fn is_highlighter(&self) -> bool {
        self.style.tool == tool::HIGHLIGHTER
    }
}

/// A stroke's style (spec 8.2).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StrokeStyle {
    /// The tool code.
    pub tool: u8,
    /// The palette slot.
    pub palette: u8,
    /// Red, green, blue, and alpha in sRGB with straight alpha, as the light-theme value.
    pub color: [u8; 4],
    /// Nominal diameter in page units.
    pub width: f32,
}

/// An affine transform `a b c d e f`, mapping `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine(pub [f32; 6]);

impl Affine {
    /// The transform that changes nothing. In a property record it removes a transform (spec 9.5).
    pub const IDENTITY: Affine = Affine([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    /// Whether this is the identity.
    pub fn is_identity(&self) -> bool {
        *self == Affine::IDENTITY
    }

    /// The factor by which this transform scales lengths on average: the square root of the absolute value of
    /// its determinant (spec 11.3).
    pub fn width_scale(&self) -> f64 {
        let [a, b, c, d, ..] = self.0.map(f64::from);
        (a * d - b * c).abs().sqrt()
    }

    /// Maps a point.
    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        let [a, b, c, d, e, f] = self.0.map(f64::from);
        (a * x + c * y + e, b * x + d * y + f)
    }
}

/// A bounding box in 1/64 page units.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BBox {
    /// Smallest x.
    pub min_x: i32,
    /// Smallest y.
    pub min_y: i32,
    /// Largest x.
    pub max_x: i32,
    /// Largest y.
    pub max_y: i32,
}

impl BBox {
    /// The box in page units, before any transform.
    pub fn to_rect(&self) -> Rect {
        let unit = |v: i32| f64::from(v) / 64.0;
        Rect {
            x: unit(self.min_x),
            y: unit(self.min_y),
            w: unit(self.max_x) - unit(self.min_x),
            h: unit(self.max_y) - unit(self.min_y),
        }
    }
}

/// Which optional point channels a stroke has: stroke flag bits 0 to 2.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Channels(pub u16);

impl Channels {
    /// Pressure, flag bit 0.
    pub const PRESSURE: u16 = 1;
    /// Tilt, flag bit 1.
    pub const TILT: u16 = 2;
    /// Per-point time, flag bit 2.
    pub const TIME: u16 = 4;
    /// Every channel bit.
    pub const ALL: u16 = 7;

    /// Whether points carry pressure.
    pub fn pressure(self) -> bool {
        self.0 & Channels::PRESSURE != 0
    }

    /// Whether points carry tilt.
    pub fn tilt(self) -> bool {
        self.0 & Channels::TILT != 0
    }

    /// Whether points carry time.
    pub fn time(self) -> bool {
        self.0 & Channels::TIME != 0
    }
}

/// One decoded point (spec 9.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Point {
    /// X in 1/64 page units.
    pub x: i32,
    /// Y in 1/64 page units.
    pub y: i32,
    /// Pressure from 0 to 65535, or 0 without the channel.
    pub pressure: u16,
    /// Tilt in 1/100 degree.
    pub tilt_x: i16,
    /// Tilt in 1/100 degree.
    pub tilt_y: i16,
    /// Time in 100 microseconds after the stroke's start.
    pub t: u32,
}
