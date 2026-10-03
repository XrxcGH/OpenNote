#![no_main]
//! Rendering and classifying readable copies (plan 13.3). Owned by WP1.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_core::fuzzing::formats::readable(data));
