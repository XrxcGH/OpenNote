//! The write-ahead journal's files (spec 20.4 to 20.7). Owned by WP4.
//!
//! The thread that owns the journal lives in `session::journal_thread`.

pub mod format;
pub mod reader;
pub mod txn_json;
