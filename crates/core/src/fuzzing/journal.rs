//! Fuzz entry point for journal files (plan 13.3). Owned by WP4.

/// Reads a whole journal file and replays it onto a fixed page. Reading must stop cleanly at the first bad
/// record.
pub fn journal(_data: &[u8]) {
    unimplemented!("WP4: fuzzing::journal::journal")
}
