use super::group::{joins, joins_with, typed_chars};
use super::*;
use crate::id::{BlockId, Id};
use crate::model::JsonMap;
use crate::ops::{CoalesceKind, Splice, Stamps};
use crate::time::Timestamp;

fn edit_text(block: u128, at: u32, del: &str, ins: &str) -> Op {
    Op::EditText {
        id: BlockId(Id::from_parts(1, block)),
        splices: vec![Splice {
            at,
            del: del.into(),
            ins: ins.into(),
        }],
        stamps: Stamps {
            before: Timestamp::EPOCH,
            after: Timestamp::EPOCH,
        },
    }
}

fn typing_txn(ops: Vec<Op>, target: &str) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(1, 1)),
        at: Timestamp::EPOCH,
        origin: Origin::Local,
        client: ClientId::parse("main-1").unwrap(),
        coalesce: Some(CoalesceKey {
            kind: CoalesceKind::Typing,
            target: target.into(),
        }),
        ui: None,
        ops,
    }
}

fn entry(ops: Vec<Op>, target: &str) -> UndoEntry {
    UndoEntry {
        forward: ops,
        coalesce: typing_txn(Vec::new(), target).coalesce,
        first: Duration::ZERO,
        last: Duration::ZERO,
        ui_before: None,
        ui_after: None,
        bytes: 0,
    }
}

#[test]
fn typing_joins_only_a_continuing_splice_in_the_same_block() {
    let top = entry(vec![edit_text(1, 5, "", "ab")], "b1");
    let soon = Duration::from_millis(200);
    assert!(joins(&top, &typing_txn(vec![edit_text(1, 7, "", "c")], "b1"), soon));
    assert!(
        !joins(&top, &typing_txn(vec![edit_text(1, 8, "", "c")], "b1"), soon),
        "not where the last ended"
    );
    assert!(
        !joins(&top, &typing_txn(vec![edit_text(1, 7, "", "c")], "b2"), soon),
        "another key"
    );
    assert!(
        !joins(&top, &typing_txn(vec![edit_text(2, 7, "", "c")], "b1"), soon),
        "another block"
    );
    let two = vec![edit_text(1, 7, "", "c"), edit_text(1, 8, "", "d")];
    assert!(
        !joins(&top, &typing_txn(two, "b1"), soon),
        "two text edits aren't typing"
    );
    let with_move = vec![
        edit_text(1, 7, "", "c"),
        Op::RemoveStrokes {
            strokes: vec![std::sync::Arc::new(crate::testing::sample::sample_stroke())],
        },
    ];
    assert!(!joins(&top, &typing_txn(with_move, "b1"), soon));
    assert!(!joins(
        &top,
        &typing_txn(vec![edit_text(1, 7, "", "c")], "b1"),
        TYPING_GAP
    ));
}

#[test]
fn typing_groups_count_characters_not_bytes() {
    let ops = vec![edit_text(1, 0, "", "🙂é"), edit_text(1, 0, "ab", "")];
    assert_eq!(typed_chars(&ops), 4);
    let full = entry(vec![edit_text(1, 0, "", &"x".repeat(TYPING_CHARS))], "b1");
    let next = typing_txn(vec![edit_text(1, TYPING_CHARS as u32, "", "y")], "b1");
    assert!(!joins(&full, &next, Duration::from_millis(10)));
}

#[test]
fn a_zero_entry_stack_keeps_nothing() {
    let mut stack = UndoStack::new(0);
    let txn = Txn {
        coalesce: None,
        ..typing_txn(vec![edit_text(1, 0, "", "a")], "b1")
    };
    stack.record(&txn, Duration::ZERO);
    assert!(!stack.can_undo());
    assert_eq!(stack.bytes(), 0);
    assert_eq!(delta(10, 4), -6);
    assert_eq!(delta(4, 10), 6);
}

fn patch_block(block: u128) -> Op {
    Op::PatchBlock {
        id: BlockId(Id::from_parts(1, block)),
        before: JsonMap::new(),
        after: JsonMap::new(),
        stamps: Stamps {
            before: Timestamp::EPOCH,
            after: Timestamp::EPOCH,
        },
    }
}

#[test]
fn typing_may_patch_ink_anchored_to_the_typing_block() {
    let top = entry(vec![edit_text(1, 5, "", "ab")], "b1");
    let soon = Duration::from_millis(200);
    let anchored_to_one =
        |ink: BlockId, text: BlockId| ink == BlockId(Id::from_parts(1, 9)) && text == BlockId(Id::from_parts(1, 1));
    let txn = typing_txn(vec![edit_text(1, 7, "", "c"), patch_block(9)], "b1");
    assert!(
        !joins(&top, &txn, soon),
        "a stack that doesn't know the anchors keeps them out"
    );
    assert!(joins_with(&top, &txn, soon, &anchored_to_one));
    let other_ink = typing_txn(vec![edit_text(1, 7, "", "c"), patch_block(8)], "b1");
    assert!(
        !joins_with(&top, &other_ink, soon, &anchored_to_one),
        "ink anchored elsewhere is not typing"
    );
    let same_block = typing_txn(vec![edit_text(1, 7, "", "c"), patch_block(1)], "b1");
    assert!(joins(&top, &same_block, soon), "the block's own patches always are");
}

#[test]
fn typing_that_is_not_a_splice_needs_a_matching_entry() {
    let soon = Duration::from_millis(200);
    let cells = entry(vec![patch_block(1)], "b1");
    assert!(joins(&cells, &typing_txn(vec![patch_block(1)], "b1"), soon));
    assert!(
        !joins(&cells, &typing_txn(vec![patch_block(2)], "b1"), soon),
        "another block"
    );
    assert!(!joins(
        &cells,
        &typing_txn(vec![patch_block(1), patch_block(2)], "b1"),
        soon
    ));
    assert!(
        !joins(&cells, &typing_txn(vec![edit_text(1, 0, "", "a")], "b1"), soon),
        "a splice needs a splice before it"
    );
    let text = entry(vec![edit_text(1, 5, "", "ab")], "b1");
    assert!(
        !joins(&text, &typing_txn(vec![patch_block(1)], "b1"), soon),
        "a patch needs a patch before it"
    );
    let move_op = Op::MoveBlock {
        id: BlockId(Id::from_parts(1, 3)),
        before: crate::ops::Placement {
            order: crate::order::OrderKey::parse("a0").unwrap(),
            frame: None,
        },
        after: crate::ops::Placement {
            order: crate::order::OrderKey::parse("a1").unwrap(),
            frame: None,
        },
        stamps: Stamps {
            before: Timestamp::EPOCH,
            after: Timestamp::EPOCH,
        },
    };
    assert!(joins(
        &cells,
        &typing_txn(vec![patch_block(1), move_op.clone()], "b1"),
        soon
    ));
    assert!(
        !joins(&cells, &typing_txn(vec![move_op], "b1"), soon),
        "followers alone are not typing"
    );
}
