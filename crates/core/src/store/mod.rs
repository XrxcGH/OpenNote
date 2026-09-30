//! Storage: the file system seam, paths, page saves, the journal, recovery, and the notebook tree.
//!
//! Code here reads untrusted files, so the lints below forbid the usual ways to panic. The release build
//! aborts on a panic.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

pub mod fs;
pub mod layout;
