use serde_json::json;

use super::*;
use crate::id::{AssetId, BlockId, ClientId, Id, StrokeId, TxnId};
use crate::model::{InkRecord, Lock, Named, OtherData};
use crate::ops::{Origin, Placement, Splice, StrokeState};
use crate::order::OrderKey;
use crate::testing::oracle::same_content_but_modified;
use crate::testing::sample::{sample_asset_id, sample_ink_block, sample_page, sample_stroke};

mod runs;

const LATER: Timestamp = Timestamp::from_unix_ms(1_790_800_000_000);

fn txn(ops: Vec<Op>) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(1, 1)),
        at: LATER,
        origin: Origin::Local,
        client: ClientId::parse("main-1").unwrap(),
        coalesce: None,
        ui: None,
        ops,
    }
}

fn blocks(page: &Page) -> Vec<Arc<Block>> {
    page.blocks.iter().cloned().collect()
}

fn text_block(page: &Page) -> Arc<Block> {
    blocks(page)[0].clone()
}

fn stamps(block: &Block) -> Stamps {
    Stamps {
        before: block.modified,
        after: LATER,
    }
}

fn edit_text(block: &Block, at: u32, del: &str, ins: &str) -> Op {
    Op::EditText {
        id: block.id,
        splices: vec![Splice {
            at,
            del: del.to_owned(),
            ins: ins.to_owned(),
        }],
        stamps: stamps(block),
    }
}

/// Applies `ops`, checks that the inverse restores the page, and returns the changed page.
fn apply_and_invert(page: &Page, ops: Vec<Op>) -> (Page, AppliedChanges) {
    let mut changed = page.clone();
    let t = txn(ops);
    let changes = changed.apply(&t).unwrap();
    let mut undone = changed.clone();
    undone.apply(&txn(invert_all(&t.ops))).unwrap();
    assert!(
        same_content_but_modified(&undone, page),
        "the inverse restores the page"
    );
    (changed, changes)
}

fn failed_check(page: &Page, ops: Vec<Op>) -> (&'static str, usize) {
    let mut changed = page.clone();
    let error = changed.apply(&txn(ops)).unwrap_err();
    assert_eq!(&changed, page, "a failed transaction leaves the page as it was");
    (error.check, error.op_index)
}

#[test]
fn edit_text_splices_and_stamps() {
    let page = sample_page();
    let block = text_block(&page);
    let (changed, changes) = apply_and_invert(&page, vec![edit_text(&block, 0, "## Light", "## Dark")]);
    let new = changed.blocks.get(block.id).unwrap();
    let BlockData::Text(text) = &new.data else { panic!() };
    assert!(text.markdown.starts_with("## Dark reactions"));
    assert_eq!((new.modified, changed.modified), (LATER, LATER));
    assert_eq!(changes.blocks_changed, [block.id]);
    assert_eq!(
        failed_check(&page, vec![edit_text(&block, 0, "#x", "")]),
        ("spliceMatches", 0)
    );
    assert_eq!(
        failed_check(&page, vec![edit_text(&blocks(&page)[1], 0, "", "x")]),
        ("textBlock", 0)
    );
}

#[test]
fn a_failing_operation_undoes_the_ones_before_it() {
    let page = sample_page();
    let block = text_block(&page);
    let ops = vec![
        edit_text(&block, 0, "", "A"),
        Op::RemoveStrokes {
            strokes: vec![Arc::new(sample_stroke())],
        },
        Op::AddAsset {
            asset: page.assets.values().next().unwrap().clone(),
        },
    ];
    assert_eq!(failed_check(&page, ops), ("assetIdUnused", 2));
    assert!(page.ink.pending().len() == 1, "no records were queued");
}

#[test]
fn empty_transactions_change_nothing() {
    let mut page = sample_page();
    let before = page.clone();
    assert_eq!(page.apply(&txn(Vec::new())).unwrap(), AppliedChanges::default());
    assert_eq!(page, before);
}

#[test]
fn deleting_an_ink_block_takes_its_strokes_and_undo_brings_them_back() {
    let page = sample_page();
    let layer = page.blocks.get(sample_ink_block()).unwrap().clone();
    let strokes: Vec<_> = page.ink.in_block(layer.id).cloned().collect();
    let delete = Op::DeleteBlocks {
        blocks: vec![layer.clone()],
        strokes: strokes.clone(),
    };
    let (changed, changes) = apply_and_invert(&page, vec![delete]);
    assert!(changed.ink.is_empty());
    assert_eq!(changes.blocks_removed, [layer.id]);
    assert_eq!(changes.strokes_removed, [strokes[0].id]);
    let only_block = Op::DeleteBlocks {
        blocks: vec![layer],
        strokes: Vec::new(),
    };
    assert_eq!(failed_check(&page, vec![only_block]), ("inkBlockEmpty", 0));
    assert_eq!(
        invert(&Op::DeleteBlocks {
            blocks: Vec::new(),
            strokes
        })
        .len(),
        2
    );
}

#[test]
fn inserted_blocks_need_unused_ids_and_known_assets() {
    let page = sample_page();
    let existing = text_block(&page);
    assert_eq!(
        failed_check(
            &page,
            vec![Op::InsertBlocks {
                blocks: vec![existing.clone()]
            }]
        ),
        ("blockIdUnused", 0)
    );
    let mut image = Block::clone(&blocks(&page)[1]);
    image.id = BlockId(Id::from_parts(5, 5));
    if let BlockData::Image(data) = &mut image.data {
        data.asset = AssetId(Id::from_parts(5, 6));
    }
    let insert = Op::InsertBlocks {
        blocks: vec![Arc::new(image)],
    };
    assert_eq!(failed_check(&page, vec![insert]), ("blockValid", 0));
}

#[test]
fn locks_stop_moves_and_edits() {
    let mut page = sample_page();
    let block = text_block(&page);
    let mut locked = Block::clone(&block);
    locked.lock = Some(Named::Known(Lock::All));
    page.blocks.replace(Arc::new(locked.clone())).unwrap();
    let placement = Placement {
        order: block.order.clone(),
        frame: block.frame.clone(),
    };
    let moved = Placement {
        order: OrderKey::parse("Zz").unwrap(),
        frame: None,
    };
    let move_op = Op::MoveBlock {
        id: block.id,
        before: placement,
        after: moved,
        stamps: stamps(&locked),
    };
    assert_eq!(failed_check(&page, vec![move_op]), ("blockLocked", 0));
    assert_eq!(
        failed_check(&page, vec![edit_text(&locked, 0, "", "x")]),
        ("blockLocked", 0)
    );
    let unlock = Op::PatchBlock {
        id: block.id,
        before: crate::ops::merge_patch::view::block_view(&locked)
            .into_iter()
            .filter(|(k, _)| k == "lock")
            .collect(),
        after: [("lock".to_owned(), serde_json::Value::Null)].into_iter().collect(),
        stamps: stamps(&locked),
    };
    let (unlocked, _) = apply_and_invert(&page, vec![unlock]);
    assert_eq!(unlocked.blocks.get(block.id).unwrap().lock, None);
}

fn patch_op(block: &Block, before: serde_json::Value, after: serde_json::Value) -> Op {
    let map = |v: serde_json::Value| v.as_object().unwrap().clone();
    Op::PatchBlock {
        id: block.id,
        before: map(before),
        after: map(after),
        stamps: stamps(block),
    }
}

#[test]
fn patches_check_before_values_and_the_result() {
    let page = sample_page();
    let image = blocks(&page)[1].clone();
    let good = patch_op(
        &image,
        json!({"data": {"alt": "Cross-section of a leaf", "decorative": null}}),
        json!({"data": {"alt": "A leaf", "decorative": true}}),
    );
    let (changed, _) = apply_and_invert(&page, vec![good]);
    let BlockData::Image(data) = &changed.blocks.get(image.id).unwrap().data else {
        panic!()
    };
    assert!(data.decorative && data.alt == "A leaf");
    let stale = patch_op(
        &image,
        json!({"data": {"alt": "Other"}}),
        json!({"data": {"alt": "A leaf"}}),
    );
    assert_eq!(failed_check(&page, vec![stale]), ("patchBefore", 0));
    let bad = patch_op(
        &image,
        json!({"data": {"asset": image_asset(&page)}}),
        json!({"data": {"asset": 5}}),
    );
    assert_eq!(failed_check(&page, vec![bad]), ("patchValid", 0));
    let loose = patch_op(
        &image,
        json!({"data": {"crop": null}}),
        json!({"data": {"crop": {"x": 0, "y": 0, "w": 1, "h": 1}}}),
    );
    assert_eq!(failed_check(&page, vec![loose]), ("patchCanonical", 0));
    let frame = patch_op(&image, json!({"frame": null}), json!({"frame": {}}));
    assert_eq!(failed_check(&page, vec![frame]), ("patchKeys", 0));
    let layer = page.blocks.get(sample_ink_block()).unwrap().clone();
    let count = patch_op(
        &layer,
        json!({"data": {"strokeCount": 1}}),
        json!({"data": {"strokeCount": 9}}),
    );
    assert_eq!(failed_check(&page, vec![count]), ("strokeCountDerived", 0));
    let kanban = blocks(&page)[3].clone();
    assert!(matches!(kanban.data, BlockData::Other(OtherData { .. })));
    let edit_unknown = patch_op(&kanban, json!({"data": {"cards": null}}), json!({"data": {"cards": 8}}));
    assert_eq!(failed_check(&page, vec![edit_unknown]), ("blockUnknownType", 0));
}

fn image_asset(page: &Page) -> String {
    page.assets.keys().next().unwrap().to_string()
}

#[test]
fn added_strokes_are_counted_and_queued() {
    let page = sample_page();
    let mut other = sample_stroke();
    other.id = StrokeId(Id::from_parts(7, 7));
    let other = Arc::new(other);
    let add = |stroke: &Arc<Stroke>| Op::AddStrokes {
        strokes: vec![stroke.clone()],
    };
    let (added, changes) = apply_and_invert(&page, vec![add(&other)]);
    assert_eq!(changes.strokes_added, [other.id]);
    assert_eq!(added.ink.count_in_block(sample_ink_block()), 2);
    let BlockData::Ink(ink) = &added.blocks.get(sample_ink_block()).unwrap().data else {
        panic!()
    };
    assert_eq!(ink.stroke_count, 2);
    assert_eq!(added.ink.pending().last(), Some(&InkRecord::Stroke(other.clone())));
    let taken = Arc::new(sample_stroke());
    assert_eq!(failed_check(&page, vec![add(&taken)]), ("strokeIdUnused", 0));
}

fn props(id: StrokeId, before: &StrokeState, after: &StrokeState) -> Op {
    Op::SetStrokeProps {
        items: vec![crate::ops::StrokePropsChange {
            id,
            before: before.clone(),
            after: after.clone(),
        }],
    }
}

#[test]
fn stroke_properties_change_with_a_record() {
    let page = sample_page();
    let stroke = sample_stroke();
    let before = StrokeState {
        style: stroke.style,
        transform: None,
        block: stroke.block,
    };
    let after = StrokeState {
        transform: Some(crate::model::Affine([2.0, 0.0, 0.0, 2.0, 5.0, 5.0])),
        ..before.clone()
    };
    let (moved, changes) = apply_and_invert(&page, vec![props(stroke.id, &before, &after)]);
    assert_eq!(changes.strokes_changed, [stroke.id]);
    assert_eq!(moved.ink.stroke(stroke.id).unwrap().transform, after.transform);
    let record = moved.ink.pending().last();
    assert!(matches!(record, Some(InkRecord::Props(p)) if p.transform.is_some() && p.style.is_none()));
    let stale = props(stroke.id, &after, &before);
    assert_eq!(failed_check(&page, vec![stale]), ("strokePropsEqual", 0));
}

#[test]
fn assets_in_use_stay() {
    let page = sample_page();
    let asset = page.assets.get(&sample_asset_id()).unwrap().clone();
    assert_eq!(
        failed_check(&page, vec![Op::RemoveAsset { asset: asset.clone() }]),
        ("assetUnused", 0)
    );
    let image = blocks(&page)[1].clone();
    let ops = vec![
        Op::DeleteBlocks {
            blocks: vec![image],
            strokes: Vec::new(),
        },
        Op::RemoveAsset { asset },
    ];
    let (changed, changes) = apply_and_invert(&page, ops);
    assert!(changed.assets.is_empty());
    assert_eq!(changes.assets_changed, [sample_asset_id()]);
}

#[test]
fn set_page_needs_matching_pairs() {
    let page = sample_page();
    let before = PageFields {
        title: Some(page.title.clone()),
        ..PageFields::default()
    };
    let after = PageFields {
        title: Some("Respiration".to_owned()),
        ..PageFields::default()
    };
    let (changed, changes) = apply_and_invert(
        &page,
        vec![Op::SetPage {
            before: before.clone(),
            after: after.clone(),
        }],
    );
    assert_eq!(changed.title, "Respiration");
    assert!(changes.page_fields);
    let unpaired = Op::SetPage {
        before: PageFields::default(),
        after,
    };
    assert_eq!(failed_check(&page, vec![unpaired]), ("fieldsPaired", 0));
    let stale = Op::SetPage {
        before: PageFields {
            title: Some("Other".to_owned()),
            ..PageFields::default()
        },
        after: before,
    };
    assert_eq!(failed_check(&page, vec![stale]), ("pageFieldsEqual", 0));
}

#[test]
fn retained_bytes_charge_what_only_undo_keeps() {
    let stroke = Arc::new(sample_stroke());
    let removed = retained_bytes(&Op::RemoveStrokes {
        strokes: vec![stroke.clone()],
    });
    let added = retained_bytes(&Op::AddStrokes {
        strokes: vec![stroke.clone()],
    });
    assert!(removed >= stroke.points.len() + size_of::<Stroke>());
    assert!(added < removed);
    let page = sample_page();
    let typed = retained_bytes(&edit_text(&text_block(&page), 0, "", "hello"));
    assert!(typed >= size_of::<Op>() + 5 && typed < size_of::<Op>() + 256);
}
