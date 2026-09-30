//! Generated pages.

use std::collections::{BTreeMap, HashMap};

use proptest::sample::Index;

use super::blocks::{block_id, build_block, BlockCtx};
use super::*;
use crate::model::{Blocks, FormatInfo, Ink};

/// The page-level fields of a generated page.
#[derive(Clone, Debug)]
struct Header {
    id: Id,
    title: String,
    created: Timestamp,
    modified: Timestamp,
    tags: Vec<String>,
    view: PageView,
    revision: Revision,
    extra: JsonMap,
    recordings: Option<serde_json::Value>,
}

fn arb_header(unknown: bool) -> impl Strategy<Value = Header> {
    let recordings = if unknown {
        proptest::option::weighted(0.2, arb_json()).boxed()
    } else {
        Just(None).boxed()
    };
    let fields = (
        arb_id(),
        arb_text(40),
        arb_timestamp(),
        arb_timestamp(),
        vec(arb_text(10), 0..4),
    );
    (
        fields,
        arb_view(unknown),
        arb_revision(unknown),
        arb_extra(unknown),
        recordings,
    )
        .prop_map(
            |((id, title, created, modified, tags), view, revision, extra, recordings)| Header {
                id,
                title,
                created,
                modified,
                tags,
                view,
                revision,
                extra,
                recordings,
            },
        )
}

/// A page as `config` describes it. With `segment_refs` off, its live strokes are also its pending records.
pub fn arb_page(config: PageGen) -> impl Strategy<Value = Page> {
    let unknown = config.unknown_keys;
    let assets = (0..=config.max_assets).prop_flat_map(move |n| {
        (0..n)
            .map(|i| arb_asset(AssetId(unique_id(3, i, 0)), unknown))
            .collect::<Vec<_>>()
    });
    let segments = if config.segment_refs {
        vec(arb_segment_ref(unknown), 0..4).boxed()
    } else {
        Just(Vec::new()).boxed()
    };
    let blocks = vec(arb_block_parts(unknown), 0..=config.max_blocks);
    let reading = vec(any::<Index>(), 0..3);
    (arb_header(unknown), assets, blocks, segments, reading).prop_flat_map(
        move |(header, assets, blocks, segments, reading)| {
            let ink_blocks: Vec<BlockId> = blocks
                .iter()
                .enumerate()
                .filter(|(_, b)| b.kind == 1)
                .map(|(i, b)| block_id(i, b))
                .collect();
            let strokes = arb_strokes(ink_blocks, config.max_strokes, config.max_points);
            let pend = !config.segment_refs;
            strokes.prop_map(move |strokes| assemble(&header, &assets, &blocks, (&segments, &reading), (strokes, pend)))
        },
    )
}

fn arb_strokes(blocks: Vec<BlockId>, max: usize, max_points: usize) -> BoxedStrategy<Vec<Stroke>> {
    if blocks.is_empty() || max == 0 {
        return Just(Vec::new()).boxed();
    }
    (0..=max)
        .prop_flat_map(move |n| {
            (0..n)
                .map(|i| arb_stroke(StrokeId(unique_id(2, i, 0)), blocks.clone(), max_points))
                .collect::<Vec<_>>()
        })
        .boxed()
}

fn assemble(
    header: &Header,
    assets: &[Asset],
    parts: &[BlockParts],
    (segments, reading): (&[SegmentRef], &[Index]),
    (strokes, pend): (Vec<Stroke>, bool),
) -> Page {
    let mut ink = Ink::default();
    let mut counts: HashMap<BlockId, u32> = HashMap::new();
    for stroke in strokes {
        *counts.entry(stroke.block).or_default() += 1;
        let stroke = Arc::new(stroke);
        if pend {
            ink.push_pending(InkRecord::Stroke(stroke.clone()));
        }
        ink.insert(stroke);
    }
    ink.commit(0, segments.to_vec(), 0);
    let asset_ids: Vec<AssetId> = assets.iter().map(|a| a.id).collect();
    let anchor_target = parts.first().map_or(Id::ZERO, |p| block_id(0, p).0);
    let mut ctx = BlockCtx {
        assets: &asset_ids,
        strokes: &counts,
        anchor_target,
        next: 0,
    };
    let mut blocks = Blocks::new();
    for (i, part) in parts.iter().enumerate() {
        let block = build_block(i, part, &mut ctx);
        blocks.insert(Arc::new(block)).expect("generated block IDs are unique");
    }
    let order: Vec<BlockId> = blocks.iter().map(|b| b.id).collect();
    let reading_order = if order.is_empty() {
        Vec::new()
    } else {
        reading.iter().map(|i| order[i.index(order.len())]).collect()
    };
    Page {
        id: PageId(header.id),
        title: header.title.clone(),
        created: header.created,
        modified: header.modified,
        tags: header.tags.clone(),
        view: header.view.clone(),
        blocks,
        reading_order: dedupe(reading_order),
        assets: assets.iter().map(|a| (a.id, a.clone())).collect::<BTreeMap<_, _>>(),
        ink,
        recordings: header.recordings.clone(),
        encryption: None,
        revision: header.revision.clone(),
        extra: header.extra.clone(),
        format: FormatInfo::default(),
    }
}

fn dedupe(ids: Vec<BlockId>) -> Vec<BlockId> {
    let mut seen = std::collections::HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}
