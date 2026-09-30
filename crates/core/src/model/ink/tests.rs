use super::*;
use crate::id::Id;
use crate::model::stroke::tool;
use crate::model::{BBox, Channels};

fn block(n: u64) -> BlockId {
    BlockId(Id::from_parts(n, 1))
}

fn stroke(n: u64, in_block: u64, start: i64) -> Arc<Stroke> {
    Arc::new(Stroke {
        id: StrokeId(Id::from_parts(n, 2)),
        block: block(in_block),
        start: Timestamp::from_unix_ms(start),
        start_unknown: false,
        style: StrokeStyle {
            tool: tool::PEN,
            palette: 1,
            color: [0x2b, 0x25, 0x21, 0xff],
            width: 2.0,
        },
        transform: None,
        origin: None,
        bbox: BBox {
            min_x: 640,
            min_y: 1_280,
            max_x: 720,
            max_y: 1_440,
        },
        channels: Channels(Channels::PRESSURE | Channels::TIME),
        point_count: 3,
        points: Arc::from(&[0x80u8, 0x0a, 0x80, 0x14][..]),
    })
}

fn sid(n: u64) -> StrokeId {
    StrokeId(Id::from_parts(n, 2))
}

fn segment(n: u64) -> SegmentRef {
    SegmentRef {
        id: SegmentId(Id::from_parts(n, 3)),
        bytes: 176,
        records: 1,
        crc32: 0xc445_a2a0,
        extra: JsonMap::new(),
    }
}

#[test]
fn keeps_strokes_in_drawing_order_per_block() {
    let mut ink = Ink::default();
    ink.insert(stroke(1, 10, 300));
    ink.insert(stroke(2, 10, 100));
    ink.insert(stroke(3, 11, 50));
    ink.insert(stroke(4, 10, 100));
    let order: Vec<StrokeId> = ink.in_block(block(10)).map(|s| s.id).collect();
    assert_eq!(order, [sid(2), sid(4), sid(1)]);
    assert_eq!(ink.count_in_block(block(10)), 3);
    assert_eq!(ink.count_in_block(block(11)), 1);
    assert_eq!(ink.count_in_block(block(12)), 0);
    assert_eq!(ink.len(), 4);
}

#[test]
fn insert_replaces_and_remove_forgets() {
    let mut ink = Ink::default();
    assert!(ink.insert(stroke(1, 10, 100)).is_none());
    let old = ink.insert(stroke(1, 11, 200)).unwrap();
    assert_eq!(old.block, block(10));
    assert_eq!(ink.count_in_block(block(10)), 0);
    assert_eq!(ink.count_in_block(block(11)), 1);
    assert!(ink.remove(sid(1)).is_some());
    assert!(ink.remove(sid(1)).is_none());
    assert!(ink.is_empty());
}

#[test]
fn props_change_style_transform_and_block() {
    let mut ink = Ink::default();
    ink.insert(stroke(1, 10, 100));
    let moved = Affine([1.0, 0.0, 0.0, 1.0, 24.0, -12.0]);
    let props = StrokeProps {
        id: sid(1),
        style: None,
        transform: Some(Some(moved)),
        block: Some(block(11)),
    };
    assert!(ink.apply_props(&props).is_some());
    let now = ink.stroke(sid(1)).unwrap();
    assert_eq!((now.transform, now.block), (Some(moved), block(11)));
    assert_eq!(now.flags(), Channels::PRESSURE | Channels::TIME | 8);
    let reset = StrokeProps {
        id: sid(1),
        style: None,
        transform: Some(Some(Affine::IDENTITY)),
        block: None,
    };
    ink.apply_props(&reset);
    assert_eq!(ink.stroke(sid(1)).unwrap().transform, None);
    let missing = StrokeProps {
        id: sid(9),
        style: None,
        transform: None,
        block: None,
    };
    assert!(ink.apply_props(&missing).is_none());
}

#[test]
fn replay_applies_records_in_order_and_counts_dead_bytes() {
    let first = vec![
        InkRecord::Stroke(stroke(1, 10, 100)),
        InkRecord::Stroke(stroke(2, 10, 200)),
    ];
    let second = vec![
        InkRecord::Remove(sid(1)),
        InkRecord::Stroke(stroke(2, 10, 250)),
        InkRecord::Props(StrokeProps {
            id: sid(2),
            style: None,
            transform: None,
            block: Some(block(11)),
        }),
        InkRecord::Remove(sid(7)),
    ];
    let (ink, warnings) = Ink::replay(vec![segment(1), segment(2)], vec![first, second]);
    assert_eq!(ink.strokes().map(|s| s.id).collect::<Vec<_>>(), [sid(2)]);
    assert_eq!(ink.stroke(sid(2)).unwrap().block, block(11));
    assert_eq!(ink.segments().len(), 2);
    assert_eq!(ink.dead_bytes(), 2 * stroke(1, 10, 100).record_len());
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].code, "ink.removeMissing");
}

#[test]
fn replay_warns_when_records_and_segments_disagree() {
    let (_, warnings) = Ink::replay(vec![segment(1)], vec![]);
    assert_eq!(warnings[0].code, "ink.segmentCount");
}

#[test]
fn commit_drops_saved_pending_records() {
    let mut ink = Ink::default();
    ink.push_pending(InkRecord::Stroke(stroke(1, 10, 100)));
    ink.push_pending(InkRecord::Remove(sid(1)));
    ink.push_pending(InkRecord::Stroke(stroke(2, 10, 100)));
    ink.commit(2, vec![segment(1)], 88);
    assert_eq!(ink.pending().len(), 1);
    assert_eq!(ink.pending()[0].stroke_id(), sid(2));
    assert_eq!(ink.segments(), &[segment(1)]);
    assert_eq!(ink.dead_bytes(), 88);
    ink.commit(10, Vec::new(), 0);
    assert!(ink.pending().is_empty());
}

#[test]
fn record_len_counts_optional_fields() {
    let mut s = Stroke::clone(&stroke(1, 10, 100));
    assert_eq!(s.record_len(), 12 + 72 + 4);
    s.transform = Some(Affine::IDENTITY);
    s.origin = Some(sid(5));
    s.start_unknown = true;
    assert_eq!(s.record_len(), 12 + 72 + 24 + 16 + 4);
    assert_eq!(s.flags(), 0b11_1101);
}

#[test]
fn affine_and_bbox_helpers() {
    let t = Affine([2.0, 0.0, 0.0, 2.0, 10.0, 20.0]);
    assert_eq!(t.apply(1.0, 2.0), (12.0, 24.0));
    assert!(Affine::IDENTITY.is_identity());
    let rect = BBox {
        min_x: 64,
        min_y: 128,
        max_x: 640,
        max_y: 256,
    }
    .to_rect();
    assert_eq!((rect.x, rect.y, rect.w, rect.h), (1.0, 2.0, 9.0, 2.0));
}
