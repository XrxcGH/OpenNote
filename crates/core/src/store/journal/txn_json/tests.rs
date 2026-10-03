#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use super::*;
use crate::id::{Id, StrokeId};
use crate::model::Page;
use crate::model::{Block, Frame};
use crate::ops::{CoalesceKind, PageFields};
use crate::order::OrderKey;
use crate::testing::sample::{sample_asset_id, sample_ink_block, sample_page, sample_stroke};
use crate::testing::RegistryCodec;
use serde_json::Value;

fn at(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

fn stamps() -> Stamps {
    Stamps {
        before: at("2026-09-30T14:05:40.020Z"),
        after: at("2026-09-30T14:07:41.100Z"),
    }
}

fn second_stroke() -> Arc<Stroke> {
    let mut stroke = sample_stroke();
    stroke.id = StrokeId(Id::from_parts(1_790_777_300_000, 7));
    Arc::new(stroke)
}

fn placement(order: &str, x: f64) -> Placement {
    Placement {
        order: OrderKey::parse(order).unwrap(),
        frame: Some(Frame {
            x: Some(x),
            y: Some(12.5),
            ..Frame::default()
        }),
    }
}

fn state(width: f32, transform: Option<Affine>) -> StrokeState {
    StrokeState {
        style: StrokeStyle {
            tool: 0,
            palette: 1,
            color: [0x2b, 0x25, 0x21, 0xff],
            width,
        },
        transform,
        block: sample_ink_block(),
    }
}

/// Operations on page fields and blocks.
fn block_ops(page: &Page) -> Vec<Op> {
    let blocks: Vec<Arc<Block>> = page.blocks.iter().cloned().collect();
    let text = blocks[0].id;
    let mut patch = JsonMap::new();
    patch.insert("alt".into(), serde_json::Value::String("A leaf".into()));
    let mut view = page.view.clone();
    view.reading_order = vec![text];
    let before = PageFields {
        title: Some("Photosynthesis".into()),
        tags: Some(vec!["biology".into()]),
        view: Some(Box::new(view)),
    };
    let after = PageFields {
        title: Some("Light".into()),
        ..PageFields::default()
    };
    let splice = Splice {
        at: 118,
        del: String::new(),
        ins: " and b".into(),
    };
    vec![
        Op::SetPage { before, after },
        Op::InsertBlocks { blocks: blocks.clone() },
        Op::DeleteBlocks {
            blocks: blocks[2..3].to_vec(),
            strokes: vec![Arc::new(sample_stroke())],
        },
        Op::MoveBlock {
            id: text,
            before: placement("a0", 96.0),
            after: placement("a0V", 120.25),
            stamps: stamps(),
        },
        Op::PatchBlock {
            id: blocks[1].id,
            before: JsonMap::new(),
            after: patch,
            stamps: stamps(),
        },
        Op::EditText {
            id: text,
            splices: vec![splice],
            stamps: stamps(),
        },
    ]
}

/// Operations on strokes and assets.
fn ink_ops(page: &Page) -> Vec<Op> {
    let asset = page.assets[&sample_asset_id()].clone();
    let props = StrokePropsChange {
        id: sample_stroke().id,
        before: state(2.0, None),
        after: state(0.1, Some(Affine([1.0, 0.0, 0.0, 1.0, 24.0, -12.0]))),
    };
    vec![
        Op::AddStrokes {
            strokes: vec![Arc::new(sample_stroke()), second_stroke()],
        },
        Op::RemoveStrokes {
            strokes: vec![second_stroke()],
        },
        Op::SetStrokeProps { items: vec![props] },
        Op::AddAsset { asset: asset.clone() },
        Op::RemoveAsset { asset },
    ]
}

/// A transaction with every operation.
pub(crate) fn every_op_txn() -> Txn {
    let page = sample_page();
    let mut ops = block_ops(&page);
    ops.extend(ink_ops(&page));
    let text = page.blocks.iter().next().unwrap().id;
    Txn {
        id: "01m3sa8z1czh26f1rsnav197pg".parse().unwrap(),
        at: at("2026-09-30T14:07:41.100Z"),
        origin: crate::ops::Origin::Local,
        client: crate::id::ClientId::parse("main-1").unwrap(),
        coalesce: Some(crate::ops::CoalesceKey {
            kind: CoalesceKind::Typing,
            target: text.to_string(),
        }),
        ui: Some(serde_json::json!({"selAfter": {"anchor": 124, "head": 124}})),
        ops,
    }
}

#[test]
fn every_operation_round_trips() {
    let codec = RegistryCodec::new();
    let txn = every_op_txn();
    let (json, blob) = encode_txn(&txn, &codec);
    assert!(!blob.is_empty());
    let decoded = decode_txn(&json, &blob, &codec, &Limits::default()).unwrap();
    assert_eq!(decoded, txn);
}

#[test]
fn writes_the_shape_of_spec_20_7() {
    let codec = RegistryCodec::new();
    let txn = every_op_txn();
    let (json, _) = encode_txn(&txn, &codec);
    let value: Value = serde_json::from_slice(&json).unwrap();
    assert_eq!(value["txn"], "01m3sa8z1czh26f1rsnav197pg");
    assert_eq!(value["at"], "2026-09-30T14:07:41.100Z");
    assert_eq!(value["origin"], "local");
    assert_eq!(value["client"], "main-1");
    let ops = value["ops"].as_array().unwrap();
    assert_eq!(ops[5]["op"], "editText");
    assert_eq!(ops[5]["splices"][0]["ins"], " and b");
    assert_eq!(ops[5]["stamps"][1], "2026-09-30T14:07:41.100Z");
    assert_eq!(ops[2]["strokes"], serde_json::json!([0, 1]));
    assert_eq!(ops[6]["records"], serde_json::json!([1, 3]));
    assert_eq!(ops[7]["records"], serde_json::json!([3, 4]));
    assert_eq!(ops[3]["after"]["order"], "a0V");
}

#[test]
fn a_transaction_without_strokes_has_no_blob() {
    let codec = RegistryCodec::new();
    let mut txn = every_op_txn();
    txn.ops.truncate(1);
    txn.coalesce = None;
    txn.ui = None;
    let (json, blob) = encode_txn(&txn, &codec);
    assert!(blob.is_empty());
    let text = String::from_utf8(json.clone()).unwrap();
    assert!(!text.contains("coalesce") && !text.contains("\"ui\""));
    assert_eq!(decode_txn(&json, &blob, &codec, &Limits::default()).unwrap(), txn);
}

#[test]
fn rejects_ranges_outside_the_blob_and_foreign_records() {
    let codec = RegistryCodec::new();
    let limits = Limits::default();
    let mut txn = every_op_txn();
    txn.ops = vec![Op::AddStrokes {
        strokes: vec![Arc::new(sample_stroke())],
    }];
    let (json, blob) = encode_txn(&txn, &codec);
    assert!(
        decode_txn(&json, &[], &codec, &limits).is_err(),
        "the range needs the blob"
    );
    let text = String::from_utf8(json).unwrap().replace("[0,1]", "[1,0]");
    assert!(decode_txn(text.as_bytes(), &blob, &codec, &limits).is_err());
    let removal = codec.encode_records(&[InkRecord::Remove(sample_stroke().id)]);
    let json = text.replace("[1,0]", "[0,1]");
    assert!(decode_txn(json.as_bytes(), &removal, &codec, &limits).is_err());
    assert_eq!(
        decode_txn(b"{", &[], &codec, &limits).unwrap_err().kind,
        FormatErrorKind::Syntax
    );
    assert!(decode_txn(br#"{"txn": "x"}"#, &[], &codec, &limits).is_err());
}
