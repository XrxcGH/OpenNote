//! Properties P4 and P5 of plan 13.2: inverses and undo restore pages exactly, and typing groups into the undo
//! steps the grouping rules predict.

mod common;

use std::sync::Arc;
use std::time::Duration;

use opennote_core::error::EditError;
use opennote_core::id::{BlockId, Id};
use opennote_core::model::{Block, BlockData, JsonMap, Page, TextData};
use opennote_core::ops::apply::{invert_all, OpsApplier};
use opennote_core::ops::resolve::{resolve, Edit, ResolveCtx, TxnRequest};
use opennote_core::ops::undo::{UndoStack, MAX_ENTRIES};
use opennote_core::ops::{CoalesceKey, CoalesceKind, Txn};
use opennote_core::testing::edits::{arb_edits, EditRunner};
use opennote_core::testing::gen::{arb_page, PageGen};
use opennote_core::testing::oracle::{pending_records_rebuild_ink, same_content_but_modified};
use opennote_core::testing::sample::{sample_page, test_clock};
use opennote_core::{ClientId, Clock, Limits, OrderKey, TestClock};
use proptest::prelude::*;

/// Applies the inverse of `txn` to a copy of `after` and checks that it gives `before`.
fn inverse_restores(before: &Page, after: &Page, txn: &Txn) -> Result<(), TestCaseError> {
    let mut undone = after.clone();
    let inverse = Txn {
        ops: invert_all(&txn.ops),
        ..txn.clone()
    };
    undone
        .apply(&inverse)
        .map_err(|e| TestCaseError::fail(format!("the inverse failed: {e}")))?;
    prop_assert!(
        same_content_but_modified(&undone, before),
        "the inverse of {:?} didn't restore the page",
        txn.ops
    );
    Ok(())
}

/// Runs the edits, checking every step, and returns how many applied.
fn run_edits(
    runner: &mut EditRunner,
    edits: &[opennote_core::testing::edits::AbstractEdit],
) -> Result<usize, TestCaseError> {
    let mut applied = 0;
    for edit in edits {
        let before = runner.page.clone();
        match runner.step(edit) {
            Ok(Some(txn)) => {
                applied += 1;
                prop_assert!(
                    pending_records_rebuild_ink(&runner.page),
                    "pending records after {edit:?}"
                );
                inverse_restores(&before, &runner.page, &txn)?;
            }
            Ok(None) => prop_assert!(runner.page == before, "{edit:?} changed the page without a transaction"),
            Err(EditError::Precondition(error)) => {
                return Err(TestCaseError::fail(format!("{edit:?} failed a check: {error}")));
            }
            Err(_) => prop_assert!(runner.page == before, "a rejected {edit:?} changed the page"),
        }
    }
    Ok(applied)
}

fn undo_all(runner: &mut EditRunner) -> Result<usize, TestCaseError> {
    let mut steps = 0;
    while runner
        .undo
        .undo(&mut runner.page, &OpsApplier, &runner.clock, &runner.client)
        .map_err(|e| TestCaseError::fail(format!("undo failed: {e}")))?
        .is_some()
    {
        steps += 1;
    }
    Ok(steps)
}

fn redo_all(runner: &mut EditRunner) -> Result<usize, TestCaseError> {
    let mut steps = 0;
    while runner
        .undo
        .redo(&mut runner.page, &OpsApplier, &runner.clock, &runner.client)
        .map_err(|e| TestCaseError::fail(format!("redo failed: {e}")))?
        .is_some()
    {
        steps += 1;
    }
    Ok(steps)
}

proptest! {
    #![proptest_config(common::cases(256))]

    /// P4: applying a transaction and then its inverse restores the page exactly. Undoing everything returns
    /// to the start, and redoing everything returns to the end.
    #[test]
    fn p4_inverses_and_undo_restore_pages(page in arb_page(PageGen::small()), edits in arb_edits(1..48)) {
        let start = page.clone();
        let mut runner = EditRunner::new(page);
        run_edits(&mut runner, &edits)?;
        redo_all(&mut runner)?;
        let end = runner.page.clone();
        let undone = undo_all(&mut runner)?;
        prop_assert!(same_content_but_modified(&runner.page, &start), "undoing everything didn't return to the start");
        prop_assert!(pending_records_rebuild_ink(&runner.page));
        let redone = redo_all(&mut runner)?;
        prop_assert_eq!(undone, redone);
        prop_assert!(same_content_but_modified(&runner.page, &end), "redoing everything didn't return to the end");
    }

    /// P4 on the sample page, which has an image, an extension block, and a stroke, with longer scripts.
    #[test]
    fn p4_holds_on_the_sample_page(edits in arb_edits(1..96)) {
        let start = sample_page();
        let mut runner = EditRunner::new(start.clone());
        run_edits(&mut runner, &edits)?;
        redo_all(&mut runner)?;
        let end = runner.page.clone();
        undo_all(&mut runner)?;
        prop_assert!(same_content_but_modified(&runner.page, &start));
        redo_all(&mut runner)?;
        prop_assert!(same_content_but_modified(&runner.page, &end));
    }
}

/// A keystroke: a character typed at the end, or a backspace, after a pause.
#[derive(Clone, Debug)]
enum Key {
    Char(char),
    Backspace,
}

fn arb_keys() -> impl Strategy<Value = Vec<(Key, u64)>> {
    let key = prop_oneof![
        4 => proptest::sample::select(vec!['a', 'b', ' ', 'é', '\u{301}', 'א', '🙂']).prop_map(Key::Char),
        1 => Just(Key::Backspace),
    ];
    let pause = prop_oneof![12 => 0u64..400, 1 => 900u64..1_100, 1 => 1_000u64..4_000];
    proptest::collection::vec((key, pause), 1..400)
}

/// The number of undo steps the rules of plan 7.3 give for typing at the end of a block.
fn predicted_steps(keys: &[(Key, u64)]) -> usize {
    struct Group {
        first: u64,
        last: u64,
        deleting: bool,
        chars: usize,
    }
    let (mut now, mut len, mut steps) = (0u64, 0usize, 0usize);
    let mut group: Option<Group> = None;
    for (key, pause) in keys {
        now += pause;
        let deleting = matches!(key, Key::Backspace);
        if deleting && len == 0 {
            continue;
        }
        len = if deleting { len - 1 } else { len + 1 };
        let joins = group
            .as_ref()
            .is_some_and(|g| now - g.last < 1_000 && now - g.first < 10_000 && g.chars < 100 && g.deleting == deleting);
        match &mut group {
            Some(g) if joins => {
                g.last = now;
                g.chars += 1;
            }
            _ => {
                steps += 1;
                group = Some(Group {
                    first: now,
                    last: now,
                    deleting,
                    chars: 1,
                });
            }
        }
    }
    steps
}

/// A page with one empty text block.
fn empty_text_page() -> (Page, BlockId) {
    let mut page = sample_page();
    let ids: Vec<BlockId> = page.blocks.iter().map(|b| b.id).collect();
    for id in ids {
        page.blocks.remove(id);
    }
    page.ink = Default::default();
    let id = BlockId(Id::from_parts(1_800_000_000_000, 7));
    let block = Block {
        id,
        order: OrderKey::parse("a0").unwrap(),
        frame: None,
        lock: None,
        created: page.created,
        modified: page.created,
        data: BlockData::Text(TextData::default()),
        fallback: None,
        extra: JsonMap::new(),
    };
    page.blocks.insert(Arc::new(block)).unwrap();
    (page, id)
}

fn markdown(page: &Page, id: BlockId) -> String {
    match &page.blocks.get(id).unwrap().data {
        BlockData::Text(text) => text.markdown.to_string(),
        _ => unreachable!(),
    }
}

fn type_keys(page: &mut Page, id: BlockId, keys: &[(Key, u64)], clock: &TestClock) -> Result<UndoStack, TestCaseError> {
    let client = ClientId::parse("main-1").unwrap();
    let limits = Limits::default();
    let mut stack = UndoStack::new(MAX_ENTRIES);
    for (seq, (key, pause)) in keys.iter().enumerate() {
        clock.advance(Duration::from_millis(*pause));
        let mut text = markdown(page, id);
        match key {
            Key::Char(c) => text.push(*c),
            Key::Backspace => {
                text.pop();
            }
        }
        let request = TxnRequest {
            page: page.id,
            client: client.clone(),
            client_seq: seq as u64,
            coalesce: Some(CoalesceKey {
                kind: CoalesceKind::Typing,
                target: id.to_string(),
            }),
            ui: None,
            edits: vec![Edit::SetText {
                block: id,
                markdown: text,
            }],
        };
        let ctx = ResolveCtx {
            clock,
            limits: &limits,
            imported: &|_| None,
        };
        let txn = resolve(page, &request, &ctx).map_err(|e| TestCaseError::fail(e.to_string()))?;
        page.apply(&txn).map_err(|e| TestCaseError::fail(e.to_string()))?;
        stack.record(&txn, clock.monotonic());
    }
    Ok(stack)
}

proptest! {
    #![proptest_config(common::cases(256))]

    /// P5: typing a random string gives the number of undo steps the grouping rules predict, and undoing and
    /// redoing them gives the text before and after.
    #[test]
    fn p5_typing_groups_as_predicted(keys in arb_keys()) {
        let (mut page, id) = empty_text_page();
        let clock = test_clock();
        let mut stack = type_keys(&mut page, id, &keys, &clock)?;
        let typed = markdown(&page, id);
        let client = ClientId::parse("main-1").unwrap();
        let mut steps = 0;
        while stack.undo(&mut page, &OpsApplier, &clock, &client).unwrap().is_some() {
            steps += 1;
        }
        prop_assert_eq!(steps, predicted_steps(&keys));
        prop_assert_eq!(markdown(&page, id), "");
        while stack.redo(&mut page, &OpsApplier, &clock, &client).unwrap().is_some() {}
        prop_assert_eq!(markdown(&page, id), typed);
    }
}

/// The name of an operation's kind.
fn op_kind(op: &opennote_core::ops::Op) -> &'static str {
    use opennote_core::ops::Op;
    match op {
        Op::SetPage { .. } => "setPage",
        Op::InsertBlocks { .. } => "insertBlocks",
        Op::DeleteBlocks { .. } => "deleteBlocks",
        Op::MoveBlock { .. } => "moveBlock",
        Op::PatchBlock { .. } => "patchBlock",
        Op::EditText { .. } => "editText",
        Op::AddStrokes { .. } => "addStrokes",
        Op::RemoveStrokes { .. } => "removeStrokes",
        Op::SetStrokeProps { .. } => "setStrokeProps",
        Op::AddAsset { .. } => "addAsset",
        Op::RemoveAsset { .. } => "removeAsset",
    }
}

/// The generated scripts reach every operation, and most edits apply rather than being rejected.
#[test]
fn generated_edits_cover_every_operation() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};
    let rng = TestRng::from_seed(RngAlgorithm::ChaCha, &[7; 32]);
    let mut runner = TestRunner::new_with_rng(Config::default(), rng);
    let strategy = (arb_page(PageGen::small()), arb_edits(10..60));
    let mut kinds = std::collections::BTreeSet::new();
    let (mut applied, mut rejected) = (0usize, 0usize);
    for _ in 0..64 {
        let (page, edits) = strategy.new_tree(&mut runner).unwrap().current();
        let mut edit_runner = EditRunner::new(page);
        for edit in &edits {
            match edit_runner.step(edit) {
                Ok(Some(txn)) => {
                    applied += 1;
                    kinds.extend(txn.ops.iter().map(op_kind));
                }
                Ok(None) => {}
                Err(_) => rejected += 1,
            }
        }
    }
    assert_eq!(kinds.len(), 11, "operations seen: {kinds:?}");
    assert!(rejected * 20 < applied, "{rejected} rejected, {applied} applied");
}

#[test]
fn the_clock_of_the_typing_test_is_monotonic() {
    let clock = test_clock();
    let before = clock.monotonic();
    clock.advance(Duration::from_millis(5));
    assert_eq!(clock.monotonic() - before, Duration::from_millis(5));
}
