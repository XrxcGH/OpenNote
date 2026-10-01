//! The version 1 fixture notebook (spec Appendix B.6), built by the version 1 writer.
//!
//! `OPENNOTE_BLESS=1 cargo test -p opennote-core --all-features fixture` writes it into
//! `docs/format/fixtures/nb/v1`. Every other run compares the files with what this code writes.

use std::collections::BTreeMap;
use std::sync::Arc;

use opennote_core::format::gzip::gzip;
use opennote_core::format::names::asset_file_name;
use opennote_core::format::points::encode_points;
use opennote_core::format::SegmentHeader;
use opennote_core::id::*;
use opennote_core::model::*;
use opennote_core::{OrderKey, Timestamp};
use sha2::{Digest, Sha256};

/// A file of the notebook: its path inside the notebook folder, and its bytes.
pub type Files = BTreeMap<String, Vec<u8>>;

pub fn at(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

pub fn key(text: &str) -> OrderKey {
    OrderKey::parse(text).unwrap()
}

/// An ID from a small number, so the fixtures stay readable and stable.
pub fn id<T: From<Id>>(n: u64) -> T {
    T::from(Id::from_parts(1_790_777_000_000 + n * 1_000, u128::from(n) * 7_919 + 1))
}

pub fn device() -> DeviceRef {
    DeviceRef {
        id: "01m1e34qm04rx4vfj1927vgwgm".parse().unwrap(),
        label: "Windows device GWGM".to_owned(),
    }
}

pub fn revision(n: u64, parent: Option<RevisionId>) -> Revision {
    let mut revision = Revision::new(
        id(n),
        at("2026-09-30T14:07:40.520Z"),
        device(),
        "OpenNote 0.4.0 (windows)",
    );
    revision.parents.extend(parent);
    revision.ancestors.extend(parent);
    revision
}

pub fn block(n: u64, order: &str, frame: Option<Frame>, data: BlockData) -> Block {
    Block {
        id: id(n),
        order: key(order),
        frame,
        lock: None,
        created: at("2026-09-30T14:03:25.001Z"),
        modified: at("2026-09-30T14:05:40.020Z"),
        data,
        fallback: None,
        extra: JsonMap::new(),
    }
}

pub fn floating(x: f64, y: f64, w: Option<f64>) -> Option<Frame> {
    Some(Frame {
        x: Some(x),
        y: Some(y),
        w,
        ..Frame::default()
    })
}

pub fn text(markdown: &str) -> BlockData {
    BlockData::Text(TextData {
        markdown: markdown.into(),
        ..TextData::default()
    })
}

pub fn ink_block(role: InkRole, count: u32, alt: &str) -> BlockData {
    BlockData::Ink(InkBlockData {
        role: Named::Known(role),
        stroke_count: count,
        alt: alt.to_owned(),
        ..InkBlockData::default()
    })
}

pub fn page(n: u64, title: &str, rev: Revision) -> Page {
    let mut page = Page::new(id(n), at("2026-09-30T14:03:22.114Z"), rev);
    page.title = title.to_owned();
    page.modified = at("2026-09-30T14:07:40.412Z");
    page
}

/// Points along a curve, like a short handwritten stroke sampled at 240 Hz.
pub fn curve(seed: u32, count: u32, (x0, y0): (f64, f64)) -> Vec<Point> {
    (0..count)
        .map(|i| {
            let s = f64::from(i) / 8.0 + f64::from(seed);
            let (x, y) = (x0 + f64::from(i) * 1.5 + s.sin() * 3.0, y0 + (s * 1.3).cos() * 4.0);
            Point {
                x: (x * 64.0).round() as i32,
                y: (y * 64.0).round() as i32,
                pressure: (20_000.0 + 12_000.0 * (s * 0.7).sin()) as u16,
                tilt_x: (1_500.0 + 300.0 * s.cos()) as i16,
                tilt_y: (-800.0 + 200.0 * s.sin()) as i16,
                t: if i == 0 { seed % 10 } else { (seed % 10) + i * 42 },
            }
        })
        .collect()
}

pub struct StrokeSpec {
    pub n: u64,
    pub block: BlockId,
    pub tool: u8,
    pub palette: u8,
    pub color: [u8; 4],
    pub channels: u16,
    pub points: Vec<Point>,
}

pub fn stroke(spec: StrokeSpec) -> Stroke {
    let channels = Channels(spec.channels);
    let mut points = spec.points;
    for p in &mut points {
        if !channels.pressure() {
            p.pressure = 0;
        }
        if !channels.tilt() {
            p.tilt_x = 0;
            p.tilt_y = 0;
        }
        if !channels.time() {
            p.t = 0;
        }
    }
    let mut encoded = Vec::new();
    let bbox = encode_points(&points, channels, &mut encoded).unwrap();
    Stroke {
        id: id(spec.n),
        block: spec.block,
        start: Timestamp::from_unix_ms(1_790_777_258_345 + spec.n as i64 * 1_000),
        start_unknown: false,
        style: StrokeStyle {
            tool: spec.tool,
            palette: spec.palette,
            color: spec.color,
            width: if spec.tool == 2 { 12.0 } else { 2.0 },
        },
        transform: None,
        origin: None,
        bbox,
        channels,
        point_count: points.len() as u32,
        points: Arc::from(encoded),
    }
}

/// Adds an asset file and its table entry.
/// `file` is the original name, the media type, and the bytes.
pub fn asset(files: &mut Files, dir: &str, n: u64, (name, mime, bytes): (&str, &str, &[u8])) -> Asset {
    let asset_id: AssetId = id(n);
    let file = asset_file_name(asset_id, name, mime);
    files.insert(format!("{dir}/assets/{file}"), bytes.to_vec());
    Asset {
        id: asset_id,
        file,
        mime: mime.to_owned(),
        bytes: bytes.len() as u64,
        sha256: Sha256::digest(bytes).into(),
        name: name.to_owned(),
        width: mime.starts_with("image/").then_some(1),
        height: mime.starts_with("image/").then_some(1),
        created: at("2026-09-30T14:05:02.305Z"),
        extra: JsonMap::new(),
    }
}

/// Writes a segment of records into the page folder and lists it on the page.
pub fn add_segment(files: &mut Files, dir: &str, page: &mut Page, n: u64, records: &[InkRecord]) -> SegmentRef {
    let header = SegmentHeader {
        id: id(n),
        page: page.id,
        created: at("2026-09-30T14:07:40.000Z"),
    };
    let bytes = opennote_core::format::segment::encode_segment(&header, records);
    let entry = SegmentRef {
        id: header.id,
        bytes: bytes.len() as u64,
        records: records.len() as u32,
        crc32: opennote_core::format::segment_footer_crc(&bytes).unwrap(),
        extra: JsonMap::new(),
    };
    files.insert(format!("{dir}/ink/{}.onk", header.id), bytes);
    let mut segments = page.ink.segments().to_vec();
    segments.push(entry.clone());
    page.ink.commit(0, segments, 0);
    entry
}

/// A gzip snapshot of a page for its history (spec 13.1).
pub fn snapshot(bytes: &[u8]) -> Vec<u8> {
    gzip(bytes)
}

/// A 1 by 1 transparent PNG.
pub const PNG: [u8; 67] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];
