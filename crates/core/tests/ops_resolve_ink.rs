//! Resolving the stroke, page, and asset edits of plan 7.2, and reading requests in the wire format of plan 11.4.

mod ops_support;

use opennote_core::error::EditError;
use opennote_core::id::{AssetId, BlockId, Id, StrokeId};
use opennote_core::model::{Affine, Lock};
use opennote_core::ops::resolve::view::view_to_json;
use opennote_core::ops::resolve::{compose, resolve, Edit, ResolveCtx, StyleEdit, TxnRequest};
use opennote_core::ops::Op;
use opennote_core::testing::sample::{sample_asset_id, sample_ink_block, sample_page, sample_stroke, test_clock};
use opennote_core::Limits;
use ops_support::*;
use serde_json::json;

fn transform(stroke: StrokeId, matrix: [f64; 6]) -> Edit {
    Edit::TransformStrokes {
        strokes: vec![stroke],
        matrix,
    }
}

fn restyle(stroke: StrokeId, style: StyleEdit) -> Edit {
    Edit::RestyleStrokes {
        strokes: vec![stroke],
        style,
    }
}

#[test]
fn transforms_compose_with_the_stroke_transform() {
    let page = sample_page();
    let stroke = sample_stroke().id;
    let matrix = [1.0, 0.0, 0.0, 1.0, 24.0, -12.0];
    let (moved, _) = apply_one(&page, transform(stroke, matrix));
    assert_eq!(
        moved.ink.stroke(stroke).unwrap().transform,
        Some(compose(&matrix, None))
    );
    let (twice, _) = apply_one(&moved, transform(stroke, matrix));
    let expected = compose(&[1.0, 0.0, 0.0, 1.0, 48.0, -24.0], None);
    assert_eq!(twice.ink.stroke(stroke).unwrap().transform, Some(expected));
    assert_eq!(
        code(&page, transform(stroke, [f64::NAN, 0.0, 0.0, 1.0, 0.0, 0.0])),
        "invalid"
    );
    let (back, _) = apply_one(&moved, transform(stroke, [1.0, 0.0, 0.0, 1.0, -24.0, 12.0]));
    assert_eq!(
        back.ink.stroke(stroke).unwrap().transform,
        None,
        "the identity is no transform"
    );
}

#[test]
fn composing_applies_the_stroke_transform_first() {
    let scale = Affine([2.0, 0.0, 0.0, 2.0, 0.0, 0.0]);
    let moved = compose(&[1.0, 0.0, 0.0, 1.0, 10.0, 0.0], Some(scale));
    assert_eq!(moved.apply(1.0, 1.0), (12.0, 2.0));
    let rotated = compose(&[0.0, 1.0, -1.0, 0.0, 0.0, 0.0], None);
    assert_eq!(rotated.apply(1.0, 0.0), (0.0, 1.0));
}

#[test]
fn restyling_changes_only_the_given_parts() {
    let page = sample_page();
    let stroke = sample_stroke();
    let style = StyleEdit {
        palette: Some(3),
        width: Some(4.0),
        ..StyleEdit::default()
    };
    let (styled, _) = apply_one(&page, restyle(stroke.id, style));
    let new = styled.ink.stroke(stroke.id).unwrap().style;
    assert_eq!((new.palette, new.width, new.color), (3, 4.0, stroke.style.color));
    let bad = StyleEdit {
        width: Some(f32::NAN),
        ..StyleEdit::default()
    };
    assert_eq!(code(&page, restyle(stroke.id, bad)), "invalid");
    assert!(changes_nothing(&page, restyle(stroke.id, StyleEdit::default())));
}

#[test]
fn strokes_move_only_to_ink_blocks() {
    let page = sample_page();
    let stroke = sample_stroke().id;
    let text = ids(&page)[0];
    let to_text = Edit::MoveStrokesToBlock {
        strokes: vec![stroke],
        block: text,
    };
    assert_eq!(code(&page, to_text), "invalid");
    let missing = Edit::MoveStrokesToBlock {
        strokes: vec![stroke],
        block: BlockId(Id::from_parts(1, 3)),
    };
    assert_eq!(code(&page, missing), "notFound");
}

#[test]
fn removed_strokes_are_whole_and_named_once() {
    let page = sample_page();
    let stroke = sample_stroke().id;
    let (erased, txn) = apply_one(&page, remove_strokes(&[stroke, stroke]));
    assert!(erased.ink.is_empty());
    assert!(matches!(&txn.ops[..], [Op::RemoveStrokes { strokes }] if strokes.len() == 1));
    let missing = StrokeId(Id::from_parts(1, 2));
    assert_eq!(code(&page, remove_strokes(&[missing])), "notFound");
    let mut locked = page.clone();
    with_lock(&mut locked, sample_ink_block(), Lock::All);
    let error = run_one(&locked, remove_strokes(&[stroke])).unwrap_err();
    assert_eq!(error, EditError::Locked(sample_ink_block()));
}

#[test]
fn titles_and_tags_change_only_when_they_differ() {
    let page = sample_page();
    let (changed, _) = apply_one(&page, set_title("Respiration"));
    assert_eq!(changed.title, "Respiration");
    assert!(changes_nothing(&page, set_title("Photosynthesis")));
    assert_eq!(code(&page, set_title(&"x".repeat(1_001))), "invalid");
    let tags = Edit::SetPage {
        title: None,
        tags: Some(vec!["a".repeat(201)]),
        view: None,
    };
    assert_eq!(code(&page, tags), "invalid");
}

#[test]
fn views_are_read_as_page_json_writes_them() {
    let page = sample_page();
    let view = json!({"layout": "flow", "mode": "paginated", "paper": {"size": "a4", "width": 793.7, "height": 1122.52},
        "background": {"pattern": "ruled", "color": "indigo", "marginLine": true}});
    let (changed, _) = apply_one(&page, set_view(view.clone()));
    assert_eq!(changed.view.background.pattern.as_str(), "ruled");
    assert_eq!(view_to_json(&changed.view), view);
    for bad in [
        json!({"paper": {"width": -5}}),
        json!({"paper": {"margins": [1, 2]}}),
        json!(5),
    ] {
        assert_eq!(code(&page, set_view(bad)), "invalid");
    }
    assert!(
        changes_nothing(&page, set_view(json!({}))),
        "an empty view is the default view"
    );
}

#[test]
fn reading_orders_drop_unknown_and_repeated_blocks() {
    let page = sample_page();
    let [text, image, ..] = ids(&page)[..] else { panic!() };
    let missing = BlockId(Id::from_parts(9, 9));
    let (changed, _) = apply_one(&page, set_reading_order(vec![image, missing, image, text]));
    assert_eq!(changed.view.reading_order, [image, text]);
}

#[test]
fn a_view_is_a_merge_patch_over_the_current_view() {
    let page = sample_page();
    let [text, image, ..] = ids(&page)[..] else { panic!() };
    let first =
        json!({"mode": "paginated", "paper": {"width": 700}, "readingOrder": [image.to_string(), text.to_string()]});
    let (one, _) = apply_one(&page, set_view(first));
    // A later patch changes one member and leaves the others alone.
    let (two, _) = apply_one(&one, set_view(json!({"paper": {"height": 900}})));
    assert_eq!(two.view.mode.as_str(), "paginated");
    assert_eq!((two.view.paper.width, two.view.paper.height), (700.0, 900.0));
    assert_eq!(two.view.reading_order, [image, text]);
    // `null` puts a member back to its default, for an object and for the reading order.
    let (three, _) = apply_one(&two, set_view(json!({"paper": null, "readingOrder": null})));
    assert_eq!(three.view.paper, page.view.paper);
    assert!(three.view.reading_order.is_empty());
    assert_eq!(three.view.mode.as_str(), "paginated");
    assert_eq!(code(&page, set_view(json!({"readingOrder": [5]}))), "invalid");
}

#[test]
fn assets_come_from_imports() {
    let page = sample_page();
    let mut asset = page.assets.get(&sample_asset_id()).unwrap().clone();
    let id = AssetId(Id::from_parts(1_800_000_000_000, 77));
    asset.id = id;
    asset.file = opennote_core::format::names::asset_file_name(id, "Leaf.png", "image/png");
    let imported = asset.clone();
    let lookup = move |wanted: AssetId| (wanted == imported.id).then(|| imported.clone());
    let txn = run_with(&page, vec![Edit::AddAsset { asset: id }], &lookup).unwrap();
    assert!(matches!(&txn.ops[..], [Op::AddAsset { asset: a }] if *a == asset));
    assert_eq!(code(&page, Edit::AddAsset { asset: id }), "notFound");
    assert!(changes_nothing(
        &page,
        Edit::AddAsset {
            asset: sample_asset_id()
        }
    ));
}

#[test]
fn assets_leave_the_table_once_unused() {
    let page = sample_page();
    let asset = sample_asset_id();
    assert_eq!(code(&page, Edit::RemoveAsset { asset }), "invalid");
    let image = ids(&page)[1];
    let (changed, _) = apply(&page, vec![delete(&[image]), Edit::RemoveAsset { asset }]);
    assert!(changed.assets.is_empty());
}

#[test]
fn requests_read_the_wire_format() {
    let page = sample_page();
    let text = ids(&page)[0];
    let value = json!({
        "page": page.id,
        "client": "main-1",
        "clientSeq": 57,
        "coalesce": { "kind": "typing", "target": text },
        "ui": { "selBefore": { "anchor": 118, "head": 118 }, "selAfter": { "anchor": 124, "head": 124 } },
        "edits": [
            { "edit": "setText", "block": text, "markdown": "## Light reactions" },
            { "edit": "transformStrokes", "strokes": [sample_stroke().id], "matrix": [1, 0, 0, 1, 24, -12] }
        ]
    });
    let req: TxnRequest = serde_json::from_value(value).unwrap();
    assert_eq!(req.client_seq, 57);
    let back: TxnRequest = serde_json::from_value(serde_json::to_value(&req).unwrap()).unwrap();
    assert_eq!(back, req);
    let clock = test_clock();
    let limits = Limits::default();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let txn = resolve(&page, &req, &ctx).unwrap();
    assert_eq!(
        (txn.ops.len(), txn.ui.is_some(), txn.coalesce.is_some()),
        (2, true, true)
    );
}

fn meta(page: &opennote_core::model::Page, edits: Vec<Edit>) -> opennote_core::ops::resolve::StrokeTxnMeta {
    opennote_core::ops::resolve::StrokeTxnMeta {
        page: page.id,
        client: opennote_core::ClientId::parse("main-1").unwrap(),
        client_seq: 1,
        coalesce: None,
        ui: Some(json!({"selAfter": {"anchor": 2, "head": 2}})),
        edits,
    }
}

fn add_with(
    page: &opennote_core::model::Page,
    edits: Vec<Edit>,
    strokes: Vec<std::sync::Arc<opennote_core::model::Stroke>>,
) -> Result<opennote_core::ops::Txn, EditError> {
    let (clock, limits) = (test_clock(), Limits::default());
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    opennote_core::ops::resolve::resolve_checked_strokes(page, &meta(page, edits), strokes, &ctx)
}

#[test]
fn stroke_requests_carry_edits_and_the_selection_in_one_transaction() {
    let page = sample_page();
    let old = sample_stroke();
    let mut part = old.clone();
    part.start = old.start;
    let kept = std::sync::Arc::new(part);
    // A partial erase: the stroke goes, and a slice of it comes back under the same ID.
    assert!(
        add_with(&page, Vec::new(), vec![kept.clone()]).is_err(),
        "the ID is in use without the removal"
    );
    let txn = add_with(&page, vec![remove_strokes(&[old.id])], vec![kept.clone()]).unwrap();
    assert!(matches!(
        &txn.ops[..],
        [Op::RemoveStrokes { .. }, Op::AddStrokes { .. }]
    ));
    assert!(txn.ui.is_some());
    let mut changed = page.clone();
    changed.apply(&txn).unwrap();
    assert!(changed.ink.stroke(old.id).is_some());
    // Undoing the transaction in one step restores the original stroke.
    let inverse: Vec<Op> = txn
        .ops
        .iter()
        .rev()
        .flat_map(opennote_core::ops::apply::invert)
        .collect();
    let mut undone = changed.clone();
    undone
        .apply(&opennote_core::ops::Txn {
            ops: inverse,
            ..txn.clone()
        })
        .unwrap();
    assert_eq!(undone.ink.stroke(old.id), page.ink.stroke(old.id));
}

#[test]
fn the_first_stroke_can_bring_its_layer_block() {
    let mut page = sample_page();
    let layer = sample_ink_block();
    page = apply_one(&page, delete(&[layer])).0;
    let stroke = sample_stroke();
    assert!(add_with(&page, Vec::new(), vec![std::sync::Arc::new(stroke.clone())]).is_err());
    let mut block = new_block(1, "ink", json!({"role": "layer"}));
    block.id = layer;
    let txn = add_with(
        &page,
        vec![insert(block, None, None)],
        vec![std::sync::Arc::new(stroke.clone())],
    )
    .unwrap();
    assert!(matches!(&txn.ops[..], [Op::InsertBlocks { .. }, Op::AddStrokes { .. }]));
    let mut changed = page.clone();
    changed.apply(&txn).unwrap();
    assert!(changed.ink.stroke(stroke.id).is_some() && changed.blocks.contains(layer));
}

#[test]
fn a_failing_edit_fails_the_whole_stroke_request() {
    let page = sample_page();
    let missing = StrokeId(Id::from_parts(1, 1));
    let mut fresh = sample_stroke();
    fresh.id = StrokeId(Id::from_parts(9, 9));
    let result = add_with(
        &page,
        vec![remove_strokes(&[missing])],
        vec![std::sync::Arc::new(fresh)],
    );
    assert_eq!(result.unwrap_err().code(), "notFound");
}
