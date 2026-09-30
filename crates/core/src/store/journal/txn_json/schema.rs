//! The JSON shapes of transaction records (spec 20.7).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::id::{BlockId, ClientId, StrokeId, TxnId};
use crate::model::{Frame, JsonMap};
use crate::ops::{CoalesceKey, Origin};
use crate::order::OrderKey;
use crate::time::Timestamp;

/// A transaction record's JSON.
#[derive(Serialize, Deserialize)]
pub struct TxnJson {
    pub txn: TxnId,
    pub at: Timestamp,
    pub origin: Origin,
    pub client: ClientId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coalesce: Option<CoalesceKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<Value>,
    pub ops: Vec<OpJson>,
}

/// One operation's JSON. Blocks, views, and asset entries are `page.json` fragments, and strokes are ranges
/// `[a, b]` of the blob.
#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OpJson {
    SetPage {
        before: FieldsJson,
        after: FieldsJson,
    },
    InsertBlocks {
        blocks: Value,
    },
    DeleteBlocks {
        blocks: Value,
        strokes: [u32; 2],
    },
    MoveBlock {
        block: BlockId,
        before: PlacementJson,
        after: PlacementJson,
        stamps: [Timestamp; 2],
    },
    PatchBlock {
        block: BlockId,
        before: JsonMap,
        after: JsonMap,
        stamps: [Timestamp; 2],
    },
    EditText {
        block: BlockId,
        splices: Vec<SpliceJson>,
        stamps: [Timestamp; 2],
    },
    AddStrokes {
        records: [u32; 2],
    },
    RemoveStrokes {
        records: [u32; 2],
    },
    SetStrokeProps {
        items: Vec<PropsJson>,
    },
    AddAsset {
        asset: Value,
    },
    RemoveAsset {
        asset: Value,
    },
}

/// The page fields of `setPage`. Absent fields don't change.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldsJson {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<Vec<BlockId>>,
}

/// A block's order key and frame.
#[derive(Serialize, Deserialize)]
pub struct PlacementJson {
    pub order: OrderKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<Frame>,
}

/// A splice at a byte offset into the UTF-8 text.
#[derive(Serialize, Deserialize)]
pub struct SpliceJson {
    pub at: u32,
    pub del: String,
    pub ins: String,
}

/// One stroke of `setStrokeProps`.
#[derive(Serialize, Deserialize)]
pub struct PropsJson {
    pub stroke: StrokeId,
    pub before: StateJson,
    pub after: StateJson,
}

/// A stroke's style, transform, and ink block.
#[derive(Serialize, Deserialize)]
pub struct StateJson {
    pub style: StyleJson,
    pub transform: Option<[f32; 6]>,
    pub block: BlockId,
}

/// A stroke's style: tool, palette slot, color bytes, and width.
#[derive(Serialize, Deserialize)]
pub struct StyleJson {
    pub tool: u8,
    pub palette: u8,
    pub color: [u8; 4],
    pub width: f32,
}
