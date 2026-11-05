#![no_main]
//! The reader and writer of an OpenNote page's Markdown, version 2 (A4-36).

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::page_markdown(data));
