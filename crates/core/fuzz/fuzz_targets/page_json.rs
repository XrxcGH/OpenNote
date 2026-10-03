#![no_main]
//! Reading `page.json` (plan 13.3). Owned by WP1.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::formats::page_json(data));
