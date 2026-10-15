#![no_main]
//! The OneNote section and package reader (A3-17).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::onenote(data));
