//! A Trash item's `item.json` (spec 12.1). Owned by WP1.

use crate::error::FormatError;
use crate::limits::Limits;
use crate::model::TrashItemFile;

/// Reads `item.json`.
pub fn read_trash_item(_bytes: &[u8], _limits: &Limits) -> Result<TrashItemFile, FormatError> {
    unimplemented!("WP1: read_trash_item")
}

/// Writes `item.json` in canonical form.
pub fn write_trash_item(_file: &TrashItemFile) -> Vec<u8> {
    unimplemented!("WP1: write_trash_item")
}
