#![no_main]
//! Decoding ink segment files (plan 13.3). Owned by WP1.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::formats::segment(data));
