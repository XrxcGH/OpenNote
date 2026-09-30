//! Transactions as journal JSON, with strokes in the blob (spec 20.7). Owned by WP4.
//!
//! Strokes travel as records in the segment record format and are named by index ranges `[a, b]`, so ink is
//! never inflated by JSON. Blocks, views, and asset entries are written as `page.json` writes them.

use std::sync::Arc;

use super::fragment;
use crate::error::{FormatError, FormatErrorKind};
use crate::id::BlockId;
use crate::limits::Limits;
use crate::model::{Affine, InkRecord, JsonMap, Stroke, StrokeStyle};
use crate::ops::{Op, PageFields, Placement, Splice, Stamps, StrokePropsChange, StrokeState, Txn};
use crate::seams::Codec;
use crate::time::Timestamp;

mod schema;

use schema::{FieldsJson, OpJson, PlacementJson, PropsJson, SpliceJson, StateJson, StyleJson, TxnJson};

/// Encodes a transaction: its JSON and its blob of stroke records.
pub fn encode_txn(txn: &Txn, codec: &dyn Codec) -> (Vec<u8>, Vec<u8>) {
    let mut blob = Vec::new();
    let ops = txn.ops.iter().map(|op| encode_op(op, codec, &mut blob)).collect();
    let json = TxnJson {
        txn: txn.id,
        at: txn.at,
        origin: txn.origin,
        client: txn.client.clone(),
        coalesce: txn.coalesce.clone(),
        ui: txn.ui.clone(),
        ops,
    };
    let bytes = serde_json::to_vec(&json).unwrap_or_default();
    (bytes, encode_blob(codec, blob))
}

/// Encodes stroke records for a blob. No records make an empty blob.
pub fn encode_blob(codec: &dyn Codec, records: Vec<InkRecord>) -> Vec<u8> {
    if records.is_empty() {
        Vec::new()
    } else {
        codec.encode_records(&records)
    }
}

/// Decodes a blob. An empty blob holds no records.
pub fn decode_blob(codec: &dyn Codec, blob: &[u8], limits: &Limits) -> Result<Vec<InkRecord>, FormatError> {
    if blob.is_empty() {
        Ok(Vec::new())
    } else {
        codec.decode_records(blob, limits)
    }
}

/// Decodes a transaction from its JSON and its blob.
pub fn decode_txn(json: &[u8], blob: &[u8], codec: &dyn Codec, limits: &Limits) -> Result<Txn, FormatError> {
    let parsed: TxnJson = serde_json::from_slice(json)
        .map_err(|err| FormatError::new(FormatErrorKind::Syntax, format!("journal: {err}")))?;
    let strokes: Vec<Arc<Stroke>> = decode_blob(codec, blob, limits)?
        .into_iter()
        .map(|record| match record {
            InkRecord::Stroke(stroke) => Ok(stroke),
            _ => Err(invalid("the blob holds a record that is not a stroke")),
        })
        .collect::<Result<_, _>>()?;
    let ctx = DecodeCtx {
        codec,
        limits,
        strokes: &strokes,
    };
    let ops = parsed
        .ops
        .into_iter()
        .map(|op| decode_op(op, &ctx))
        .collect::<Result<_, _>>()?;
    Ok(Txn {
        id: parsed.txn,
        at: parsed.at,
        origin: parsed.origin,
        client: parsed.client,
        coalesce: parsed.coalesce,
        ui: parsed.ui,
        ops,
    })
}

fn encode_op(op: &Op, codec: &dyn Codec, blob: &mut Vec<InkRecord>) -> OpJson {
    match op {
        Op::SetPage { before, after } => OpJson::SetPage {
            before: encode_fields(before, codec),
            after: encode_fields(after, codec),
        },
        Op::InsertBlocks { blocks } => OpJson::InsertBlocks {
            blocks: fragment::write_blocks(codec, blocks),
        },
        Op::DeleteBlocks { blocks, strokes } => OpJson::DeleteBlocks {
            blocks: fragment::write_blocks(codec, blocks),
            strokes: push_strokes(blob, strokes),
        },
        Op::MoveBlock {
            id,
            before,
            after,
            stamps,
        } => move_json(*id, before, after, stamps),
        Op::PatchBlock {
            id,
            before,
            after,
            stamps,
        } => patch_json(*id, before, after, stamps),
        Op::EditText { id, splices, stamps } => edit_json(*id, splices, stamps),
        Op::AddStrokes { strokes } => OpJson::AddStrokes {
            records: push_strokes(blob, strokes),
        },
        Op::RemoveStrokes { strokes } => OpJson::RemoveStrokes {
            records: push_strokes(blob, strokes),
        },
        Op::SetStrokeProps { items } => OpJson::SetStrokeProps {
            items: items.iter().map(encode_props).collect(),
        },
        Op::AddAsset { asset } => OpJson::AddAsset {
            asset: fragment::write_asset(codec, asset),
        },
        Op::RemoveAsset { asset } => OpJson::RemoveAsset {
            asset: fragment::write_asset(codec, asset),
        },
    }
}

fn move_json(block: BlockId, before: &Placement, after: &Placement, stamps: &Stamps) -> OpJson {
    let placement = |p: &Placement| PlacementJson {
        order: p.order.clone(),
        frame: p.frame.clone(),
    };
    OpJson::MoveBlock {
        block,
        before: placement(before),
        after: placement(after),
        stamps: [stamps.before, stamps.after],
    }
}

fn patch_json(block: BlockId, before: &JsonMap, after: &JsonMap, stamps: &Stamps) -> OpJson {
    OpJson::PatchBlock {
        block,
        before: before.clone(),
        after: after.clone(),
        stamps: [stamps.before, stamps.after],
    }
}

fn edit_json(block: BlockId, splices: &[Splice], stamps: &Stamps) -> OpJson {
    let splices = splices
        .iter()
        .map(|s| SpliceJson {
            at: s.at,
            del: s.del.clone(),
            ins: s.ins.clone(),
        })
        .collect();
    OpJson::EditText {
        block,
        splices,
        stamps: [stamps.before, stamps.after],
    }
}

/// Adds strokes to the blob and returns their range.
fn push_strokes(blob: &mut Vec<InkRecord>, strokes: &[Arc<Stroke>]) -> [u32; 2] {
    let index = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    let start = index(blob.len());
    blob.extend(strokes.iter().cloned().map(InkRecord::Stroke));
    [start, index(blob.len())]
}

fn encode_fields(fields: &PageFields, codec: &dyn Codec) -> FieldsJson {
    FieldsJson {
        title: fields.title.clone(),
        tags: fields.tags.clone(),
        view: fields.view.as_ref().map(|view| fragment::write_view(codec, view)),
        reading_order: fields.reading_order.clone(),
    }
}

fn encode_props(change: &StrokePropsChange) -> PropsJson {
    let state = |state: &StrokeState| StateJson {
        style: StyleJson {
            tool: state.style.tool,
            palette: state.style.palette,
            color: state.style.color,
            width: state.style.width,
        },
        transform: state.transform.map(|t| t.0),
        block: state.block,
    };
    PropsJson {
        stroke: change.id,
        before: state(&change.before),
        after: state(&change.after),
    }
}

/// What decoding an operation needs.
struct DecodeCtx<'a> {
    codec: &'a dyn Codec,
    limits: &'a Limits,
    strokes: &'a [Arc<Stroke>],
}

impl DecodeCtx<'_> {
    fn range(&self, [start, end]: [u32; 2]) -> Result<Vec<Arc<Stroke>>, FormatError> {
        let (start, end) = (start as usize, end as usize);
        let strokes = self.strokes.get(start..end).filter(|_| start <= end);
        strokes
            .map(<[_]>::to_vec)
            .ok_or_else(|| invalid("a stroke range outside the blob"))
    }

    fn blocks(&self, value: &serde_json::Value) -> Result<Vec<Arc<crate::model::Block>>, FormatError> {
        fragment::read_blocks(self.codec, value, self.limits)
    }

    fn asset(&self, value: &serde_json::Value) -> Result<crate::model::Asset, FormatError> {
        fragment::read_asset(self.codec, value, self.limits)
    }
}

fn decode_op(op: OpJson, ctx: &DecodeCtx<'_>) -> Result<Op, FormatError> {
    Ok(match op {
        OpJson::SetPage { before, after } => Op::SetPage {
            before: decode_fields(before, ctx)?,
            after: decode_fields(after, ctx)?,
        },
        OpJson::InsertBlocks { blocks } => Op::InsertBlocks {
            blocks: ctx.blocks(&blocks)?,
        },
        OpJson::DeleteBlocks { blocks, strokes } => Op::DeleteBlocks {
            blocks: ctx.blocks(&blocks)?,
            strokes: ctx.range(strokes)?,
        },
        OpJson::MoveBlock {
            block,
            before,
            after,
            stamps,
        } => decode_move(block, before, after, stamps),
        OpJson::PatchBlock {
            block,
            before,
            after,
            stamps,
        } => Op::PatchBlock {
            id: block,
            before,
            after,
            stamps: decode_stamps(stamps),
        },
        OpJson::EditText { block, splices, stamps } => decode_edit(block, splices, stamps),
        OpJson::AddStrokes { records } => Op::AddStrokes {
            strokes: ctx.range(records)?,
        },
        OpJson::RemoveStrokes { records } => Op::RemoveStrokes {
            strokes: ctx.range(records)?,
        },
        OpJson::SetStrokeProps { items } => Op::SetStrokeProps {
            items: items.into_iter().map(decode_props).collect(),
        },
        OpJson::AddAsset { asset } => Op::AddAsset {
            asset: ctx.asset(&asset)?,
        },
        OpJson::RemoveAsset { asset } => Op::RemoveAsset {
            asset: ctx.asset(&asset)?,
        },
    })
}

fn decode_stamps([before, after]: [Timestamp; 2]) -> Stamps {
    Stamps { before, after }
}

fn decode_move(block: BlockId, before: PlacementJson, after: PlacementJson, stamps: [Timestamp; 2]) -> Op {
    let placement = |p: PlacementJson| Placement {
        order: p.order,
        frame: p.frame,
    };
    Op::MoveBlock {
        id: block,
        before: placement(before),
        after: placement(after),
        stamps: decode_stamps(stamps),
    }
}

fn decode_edit(block: BlockId, splices: Vec<SpliceJson>, stamps: [Timestamp; 2]) -> Op {
    let splices = splices
        .into_iter()
        .map(|s| Splice {
            at: s.at,
            del: s.del,
            ins: s.ins,
        })
        .collect();
    Op::EditText {
        id: block,
        splices,
        stamps: decode_stamps(stamps),
    }
}

fn decode_fields(fields: FieldsJson, ctx: &DecodeCtx<'_>) -> Result<PageFields, FormatError> {
    let view = match fields.view {
        Some(view) => Some(Box::new(fragment::read_view(ctx.codec, &view, ctx.limits)?)),
        None => None,
    };
    Ok(PageFields {
        title: fields.title,
        tags: fields.tags,
        view,
        reading_order: fields.reading_order,
    })
}

fn decode_props(props: PropsJson) -> StrokePropsChange {
    let state = |state: StateJson| StrokeState {
        style: StrokeStyle {
            tool: state.style.tool,
            palette: state.style.palette,
            color: state.style.color,
            width: state.style.width,
        },
        transform: state.transform.map(Affine),
        block: state.block,
    };
    StrokePropsChange {
        id: props.stroke,
        before: state(props.before),
        after: state(props.after),
    }
}

fn invalid(detail: &str) -> FormatError {
    FormatError::new(FormatErrorKind::Validation, format!("journal: {detail}"))
}

#[cfg(test)]
pub(crate) mod tests;
