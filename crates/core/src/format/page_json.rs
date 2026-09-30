//! `page.json` (spec 5 and 6). Owned by WP1.

use crate::error::FormatError;
use crate::format::ReadPage;
use crate::limits::Limits;
use crate::model::Page;

/// Reads `page.json`, upgrading older versions in memory. Sets `format.access` to read-only for newer
/// versions, damaged data, and reserved content such as encryption.
pub fn read_page(_bytes: &[u8], _limits: &Limits) -> Result<ReadPage, FormatError> {
    unimplemented!("WP1: read_page")
}

/// Writes `page.json` in canonical form (spec 2.2).
pub fn write_page(_page: &Page) -> Vec<u8> {
    unimplemented!("WP1: write_page")
}

/// The page's title without a full parse, for the scan.
pub fn page_title_prefix(_bytes: &[u8]) -> Option<String> {
    unimplemented!("WP1: page_title_prefix")
}
