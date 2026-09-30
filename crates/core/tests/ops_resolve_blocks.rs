//! Resolving the block edits of plan 7.2 against the sample page, with the lock rules and the limits.

mod ops_support;

use std::sync::Arc;

use opennote_core::error::EditError;
use opennote_core::id::{BlockId, Id, PageId};
use opennote_core::model::{Access, Block, BlockData, Frame, Lock, Page, ReadOnlyReason};
use opennote_core::ops::resolve::{assigned_order_keys, resolve, Edit, ResolveCtx, TxnRequest};
use opennote_core::ops::Op;
use opennote_core::testing::sample::{sample_page, test_clock};
use opennote_core::{Limits, OrderKey};
use ops_support::*;
use serde_json::json;

#[test]
fn set_text_gives_one_splice() {
    let page = sample_page();
    let [text, image, ..] = ids(&page)[..] else { panic!() };
    let old = markdown(&page, text);
    let new = old.replace("thylakoid", "stroma");
    let (changed, txn) = apply_one(&page, set_text(text, &new));
    assert_eq!(markdown(&changed, text), new);
    assert!(matches!(&txn.ops[..], [Op::EditText { splices, .. }] if splices.len() == 1));
    assert!(changes_nothing(&page, set_text(text, &old)));
    assert_eq!(code(&page, set_text(image, "x")), "invalid");
    let missing = BlockId(Id::from_parts(1, 1));
    let error = run_one(&page, set_text(missing, "x")).unwrap_err();
    assert_eq!((error.code(), error.resync()), ("notFound", true));
    let long = "x".repeat(4 * 1024 * 1024 + 1);
    assert_eq!(code(&page, set_text(text, &long)), "invalid");
}

#[test]
fn locks_reject_edits_with_their_code() {
    let mut page = sample_page();
    let text = ids(&page)[0];
    with_lock(&mut page, text, Lock::All);
    assert_eq!(
        run_one(&page, set_text(text, "x")).unwrap_err(),
        EditError::Locked(text)
    );
    let (unlocked, _) = apply_one(&page, lock(text, "none"));
    assert_eq!(unlocked.blocks.get(text).unwrap().lock, None);
    let mut page = sample_page();
    with_lock(&mut page, text, Lock::Position);
    let moved = run_one(&page, move_block(text, Some(at(1.0, 2.0)), None));
    assert_eq!(moved.unwrap_err(), EditError::Locked(text));
    assert_eq!(
        code(&page, set_text(text, "x")),
        "ok",
        "a position lock allows text edits"
    );
}

#[test]
fn read_only_pages_and_other_pages_are_rejected() {
    let mut page = sample_page();
    let text = ids(&page)[0];
    page.format.access = Access::ReadOnly(ReadOnlyReason::NewerFormat);
    assert_eq!(code(&page, set_text(text, "x")), "readOnly");
    let page = sample_page();
    let req = TxnRequest {
        page: PageId(Id::from_parts(3, 3)),
        ..request(&page, vec![])
    };
    let clock = test_clock();
    let limits = Limits::default();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    assert!(matches!(resolve(&page, &req, &ctx), Err(EditError::Invalid(_))));
}

#[test]
fn inserted_blocks_get_order_keys_and_timestamps() {
    let page = sample_page();
    let [text, image, ..] = ids(&page)[..] else { panic!() };
    let block = new_block(1, "text", json!({"markdown": "New"}));
    let id = block.id;
    let (changed, txn) = apply_one(&page, insert(block, Some(text), Some(image)));
    assert_eq!(ids(&changed)[..3], [text, id, image]);
    let inserted = changed.blocks.get(id).unwrap();
    assert_eq!((inserted.created, inserted.modified), (txn.at, txn.at));
    assert_eq!(assigned_order_keys(&txn), [(id, inserted.order.clone())]);
    let first = new_block(3, "text", json!({}));
    let first_id = first.id;
    let (changed, _) = apply_one(&page, insert(first, None, Some(text)));
    assert_eq!(ids(&changed)[0], first_id);
}

#[test]
fn new_ink_blocks_start_without_strokes_and_empty_frames_are_none() {
    let page = sample_page();
    let drawing = new_block(2, "ink", json!({"role": "drawing", "strokeCount": 5}));
    let id = drawing.id;
    let (changed, _) = apply_one(&page, insert(drawing, None, None));
    assert_eq!(ids(&changed).last(), Some(&id));
    let BlockData::Ink(ink) = &changed.blocks.get(id).unwrap().data else {
        panic!()
    };
    assert_eq!(ink.stroke_count, 0, "the core counts strokes itself");
    let mut empty_frame = new_block(4, "text", json!({}));
    empty_frame.frame = Some(Frame::default());
    let id = empty_frame.id;
    let (changed, _) = apply_one(&page, insert(empty_frame, None, None));
    assert_eq!(changed.blocks.get(id).unwrap().frame, None);
}

#[test]
fn new_blocks_need_unused_ids_and_known_types() {
    let page = sample_page();
    let text = ids(&page)[0];
    let mut taken = new_block(1, "text", json!({}));
    taken.id = text;
    assert_eq!(code(&page, insert(taken, None, None)), "invalid");
    let mut element = new_block(1, "text", json!({}));
    element.id = "01m3sa14y9zszek1wdk3snddt0".parse().unwrap();
    assert_eq!(
        code(&page, insert(element, None, None)),
        "invalid",
        "element IDs share the ID space"
    );
    let clash = new_block(1, "text", json!({"ids": ["01m3sa14y9zszek1wdk3snddt0"]}));
    assert_eq!(code(&page, insert(clash, None, None)), "invalid");
    for type_name in ["chart", "mystery", "ext:org.example/x"] {
        assert_eq!(
            code(&page, insert(new_block(1, type_name, json!({})), None, None)),
            "invalid"
        );
    }
    let mut extension = new_block(1, "ext:org.example/x", json!({"cards": 1}));
    extension.fallback = Some(json!({"markdown": "A card"}));
    assert_eq!(code(&page, insert(extension, None, None)), "ok");
    let unknown_asset = new_block(1, "image", json!({"asset": "01m3sa43z1tp9rdr5e8df2jbxz"}));
    assert_eq!(code(&page, insert(unknown_asset, None, None)), "invalid");
}

#[test]
fn after_and_before_must_be_neighbors() {
    let page = sample_page();
    let [text, image, ..] = ids(&page)[..] else { panic!() };
    let apart = insert(new_block(1, "text", json!({})), Some(image), Some(text));
    assert_eq!(code(&page, apart), "invalid");
    let missing = BlockId(Id::from_parts(1, 1));
    assert_eq!(
        code(&page, insert(new_block(1, "text", json!({})), Some(missing), None)),
        "notFound"
    );
}

/// A page whose first two blocks share an order key, so no key fits between them.
fn page_with_equal_keys() -> Page {
    let mut page = sample_page();
    let second = ids(&page)[1];
    let mut block = Block::clone(page.blocks.get(second).unwrap());
    block.order = OrderKey::parse("a0").unwrap();
    page.blocks.replace(Arc::new(block)).unwrap();
    page
}

#[test]
fn a_key_that_doesnt_fit_re_keys_the_blocks() {
    let page = page_with_equal_keys();
    let order = ids(&page);
    let block = new_block(5, "text", json!({}));
    let id = block.id;
    let (changed, txn) = apply_one(&page, insert(block, Some(order[0]), Some(order[1])));
    let mut expected = order.clone();
    expected.insert(1, id);
    assert_eq!(ids(&changed), expected);
    assert!(txn.ops.iter().any(|op| matches!(op, Op::MoveBlock { .. })));
    let keys: Vec<_> = changed.blocks.iter().map(|b| b.order.clone()).collect();
    assert!(keys.windows(2).all(|w| w[0] < w[1]), "every key is distinct");
    assert!(assigned_order_keys(&txn).len() > 1);
    let mut locked = page_with_equal_keys();
    with_lock(&mut locked, order[3], Lock::Position);
    let block = new_block(6, "text", json!({}));
    let error = run_one(&locked, insert(block, Some(order[0]), None)).unwrap_err();
    assert_eq!(error, EditError::Locked(order[3]));
}

#[test]
fn blocks_move_by_frame() {
    let page = sample_page();
    let text = ids(&page)[0];
    let frame = Frame {
        w: Some(300.0),
        ..at(10.0, 20.0)
    };
    let (changed, txn) = apply_one(&page, move_block(text, Some(frame.clone()), None));
    assert_eq!(changed.blocks.get(text).unwrap().frame, Some(frame));
    assert!(assigned_order_keys(&txn).is_empty());
    let too_far = move_block(text, Some(at(1e12, 0.0)), None);
    assert_eq!(code(&page, too_far), "invalid");
    let (flowing, _) = apply_one(&page, move_block(text, Some(Frame::default()), None));
    assert_eq!(
        flowing.blocks.get(text).unwrap().frame,
        None,
        "an empty frame removes the frame"
    );
}

#[test]
fn blocks_move_among_their_siblings() {
    let page = sample_page();
    let [text, image, layer, kanban] = ids(&page)[..] else {
        panic!()
    };
    let (changed, _) = apply_one(&page, move_block(text, None, Some(kanban)));
    assert_eq!(ids(&changed), [image, layer, kanban, text]);
    assert!(
        changes_nothing(&page, move_block(image, None, Some(text))),
        "already in place"
    );
    assert_eq!(code(&page, move_block(text, None, Some(text))), "invalid");
}

#[test]
fn patches_are_normalized_and_exact() {
    let page = sample_page();
    let image = ids(&page)[1];
    let crop = patch(image, json!({"crop": {"x": 0, "y": 0, "w": 1, "h": 0.5}, "alt": ""}));
    let (changed, txn) = apply_one(&page, crop);
    let BlockData::Image(data) = &changed.blocks.get(image).unwrap().data else {
        panic!()
    };
    assert_eq!((data.alt.as_str(), data.crop.as_ref().map(|c| c.h)), ("", Some(0.5)));
    let Op::PatchBlock { before, after, .. } = &txn.ops[0] else {
        panic!()
    };
    let (before, after) = (json!(before), json!(after));
    assert_eq!(
        after["data"]["alt"],
        serde_json::Value::Null,
        "an empty description is left out"
    );
    assert_eq!(before["data"]["alt"], json!("Cross-section of a leaf"));
    assert!(changes_nothing(&page, patch(image, json!({}))));
    assert_eq!(code(&page, patch(image, json!({"alt": 3}))), "invalid");
}

#[test]
fn patches_follow_the_rules_of_each_type() {
    let page = sample_page();
    let [text, _, layer, kanban] = ids(&page)[..] else {
        panic!()
    };
    let style = patch(text, json!({"styles": {"01m3sa14y9zszek1wdk3snddt0": "title"}}));
    assert_eq!(code(&page, style), "ok");
    assert_eq!(code(&page, patch(layer, json!({"strokeCount": 3}))), "invalid");
    assert_eq!(code(&page, patch(kanban, json!({"cards": 3}))), "invalid");
    assert_eq!(
        code(&page, lock(kanban, "position")),
        "ok",
        "unknown types can still be locked"
    );
    assert_eq!(code(&page, lock(kanban, "sealed")), "invalid");
}

fn patch_fallback(page: &Page, block: BlockId, fallback: serde_json::Value, seq: u64) -> Page {
    let req: TxnRequest = serde_json::from_value(json!({
        "page": page.id, "client": "main-1", "clientSeq": seq,
        "edits": [{"edit": "patchBlock", "block": block, "fallback": fallback}]
    }))
    .unwrap();
    let clock = test_clock();
    let limits = Limits::default();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let mut changed = page.clone();
    changed.apply(&resolve(page, &req, &ctx).unwrap()).unwrap();
    changed
}

#[test]
fn fallbacks_are_removed_with_null() {
    let page = sample_page();
    let text = ids(&page)[0];
    let added = patch_fallback(&page, text, json!({"markdown": "Plain"}), 1);
    assert!(added.blocks.get(text).unwrap().fallback.is_some());
    let removed = patch_fallback(&added, text, serde_json::Value::Null, 2);
    assert!(removed.blocks.get(text).unwrap().fallback.is_none());
}

#[test]
fn deleting_blocks_takes_strokes_and_reading_order() {
    let mut page = sample_page();
    let [text, _, layer, _] = ids(&page)[..] else { panic!() };
    page.reading_order = vec![layer, text];
    let (changed, txn) = apply_one(&page, delete(&[layer, layer]));
    assert!(changed.ink.is_empty());
    assert_eq!(changed.reading_order, [text]);
    let shape = matches!(&txn.ops[..], [Op::SetPage { .. }, Op::DeleteBlocks { blocks, strokes }]
        if blocks.len() == 1 && strokes.len() == 1);
    assert!(shape, "{:?}", txn.ops);
    assert!(changes_nothing(&page, delete(&[])));
    with_lock(&mut page, text, Lock::All);
    assert_eq!(run_one(&page, delete(&[text])).unwrap_err(), EditError::Locked(text));
}

#[test]
fn later_edits_see_the_earlier_edits_of_a_request() {
    let page = sample_page();
    let block = new_block(8, "text", json!({"markdown": "One"}));
    let id = block.id;
    let first = ids(&page)[0];
    let edits = vec![
        insert(block, None, None),
        set_text(id, "One two"),
        Edit::MoveBlock {
            block: id,
            frame: None,
            after: None,
            before: Some(first),
        },
    ];
    let (changed, txn) = apply(&page, edits);
    assert_eq!(markdown(&changed, id), "One two");
    assert_eq!(ids(&changed)[0], id);
    assert_eq!(txn.ops.len(), 3);
}
