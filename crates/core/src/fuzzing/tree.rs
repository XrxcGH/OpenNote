//! Fuzz entry point for notebook folders (plan 13.3). Owned by WP5.

/// An arbitrary folder tree in `testing::MemFs`, opened, scanned, and verified. The scan must end, and a
/// repair must change nothing when it runs twice.
pub fn notebook_tree(_data: &[u8]) {
    unimplemented!("WP5: fuzzing::tree::notebook_tree")
}
