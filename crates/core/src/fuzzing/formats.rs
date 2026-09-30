//! Fuzz entry points for the byte formats (plan 13.3). Owned by WP1.
//!
//! Whatever parses must validate and round-trip, and re-encoding a parsed segment must give the same bytes.

/// `page.json` reading.
pub fn page_json(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::page_json")
}

/// `section.json` reading.
pub fn section_json(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::section_json")
}

/// `notebook.json` reading.
pub fn notebook_json(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::notebook_json")
}

/// `item.json` reading.
pub fn trash_item(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::trash_item")
}

/// `versions.json` reading.
pub fn versions(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::versions")
}

/// Segment decoding.
pub fn segment(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::segment")
}

/// Record decoding.
pub fn records(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::records")
}

/// Rendering an arbitrary page, and classifying arbitrary bytes as a readable copy.
pub fn readable(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::readable")
}

/// Migrating arbitrary JSON with any `formatVersion`.
pub fn migrate(_data: &[u8]) {
    unimplemented!("WP1: fuzzing::formats::migrate")
}
