#![no_main]
//! The search indexer (A4-36): a page made from the input is indexed and searched.

use libfuzzer_sys::fuzz_target;

#[path = "../entries/search.rs"]
mod entry;

fuzz_target!(|data: &[u8]| entry::search_index(data));
