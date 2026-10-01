//! Undo and redo stacks (plan 7.3): grouping by kind, one stack per client, dropped entries, and the budget.

mod ops_support;

use std::sync::Arc;
use std::time::Duration;

use opennote_core::id::{ClientId, Id, TxnId};
use opennote_core::model::{Access, Frame, ReadOnlyReason};
use opennote_core::ops::resolve::{Edit, StyleEdit};
use opennote_core::ops::undo::{merge_splices, UndoStack, MAX_ENTRIES};
use opennote_core::ops::{CoalesceKind, Op, Origin, Splice, Txn};
use opennote_core::testing::sample::{sample_page, sample_stroke};
use ops_support::*;

fn stack() -> UndoStack {
    UndoStack::new(MAX_ENTRIES)
}

#[test]
fn typing_groups_until_a_pause_and_merges_splices() {
    let (mut s, mut stack) = (Session::new(), stack());
    let start = s.markdown();
    for word in ["a", "b", "c"] {
        s.type_text(&mut stack, 200, word);
    }
    assert_eq!(stack.undo.len(), 1);
    let Op::EditText { splices, .. } = &stack.undo[0].forward[0] else {
        panic!()
    };
    assert_eq!(
        (splices.len(), splices[0].ins.as_str()),
        (1, "abc"),
        "three insertions are one splice"
    );
    s.type_text(&mut stack, 1_000, "d");
    assert_eq!(stack.undo.len(), 2, "a pause of 1 second starts a new step");
    assert_eq!(s.undo_all(&mut stack), 2);
    assert_eq!(s.markdown(), start);
}

#[test]
fn typing_groups_close_after_10_seconds() {
    let (mut s, mut stack) = (Session::new(), stack());
    for _ in 0..30 {
        s.type_text(&mut stack, 500, "x");
    }
    assert_eq!(stack.undo.len(), 2, "15 seconds of typing make 2 steps");
}

#[test]
fn switching_between_typing_and_deleting_starts_a_step() {
    let (mut s, mut stack) = (Session::new(), stack());
    s.type_text(&mut stack, 100, "ab");
    let group = key(CoalesceKind::Typing, &s.text().to_string());
    for _ in 0..2 {
        let mut text = s.markdown();
        text.pop();
        let edit = set_text(s.text(), &text);
        s.edit(&mut stack, "main-1", (100, group.clone()), vec![edit]);
    }
    assert_eq!(stack.undo.len(), 2);
    let Op::EditText { splices, .. } = &stack.undo[1].forward[0] else {
        panic!()
    };
    assert_eq!(
        (splices.len(), splices[0].del.as_str()),
        (1, "ab"),
        "two backspaces are one splice"
    );
}

#[test]
fn gestures_group_by_their_id() {
    let (mut s, mut stack) = (Session::new(), stack());
    let text = s.text();
    for x in 1..=5 {
        let edit = move_block(text, Some(at(f64::from(x), 0.0)), None);
        s.edit(
            &mut stack,
            "main-1",
            (5_000, key(CoalesceKind::Drag, "gesture-1")),
            vec![edit],
        );
    }
    assert_eq!(stack.undo.len(), 1, "one drag, however long");
    let edit = move_block(text, Some(at(9.0, 0.0)), None);
    s.edit(
        &mut stack,
        "main-1",
        (10, key(CoalesceKind::Drag, "gesture-2")),
        vec![edit],
    );
    assert_eq!(stack.undo.len(), 2);
    let original: Option<Frame> = sample_page().blocks.get(text).unwrap().frame.clone();
    s.undo_all(&mut stack);
    assert_eq!(s.page.blocks.get(text).unwrap().frame, original);
}

#[test]
fn sliders_group_while_changes_are_close() {
    let (mut s, mut stack) = (Session::new(), stack());
    let stroke = sample_stroke().id;
    for (pause, width) in [(100, 3.0), (300, 4.0), (900, 5.0), (1_500, 6.0)] {
        let style = StyleEdit {
            width: Some(width),
            ..StyleEdit::default()
        };
        let edit = Edit::RestyleStrokes {
            strokes: vec![stroke],
            style,
        };
        s.edit(
            &mut stack,
            "main-1",
            (pause, key(CoalesceKind::Slider, "width")),
            vec![edit],
        );
    }
    assert_eq!(stack.undo.len(), 2);
}

#[test]
fn erasing_groups_by_gesture_and_other_edits_are_their_own_steps() {
    let (mut s, mut stack) = (Session::new(), stack());
    let stroke = sample_stroke().id;
    let eraser = key(CoalesceKind::Erase, "eraser-1");
    s.edit(&mut stack, "main-1", (10, eraser), vec![remove_strokes(&[stroke])]);
    s.edit(&mut stack, "main-1", (10, None), vec![set_title("A")]);
    s.edit(&mut stack, "main-1", (10, None), vec![set_title("B")]);
    assert_eq!(stack.undo.len(), 3, "transactions without a key are steps of their own");
    assert_eq!(s.undo_all(&mut stack), 3);
    assert!(s.page.ink.stroke(stroke).is_some());
}

#[test]
fn undo_and_redo_return_the_selection_and_timestamps() {
    let (mut s, mut stack) = (Session::new(), stack());
    let before = s.page.blocks.get(s.text()).unwrap().modified;
    s.type_text(&mut stack, 100, "a");
    s.type_text(&mut stack, 100, "b");
    let (first_ui, last_ui) = (stack.undo[0].ui_before.clone(), stack.undo[0].ui_after.clone());
    assert_ne!(first_ui, last_ui);
    let undone = s.undo(&mut stack).unwrap().unwrap();
    assert_eq!((undone.ui, undone.txn.origin), (first_ui, Origin::Undo));
    assert_eq!(undone.changes.blocks_changed, [s.text()]);
    assert_eq!(
        s.page.blocks.get(s.text()).unwrap().modified,
        before,
        "undo restores the block's time"
    );
    assert!(stack.can_redo() && !stack.can_undo());
    let redone = s.step(&mut stack, "main-1", true).unwrap().unwrap();
    assert_eq!((redone.ui, redone.txn.origin), (last_ui, Origin::Redo));
    assert!(s.undo(&mut stack).unwrap().is_some());
    assert!(s.undo(&mut stack).unwrap().is_none());
}

#[test]
fn a_new_edit_clears_redo_and_never_joins_across_an_undo() {
    let (mut s, mut stack) = (Session::new(), stack());
    s.type_text(&mut stack, 100, "a");
    s.type_text(&mut stack, 2_000, "b");
    s.undo(&mut stack).unwrap();
    s.type_text(&mut stack, 100, "c");
    assert!(!stack.can_redo());
    assert_eq!(stack.undo.len(), 2, "typing right after an undo starts a new step");
}

#[test]
fn another_windows_change_drops_the_entry() {
    let (mut s, mut mine, mut theirs) = (Session::new(), stack(), stack());
    let stroke = sample_stroke().id;
    let matrix = [1.0, 0.0, 0.0, 1.0, 5.0, 5.0];
    let moved = Edit::TransformStrokes {
        strokes: vec![stroke],
        matrix,
    };
    s.edit(&mut mine, "main-1", (10, None), vec![moved]);
    s.type_text(&mut mine, 2_000, "x");
    s.edit(&mut theirs, "main-2", (10, None), vec![remove_strokes(&[stroke])]);
    assert!(s.undo(&mut mine).unwrap().is_some(), "the text is still undoable");
    let bytes = mine.bytes();
    assert_eq!(s.undo(&mut mine).unwrap_err().code(), "precondition");
    assert!(!mine.can_undo());
    assert!(mine.bytes() < bytes, "the dropped entry is no longer charged");
    assert!(
        s.step(&mut theirs, "main-2", false).unwrap().is_some(),
        "the other window's undo works"
    );
    assert!(s.page.ink.stroke(stroke).is_some());
}

#[test]
fn read_only_pages_refuse_undo() {
    let (mut s, mut stack) = (Session::new(), stack());
    s.type_text(&mut stack, 100, "a");
    s.page.format.access = Access::ReadOnly(ReadOnlyReason::Offline);
    assert_eq!(s.undo(&mut stack).unwrap_err().code(), "readOnly");
    assert!(stack.can_undo());
}

fn txn(ops: Vec<Op>, origin: Origin) -> Txn {
    Txn {
        id: TxnId(Id::from_parts(1, 1)),
        at: sample_page().modified,
        origin,
        client: ClientId::parse("main-1").unwrap(),
        coalesce: None,
        ui: None,
        ops,
    }
}

#[test]
fn stacks_keep_their_limit_and_charge_their_bytes() {
    let mut stack = UndoStack::new(3);
    let remove = Op::RemoveStrokes {
        strokes: vec![Arc::new(sample_stroke())],
    };
    let mut charged = 0isize;
    for i in 0..5u64 {
        charged += stack.record(&txn(vec![remove.clone()], Origin::Local), Duration::from_secs(i));
    }
    assert_eq!(stack.undo.len(), 3);
    assert_eq!(charged.unsigned_abs(), stack.bytes());
    assert_eq!(
        stack.record(&txn(vec![remove.clone()], Origin::Undo), Duration::ZERO),
        0
    );
    assert_eq!(stack.record(&txn(Vec::new(), Origin::Local), Duration::ZERO), 0);
    stack.clear();
    assert!(!stack.can_undo() && stack.bytes() == 0);
}

#[test]
fn the_oldest_entries_are_dropped_first() {
    let mut stack = UndoStack::new(MAX_ENTRIES);
    let remove = Op::RemoveStrokes {
        strokes: vec![Arc::new(sample_stroke())],
    };
    for i in 0..4u64 {
        stack.record(&txn(vec![remove.clone()], Origin::Local), Duration::from_secs(i));
    }
    let oldest = stack.undo[0].bytes;
    assert_eq!(stack.drop_oldest(1), oldest);
    assert_eq!(stack.undo.len(), 3);
    let all = stack.bytes();
    assert_eq!(stack.drop_oldest(usize::MAX), all);
    assert_eq!(stack.bytes(), 0);
}

#[test]
fn contiguous_splices_merge() {
    let s = |at: u32, del: &str, ins: &str| Splice {
        at,
        del: del.into(),
        ins: ins.into(),
    };
    assert_eq!(merge_splices(&s(3, "", "ab"), &s(5, "", "c")), Some(s(3, "", "abc")));
    assert_eq!(merge_splices(&s(5, "c", ""), &s(4, "b", "")), Some(s(4, "bc", "")));
    assert_eq!(merge_splices(&s(5, "c", ""), &s(5, "d", "")), Some(s(5, "cd", "")));
    assert_eq!(merge_splices(&s(3, "", "a"), &s(9, "", "b")), None);
    assert_eq!(merge_splices(&s(3, "", "a"), &s(3, "a", "")), None);
    assert_eq!(merge_splices(&s(3, "x", "y"), &s(4, "", "z")), None);
}

fn typing(target: &str) -> Option<opennote_core::ops::CoalesceKey> {
    key(CoalesceKind::Typing, target)
}

#[test]
fn typing_into_a_block_field_groups_its_patches() {
    let (mut s, mut stack) = (Session::new(), stack());
    let image = ids(&s.page)[1];
    let alt = |text: &str| patch(image, serde_json::json!({ "alt": text }));
    let original = s.page.blocks.get(image).unwrap().clone();
    for (pause, text) in [(100, "A"), (200, "A l"), (300, "A le"), (200, "A lea")] {
        s.edit(
            &mut stack,
            "main-1",
            (pause, typing(&image.to_string())),
            vec![alt(text)],
        );
    }
    assert_eq!(stack.undo.len(), 1, "four patches in under a second apart are one step");
    s.edit(
        &mut stack,
        "main-1",
        (1_000, typing(&image.to_string())),
        vec![alt("A leaf")],
    );
    assert_eq!(stack.undo.len(), 2, "a pause of 1 second starts a new step");
    s.edit(&mut stack, "main-1", (100, typing("another")), vec![alt("A leaf.")]);
    assert_eq!(stack.undo.len(), 3, "another target starts a new step");
    assert_eq!(s.undo_all(&mut stack), 3);
    assert_eq!(
        s.page.blocks.get(image),
        Some(&original),
        "undo restores the block, times included"
    );
}

#[test]
fn typing_groups_of_patches_close_after_10_seconds() {
    let (mut s, mut stack) = (Session::new(), stack());
    let image = ids(&s.page)[1];
    for n in 0..30 {
        let edit = patch(image, serde_json::json!({ "alt": "x".repeat(n + 1) }));
        s.edit(&mut stack, "main-1", (500, typing(&image.to_string())), vec![edit]);
    }
    assert_eq!(stack.undo.len(), 2, "15 seconds of typing make 2 steps");
}

#[test]
fn typing_a_title_groups_its_set_page_edits() {
    let (mut s, mut stack) = (Session::new(), stack());
    let original = s.page.title.clone();
    for (pause, title) in [(100, "L"), (300, "Li"), (300, "Lig")] {
        s.edit(&mut stack, "main-1", (pause, typing("title")), vec![set_title(title)]);
    }
    assert_eq!(stack.undo.len(), 1);
    // Typing in the page's text starts its own step, even under the same key target.
    s.type_text(&mut stack, 100, "!");
    assert_eq!(stack.undo.len(), 2);
    s.edit(&mut stack, "main-1", (100, typing("title")), vec![set_title("Ligh")]);
    assert_eq!(stack.undo.len(), 3, "an edit of another kind in between ends the group");
    assert_eq!(s.undo_all(&mut stack), 3);
    assert_eq!(s.page.title, original);
}

#[test]
fn followers_that_move_with_typing_do_not_split_the_group() {
    let (mut s, mut stack) = (Session::new(), stack());
    let (text, image) = (s.text(), ids(&s.page)[1]);
    let original = s.page.blocks.get(image).unwrap().frame.clone();
    let group = typing(&text.to_string());
    for (n, word) in ["a", "b", "c"].into_iter().enumerate() {
        let markdown = format!("{}{word}", s.markdown());
        let follower = move_block(image, Some(at(10.0, 100.0 + 10.0 * n as f64)), None);
        let edits = vec![set_text(text, &markdown), follower];
        s.edit(&mut stack, "main-1", (100, group.clone()), edits);
    }
    assert_eq!(
        stack.undo.len(),
        1,
        "moving the blocks below doesn't end a typing group"
    );
    assert_eq!(s.undo_all(&mut stack), 1);
    assert_eq!(s.page.blocks.get(image).unwrap().frame, original);
    // Moves alone are not typing.
    let alone = move_block(image, Some(at(5.0, 5.0)), None);
    s.edit(&mut stack, "main-1", (100, group.clone()), vec![alone.clone()]);
    let again = move_block(image, Some(at(6.0, 6.0)), None);
    s.edit(&mut stack, "main-1", (100, group), vec![again]);
    assert_eq!(stack.undo.len(), 2);
}
