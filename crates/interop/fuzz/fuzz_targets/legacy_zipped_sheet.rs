#![no_main]
//! Reading the parts of an Excel binary workbook (.xlsb) or an OpenDocument spreadsheet (.ods).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::zipped_sheet(data));
