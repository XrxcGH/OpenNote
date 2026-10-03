//! Fuzz entry point for journal files (plan 13.3). Owned by WP4.
//!
//! The first byte chooses a mode. With its low bit set, the rest has its CRC-32 values recomputed first, so
//! random inputs get past the checksums and reach the record decoders. Reading must never panic, must stop at
//! the first bad record, and must keep records in sequence. The records are then replayed onto a fixed page.

use crate::format::CanonicalCodec;
use crate::limits::Limits;
use crate::ops::apply::OpsApplier;
use crate::seams::{Applier, Codec};
use crate::store::journal::format::fix_checksums;
use crate::store::journal::reader::{read_generation, JournalRecord};
use crate::testing::sample::sample_page;

use super::Input;

/// The largest payload and base snapshot a fuzz run decodes, so no input can pass the fuzzer's memory limit.
const FUZZ_LIMIT: u64 = 1 << 20;

/// Reads a whole journal file and replays it onto a fixed page. Reading must stop cleanly at the first bad
/// record.
pub fn journal(data: &[u8]) {
    journal_with(data, &CanonicalCodec, &OpsApplier);
}

/// [`journal`] with another codec and applier, so the entry point can be tested with the fakes.
pub fn journal_with(data: &[u8], codec: &dyn Codec, applier: &dyn Applier) {
    let mut input = Input::new(data);
    let fix = input.bool();
    let mut bytes = input.rest().to_vec();
    if fix {
        fix_checksums(&mut bytes);
    }
    let limits = Limits {
        journal_payload: FUZZ_LIMIT,
        gunzip_bytes: FUZZ_LIMIT,
        ..Limits::default()
    };
    let Ok(generation) = read_generation(&bytes, codec, &limits) else {
        return;
    };
    let mut expected = generation.header.anchor;
    for record in &generation.records {
        expected = expected.wrapping_add(1);
        assert_eq!(record.seq(), expected, "records stay in sequence");
    }
    if let Some(offset) = generation.stop.offset() {
        assert!(offset <= bytes.len() as u64, "the stop lies inside the file");
    }
    let mut page = sample_page();
    for record in &generation.records {
        if let JournalRecord::Txn { txn, .. } = record {
            if applier.apply(&mut page, txn).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::gzip::gzip;
    use crate::store::journal::encode;
    use crate::store::journal::format::encode_header;
    use crate::store::journal::reader::JournalHeader;
    use crate::testing::{RegistryCodec, ScriptApplier};

    fn file(codec: &RegistryCodec) -> Vec<u8> {
        let header = JournalHeader {
            version: 1,
            notebook: Default::default(),
            page: sample_page().id,
            base: Default::default(),
            generation: 1,
            anchor: 5,
            created: crate::time::Timestamp::EPOCH,
            page_format: 1,
            meta: serde_json::json!({}),
        };
        let mut bytes = encode_header(&header, &gzip(b"base"));
        let record = JournalRecord::Txn {
            seq: 6,
            txn: crate::store::journal::txn_json::tests::every_op_txn(),
        };
        bytes.extend_from_slice(&encode(&record, codec));
        bytes
    }

    #[test]
    fn never_panics_on_damaged_journals() {
        let codec = RegistryCodec::new();
        let good = file(&codec);
        for mode in [0u8, 1] {
            let mut data = vec![mode];
            data.extend_from_slice(&good);
            journal_with(&data, &codec, &ScriptApplier);
            for cut in (0..data.len()).step_by(7) {
                journal_with(&data[..cut], &codec, &ScriptApplier);
            }
            for at in (1..data.len()).step_by(5) {
                let mut flipped = data.clone();
                if let Some(byte) = flipped.get_mut(at) {
                    *byte ^= 0x5a;
                }
                journal_with(&flipped, &codec, &ScriptApplier);
            }
        }
        journal_with(&[], &codec, &ScriptApplier);
        journal_with(&[1, 0x89, b'O', b'N', b'J'], &codec, &ScriptApplier);
    }
}
