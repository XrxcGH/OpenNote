//! The applied-changes frame for undo, redo, and changes pushed to other windows (plan 11.4). Owned by WP5.

/// A `u32` JSON length, the JSON with the changes and the selection to restore, and then any stroke records.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AppliedFrame {
    /// The encoded frame.
    pub bytes: Vec<u8>,
}
