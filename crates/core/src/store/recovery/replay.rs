//! Applying journal records to a page (spec 20.10, step 6, and 20.11).

use std::collections::BTreeMap;
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
pub fn after_anchor<'a>(generations: &[&'a [JournalRecord]], anchor: u64) -> Vec<&'a JournalRecord> {
    // Usually the records already follow each other one by one, as one generation's do. They are then the
    // answer as they stand, which saves sorting thousands of them.
    let mut expected = anchor.saturating_add(1);
    let mut in_order = Vec::new();
    for record in generations.iter().copied().flatten().filter(|r| r.seq() > anchor) {
        if record.seq() != expected {
            in_order.clear();
            break;
        }
        in_order.push(record);
        expected = expected.saturating_add(1);
    }
    if !in_order.is_empty() {
        return in_order;
    }
    let mut by_seq: BTreeMap<u64, &'a JournalRecord> = BTreeMap::new();
    for record in generations.iter().copied().flatten().filter(|r| r.seq() > anchor) {
        by_seq.entry(record.seq()).or_insert(record);
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
///
/// Each run of transactions between other records goes to the applier at once, which may apply a long run of
/// handwriting faster than one transaction at a time. No record in a run touches the strokes in progress, so
/// those are tracked after it as they would be record by record.
pub fn replay(ctx: &RecoverCtx<'_>, page: &mut Page, records: &[&JournalRecord]) -> Replayed {
    let mut done = Replayed::default();
    let mut progress: BTreeMap<StrokeId, Arc<Stroke>> = BTreeMap::new();
    let mut index = 0usize;
    while let Some(rest) = records.get(index..).filter(|rest| !rest.is_empty()) {
        let txns: Vec<&Txn> = rest.iter().copied().map_while(as_txn_ref).collect();
        if txns.is_empty() {
            if let Some(JournalRecord::InkProgress { stroke, .. }) = rest.first() {
                progress.insert(stroke.id, stroke.clone());
            }
            done.last_seq = rest.first().map_or(done.last_seq, |record| record.seq());
            index = index.saturating_add(1);
            continue;
        }
        let failed = ctx.applier.apply_each(page, &txns).err();
        let applied = failed.as_ref().map_or(txns.len(), |(at, _)| *at);
        for txn in txns.iter().take(applied) {
            forget_added(&mut progress, txn);
        }
        done.txns = done.txns.saturating_add(u32::try_from(applied).unwrap_or(u32::MAX));
        if let Some(last) = applied.checked_sub(1).and_then(|last| rest.get(last)) {
            done.last_seq = last.seq();
        }
        if let Some((_, err)) = failed {
            let unapplied = rest.get(applied..).unwrap_or_default();
            done.failed = Some((err, unapplied.iter().copied().filter_map(as_txn).collect()));
            return done;
        }
        index = index.saturating_add(applied);
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

fn as_txn_ref(record: &JournalRecord) -> Option<&Txn> {
    match record {
        JournalRecord::Txn { txn, .. } => Some(txn),
        _ => None,
    }
}

fn as_txn(record: &JournalRecord) -> Option<Txn> {
    match record {
        JournalRecord::Txn { txn, .. } => Some(txn.clone()),
        _ => None,
    }
}

/// Strokes that a transaction adds are no longer in progress.
fn forget_added(progress: &mut BTreeMap<StrokeId, Arc<Stroke>>, txn: &Txn) {
    if progress.is_empty() {
        return;
    }
    for op in &txn.ops {
        if let Op::AddStrokes { strokes } = op {
            for stroke in strokes {
                progress.remove(&stroke.id);
            }
        }
    }
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use crate::id::{Id, RevisionId};

    fn records(seqs: &[u64]) -> Vec<JournalRecord> {
        seqs.iter()
            .map(|&seq| JournalRecord::SaveBegin {
                seq,
                revision: RevisionId(Id::from_parts(1, u128::from(seq))),
                through_seq: 0,
            })
            .collect()
    }

    fn seqs(records: &[&JournalRecord]) -> Vec<u64> {
        records.iter().map(|r| r.seq()).collect()
    }

    #[test]
    fn records_after_the_anchor_stop_at_the_first_gap() {
        let one = records(&[1, 2, 3, 4]);
        assert_eq!(seqs(&after_anchor(&[&one], 1)), [2, 3, 4]);
        let gap = records(&[1, 2, 4, 5]);
        assert_eq!(seqs(&after_anchor(&[&gap], 0)), [1, 2]);
        let late = records(&[5, 6]);
        assert!(after_anchor(&[&late], 2).is_empty());
        assert!(after_anchor(&[&one], 4).is_empty());
    }

    #[test]
    fn records_from_several_generations_come_once_each_in_order() {
        let (older, newer) = (records(&[1, 2, 3]), records(&[3, 4, 5]));
        let found = after_anchor(&[&older, &newer], 0);
        assert_eq!(seqs(&found), [1, 2, 3, 4, 5]);
        // A record in two generations comes from the first.
        assert!(std::ptr::eq(found[2], &older[2]));
        let (later, earlier) = (records(&[3, 4]), records(&[1, 2]));
        assert_eq!(seqs(&after_anchor(&[&later, &earlier], 0)), [1, 2, 3, 4]);
    }
}
