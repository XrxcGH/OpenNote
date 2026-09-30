//! Fuzz entry point for edit requests (plan 13.3). Owned by WP3.

/// A request applied to a fixed page, such as `testing::sample::sample_page`. The page must stay valid.
pub fn txn_request(_data: &[u8]) {
    unimplemented!("WP3: fuzzing::ops::txn_request")
}
