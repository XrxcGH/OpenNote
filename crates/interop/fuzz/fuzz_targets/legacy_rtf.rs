#![no_main]
//! Reading a Rich Text Format file (.rtf).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::rtf(data));
