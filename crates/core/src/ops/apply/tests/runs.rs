//! Runs of transactions that `apply_each` applies at once.

use super::*;

/// Transactions that each add strokes, `count` of them, with one more stroke in the last, a millisecond apart.
fn stroke_txns(count: u64) -> Vec<Txn> {
    let stroke = |n: u64| {
        let mut stroke = sample_stroke();
        stroke.id = StrokeId(Id::from_parts(100 + n, u128::from(n)));
        Arc::new(stroke)
    };
    (0..count)
        .map(|n| {
            let mut strokes = vec![stroke(n)];
            if n + 1 == count {
                strokes.push(stroke(n + 1_000));
            }
            let mut t = txn(vec![Op::AddStrokes { strokes }]);
            t.at = Timestamp::from_unix_ms(LATER.unix_ms() + n as i64);
            t
        })
        .collect()
}

/// Applies the transactions one by one, as `apply_each` must match.
fn one_by_one(page: &mut Page, txns: &[&Txn]) -> Result<(), (usize, ApplyError)> {
    for (index, t) in txns.iter().enumerate() {
        page.apply(t).map_err(|err| (index, err))?;
    }
    Ok(())
}

#[test]
fn a_run_of_added_strokes_ends_as_one_by_one() {
    let page = sample_page();
    let mut txns = stroke_txns(6);
    let retitle = Op::SetPage {
        before: PageFields {
            title: Some(page.title.clone()),
            ..PageFields::default()
        },
        after: PageFields {
            title: Some("Respiration".to_owned()),
            ..PageFields::default()
        },
    };
    txns.insert(3, txn(vec![retitle]));
    txns.push(txn(Vec::new()));
    let refs: Vec<&Txn> = txns.iter().collect();
    let mut batched = page.clone();
    OpsApplier.apply_each(&mut batched, &refs).unwrap();
    let mut single = page.clone();
    one_by_one(&mut single, &refs).unwrap();
    assert_eq!(batched, single);
    assert_eq!(batched.ink.count_in_block(sample_ink_block()), 8);
    assert_eq!(batched.modified, txns[6].at);
}

#[test]
fn a_failing_stroke_in_a_run_stops_where_one_by_one_stops() {
    let page = sample_page();
    let mut txns = stroke_txns(5);
    // The third adds a stroke the page already has.
    txns[2] = txn(vec![Op::AddStrokes {
        strokes: vec![Arc::new(sample_stroke())],
    }]);
    let refs: Vec<&Txn> = txns.iter().collect();
    let mut batched = page.clone();
    let (index, err) = OpsApplier.apply_each(&mut batched, &refs).unwrap_err();
    let mut single = page.clone();
    let (want_index, want) = one_by_one(&mut single, &refs).unwrap_err();
    assert_eq!(
        (index, err.check, err.op_index),
        (want_index, want.check, want.op_index)
    );
    assert_eq!((index, err.check), (2, "strokeIdUnused"));
    assert_eq!(batched, single);
}
