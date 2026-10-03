//! Restoring blocks from an older version of a page (amendment P3-7). The old copy replaces the current one,
//! with its strokes and the assets it needs, in one transaction.

mod ops_support;

use opennote_core::error::EditError;
use opennote_core::id::BlockId;
use opennote_core::model::{Lock, Page};
use opennote_core::ops::resolve::resolve_restore_blocks;
use opennote_core::ops::resolve::ResolveCtx;
use opennote_core::ops::Op;
use opennote_core::ops::Txn;
use opennote_core::testing::sample::{sample_ink_block, sample_page, sample_stroke, test_clock};
use opennote_core::{ClientId, Limits};
use ops_support::*;

fn restore(page: &Page, old: &Page, ids: &[BlockId]) -> Result<Txn, EditError> {
    let (clock, limits) = (test_clock(), Limits::default());
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    resolve_restore_blocks(page, old, ids, &ClientId::parse("main-1").unwrap(), &ctx)
}

fn restored(page: &Page, old: &Page, ids: &[BlockId]) -> (Page, Txn) {
    let txn = restore(page, old, ids).unwrap();
    let mut changed = page.clone();
    changed.apply(&txn).unwrap();
    (changed, txn)
}

/// The sample page with the text edited, the picture gone with its asset, and the handwriting layer deleted.
fn damaged() -> Page {
    let page = sample_page();
    let [text, image, ..] = ids(&page)[..] else { panic!() };
    let asset = page.assets.keys().next().copied().unwrap();
    let ink = sample_ink_block();
    let edits = vec![
        set_text(text, "Rewritten"),
        delete(&[image, ink]),
        opennote_core::ops::resolve::Edit::RemoveAsset { asset },
    ];
    apply(&page, edits).0
}

#[test]
fn blocks_come_back_with_their_strokes_and_assets() {
    let old = sample_page();
    let now = damaged();
    let [text, image, ..] = ids(&old)[..] else { panic!() };
    assert!(now.assets.is_empty() && now.ink.stroke(sample_stroke().id).is_none());
    let (back, txn) = restored(&now, &old, &[text, image, sample_ink_block()]);
    assert_eq!(markdown(&back, text), markdown(&old, text));
    assert!(back.blocks.contains(image) && back.blocks.contains(sample_ink_block()));
    assert_eq!(back.assets.len(), 1, "the asset entry the picture needs is added again");
    assert!(back.ink.stroke(sample_stroke().id).is_some());
    let kinds: Vec<&str> = txn
        .ops
        .iter()
        .map(|op| match op {
            Op::AddAsset { .. } => "asset",
            Op::DeleteBlocks { .. } => "delete",
            Op::InsertBlocks { .. } => "insert",
            Op::AddStrokes { .. } => "strokes",
            _ => "other",
        })
        .collect();
    assert_eq!(kinds, ["asset", "delete", "insert", "strokes"]);
    let time = back.blocks.get(text).unwrap().modified;
    assert_eq!(
        time, txn.at,
        "restored blocks count as changed at the time of the restore"
    );
}

#[test]
fn a_block_that_is_the_same_in_both_is_left_alone() {
    let old = sample_page();
    let [text, ..] = ids(&old)[..] else { panic!() };
    assert!(restore(&old, &old, &[text]).unwrap().ops.is_empty());
    assert!(restore(&old, &old, &[sample_ink_block()]).unwrap().ops.is_empty());
}

#[test]
fn a_current_copy_is_replaced_and_its_strokes_are_replaced_with_it() {
    let old = sample_page();
    let ink = sample_ink_block();
    // The handwriting layer gains a stroke, and loses the old one.
    let mut extra = sample_stroke();
    extra.id = opennote_core::id::StrokeId(opennote_core::id::Id::from_parts(5, 5));
    let now = apply(
        &old,
        vec![opennote_core::ops::resolve::Edit::RemoveStrokes {
            strokes: vec![sample_stroke().id],
        }],
    )
    .0;
    let mut now = now;
    now.ink.insert(std::sync::Arc::new(extra.clone()));
    let (back, _) = restored(&now, &old, &[ink]);
    assert!(back.ink.stroke(sample_stroke().id).is_some());
    assert!(
        back.ink.stroke(extra.id).is_none(),
        "the layer holds the strokes it held then"
    );
}

#[test]
fn a_stroke_that_moved_to_another_block_stays_there() {
    let old = sample_page();
    let ink = sample_ink_block();
    let [text, ..] = ids(&old)[..] else { panic!() };
    let new_layer = opennote_core::id::BlockId(opennote_core::id::Id::from_parts(1_800_000_000_000, 9));
    let layer = opennote_core::ops::resolve::NewBlock {
        id: new_layer,
        type_name: "ink".into(),
        frame: None,
        data: serde_json::json!({"role": "drawing"}).as_object().cloned().unwrap(),
        fallback: None,
    };
    let moved = vec![
        insert(layer, Some(text), None),
        opennote_core::ops::resolve::Edit::MoveStrokesToBlock {
            strokes: vec![sample_stroke().id],
            block: new_layer,
        },
    ];
    let now = apply(&old, moved).0;
    let (back, _) = restored(&now, &old, &[ink]);
    assert_eq!(back.ink.stroke(sample_stroke().id).unwrap().block, new_layer);
    assert_eq!(back.ink.count_in_block(ink), 0, "no copy of the stroke is made");
}

#[test]
fn restoring_follows_the_rules_of_edits() {
    let old = sample_page();
    let now = damaged();
    let missing = opennote_core::id::BlockId(opennote_core::id::Id::from_parts(1, 1));
    assert_eq!(restore(&now, &old, &[missing]).unwrap_err().code(), "notFound");
    let [text, ..] = ids(&old)[..] else { panic!() };
    let mut locked = now.clone();
    with_lock(&mut locked, text, Lock::All);
    assert_eq!(restore(&locked, &old, &[text]).unwrap_err().code(), "locked");
    let mut read_only = now;
    read_only.format.access = opennote_core::model::Access::ReadOnly(opennote_core::model::ReadOnlyReason::NewerFormat);
    assert_eq!(restore(&read_only, &old, &[text]).unwrap_err().code(), "readOnly");
}
