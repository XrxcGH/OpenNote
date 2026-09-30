//! Applying journal records to a page (spec 20.10, step 6, and 20.11).

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};

use super::RecoverCtx;
use crate::error::{ApplyError, CoreError};
use crate::id::{ClientId, PageId, StrokeId, TxnId};
use crate::model::asset::hex;
use crate::model::{Page, Stroke};
use crate::ops::{Op, Origin, Txn};
use crate::store::journal::reader::JournalRecord;
use crate::store::journal::txn_json::encode_txn;
use crate::store::layout::file_time;
use crate::store::page_store::ensure_dir;

/// What replaying records did.
#[derive(Debug, Default)]
pub struct Replayed {
    /// Transactions applied.
    pub txns: u32,
    /// Strokes in progress that became normal strokes.
    pub strokes: u32,
    /// The last sequence number replayed.
    pub last_seq: u64,
    /// The transactions from the first one that failed its checks, which a recovery file keeps.
    pub failed: Option<(ApplyError, Vec<Txn>)>,
}

/// The records after `anchor`, from every generation, once each and in order, up to the first gap.
pub fn after_anchor(generations: &[Vec<JournalRecord>], anchor: u64) -> Vec<JournalRecord> {
    let mut by_seq: BTreeMap<u64, JournalRecord> = BTreeMap::new();
    for record in generations.iter().flatten().filter(|r| r.seq() > anchor) {
        by_seq.entry(record.seq()).or_insert_with(|| record.clone());
    }
    let mut expected = anchor.saturating_add(1);
    let mut contiguous = Vec::new();
    for (seq, record) in by_seq {
        if seq != expected {
            break;
        }
        contiguous.push(record);
        expected = expected.saturating_add(1);
    }
    contiguous
}

/// Applies the transactions with their checks, and turns strokes in progress that never got their final
/// `addStrokes` into normal strokes. Replay stops at the first transaction that fails (spec 20.11).
pub fn replay(ctx: &RecoverCtx<'_>, page: &mut Page, records: &[JournalRecord]) -> Replayed {
    let mut done = Replayed::default();
    let mut progress: BTreeMap<StrokeId, Arc<Stroke>> = BTreeMap::new();
    for (index, record) in records.iter().enumerate() {
        match record {
            JournalRecord::Txn { txn, .. } => {
                if let Err(err) = ctx.applier.apply(page, txn) {
                    let rest = records
                        .get(index..)
                        .unwrap_or_default()
                        .iter()
                        .filter_map(as_txn)
                        .collect();
                    done.failed = Some((err, rest));
                    return done;
                }
                done.txns = done.txns.saturating_add(1);
                for id in added_strokes(txn) {
                    progress.remove(&id);
                }
            }
            JournalRecord::InkProgress { stroke, .. } => {
                progress.insert(stroke.id, stroke.clone());
            }
            _ => {}
        }
        done.last_seq = record.seq();
    }
    let unfinished: Vec<Arc<Stroke>> = progress
        .into_values()
        .filter(|s| page.ink.stroke(s.id).is_none())
        .collect();
    if !unfinished.is_empty() {
        let count = unfinished.len();
        let txn = recovery_txn(ctx, vec![Op::AddStrokes { strokes: unfinished }]);
        if txn.is_some_and(|txn| ctx.applier.apply(page, &txn).is_ok()) {
            done.strokes = u32::try_from(count).unwrap_or(u32::MAX);
        }
    }
    done
}

fn as_txn(record: &JournalRecord) -> Option<Txn> {
    match record {
        JournalRecord::Txn { txn, .. } => Some(txn.clone()),
        _ => None,
    }
}

fn added_strokes(txn: &Txn) -> HashSet<StrokeId> {
    txn.ops
        .iter()
        .filter_map(|op| match op {
            Op::AddStrokes { strokes } => Some(strokes.iter().map(|s| s.id)),
            _ => None,
        })
        .flatten()
        .collect()
}

/// A transaction that recovery itself makes.
fn recovery_txn(ctx: &RecoverCtx<'_>, ops: Vec<Op>) -> Option<Txn> {
    Some(Txn {
        id: TxnId::generate(ctx.clock),
        at: ctx.clock.now(),
        origin: Origin::Recovery,
        client: ClientId::parse("recovery").ok()?,
        coalesce: None,
        ui: None,
        ops,
    })
}

/// Writes the transactions that couldn't be applied to `recovery/<page ID>-<time>.json` as readable JSON.
pub fn write_recovery_file(
    ctx: &RecoverCtx<'_>,
    page: PageId,
    err: &ApplyError,
    txns: &[Txn],
) -> Result<PathBuf, CoreError> {
    let transactions: Vec<Value> = txns
        .iter()
        .map(|txn| {
            let (json, blob) = encode_txn(txn, ctx.codec);
            let txn = serde_json::from_slice::<Value>(&json).unwrap_or(Value::Null);
            json!({ "txn": txn, "blob": hex(&blob) })
        })
        .collect();
    let file = json!({
        "page": page.to_string(),
        "failed": { "op": err.op_index, "check": err.check, "detail": err.detail },
        "transactions": transactions,
    });
    let bytes = serde_json::to_vec_pretty(&file).unwrap_or_default();
    ensure_dir(ctx.fs, ctx.recovery_dir)?;
    let path = ctx
        .recovery_dir
        .join(format!("{page}-{}.json", file_time(ctx.clock.now())));
    ctx.fs.create_durable(&path, &bytes)?;
    Ok(path)
}
