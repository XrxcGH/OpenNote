#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use proptest::prelude::*;

use super::*;
use crate::format::SegmentHeader;
use crate::id::{BlockId, Id, PageId, SegmentId};
use crate::model::{Affine, JsonMap, SegmentRef, StrokeStyle};
use crate::testing::sample::sample_stroke;
use crate::time::Timestamp;

fn stroke(n: u64, width: f32) -> Arc<Stroke> {
    let mut stroke = sample_stroke();
    stroke.id = StrokeId(Id::from_parts(1_790_000_000_000 + n, n.into()));
    stroke.style.width = width;
    Arc::new(stroke)
}

fn segment_ref(n: u64, bytes: u64) -> SegmentRef {
    SegmentRef {
        id: SegmentId(Id::from_parts(n, 3)),
        bytes,
        records: 1,
        crc32: 0,
        extra: JsonMap::new(),
    }
}

fn decoded(records: Vec<InkRecord>) -> DecodedSegment {
    DecodedSegment {
        header: SegmentHeader {
            id: SegmentId::ZERO,
            page: PageId::ZERO,
            created: Timestamp::EPOCH,
        },
        records,
        damaged: Vec::new(),
        unknown_records: 0,
        footer_ok: true,
    }
}

/// The ink after replaying `segments`, with `pending` applied and queued.
fn ink_of(segments: &[Vec<InkRecord>], pending: &[InkRecord]) -> Ink {
    let mut all: Vec<Vec<InkRecord>> = segments.to_vec();
    all.push(pending.to_vec());
    let refs = (0..segments.len() as u64).map(|n| segment_ref(n, 1_000 - n)).collect();
    let (live, _) = Ink::replay(Vec::new(), all);
    let mut ink = Ink::replay(refs, vec![Vec::new(); segments.len()]).0;
    for stroke in live.strokes() {
        ink.insert(stroke.clone());
    }
    for record in pending {
        ink.push_pending(record.clone());
    }
    ink
}

fn live(ink: &Ink) -> Vec<Arc<Stroke>> {
    ink.strokes().cloned().collect()
}

#[test]
fn plans_follow_segment_counts_and_dead_bytes() {
    let mut ink = Ink::default();
    assert_eq!(plan_compaction(&ink), CompactionPlan::None);
    ink.push_pending(InkRecord::Stroke(stroke(1, 2.0)));
    let refs: Vec<SegmentRef> = (0..8).map(|n| segment_ref(n, 1_000 - n)).collect();
    ink.commit(0, refs.clone(), 0);
    assert_eq!(plan_compaction(&ink), CompactionPlan::Minor, "8 segments and a new one");
    ink.commit(0, refs[..7].to_vec(), 0);
    assert_eq!(plan_compaction(&ink), CompactionPlan::None);
    ink.commit(0, (0..17).map(|n| segment_ref(n, 10)).collect(), 0);
    assert_eq!(plan_compaction(&ink), CompactionPlan::Major, "more than 16 segments");
    ink.commit(0, vec![segment_ref(0, 100)], 51);
    assert_eq!(plan_compaction(&ink), CompactionPlan::Major, "more than half dead");
    ink.commit(0, vec![segment_ref(0, 100)], 50);
    assert_eq!(plan_compaction(&ink), CompactionPlan::None);
    let mut out_of_order: Vec<SegmentRef> = (0..9).map(|n| segment_ref(n, 10 + n)).collect();
    out_of_order[0].bytes = 5;
    ink.commit(0, out_of_order, 0);
    assert_eq!(plan_compaction(&ink), CompactionPlan::Major, "the base isn't first");
}

#[test]
fn major_keeps_only_live_strokes_in_drawing_order() {
    let segments = vec![vec![
        InkRecord::Stroke(stroke(2, 2.0)),
        InkRecord::Stroke(stroke(1, 2.0)),
        InkRecord::Stroke(stroke(3, 2.0)),
    ]];
    let ink = ink_of(&segments, &[InkRecord::Remove(stroke(3, 2.0).id)]);
    let records = compact(&ink, CompactionPlan::Major, &[]);
    let ids: Vec<StrokeId> = records.iter().map(InkRecord::stroke_id).collect();
    assert_eq!(ids, [stroke(1, 2.0).id, stroke(2, 2.0).id]);
}

#[test]
fn minor_folds_changes_into_one_record_per_stroke() {
    let base = vec![InkRecord::Stroke(stroke(1, 2.0)), InkRecord::Stroke(stroke(2, 2.0))];
    let later = vec![
        InkRecord::Stroke(stroke(3, 2.0)),
        InkRecord::Remove(stroke(3, 2.0).id),
        InkRecord::Props(StrokeProps {
            id: stroke(1, 2.0).id,
            style: Some(StrokeStyle {
                width: 4.0,
                ..stroke(1, 2.0).style
            }),
            transform: Some(Some(Affine([2.0, 0.0, 0.0, 2.0, 0.0, 0.0]))),
            block: None,
        }),
        InkRecord::Remove(stroke(2, 2.0).id),
    ];
    let ink = ink_of(&[base.clone(), later.clone()], &[InkRecord::Stroke(stroke(4, 1.0))]);
    let records = compact(&ink, CompactionPlan::Minor, &[decoded(base.clone()), decoded(later)]);
    assert_eq!(records.len(), 3, "{records:?}");
    assert!(matches!(&records[0], InkRecord::Props(p) if p.block.is_none() && p.style.is_some()));
    assert_eq!(records[1], InkRecord::Remove(stroke(2, 2.0).id));
    assert!(matches!(&records[2], InkRecord::Stroke(s) if s.id == stroke(4, 1.0).id));
    let (replayed, _) = Ink::replay(Vec::new(), vec![base, records]);
    assert_eq!(live(&replayed), live(&ink));
    assert_eq!(compact(&ink, CompactionPlan::None, &[]), ink.pending());
}

/// A random record about one of 6 strokes.
fn arb_record() -> impl Strategy<Value = InkRecord> {
    let id = 0u64..6;
    prop_oneof![
        (id.clone(), 1u8..4).prop_map(|(n, w)| InkRecord::Stroke(stroke(n, f32::from(w)))),
        (
            id.clone(),
            proptest::option::of(1u8..4),
            proptest::option::of(any::<bool>()),
            any::<bool>()
        )
            .prop_map(|(n, width, transform, move_block)| {
                let base = stroke(n, 2.0);
                InkRecord::Props(StrokeProps {
                    id: base.id,
                    style: width.map(|w| StrokeStyle {
                        width: f32::from(w),
                        ..base.style
                    }),
                    transform: transform.map(|on| on.then_some(Affine([1.0, 0.0, 0.0, 1.0, 5.0, 5.0]))),
                    block: move_block.then_some(BlockId(Id::from_parts(9, 9))),
                })
            }),
        id.prop_map(|n| InkRecord::Remove(stroke(n, 2.0).id)),
    ]
}

proptest! {
    /// P3, the compaction half: compaction keeps the live strokes the same.
    #[test]
    fn compaction_keeps_the_live_strokes(
        segments in proptest::collection::vec(proptest::collection::vec(arb_record(), 0..8), 1..5),
        pending in proptest::collection::vec(arb_record(), 0..6),
    ) {
        let ink = ink_of(&segments, &pending);
        let decoded_all: Vec<DecodedSegment> = segments.iter().cloned().map(decoded).collect();
        let minor = compact(&ink, CompactionPlan::Minor, &decoded_all);
        let (after_minor, _) = Ink::replay(Vec::new(), vec![segments[0].clone(), minor.clone()]);
        prop_assert_eq!(live(&after_minor), live(&ink));
        let mut ids: Vec<StrokeId> = minor.iter().map(InkRecord::stroke_id).collect();
        ids.dedup();
        prop_assert_eq!(ids.len(), minor.len(), "one record per stroke");
        let (after_major, _) = Ink::replay(Vec::new(), vec![compact(&ink, CompactionPlan::Major, &[])]);
        prop_assert_eq!(live(&after_major), live(&ink));
        prop_assert_eq!(after_major.dead_bytes(), 0);
    }

    /// The shortcut for the dead bytes after a minor compaction counts what a full replay counts.
    #[test]
    fn merged_dead_bytes_match_a_full_replay(
        base in proptest::collection::vec(arb_record(), 0..12),
        merged in proptest::collection::vec(arb_record(), 0..6),
    ) {
        let (full, _) = Ink::replay(Vec::new(), vec![base.clone(), merged.clone()]);
        prop_assert_eq!(merged_dead_bytes(&base, &merged), full.dead_bytes());
    }
}
