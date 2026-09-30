//! Binary formats between the core and the interface (plan 11.3 and 11.4). Owned by WP5.
//!
//! The lints below forbid the usual ways to panic, because the release build aborts on a panic.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

pub mod envelope;
pub mod frames;
