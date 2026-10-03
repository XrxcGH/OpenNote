//! The `txn_request` fuzz entry on stable Rust: random bytes, scripts of abstract edits, JSON requests made
//! from them, and the seed corpus. Tests that need the real point decoder or page validation wait for WP1.

mod common;

use std::path::Path;
use std::sync::Arc;

use opennote_core::error::EditError;
use opennote_core::fuzzing::ops::txn_request;
use opennote_core::model::validate::validate_page;
use opennote_core::ops::resolve::{resolve, resolve_add_strokes, ResolveCtx, StrokeTxnMeta, TxnRequest};
use opennote_core::testing::edits::{arb_edits, to_request, EditRunner};
use opennote_core::testing::gen::{arb_page, arb_stroke, PageGen};
use opennote_core::testing::sample::{sample_ink_block, sample_page, test_clock};
use opennote_core::{ClientId, Limits, StrokeId};
use proptest::prelude::*;

proptest! {
    #![proptest_config(common::cases(256))]

    /// Any bytes: the entry never panics.
    #[test]
    fn random_bytes_never_panic(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        txn_request(&data);
    }

    /// Scripts read from bytes: every step keeps the page consistent and its inverse restores it.
    #[test]
    fn scripts_keep_the_page_consistent(data in proptest::collection::vec(any::<u8>(), 0..2_048)) {
        let mut script = vec![1u8];
        script.extend(data);
        txn_request(&script);
    }

    /// JSON requests made from abstract edits on the sample page apply and invert.
    #[test]
    fn json_requests_apply(edits in arb_edits(1..8)) {
        let page = sample_page();
        let client = ClientId::parse("main-1").unwrap();
        for (seq, edit) in edits.iter().enumerate() {
            if let Some(request) = to_request(&page, edit, &client, seq as u64) {
                let mut data = vec![0u8];
                data.extend(serde_json::to_vec(&request).unwrap());
                txn_request(&data);
            }
        }
    }
}

#[test]
fn a_known_script_runs() {
    txn_request(&[1, 0, 0, 0, b'h', b'i', 9, 3, 0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 13]);
    txn_request(br#"{"page":"01m3sa12426sg32pmtyffjaqcf","client":"main-1","clientSeq":1,"edits":[]}"#);
    txn_request(b"");
}

/// Resolves and applies a JSON seed on the sample page. The seed's first byte picks the mode, so it is skipped.
fn apply_seed(path: &Path) -> Result<usize, EditError> {
    let bytes = std::fs::read(path).unwrap();
    let (mode, json) = bytes.split_first().unwrap();
    assert_eq!(mode % 2, 0, "{} must start with an even byte", path.display());
    let request: TxnRequest = serde_json::from_slice(json).unwrap();
    let mut page = sample_page();
    let (clock, limits) = (test_clock(), Limits::default());
    let ctx = ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let txn = resolve(&page, &request, &ctx)?;
    page.apply(&txn).map_err(EditError::Precondition)?;
    Ok(txn.ops.len())
}

/// Each JSON seed is a request the sample page accepts, so the fuzzer starts from every edit kind. Seeds named
/// `-rejected` must fail instead. Every seed, scripts included, also runs through the fuzz entry.
#[test]
fn the_seeds_apply_to_the_sample_page() {
    let seeds = common::files_under(&common::fuzz_dir().join("seeds").join("txn_request"));
    let json: Vec<_> = seeds
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    assert!(json.len() >= 12 && seeds.len() > json.len(), "{} seeds", seeds.len());
    for path in json {
        let rejected = path.file_stem().unwrap().to_string_lossy().ends_with("-rejected");
        match apply_seed(path) {
            Ok(ops) => assert!(!rejected && ops > 0, "{} gave {ops} operations", path.display()),
            Err(error) => assert!(rejected, "{}: {error}", path.display()),
        }
    }
    for path in &seeds {
        txn_request(&std::fs::read(path).unwrap());
    }
}

/// Pages stay valid by every rule of spec 16 after random edits.
#[test]
fn edited_pages_stay_valid() {
    let limits = Limits::default();
    let mut runner = proptest::test_runner::TestRunner::default();
    let strategy = (arb_page(PageGen::small()), arb_edits(1..40));
    runner
        .run(&strategy, |(page, edits)| {
            let mut edit_runner = EditRunner::new(page);
            for edit in &edits {
                let _ = edit_runner.step(edit);
                let report = validate_page(&edit_runner.page, &limits);
                prop_assert!(report.is_valid(), "{:?} after {edit:?}", report.errors);
            }
            Ok(())
        })
        .unwrap();
}

/// Binary strokes are decoded once, and their bounding box comes from their points.
#[test]
fn binary_strokes_are_checked_and_boxed() {
    let page = sample_page();
    let clock = test_clock();
    let limits = Limits::default();
    let ctx = opennote_core::ops::resolve::ResolveCtx {
        clock: &clock,
        limits: &limits,
        imported: &|_| None,
    };
    let meta = StrokeTxnMeta {
        page: page.id,
        client: ClientId::parse("main-1").unwrap(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: Vec::new(),
    };
    let mut runner = proptest::test_runner::TestRunner::default();
    let id = StrokeId(opennote_core::Id::from_parts(1_800_000_000_000, 1));
    runner
        .run(&arb_stroke(id, vec![sample_ink_block()], 64), |stroke| {
            let mut unboxed = stroke.clone();
            unboxed.bbox = Default::default();
            let txn = resolve_add_strokes(&page, &meta, vec![Arc::new(unboxed)], &ctx).unwrap();
            let opennote_core::ops::Op::AddStrokes { strokes } = &txn.ops[0] else {
                panic!()
            };
            prop_assert_eq!(strokes[0].bbox, stroke.bbox);
            let mut broken = stroke.clone();
            broken.point_count += 1;
            prop_assert!(resolve_add_strokes(&page, &meta, vec![Arc::new(broken)], &ctx).is_err());
            Ok(())
        })
        .unwrap();
}
