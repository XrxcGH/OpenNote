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
