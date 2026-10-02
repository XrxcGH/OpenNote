//! Helpers shared by the operation tests: requests and edits on the sample page, and a small page session with
//! undo stacks.

// Each test file uses a different subset of these helpers.
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use opennote_core::error::EditError;
use opennote_core::id::{AssetId, BlockId, Id, StrokeId};
use opennote_core::model::{Asset, Block, BlockData, Frame, Lock, Named, Page};
use opennote_core::ops::apply::OpsApplier;
use opennote_core::ops::resolve::{resolve, Edit, NewBlock, ResolveCtx, TxnRequest};
use opennote_core::ops::undo::{UndoOutcome, UndoStack};
use opennote_core::ops::{CoalesceKey, CoalesceKind, Txn};
use opennote_core::testing::sample::{sample_page, test_clock};
use opennote_core::{ClientId, Clock, Limits, TestClock};
use serde_json::{json, Value};

/// A request with these edits from `main-1`.
pub fn request(page: &Page, edits: Vec<Edit>) -> TxnRequest {
    TxnRequest {
        page: page.id,
        client: ClientId::parse("main-1").unwrap(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits,
    }
}

/// Resolves edits, with `imported` as the imported assets.
pub fn run_with(page: &Page, edits: Vec<Edit>, imported: &dyn Fn(AssetId) -> Option<Asset>) -> Result<Txn, EditError> {
    let clock = test_clock();
    let limits = Limits::default();
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported,
    };
    resolve(page, &request(page, edits), &ctx)
}

/// Resolves edits.
pub fn run(page: &Page, edits: Vec<Edit>) -> Result<Txn, EditError> {
    run_with(page, edits, &|_| None)
}

/// Resolves one edit.
pub fn run_one(page: &Page, edit: Edit) -> Result<Txn, EditError> {
    run(page, vec![edit])
}

/// The error code of resolving one edit, or `"ok"`.
pub fn code(page: &Page, edit: Edit) -> &'static str {
    run_one(page, edit).map_or_else(|e| e.code(), |_| "ok")
}

/// Whether resolving one edit gives no operations.
pub fn changes_nothing(page: &Page, edit: Edit) -> bool {
    run_one(page, edit).unwrap().ops.is_empty()
}

/// Resolves and applies edits, and returns the changed page and the transaction.
pub fn apply(page: &Page, edits: Vec<Edit>) -> (Page, Txn) {
    let txn = run(page, edits).unwrap();
    let mut changed = page.clone();
    changed.apply(&txn).unwrap();
    (changed, txn)
}

/// Resolves and applies one edit.
pub fn apply_one(page: &Page, edit: Edit) -> (Page, Txn) {
    apply(page, vec![edit])
}

/// The page's block IDs in order.
pub fn ids(page: &Page) -> Vec<BlockId> {
    page.blocks.iter().map(|b| b.id).collect()
}

/// A text block's Markdown.
pub fn markdown(page: &Page, id: BlockId) -> String {
    match &page.blocks.get(id).unwrap().data {
        BlockData::Text(text) => text.markdown.to_string(),
        other => panic!("not text: {other:?}"),
    }
}

/// Locks a block.
pub fn with_lock(page: &mut Page, id: BlockId, lock: Lock) {
    let mut block = Block::clone(page.blocks.get(id).unwrap());
    block.lock = Some(Named::Known(lock));
    page.blocks.replace(Arc::new(block)).unwrap();
}

/// A new block of a type, with an ID from `id`.
pub fn new_block(id: u128, type_name: &str, data: Value) -> NewBlock {
    NewBlock {
        id: BlockId(Id::from_parts(1_800_000_000_000, id)),
        type_name: type_name.to_owned(),
        frame: None,
        data: data.as_object().unwrap().clone(),
        fallback: None,
    }
}

/// A floating frame at `(x, y)`.
pub fn at(x: f64, y: f64) -> Frame {
    Frame {
        x: Some(x),
        y: Some(y),
        ..Frame::default()
    }
}

/// `setText`.
pub fn set_text(block: BlockId, markdown: &str) -> Edit {
    Edit::SetText {
        block,
        markdown: markdown.to_owned(),
    }
}

/// `insertBlock`.
pub fn insert(block: NewBlock, after: Option<BlockId>, before: Option<BlockId>) -> Edit {
    Edit::InsertBlock { block, after, before }
}

/// `moveBlock`.
pub fn move_block(block: BlockId, frame: Option<Frame>, after: Option<BlockId>) -> Edit {
    Edit::MoveBlock {
        block,
        frame,
        after,
        before: None,
    }
}

/// `patchBlock` with a merge patch over `data`.
pub fn patch(block: BlockId, data: Value) -> Edit {
    Edit::PatchBlock {
        block,
        lock: None,
        data: data.as_object().cloned(),
        fallback: None,
    }
}

/// `patchBlock` that sets the lock.
pub fn lock(block: BlockId, name: &str) -> Edit {
    Edit::PatchBlock {
        block,
        lock: Some(name.to_owned()),
        data: None,
        fallback: None,
    }
}

/// `deleteBlocks`.
pub fn delete(blocks: &[BlockId]) -> Edit {
    Edit::DeleteBlocks {
        blocks: blocks.to_vec(),
    }
}

/// `removeStrokes`.
pub fn remove_strokes(strokes: &[StrokeId]) -> Edit {
    Edit::RemoveStrokes {
        strokes: strokes.to_vec(),
    }
}

/// `setPage` with a title.
pub fn set_title(title: &str) -> Edit {
    Edit::SetPage {
        title: Some(title.to_owned()),
        tags: None,
        view: None,
    }
}

/// `setPage` with a view merge patch.
pub fn set_view(patch: Value) -> Edit {
    Edit::SetPage {
        title: None,
        tags: None,
        view: Some(patch),
    }
}

/// `setPage` with a view patch that sets the reading order.
pub fn set_reading_order(order: Vec<BlockId>) -> Edit {
    let ids: Vec<String> = order.iter().map(ToString::to_string).collect();
    set_view(json!({ "readingOrder": ids }))
}

/// A group key.
pub fn key(kind: CoalesceKind, target: &str) -> Option<CoalesceKey> {
    Some(CoalesceKey {
        kind,
        target: target.to_owned(),
    })
}

/// The sample page, a clock, and the limits, with undo stacks kept by the tests.
pub struct Session {
    pub page: Page,
    pub clock: TestClock,
    pub limits: Limits,
}

impl Session {
    /// A session on the sample page.
    pub fn new() -> Session {
        Session {
            page: sample_page(),
            clock: test_clock(),
            limits: Limits::default(),
        }
    }

    /// The first text block.
    pub fn text(&self) -> BlockId {
        ids(&self.page)[0]
    }

    /// Its Markdown.
    pub fn markdown(&self) -> String {
        markdown(&self.page, self.text())
    }

    /// Resolves, applies, and records edits for `client` after `pause` milliseconds.
    pub fn edit(
        &mut self,
        stack: &mut UndoStack,
        client: &str,
        (pause, key): (u64, Option<CoalesceKey>),
        edits: Vec<Edit>,
    ) -> Txn {
        self.clock.advance(Duration::from_millis(pause));
        let request = TxnRequest {
            client: ClientId::parse(client).unwrap(),
            coalesce: key,
            ui: Some(json!({ "at": self.clock.monotonic().as_millis() as u64 })),
            ..request(&self.page, edits)
        };
        let ctx = ResolveCtx {
            clock: &self.clock,
            limits: &self.limits,
            imported: &|_| None,
        };
        let txn = resolve(&self.page, &request, &ctx).unwrap();
        self.page.apply(&txn).unwrap();
        stack.record(&txn, self.clock.monotonic());
        txn
    }

    /// Types `text` at the end of the first text block after `pause` milliseconds.
    pub fn type_text(&mut self, stack: &mut UndoStack, pause: u64, text: &str) {
        let markdown = format!("{}{text}", self.markdown());
        let group = key(CoalesceKind::Typing, &self.text().to_string());
        let edit = set_text(self.text(), &markdown);
        self.edit(stack, "main-1", (pause, group), vec![edit]);
    }

    /// Undoes one step, or redoes one when `redo` is set.
    pub fn step(&mut self, stack: &mut UndoStack, client: &str, redo: bool) -> Result<Option<UndoOutcome>, EditError> {
        let client = ClientId::parse(client).unwrap();
        if redo {
            stack.redo(&mut self.page, &OpsApplier, &self.clock, &client)
        } else {
            stack.undo(&mut self.page, &OpsApplier, &self.clock, &client)
        }
    }

    /// Undoes one step of `main-1`.
    pub fn undo(&mut self, stack: &mut UndoStack) -> Result<Option<UndoOutcome>, EditError> {
        self.step(stack, "main-1", false)
    }

    /// Undoes every step of `main-1`, and returns how many there were.
    pub fn undo_all(&mut self, stack: &mut UndoStack) -> usize {
        let mut count = 0;
        while self.undo(stack).unwrap().is_some() {
            count += 1;
        }
        count
    }
}

/// `spliceText`.
pub fn splice_text(block: BlockId, at: u32, del: &str, ins: &str) -> Edit {
    Edit::SpliceText {
        block,
        at,
        del: del.to_owned(),
        ins: ins.to_owned(),
    }
}
