#![no_main]
//! The odt importer or reader (A4-36).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::odt(data));
