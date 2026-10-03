#![no_main]
//! Reading a Trash item's `item.json` (plan 13.3). Owned by WP1.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::formats::trash_item(data));
