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
        reading_order: None,
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
    assert_eq!(changed.reading_order, [image, text]);
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
