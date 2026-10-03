#![no_main]
//! Applying edit requests to a fixed page (plan 13.3). Owned by WP3.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::ops::txn_request(data));
