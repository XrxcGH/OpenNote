//! Test helpers for this crate's tests and for other crates' (the `testing` feature).
//!
//! The in-memory file system, [`mem_fs::MemFs`], simulates app crashes and power cuts. The generators in
//! [`gen`] make pages, blocks, strokes, and every JSON file kind. The fakes in [`fakes`] are a registry codec,
//! a small applier, event sinks, and a link resolver. The values in [`sample`] come from the spec's examples.
//! WP2 owns `fault_fs`, and WP3 owns `edits` and `oracle`.

pub mod edits;
pub mod fakes;
pub mod fault_fs;
pub mod gen;
pub mod mem_fs;
pub mod oracle;
pub mod sample;

pub use fakes::{CollectingIndex, CollectingSink, NoLinks, NullSink, RegistryCodec, ScriptApplier};
pub use mem_fs::{MemCrash, MemFs};
