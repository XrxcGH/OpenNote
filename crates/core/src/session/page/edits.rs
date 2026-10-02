//! Edits of a page session: transaction requests, strokes, progress records, undo, and redo (plan 7.2 and 7.3).

use std::collections::BTreeMap;
use std::sync::Arc;

use super::state::{PageSession, PageState};
use super::TxnAck;
use crate::error::EditError;
use crate::id::{AssetId, BlockId, ClientId};
use crate::model::{Block, BlockData, InkRecord, Page, Stroke};
use crate::ops::resolve::{resolve, resolve_add_strokes, ResolveCtx, StrokeTxnMeta, TxnRequest};
use crate::ops::undo::{UndoOutcome, UndoStack};
use crate::ops::{AppliedChanges, Op, Txn};
use crate::store::journal::fragment;
use crate::wire::frames::{self, AppliedFrame, FrameInfo};

/// Most entries one client's undo stack keeps (plan 7.3).
pub(crate) const MAX_UNDO_ENTRIES: usize = 1_000;

impl PageSession {
    /// Resolves, applies, and journals an edit request.
    pub(crate) fn apply(&self, req: &TxnRequest) -> Result<TxnAck, EditError> {
        let ack = {
            let mut st = self.state();
            self.check_request(&st, &req.client, req.client_seq)?;
            let txn = {
                let imported = st.imported.clone();
                let lookup = move |id: AssetId| imported.get(&id).cloned();
                let ctx = ResolveCtx {
                    clock: self.ctx.clock.as_ref(),
                    limits: &self.ctx.limits,
                    imported: &lookup,
                };
                resolve(&st.page, req, &ctx)?
            };
            self.commit_request(&mut st, &txn, (&req.client, req.client_seq))?
        };
        self.ctx.enforce_undo_budget();
        Ok(ack)
    }

    /// Adds strokes sent as binary records, as one `AddStrokes` transaction.
    pub(crate) fn add_strokes(&self, meta: &StrokeTxnMeta, records: &[u8]) -> Result<TxnAck, EditError> {
        let strokes = self.decode_strokes(records)?;
        let ack = {
            let mut st = self.state();
            self.check_request(&st, &meta.client, meta.client_seq)?;
            let ctx = ResolveCtx {
                clock: self.ctx.clock.as_ref(),
                limits: &self.ctx.limits,
                imported: &|_| None,
            };
            let txn = resolve_add_strokes(&st.page, meta, strokes, &ctx)?;
            self.commit_request(&mut st, &txn, (&meta.client, meta.client_seq))?
        };
        self.ctx.enforce_undo_budget();
        Ok(ack)
    }

    fn decode_strokes(&self, records: &[u8]) -> Result<Vec<Arc<Stroke>>, EditError> {
        let decoded = self
            .ctx
            .codec
            .decode_records(records, &self.ctx.limits)
            .map_err(|e| EditError::Invalid(format!("stroke records: {e}")))?;
        decoded
            .into_iter()
            .map(|record| match record {
                InkRecord::Stroke(stroke) => Ok(stroke),
                _ => Err(EditError::Invalid("only stroke records can be added".into())),
            })
            .collect()
    }

    /// Checks that the page may change and that the client's sequence number has no gap or repeat.
    pub(super) fn check_request(&self, st: &PageState, client: &ClientId, client_seq: u64) -> Result<(), EditError> {
        self.check_editable(st)?;
        let expected = st.clients.get(client).map_or(1, |c| c.seq.saturating_add(1));
        if client_seq != expected {
            return Err(EditError::OutOfOrder { expected });
        }
        Ok(())
    }

    /// Commits a transaction from a client request, records it in the client's undo stack, and answers.
    pub(super) fn commit_request(
        &self,
        st: &mut PageState,
        txn: &Txn,
        (client, client_seq): (&ClientId, u64),
    ) -> Result<TxnAck, EditError> {
        let (seq, _) = self.commit(st, txn)?;
        for op in &txn.ops {
            if let Op::AddAsset { asset } = op {
                st.imported.remove(&asset.id);
            }
        }
        let now = self.ctx.clock.monotonic();
        let PageState {
            clients,
            page,
            undo_bytes,
            ..
        } = &mut *st;
        let anchored = |ink: BlockId, text: BlockId| is_anchored(page, ink, text);
        let entry = clients.entry(client.clone()).or_default();
        entry.seq = client_seq;
        let stack = entry.undo.get_or_insert_with(|| UndoStack::new(MAX_UNDO_ENTRIES));
        let delta = stack.record_with(txn, now, &anchored);
        *undo_bytes = undo_bytes.saturating_add_signed(delta);
        self.ctx.charge_undo(delta);
        let (can_undo, can_redo) = PageSession::undo_state(st, client);
        Ok(TxnAck {
            seq,
            order_keys: PageSession::new_order_keys(txn),
            can_undo,
            can_redo,
        })
    }

    /// Journals a progress copy of a stroke still being drawn (spec 20.8). The page itself doesn't change.
    pub(crate) fn ink_progress(&self, record: &[u8]) -> Result<(), EditError> {
        let strokes = self.decode_strokes(record)?;
        let [stroke] = strokes.as_slice() else {
            return Err(EditError::Invalid("a progress record holds one stroke".into()));
        };
        let mut st = self.state();
        self.check_editable(&st)?;
        self.ensure_journal(&mut st);
        if let Some(journal) = self.journal().as_ref() {
            st.seq = journal.append_ink_progress(stroke);
        }
        Ok(())
    }

    /// Undoes or redoes the client's last step, and answers with the frame the interface applies.
    pub(crate) fn undo_redo(&self, client: &ClientId, redo: bool) -> Result<Option<AppliedFrame>, EditError> {
        let mut st = self.state();
        self.check_editable(&st)?;
        let outcome = {
            let PageState { clients, page, .. } = &mut *st;
            let Some(stack) = clients.get_mut(client).and_then(|c| c.undo.as_mut()) else {
                return Ok(None);
            };
            let (applier, clock) = (self.ctx.applier.as_ref(), self.ctx.clock.as_ref());
            if redo {
                stack.redo(page, applier, clock, client)?
            } else {
                stack.undo(page, applier, clock, client)?
            }
        };
        let Some(UndoOutcome { txn, changes, ui }) = outcome else {
            return Ok(None);
        };
        let seq = self.record(&mut st, &txn, &changes);
        self.frame(&st, client, (seq, &changes, ui)).map(Some)
    }

    /// The frame for applied changes: the new text of changed text blocks, the full JSON of inserted and changed
    /// blocks, the page's title, tags, and view, the added asset entries, and the added and changed strokes as
    /// they are now.
    pub(crate) fn frame(
        &self,
        st: &PageState,
        client: &ClientId,
        (seq, changes, ui): (u64, &AppliedChanges, Option<serde_json::Value>),
    ) -> Result<AppliedFrame, EditError> {
        let texts: BTreeMap<_, _> = changes
            .blocks_changed
            .iter()
            .filter_map(|id| match &st.page.blocks.get(*id)?.data {
                BlockData::Text(text) => Some((*id, text.markdown.to_string())),
                _ => None,
            })
            .collect();
        let codec = self.ctx.codec.as_ref();
        let blocks: Vec<Arc<Block>> = changes
            .blocks_changed
            .iter()
            .filter_map(|id| st.page.blocks.get(*id).cloned())
            .collect();
        let blocks = match fragment::write_blocks(codec, &blocks) {
            serde_json::Value::Array(items) => items,
            serde_json::Value::Null => Vec::new(),
            other => vec![other],
        };
        let assets = changes
            .assets_changed
            .iter()
            .filter_map(|id| st.page.assets.get(id))
            .map(|asset| fragment::write_asset(codec, asset))
            .collect();
        let page = &st.page;
        let records: Vec<InkRecord> = changes
            .strokes_added
            .iter()
            .chain(&changes.strokes_changed)
            .filter_map(|id| st.page.ink.stroke(*id).cloned())
            .map(InkRecord::Stroke)
            .collect();
        let (can_undo, can_redo) = PageSession::undo_state(st, client);
        let info = FrameInfo {
            seq,
            changes: changes.clone(),
            ui,
            texts,
            blocks,
            title: changes.page_fields.then(|| page.title.clone()),
            tags: changes.page_fields.then(|| page.tags.clone()),
            view: changes.page_fields.then(|| fragment::write_view(codec, &page.view)),
            assets,
            can_undo,
            can_redo,
            strokes: u32::try_from(records.len()).unwrap_or(u32::MAX),
        };
        let bytes = if records.is_empty() {
            Vec::new()
        } else {
            self.ctx.codec.encode_records(&records)
        };
        frames::encode(&info, &bytes).map_err(|e| EditError::Invalid(e.to_string()))
    }
}

/// Whether the ink block is anchored to the text block (spec 8.1), so typing that moves it still groups.
fn is_anchored(page: &Page, ink: BlockId, text: BlockId) -> bool {
    matches!(
        page.blocks.get(ink).map(|block| &block.data),
        Some(BlockData::Ink(data)) if data.anchor.as_ref().is_some_and(|anchor| anchor.block == text)
    )
}
