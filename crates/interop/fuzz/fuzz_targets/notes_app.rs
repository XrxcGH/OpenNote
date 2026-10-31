#![no_main]
//! The Goodnotes, Notability, and Samsung Notes readers (ADR 0053), with their property list and protobuf parts.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| opennote_interop::fuzzing::notes_app(data));
