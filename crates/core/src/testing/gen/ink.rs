//! Generated strokes and their point data.

use super::*;

/// Points of one stroke with a set of channels. Times never go backward.
pub fn arb_points(max: usize) -> impl Strategy<Value = (Channels, Vec<Point>)> {
    let point = (
        -(1i32 << 20)..(1 << 20),
        -(1i32 << 20)..(1 << 20),
        any::<u16>(),
        -9000i16..=9000,
        -9000i16..=9000,
        0u32..500,
    );
    (0u16..8, vec(point, 1..=max.max(1))).prop_map(|(channels, raw)| {
        let channels = Channels(channels);
        let mut t = 0u32;
        let points = raw
            .into_iter()
            .enumerate()
            .map(|(i, (x, y, pressure, tilt_x, tilt_y, dt))| {
                t = if i == 0 { dt % 10 } else { t + dt };
                let keep = |on: bool, v: i16| if on { v } else { 0 };
                Point {
                    x,
                    y,
                    pressure: if channels.pressure() { pressure } else { 0 },
                    tilt_x: keep(channels.tilt(), tilt_x),
                    tilt_y: keep(channels.tilt(), tilt_y),
                    t: if channels.time() { t } else { 0 },
                }
            })
            .collect();
        (channels, points)
    })
}

/// Encodes points as spec 9.4 says. An independent encoder for generated strokes, so the real one in
/// `format::points` can be checked against it.
pub fn encode_test_points(points: &[Point], channels: Channels) -> (Vec<u8>, BBox) {
    let mut out = Vec::new();
    let mut previous = Point::default();
    for (i, p) in points.iter().enumerate() {
        let first = i == 0;
        let delta = |now: i32, before: i32| if first { now } else { now - before };
        put_zigzag(&mut out, delta(p.x, previous.x));
        put_zigzag(&mut out, delta(p.y, previous.y));
        if channels.pressure() {
            if first {
                put_varint(&mut out, u32::from(p.pressure));
            } else {
                put_zigzag(&mut out, i32::from(p.pressure) - i32::from(previous.pressure));
            }
        }
        if channels.tilt() {
            put_zigzag(&mut out, delta(i32::from(p.tilt_x), i32::from(previous.tilt_x)));
            put_zigzag(&mut out, delta(i32::from(p.tilt_y), i32::from(previous.tilt_y)));
        }
        if channels.time() {
            put_varint(&mut out, if first { p.t } else { p.t - previous.t });
        }
        previous = *p;
    }
    (out, bbox_of(points))
}

fn put_zigzag(out: &mut Vec<u8>, n: i32) {
    put_varint(out, ((n << 1) ^ (n >> 31)) as u32);
}

fn put_varint(out: &mut Vec<u8>, mut v: u32) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn bbox_of(points: &[Point]) -> BBox {
    let xs = points.iter().map(|p| p.x);
    let ys = points.iter().map(|p| p.y);
    BBox {
        min_x: xs.clone().min().unwrap_or(0),
        min_y: ys.clone().min().unwrap_or(0),
        max_x: xs.max().unwrap_or(0),
        max_y: ys.max().unwrap_or(0),
    }
}

/// A stroke in one of `blocks`, with valid encoded points.
pub fn arb_stroke(id: StrokeId, blocks: Vec<BlockId>, max_points: usize) -> impl Strategy<Value = Stroke> {
    let style = (
        0u8..=4,
        prop_oneof![Just(0u8), 1u8..=7, 32u8..=36],
        any::<[u8; 4]>(),
        0.25f32..50.0,
    )
        .prop_map(|(tool, palette, color, width)| StrokeStyle {
            tool,
            palette,
            color,
            width,
        });
    let transform = proptest::option::of(proptest::array::uniform6(-100f32..100.0).prop_map(crate::model::Affine));
    let origin = proptest::option::of(arb_id().prop_map(StrokeId));
    let block = proptest::sample::select(blocks);
    (
        block,
        arb_timestamp(),
        any::<bool>(),
        style,
        transform,
        origin,
        arb_points(max_points),
    )
        .prop_map(
            move |(block, start, start_unknown, style, transform, origin, (channels, points))| {
                let (encoded, bbox) = encode_test_points(&points, channels);
                Stroke {
                    id,
                    block,
                    start,
                    start_unknown,
                    style,
                    transform: transform.filter(|t| !t.is_identity()),
                    origin,
                    bbox,
                    channels,
                    point_count: points.len() as u32,
                    points: Arc::from(encoded),
                }
            },
        )
}
