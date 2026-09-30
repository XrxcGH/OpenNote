//! Fuzz entry point for edit requests (plan 13.3). Owned by WP3.
//!
//! The first byte picks a mode. An even byte reads the rest as a JSON request, as the interface sends it. An
//! odd byte reads the rest as a script of abstract edits, including drawing, undo, and redo. The edits apply to
//! the sample page.
//!
//! The seeds in `fuzz/seeds/txn_request` hold JSON requests for every edit kind, and two scripts. Each JSON
//! seed starts with a space, an even byte, so it is both a valid JSON file and an input in JSON mode. The corpus
//! itself lives in the Actions cache, so pass the seeds as a second corpus folder:
//! `cargo +nightly fuzz run txn_request fuzz/corpus/txn_request fuzz/seeds/txn_request`.
//!
//! After each step the page must still be consistent. Every stroke is in an existing ink block, and each
//! `strokeCount` is right. Every asset a block names is in the table. The pending ink records rebuild the live
//! strokes. Applying the transaction's inverse restores the page.

use crate::error::EditError;
use crate::fuzzing::Input;
use crate::model::{BlockData, Page};
use crate::ops::apply::invert_all;
use crate::ops::resolve::TxnRequest;
use crate::ops::Txn;
use crate::testing::edits::{AbstractEdit, EditRunner, PatchChoice};
use crate::testing::oracle::{pending_records_rebuild_ink, same_content_but_modified};
use crate::testing::sample::sample_page;

/// The most steps one input runs.
const MAX_STEPS: usize = 64;

/// A request applied to a fixed page, such as `testing::sample::sample_page`. The page must stay valid.
pub fn txn_request(data: &[u8]) {
    let mut input = Input::new(data);
    let mut runner = EditRunner::new(sample_page());
    if input.u8() & 1 == 0 {
        json_request(&mut runner, input.rest());
    } else {
        for _ in 0..MAX_STEPS {
            if input.rest().is_empty() {
                break;
            }
            let edit = abstract_edit(&mut input);
            match runner.step(&edit) {
                Ok(Some(txn)) => check_step(&runner.page, &txn),
                Err(EditError::Precondition(error)) => panic!("{edit:?} failed a check after resolving: {error}"),
                Ok(None) | Err(_) => {}
            }
        }
    }
    check_page(&runner.page);
}

fn json_request(runner: &mut EditRunner, bytes: &[u8]) {
    let Ok(mut request) = serde_json::from_slice::<TxnRequest>(bytes) else {
        return;
    };
    request.page = runner.page.id;
    let ctx = crate::ops::resolve::ResolveCtx {
        clock: &runner.clock,
        limits: &runner.limits,
        imported: &|_| None,
    };
    let txn = match crate::ops::resolve::resolve(&runner.page, &request, &ctx) {
        Ok(txn) => txn,
        Err(EditError::Precondition(error)) => panic!("an edit failed a check after resolving: {error}"),
        Err(_) => return,
    };
    let before = runner.page.clone();
    if let Err(error) = runner.page.apply(&txn) {
        panic!("a resolved transaction failed to apply: {error}");
    }
    check_step(&runner.page, &txn);
    if txn.ops.is_empty() {
        assert!(
            runner.page == before,
            "a transaction without operations changed the page"
        );
    }
}

/// Applies the inverse of `txn` to a copy of the page, reapplies `txn`, and checks both.
fn check_step(page: &Page, txn: &Txn) {
    check_page(page);
    let mut undone = page.clone();
    let inverse = Txn {
        ops: invert_all(&txn.ops),
        ..txn.clone()
    };
    if let Err(error) = undone.apply(&inverse) {
        panic!("the inverse failed to apply: {error}");
    }
    check_page(&undone);
    let mut redone = undone;
    if let Err(error) = redone.apply(txn) {
        panic!("reapplying failed: {error}");
    }
    assert!(
        same_content_but_modified(&redone, page),
        "undo and redo didn't restore the page"
    );
}

/// The page's consistency rules that applying must keep.
fn check_page(page: &Page) {
    for stroke in page.ink.strokes() {
        let block = page.blocks.get(stroke.block);
        assert!(
            block.is_some_and(|b| matches!(b.data, BlockData::Ink(_))),
            "stroke {} has no ink block",
            stroke.id
        );
    }
    for block in page.blocks.iter() {
        if let BlockData::Ink(ink) = &block.data {
            assert_eq!(
                ink.stroke_count,
                page.ink.count_in_block(block.id),
                "strokeCount of {}",
                block.id
            );
        }
        let asset = match &block.data {
            BlockData::Image(image) => Some(image.asset),
            BlockData::File(file) => Some(file.asset),
            _ => None,
        };
        assert!(
            asset.is_none_or(|a| page.assets.contains_key(&a)),
            "{} names a missing asset",
            block.id
        );
    }
    assert!(
        pending_records_rebuild_ink(page),
        "the pending records don't rebuild the ink"
    );
    assert_eq!(
        page.blocks.iter().count(),
        page.blocks.len(),
        "the order index lost a block"
    );
}

/// An abstract edit read from fuzzer bytes.
fn abstract_edit(input: &mut Input<'_>) -> AbstractEdit {
    match input.u8() % 16 {
        choice @ 0..=8 => block_edit(input, choice),
        9 | 10 => draw(input),
        11 => stroke_edit(input),
        12 => page_edit(input),
        13 => AbstractEdit::Undo,
        14 => AbstractEdit::Redo,
        _ => AbstractEdit::AddAsset {
            name: format!("{}.png", input.string(6)),
            salt: u64::from(input.u32()),
        },
    }
}

fn index(input: &mut Input<'_>) -> usize {
    usize::from(input.u8())
}

fn block_edit(input: &mut Input<'_>, choice: u8) -> AbstractEdit {
    match choice {
        0 | 1 => AbstractEdit::Type {
            block: index(input),
            at: index(input),
            text: input.string(8),
        },
        2 => AbstractEdit::DeleteText {
            block: index(input),
            at: index(input),
            len: index(input),
        },
        3 => AbstractEdit::ReplaceText {
            block: index(input),
            text: input.string(16),
        },
        4 => AbstractEdit::InsertText {
            after: input.bool().then(|| index(input)),
            text: input.string(8),
            floating: input.bool(),
            salt: u64::from(input.u32()),
        },
        5 => AbstractEdit::InsertDrawing {
            after: input.bool().then(|| index(input)),
            salt: u64::from(input.u32()),
        },
        6 => AbstractEdit::MoveBlock {
            block: index(input),
            dx: i16::from(input.u8() as i8) * 8,
            dy: i16::from(input.u8() as i8) * 8,
            after: input.bool().then(|| index(input)),
        },
        7 => AbstractEdit::PatchBlock {
            block: index(input),
            patch: patch_choice(input),
        },
        _ => AbstractEdit::DeleteBlock { block: index(input) },
    }
}

fn draw(input: &mut Input<'_>) -> AbstractEdit {
    let count = 1 + index(input) % 16;
    let points: Vec<_> = (0..count)
        .map(|_| (input.u8() as i8, input.u8() as i8, u16::from(input.u8()) * 257))
        .collect();
    AbstractEdit::Draw {
        block: index(input),
        points,
        style: input.u8(),
        salt: u64::from(input.u32()),
    }
}

fn patch_choice(input: &mut Input<'_>) -> PatchChoice {
    match input.u8() % 5 {
        0 => PatchChoice::Alt(input.string(8)),
        1 => PatchChoice::Decorative(input.bool()),
        2 => PatchChoice::Lock(input.u8()),
        3 => PatchChoice::Fallback(input.bool().then(|| input.string(8))),
        _ => PatchChoice::Style(input.bool().then(|| input.string(6))),
    }
}

fn stroke_edit(input: &mut Input<'_>) -> AbstractEdit {
    let (stroke, count) = (index(input), index(input));
    match input.u8() % 4 {
        0 => AbstractEdit::EraseStrokes { stroke, count },
        1 => AbstractEdit::TransformStrokes {
            stroke,
            count,
            dx: input.u8() as i8,
            dy: input.u8() as i8,
            scale: input.u8(),
        },
        2 => AbstractEdit::RestyleStrokes {
            stroke,
            count,
            palette: input.u8(),
            width: input.u8(),
        },
        _ => AbstractEdit::MoveStrokes {
            stroke,
            count,
            block: index(input),
        },
    }
}

fn page_edit(input: &mut Input<'_>) -> AbstractEdit {
    match input.u8() % 5 {
        0 => AbstractEdit::SetTitle {
            title: input.string(16),
        },
        1 => AbstractEdit::SetTags {
            tags: vec![input.string(8)],
        },
        2 => AbstractEdit::SetView {
            pattern: input.u8(),
            paginated: input.bool(),
            spacing: input.u8(),
        },
        3 => AbstractEdit::SetReadingOrder {
            blocks: vec![index(input), index(input)],
        },
        _ => AbstractEdit::RemoveAsset { asset: index(input) },
    }
}
