use serde_json::json;

use super::*;
use crate::id::Id;
use crate::testing::sample::{sample_page, test_clock};

fn ctx_parts() -> (crate::time::TestClock, Limits) {
    (test_clock(), Limits::default())
}

#[test]
fn a_null_fallback_differs_from_a_missing_one() {
    let edit: Edit =
        serde_json::from_value(json!({"edit": "patchBlock", "block": "01m3sa14y9zszek1wdk3snddsn"})).unwrap();
    assert!(matches!(edit, Edit::PatchBlock { fallback: None, .. }));
    let edit: Edit =
        serde_json::from_value(json!({"edit": "patchBlock", "block": "01m3sa14y9zszek1wdk3snddsn", "fallback": null}))
            .unwrap();
    assert!(matches!(
        edit,
        Edit::PatchBlock {
            fallback: Some(serde_json::Value::Null),
            ..
        }
    ));
    let back: Edit = serde_json::from_value(serde_json::to_value(&edit).unwrap()).unwrap();
    assert_eq!(back, edit);
}

#[test]
fn keys_other_tools_wrote_are_replaced_when_nothing_fits() {
    let mut page = sample_page();
    let last = page.blocks.iter().last().unwrap().clone();
    let mut foreign = Block::clone(&last);
    foreign.order = OrderKey::parse("z").unwrap();
    foreign.lock = None;
    page.blocks.replace(Arc::new(foreign)).unwrap();
    assert!(!page.blocks.get(last.id).unwrap().order.is_fractional());
    let (clock, limits) = ctx_parts();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let c = EditCtx {
        page: &page,
        ctx: &ctx,
        at: clock.now(),
    };
    let (ops, key) = place::place(&c, None, None, None).unwrap();
    assert!(
        matches!(&ops[..], [Op::MoveBlock { id, .. }] if *id == last.id),
        "only the foreign key changes"
    );
    let mut changed = page.clone();
    apply_ops(&mut changed, &ops, c.at).unwrap();
    assert!(changed.blocks.iter().all(|b| b.order < key && b.order.is_fractional()));
}

#[test]
fn checked_strokes_need_new_ids_and_an_ink_block() {
    let page = sample_page();
    let (clock, limits) = ctx_parts();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let meta = StrokeTxnMeta {
        page: page.id,
        client: ClientId::parse("main-1").unwrap(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: Vec::new(),
    };
    let stroke = Arc::new(crate::testing::sample::sample_stroke());
    let taken = resolve_checked_strokes(&page, &meta, vec![stroke.clone()], &ctx);
    assert!(matches!(taken, Err(EditError::Invalid(_))));
    let mut fresh = Stroke::clone(&stroke);
    fresh.id = StrokeId(Id::from_parts(1, 9));
    let twice = vec![Arc::new(fresh.clone()), Arc::new(fresh.clone())];
    assert!(matches!(
        resolve_checked_strokes(&page, &meta, twice, &ctx),
        Err(EditError::Invalid(_))
    ));
    let mut no_block = fresh.clone();
    no_block.block = BlockId(Id::from_parts(1, 10));
    let missing = resolve_checked_strokes(&page, &meta, vec![Arc::new(no_block)], &ctx);
    assert!(matches!(missing, Err(EditError::NotFound(_))));
    let mut wide = fresh.clone();
    wide.style.width = f32::INFINITY;
    assert!(resolve_checked_strokes(&page, &meta, vec![Arc::new(wide)], &ctx).is_err());
    let small = Limits {
        strokes_per_page: 1,
        ..Limits::default()
    };
    let tight = ResolveCtx { limits: &small, ..ctx };
    assert!(resolve_checked_strokes(&page, &meta, vec![Arc::new(fresh.clone())], &tight).is_err());
    let txn = resolve_checked_strokes(&page, &meta, vec![Arc::new(fresh)], &ctx).unwrap();
    assert!(matches!(&txn.ops[..], [Op::AddStrokes { strokes }] if strokes.len() == 1));
    assert!(resolve_checked_strokes(&page, &meta, Vec::new(), &ctx)
        .unwrap()
        .ops
        .is_empty());
}

#[test]
fn object_groups_live_in_the_view_and_undo_exactly_without_touching_the_reading_order() {
    // ADR 0036: a group is a `groups` entry in the page view, set and removed by a view patch.
    let page = sample_page();
    let (clock, limits) = ctx_parts();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let c = EditCtx {
        page: &page,
        ctx: &ctx,
        at: clock.now(),
    };
    let ids: Vec<String> = page.blocks.iter().take(2).map(|b| b.id.to_string()).collect();
    let group = json!({"groups": {"01m3sa14y9zszek1wdk3sngrp1": {"blocks": ids, "strokes": []}}});
    let edit: Edit = serde_json::from_value(json!({"edit": "setPage", "view": group})).unwrap();
    let ops = resolve_edit(&c, &edit).unwrap();
    let mut grouped = page.clone();
    apply_ops(&mut grouped, &ops, c.at).unwrap();
    assert_eq!(grouped.view.extra.get("groups"), group.get("groups"));
    assert_eq!(grouped.view.reading_order, page.view.reading_order);
    assert_eq!(grouped.blocks, page.blocks);
    let mut undone = grouped.clone();
    apply_ops(&mut undone, &crate::ops::apply::invert_all(&ops), c.at).unwrap();
    assert_eq!(undone.view, page.view);
    // Ungrouping is the same patch with null.
    let ungroup: Edit = serde_json::from_value(
        json!({"edit": "setPage", "view": {"groups": {"01m3sa14y9zszek1wdk3sngrp1": null}}}),
    )
    .unwrap();
    let c2 = EditCtx {
        page: &grouped,
        ctx: &ctx,
        at: clock.now(),
    };
    let mut ungrouped = grouped.clone();
    apply_ops(&mut ungrouped, &resolve_edit(&c2, &ungroup).unwrap(), c2.at).unwrap();
    assert!(ungrouped.view.extra.get("groups").map_or(true, |g| g.as_object().is_some_and(|o| o.is_empty())));
}

#[test]
fn ink_layers_and_links_live_in_the_view_and_undo_exactly() {
    // ADR 0037: layers are an `inkLayers` entry in the page view. A layer change and a link change are view patches.
    let page = sample_page();
    let (clock, limits) = ctx_parts();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let c = EditCtx {
        page: &page,
        ctx: &ctx,
        at: clock.now(),
    };
    let view = json!({
        "inkLayers": {
            "order": ["base", "01m3sa14y9zszek1wdk3snlyr1"],
            "layers": { "01m3sa14y9zszek1wdk3snlyr1": { "name": "Notes", "hidden": true, "locked": false, "imported": false } },
            "assign": { "01m3sa14y9zszek1wdk3snstr1": "01m3sa14y9zszek1wdk3snlyr1" }
        },
        "inkLinks": { "01m3sa14y9zszek1wdk3snlnk1": {
            "block": "01m3sa14y9zszek1wdk3snddsn", "strokes": ["01m3sa14y9zszek1wdk3snstr1"],
            "target": { "kind": "recording" }, "label": "Rec" } }
    });
    let edit: Edit = serde_json::from_value(json!({"edit": "setPage", "view": view})).unwrap();
    let ops = resolve_edit(&c, &edit).unwrap();
    let mut changed = page.clone();
    apply_ops(&mut changed, &ops, c.at).unwrap();
    assert_eq!(changed.view.extra.get("inkLayers"), view.get("inkLayers"));
    assert_eq!(changed.view.extra.get("inkLinks"), view.get("inkLinks"));
    assert_eq!(changed.blocks, page.blocks);
    let mut undone = changed.clone();
    apply_ops(&mut undone, &crate::ops::apply::invert_all(&ops), c.at).unwrap();
    assert_eq!(undone.view, page.view);
    // Moving one stroke back to the base layer is a null in the assign map.
    let back: Edit = serde_json::from_value(
        json!({"edit": "setPage", "view": {"inkLayers": {"assign": {"01m3sa14y9zszek1wdk3snstr1": null}}}}),
    )
    .unwrap();
    let c2 = EditCtx {
        page: &changed,
        ctx: &ctx,
        at: clock.now(),
    };
    let mut moved = changed.clone();
    apply_ops(&mut moved, &resolve_edit(&c2, &back).unwrap(), c2.at).unwrap();
    let assign = moved.view.extra.get("inkLayers").and_then(|l| l.get("assign"));
    assert!(assign.map_or(true, |a| a.as_object().is_some_and(|o| o.is_empty())));
}
