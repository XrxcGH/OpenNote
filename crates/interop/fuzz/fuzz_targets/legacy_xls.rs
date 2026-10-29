#![no_main]
//! Reading an Excel 97-2003 workbook (.xls) from a compound file.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::xls(data));
