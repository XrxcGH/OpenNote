#![no_main]
//! The enex importer or reader (A4-36).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::enex(data));
