//! The sample notebook generator (plan 13.9). Owned by WP1.
//!
//! It writes a deterministic notebook through the canonical writer: by default 20 sections of 50 pages in 3
//! section groups, with subpages, or every page in one section. Strokes replay the Phase 1 pen recordings.

use crate::harness::GenerateArgs;

/// Writes the sample notebook.
pub fn run(_args: &GenerateArgs) -> Result<(), String> {
    unimplemented!("WP1: opennote-perf generate")
}
