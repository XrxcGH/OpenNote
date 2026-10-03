#![no_main]
//! Reading and replaying journal files (plan 13.3). Owned by WP4.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::journal::journal(data));
