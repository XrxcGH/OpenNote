//! The records of an ink segment (spec 9.2, 9.3, and 9.5): a 12-byte frame with its own CRC-32, then a body.

use std::sync::Arc;

use crate::format::points::check_points;
use crate::id::{BlockId, Id, StrokeId};
use crate::limits::Limits;
use crate::model::{Affine, BBox, Channels, InkRecord, Stroke, StrokeProps, StrokeStyle};
use crate::time::Timestamp;

/// Bytes in a record's frame.
pub const FRAME_BYTES: usize = 12;
/// Kind 1: a stroke.
pub const KIND_STROKE: u8 = 1;
/// Kind 2: stroke properties.
pub const KIND_PROPS: u8 = 2;
/// Kind 3: a removal.
pub const KIND_REMOVE: u8 = 3;

/// Stroke flag bits version 1 knows: the channels, transform, origin, and unknown start time.
const KNOWN_STROKE_FLAGS: u16 = 0x3f;
/// Property mask bits version 1 knows: style, transform, and ink block.
const KNOWN_PROPS_MASK: u16 = 0x7;
const STROKE_FIXED: usize = 72;

/// A little-endian value at a byte offset, if the bytes are there.
pub fn array_at<const N: usize>(bytes: &[u8], at: usize) -> Option<[u8; N]> {
    bytes.get(at..at.checked_add(N)?)?.try_into().ok()
}

/// A `u16` at a byte offset.
pub fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    array_at(bytes, at).map(u16::from_le_bytes)
}

/// A `u32` at a byte offset.
pub fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    array_at(bytes, at).map(u32::from_le_bytes)
}

/// An `i64` at a byte offset.
pub fn i64_at(bytes: &[u8], at: usize) -> Option<i64> {
    array_at(bytes, at).map(i64::from_le_bytes)
}

/// An ID at a byte offset.
pub fn id_at(bytes: &[u8], at: usize) -> Option<Id> {
    array_at(bytes, at).map(Id::from_bytes)
}

fn f32_at(bytes: &[u8], at: usize) -> Option<f32> {
    array_at(bytes, at).map(f32::from_le_bytes).filter(|v| v.is_finite())
}

/// Appends one record: frame and body.
pub fn encode_record(record: &InkRecord, out: &mut Vec<u8>, body: &mut Vec<u8>) {
    body.clear();
    let kind = match record {
        InkRecord::Stroke(stroke) => {
            stroke_body(stroke, body);
            KIND_STROKE
        }
        InkRecord::Props(props) => {
            props_body(props, body);
            KIND_PROPS
        }
        InkRecord::Remove(id) => {
            body.extend_from_slice(id.0.as_bytes());
            KIND_REMOVE
        }
    };
    let length = u32::try_from(body.len()).unwrap_or(u32::MAX).to_le_bytes();
    let mut crc = crc32fast::Hasher::new();
    crc.update(&[kind, 0, 0, 0]);
    crc.update(&length);
    crc.update(body);
    out.extend_from_slice(&crc.finalize().to_le_bytes());
    out.extend_from_slice(&[kind, 0, 0, 0]);
    out.extend_from_slice(&length);
    out.extend_from_slice(body);
}

fn put_style(style: &StrokeStyle, out: &mut Vec<u8>, reserved: bool) {
    out.push(style.tool);
    out.push(style.palette);
    if reserved {
        out.extend_from_slice(&[0, 0]);
    }
}

fn put_affine(affine: &Affine, out: &mut Vec<u8>) {
    for value in affine.0 {
        out.extend_from_slice(&value.to_le_bytes());
    }
}

fn stroke_body(stroke: &Stroke, out: &mut Vec<u8>) {
    out.extend_from_slice(stroke.id.0.as_bytes());
    out.extend_from_slice(stroke.block.0.as_bytes());
    out.extend_from_slice(&stroke.start.unix_ms().to_le_bytes());
    put_style(&stroke.style, out, false);
    out.extend_from_slice(&stroke.flags().to_le_bytes());
    out.extend_from_slice(&stroke.style.color);
    out.extend_from_slice(&stroke.style.width.to_le_bytes());
    for value in [
        stroke.bbox.min_x,
        stroke.bbox.min_y,
        stroke.bbox.max_x,
        stroke.bbox.max_y,
    ] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&stroke.point_count.to_le_bytes());
    if let Some(transform) = &stroke.transform {
        put_affine(transform, out);
    }
    if let Some(origin) = stroke.origin {
        out.extend_from_slice(origin.0.as_bytes());
    }
    out.extend_from_slice(&stroke.points);
}

fn props_body(props: &StrokeProps, out: &mut Vec<u8>) {
    let mut mask = 0u16;
    for (bit, present) in [
        (1, props.style.is_some()),
        (2, props.transform.is_some()),
        (4, props.block.is_some()),
    ] {
        if present {
            mask |= bit;
        }
    }
    out.extend_from_slice(props.id.0.as_bytes());
    out.extend_from_slice(&mask.to_le_bytes());
    out.extend_from_slice(&[0, 0]);
    if let Some(style) = &props.style {
        put_style(style, out, true);
        out.extend_from_slice(&style.color);
        out.extend_from_slice(&style.width.to_le_bytes());
    }
    if let Some(transform) = props.transform {
        put_affine(&transform.unwrap_or(Affine::IDENTITY), out);
    }
    if let Some(block) = props.block {
        out.extend_from_slice(block.0.as_bytes());
    }
}

/// What a record's body turned out to be.
#[derive(Debug)]
pub enum Parsed {
    /// A record this version knows.
    Record(InkRecord),
    /// A kind, flag, or mask bit from a newer version. Kept but not shown (spec 9.6).
    Unknown,
    /// A body that breaks the format, with a short reason: `body` or `points`.
    Bad(&'static str),
}

/// Parses a record's body. `frame_flags` holds the frame's flags and reserved bytes, which must be zero.
pub fn parse_body(kind: u8, frame_flags: [u8; 3], body: &[u8], limits: &Limits) -> Parsed {
    parse_record(kind, frame_flags, body, limits, true)
}

/// [`parse_body`], checking a stroke's points (spec 9.4) only when `points` is set.
pub(crate) fn parse_record(kind: u8, frame_flags: [u8; 3], body: &[u8], limits: &Limits, points: bool) -> Parsed {
    if frame_flags != [0, 0, 0] {
        return Parsed::Unknown;
    }
    match kind {
        KIND_STROKE => parse_stroke(body, limits, points),
        KIND_PROPS => parse_props(body),
        KIND_REMOVE if body.len() == 16 => id_at(body, 0).map_or(Parsed::Bad("body"), |id| {
            Parsed::Record(InkRecord::Remove(StrokeId(id)))
        }),
        KIND_REMOVE => Parsed::Bad("body"),
        _ => Parsed::Unknown,
    }
}

fn parse_stroke(body: &[u8], limits: &Limits, points: bool) -> Parsed {
    let Some(flags) = u16_at(body, 42) else {
        return Parsed::Bad("body");
    };
    if flags & !KNOWN_STROKE_FLAGS != 0 {
        return Parsed::Unknown;
    }
    match stroke_fields(body, flags, limits, points) {
        Ok(stroke) => Parsed::Record(InkRecord::Stroke(Arc::new(stroke))),
        Err(reason) => Parsed::Bad(reason),
    }
}

/// A field that must be there, or a `body` failure.
fn field<T>(value: Option<T>) -> Result<T, &'static str> {
    value.ok_or("body")
}

fn stroke_fields(body: &[u8], flags: u16, limits: &Limits, check: bool) -> Result<Stroke, &'static str> {
    let start = field(i64_at(body, 32))?;
    if !(Timestamp::MIN.unix_ms()..=Timestamp::MAX.unix_ms()).contains(&start) {
        return Err("body");
    }
    // Every problem with the fixed fields comes before any with the points, as in the other decoders.
    let width = field(f32_at(body, 48))?;
    let [tool, palette] = field(array_at::<2>(body, 40))?;
    let bbox = BBox {
        min_x: field(array_at(body, 52).map(i32::from_le_bytes))?,
        min_y: field(array_at(body, 56).map(i32::from_le_bytes))?,
        max_x: field(array_at(body, 60).map(i32::from_le_bytes))?,
        max_y: field(array_at(body, 64).map(i32::from_le_bytes))?,
    };
    let point_count = field(u32_at(body, 68))?;
    let (transform, origin, at) = optional_parts(body, flags)?;
    let points = body.get(at..).ok_or("body")?;
    let channels = Channels(flags & Channels::ALL);
    if point_count > limits.points_per_stroke {
        return Err("points");
    }
    if check {
        check_points(points, point_count, channels, &bbox).map_err(|_| "points")?;
    }
    Ok(Stroke {
        id: StrokeId(field(id_at(body, 0))?),
        block: BlockId(field(id_at(body, 16))?),
        start: Timestamp::from_unix_ms(start),
        start_unknown: flags & (1 << 5) != 0,
        style: StrokeStyle {
            tool,
            palette,
            color: field(array_at(body, 44))?,
            width,
        },
        transform,
        origin,
        bbox,
        channels,
        point_count,
        points: Arc::from(points),
    })
}

/// The transform and origin that the flags say follow the fixed fields, and where the points start.
fn optional_parts(body: &[u8], flags: u16) -> Result<(Option<Affine>, Option<StrokeId>, usize), &'static str> {
    let mut at = STROKE_FIXED;
    let mut transform = None;
    if flags & (1 << 3) != 0 {
        transform = Some(field(affine_at(body, at))?);
        at = at.saturating_add(24);
    }
    let mut origin = None;
    if flags & (1 << 4) != 0 {
        origin = Some(StrokeId(field(id_at(body, at))?));
        at = at.saturating_add(16);
    }
    Ok((transform, origin, at))
}

fn affine_at(bytes: &[u8], at: usize) -> Option<Affine> {
    let mut values = [0f32; 6];
    for (i, slot) in values.iter_mut().enumerate() {
        *slot = f32_at(bytes, at.checked_add(i.checked_mul(4)?)?)?;
    }
    Some(Affine(values))
}

fn parse_props(body: &[u8]) -> Parsed {
    let (Some(id), Some(mask), Some(reserved)) = (id_at(body, 0), u16_at(body, 16), u16_at(body, 18)) else {
        return Parsed::Bad("body");
    };
    if mask & !KNOWN_PROPS_MASK != 0 || reserved != 0 {
        return Parsed::Unknown;
    }
    let mut at = 20usize;
    let mut props = StrokeProps {
        id: StrokeId(id),
        style: None,
        transform: None,
        block: None,
    };
    if mask & 1 != 0 {
        match style_at(body, at) {
            Some(Ok(style)) => props.style = Some(style),
            Some(Err(())) => return Parsed::Unknown,
            None => return Parsed::Bad("body"),
        }
        at = at.saturating_add(12);
    }
    if mask & 2 != 0 {
        let Some(affine) = affine_at(body, at) else {
            return Parsed::Bad("body");
        };
        // Only the identity's exact bits remove a transform, so decoding and encoding again give the same bytes.
        let identity = affine
            .0
            .iter()
            .zip(Affine::IDENTITY.0)
            .all(|(a, b)| a.to_bits() == b.to_bits());
        props.transform = Some((!identity).then_some(affine));
        at = at.saturating_add(24);
    }
    if mask & 4 != 0 {
        let Some(block) = id_at(body, at) else {
            return Parsed::Bad("body");
        };
        props.block = Some(BlockId(block));
        at = at.saturating_add(16);
    }
    if at != body.len() {
        return Parsed::Bad("body");
    }
    Parsed::Record(InkRecord::Props(props))
}

/// A style part: `Some(Err(()))` when its reserved bytes are not zero.
fn style_at(bytes: &[u8], at: usize) -> Option<Result<StrokeStyle, ()>> {
    let [tool, palette] = array_at::<2>(bytes, at)?;
    let reserved = u16_at(bytes, at.checked_add(2)?)?;
    let color = array_at(bytes, at.checked_add(4)?)?;
    let width = f32_at(bytes, at.checked_add(8)?)?;
    if reserved != 0 {
        return Some(Err(()));
    }
    Some(Ok(StrokeStyle {
        tool,
        palette,
        color,
        width,
    }))
}
