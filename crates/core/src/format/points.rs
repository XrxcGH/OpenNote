//! Point data (spec 9.4): quantized points as zigzag and LEB128 varints of first-order deltas. Owned by WP1.
//!
//! `testing::gen` has a small independent encoder for generated strokes, which these functions must accept.
//! Point 0 stores absolute values. Every later point stores the difference from the point before it: `x`,
//! `y`, pressure, and tilt as zigzag varints, and time as an unsigned varint, because time never goes back.

use crate::error::InkError;
use crate::model::{BBox, Channels, Point};

/// The most points in one stroke (spec 9.3).
pub const MAX_POINTS: u32 = 200_000;
/// The largest absolute coordinate, in 1/64 page units (spec 9.4).
pub const MAX_COORD: i64 = 1 << 29;
/// The largest absolute tilt, in 1/100 degree.
pub const MAX_TILT: i64 = 9_000;
/// The largest time of point 0: the part of the start time below one millisecond, in 100 microseconds.
pub const MAX_FIRST_TIME: u32 = 9;

/// Encodes points after `out`, and returns their bounding box.
///
/// Channels that `channels` leaves out are not written, whatever the points hold. Fails on no points, too many
/// points, a value outside its range, or a time earlier than the point before.
pub fn encode_points(points: &[Point], channels: Channels, out: &mut Vec<u8>) -> Result<BBox, InkError> {
    let count = u32::try_from(points.len()).unwrap_or(u32::MAX);
    if points.is_empty() || count > MAX_POINTS {
        return Err(InkError::PointCount(points.len() as u64));
    }
    out.reserve(points.len().saturating_mul(6));
    let mut previous = None;
    let mut bbox = EMPTY_BOX;
    for (index, point) in points.iter().enumerate() {
        let index = u32::try_from(index).unwrap_or(u32::MAX);
        check_point(point, &previous.unwrap_or_default(), index, channels)?;
        put_point(out, point, previous.as_ref(), channels);
        grow(&mut bbox, point);
        previous = Some(*point);
    }
    Ok(bbox)
}

/// A box that any point grows.
const EMPTY_BOX: BBox = BBox {
    min_x: i32::MAX,
    min_y: i32::MAX,
    max_x: i32::MIN,
    max_y: i32::MIN,
};

/// Appends one point: absolute values for the first, differences after that.
fn put_point(out: &mut Vec<u8>, point: &Point, previous: Option<&Point>, channels: Channels) {
    let delta = |now: i32, before: fn(&Point) -> i32| match previous {
        None => i64::from(now),
        Some(p) => i64::from(now).wrapping_sub(i64::from(before(p))),
    };
    put_zigzag(out, delta(point.x, |p| p.x));
    put_zigzag(out, delta(point.y, |p| p.y));
    if channels.pressure() {
        match previous {
            None => put_varint(out, u32::from(point.pressure)),
            Some(_) => put_zigzag(out, delta(point.pressure.into(), |p| p.pressure.into())),
        }
    }
    if channels.tilt() {
        put_zigzag(out, delta(point.tilt_x.into(), |p| p.tilt_x.into()));
        put_zigzag(out, delta(point.tilt_y.into(), |p| p.tilt_y.into()));
    }
    if channels.time() {
        put_varint(out, previous.map_or(point.t, |p| point.t.saturating_sub(p.t)));
    }
}

fn check_point(point: &Point, previous: &Point, index: u32, channels: Channels) -> Result<(), InkError> {
    let out = |channel| InkError::OutOfRange { index, channel };
    if i64::from(point.x).unsigned_abs() > MAX_COORD as u64 {
        return Err(out("x"));
    }
    if i64::from(point.y).unsigned_abs() > MAX_COORD as u64 {
        return Err(out("y"));
    }
    let tilt_ok = |v: i16| i64::from(v).unsigned_abs() <= MAX_TILT as u64;
    if channels.tilt() && !(tilt_ok(point.tilt_x) && tilt_ok(point.tilt_y)) {
        return Err(out("tilt"));
    }
    if channels.time()
        && (if index == 0 {
            point.t > MAX_FIRST_TIME
        } else {
            point.t < previous.t
        })
    {
        return Err(out("time"));
    }
    Ok(())
}

fn grow(bbox: &mut BBox, point: &Point) {
    bbox.min_x = bbox.min_x.min(point.x);
    bbox.min_y = bbox.min_y.min(point.y);
    bbox.max_x = bbox.max_x.max(point.x);
    bbox.max_y = bbox.max_y.max(point.y);
}

/// Appends an unsigned LEB128 varint.
pub fn put_varint(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push((value & 0x7f) as u8 | 0x80);
        value = value.wrapping_shr(7);
    }
    out.push(value as u8);
}

/// Appends a signed value as a zigzag varint. Values past `i32` are cut to 32 bits, which the range checks
/// rule out.
fn put_zigzag(out: &mut Vec<u8>, value: i64) {
    let n = value as i32;
    put_varint(out, (n.wrapping_shl(1) ^ n.wrapping_shr(31)) as u32);
}

/// Decodes exactly `count` points that use up exactly `bytes`.
pub fn decode_points(bytes: &[u8], count: u32, channels: Channels) -> Result<Vec<Point>, InkError> {
    check_count(bytes, count)?;
    let mut points = Vec::with_capacity(count as usize);
    walk(bytes, count, channels, |point| points.push(*point))?;
    Ok(points)
}

/// Checks point data without keeping the points: every value in range, and the stored bounding box right.
pub fn check_points(bytes: &[u8], count: u32, channels: Channels, bbox: &BBox) -> Result<(), InkError> {
    check_count(bytes, count)?;
    let mut found = EMPTY_BOX;
    walk(bytes, count, channels, |point| grow(&mut found, point))?;
    if found == *bbox {
        Ok(())
    } else {
        Err(InkError::BoundingBox)
    }
}

/// Rejects counts outside 1 to [`MAX_POINTS`], and counts the bytes can't hold: every point takes at least
/// one byte for `x` and one for `y`. This runs before anything is allocated.
fn check_count(bytes: &[u8], count: u32) -> Result<(), InkError> {
    if count == 0 || count > MAX_POINTS {
        return Err(InkError::PointCount(count.into()));
    }
    if (bytes.len() as u64) < u64::from(count).saturating_mul(2) {
        return Err(InkError::Truncated);
    }
    Ok(())
}

/// Reads varints from point data.
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn varint(&mut self) -> Result<u32, InkError> {
        let start = self.pos;
        let mut value: u32 = 0;
        for shift in [0u32, 7, 14, 21, 28] {
            let byte = *self.bytes.get(self.pos).ok_or(InkError::Truncated)?;
            self.pos = self.pos.saturating_add(1);
            let bits = u32::from(byte & 0x7f);
            if shift == 28 && byte > 0x0f {
                return Err(InkError::Varint(start as u64));
            }
            value |= bits.wrapping_shl(shift);
            if byte & 0x80 == 0 {
                // The shortest form: a last byte of zero is only allowed as the only byte.
                if byte == 0 && shift > 0 {
                    return Err(InkError::Varint(start as u64));
                }
                return Ok(value);
            }
        }
        Err(InkError::Varint(start as u64))
    }

    fn zigzag(&mut self) -> Result<i64, InkError> {
        let z = self.varint()?;
        Ok(i64::from((z.wrapping_shr(1) as i32) ^ ((z & 1) as i32).wrapping_neg()))
    }
}

/// Decodes every point in order and hands each to `visit`.
fn walk(bytes: &[u8], count: u32, channels: Channels, mut visit: impl FnMut(&Point)) -> Result<(), InkError> {
    let mut reader = Reader { bytes, pos: 0 };
    let mut previous = Point::default();
    for index in 0..count {
        let point = next_point(&mut reader, &previous, index, channels)?;
        visit(&point);
        previous = point;
    }
    let left = bytes.len().saturating_sub(reader.pos);
    if left > 0 {
        return Err(InkError::TrailingBytes(left as u64));
    }
    Ok(())
}

fn next_point(reader: &mut Reader<'_>, previous: &Point, index: u32, channels: Channels) -> Result<Point, InkError> {
    let first = index == 0;
    let out = |channel| InkError::OutOfRange { index, channel };
    let base = |value: i64| if first { 0 } else { value };
    let coord = |delta: i64, before: i32, channel| {
        let value = base(before.into()).saturating_add(delta);
        if value.unsigned_abs() > MAX_COORD as u64 {
            return Err(out(channel));
        }
        i32::try_from(value).map_err(|_| out(channel))
    };
    let x = coord(reader.zigzag()?, previous.x, "x")?;
    let y = coord(reader.zigzag()?, previous.y, "y")?;
    let mut point = Point {
        x,
        y,
        ..Point::default()
    };
    if channels.pressure() {
        let value = if first {
            i64::from(reader.varint()?)
        } else {
            i64::from(previous.pressure).saturating_add(reader.zigzag()?)
        };
        point.pressure = u16::try_from(value).map_err(|_| out("pressure"))?;
    }
    if channels.tilt() {
        let tilt = |delta: i64, before: i16| {
            let value = base(before.into()).saturating_add(delta);
            if value.unsigned_abs() > MAX_TILT as u64 {
                return Err(out("tilt"));
            }
            i16::try_from(value).map_err(|_| out("tilt"))
        };
        point.tilt_x = tilt(reader.zigzag()?, previous.tilt_x)?;
        point.tilt_y = tilt(reader.zigzag()?, previous.tilt_y)?;
    }
    if channels.time() {
        let dt = reader.varint()?;
        point.t = if first {
            (dt <= MAX_FIRST_TIME).then_some(dt).ok_or_else(|| out("time"))?
        } else {
            previous.t.checked_add(dt).ok_or_else(|| out("time"))?
        };
    }
    Ok(point)
}

#[cfg(test)]
mod tests;
