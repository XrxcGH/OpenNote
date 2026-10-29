#![no_main]
//! Reading a Word 97-2003 file (.doc) from a compound file.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::doc(data));
