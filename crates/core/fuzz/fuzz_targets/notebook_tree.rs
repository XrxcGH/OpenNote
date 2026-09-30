#![no_main]
//! Opening, scanning, and verifying notebook folders (plan 13.3). Owned by WP5.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::tree::notebook_tree(data));
