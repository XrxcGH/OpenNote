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

use thiserror::Error;

/// A wire buffer that can't be written or read.
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum WireError {
    /// The buffer ends early, or a length points past its end.
    #[error("the buffer ends early")]
    Truncated,
    /// The magic bytes are wrong.
    #[error("not a page envelope")]
    Magic,
    /// A newer version wrote the buffer.
    #[error("envelope version {0} is newer than this reader")]
    Version(u16),
    /// Bytes are left after the last part.
    #[error("bytes are left after the ink")]
    TrailingBytes,
    /// A part is larger than a `u32` length can say.
    #[error("a part is larger than 4 GiB")]
    TooLarge,
    /// The JSON part can't be written or read.
    #[error("the JSON part is not valid")]
    Json,
}
