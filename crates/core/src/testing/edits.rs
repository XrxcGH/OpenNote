//! Random edits for properties and the kill harness (plan 13.2). Owned by WP3.
//!
//! Edits are abstract choices, such as "the third text block", resolved against the page as it evolves, so
//! every generated edit is valid and shrinking still works. A target index is taken modulo the number of
//! eligible targets: blocks that the edit may change under the lock rules. An edit with no eligible target is
//! skipped.
//!
//! New IDs come from the client's sequence number and a salt, and skip IDs the page already uses. The same
//! script on the same page therefore always makes the same IDs.

mod build;
mod runner;

use std::ops::Range;
use std::sync::Arc;

use proptest::collection::vec;
use proptest::prelude::*;

use crate::id::ClientId;
use crate::model::{Asset, Page, Stroke};
use crate::ops::resolve::{StrokeTxnMeta, TxnRequest};

pub use runner::EditRunner;

/// An edit that names its targets by index modulo the current count.
#[derive(Clone, Debug, PartialEq)]
pub enum AbstractEdit {
    /// Types `text` at a character position of a text block.
    Type {
        /// Which text block.
        block: usize,
        /// Which character position, modulo the text's length plus one.
        at: usize,
        /// The typed text.
        text: String,
    },
    /// Deletes 1 to 8 characters of a text block.
    DeleteText {
        /// Which text block.
        block: usize,
        /// The first character deleted.
        at: usize,
        /// How many characters, modulo 8, plus one.
        len: usize,
    },
    /// Replaces a text block's whole Markdown.
    ReplaceText {
        /// Which text block.
        block: usize,
        /// The new Markdown.
        text: String,
    },
    /// Adds a text block after a block, or at the end.
    InsertText {
        /// The block it goes after, or `None` for the end.
        after: Option<usize>,
        /// Its Markdown.
        text: String,
        /// Floats it at a position from the salt, when set.
        floating: bool,
        /// Varies its ID.
        salt: u64,
    },
    /// Adds a drawing area after a block, or at the end.
    InsertDrawing {
        /// The block it goes after, or `None` for the end.
        after: Option<usize>,
        /// Varies its ID.
        salt: u64,
    },
    /// Moves a block by an offset, and to another place in the order.
    MoveBlock {
        /// Which unlocked block.
        block: usize,
        /// The offset in page units, for floating blocks.
        dx: i16,
        /// The offset in page units, for floating blocks.
        dy: i16,
        /// The block it goes after, if it changes places.
        after: Option<usize>,
    },
    /// Changes a block's description, decorative flag, lock, fallback, or first element's style.
    PatchBlock {
        /// Which block.
        block: usize,
        /// The change.
        patch: PatchChoice,
    },
    /// Deletes a block, with its strokes.
    DeleteBlock {
        /// Which block.
        block: usize,
    },
    /// Draws a stroke in an ink block.
    Draw {
        /// Which ink block.
        block: usize,
        /// Steps between points, in 1/4 page units, and pressure.
        points: Vec<(i8, i8, u16)>,
        /// Point channels in bits 0 to 2, and the tool in bits 3 to 5.
        style: u8,
        /// Varies its ID and palette slot.
        salt: u64,
    },
    /// Erases 1 to 4 strokes.
    EraseStrokes {
        /// The first stroke, by ID order.
        stroke: usize,
        /// How many, modulo 4, plus one.
        count: usize,
    },
    /// Moves and scales 1 to 4 strokes.
    TransformStrokes {
        /// The first stroke, by ID order.
        stroke: usize,
        /// How many, modulo 4, plus one.
        count: usize,
        /// The offset in page units.
        dx: i8,
        /// The offset in page units.
        dy: i8,
        /// The scale: 0.5 plus this over 128.
        scale: u8,
    },
    /// Recolors and resizes 1 to 4 strokes.
    RestyleStrokes {
        /// The first stroke, by ID order.
        stroke: usize,
        /// How many, modulo 4, plus one.
        count: usize,
        /// The new palette slot.
        palette: u8,
        /// The new width: 0.5 plus this over 8.
        width: u8,
    },
    /// Moves 1 to 4 strokes to another ink block.
    MoveStrokes {
        /// The first stroke, by ID order.
        stroke: usize,
        /// How many, modulo 4, plus one.
        count: usize,
        /// Which ink block.
        block: usize,
    },
    /// Sets the title.
    SetTitle {
        /// The title.
        title: String,
    },
    /// Sets the tags.
    SetTags {
        /// The tags.
        tags: Vec<String>,
    },
    /// Sets the background pattern, spacing, and mode.
    SetView {
        /// The pattern, modulo the number of patterns.
        pattern: u8,
        /// Paginated or infinite.
        paginated: bool,
        /// The spacing: 10 plus this.
        spacing: u8,
    },
    /// Sets a reading order.
    SetReadingOrder {
        /// The blocks, by index.
        blocks: Vec<usize>,
    },
    /// Imports an asset and adds it to the table.
    AddAsset {
        /// The original file name.
        name: String,
        /// Varies its ID, size, and hash.
        salt: u64,
    },
    /// Removes an asset no block uses from the table.
    RemoveAsset {
        /// Which unused asset.
        asset: usize,
    },
    /// Undoes the client's last step.
    Undo,
    /// Redoes the client's last undone step.
    Redo,
}

/// A change to a block's `lock`, `data`, or `fallback`.
#[derive(Clone, Debug, PartialEq)]
pub enum PatchChoice {
    /// A description, for images, files, and ink blocks.
    Alt(String),
    /// The decorative flag, for images, files, and ink blocks.
    Decorative(bool),
    /// No lock, `position`, or `all`, by this number modulo 3.
    Lock(u8),
    /// A fallback, or none.
    Fallback(Option<String>),
    /// A named style for the first element of a text block, or none.
    Style(Option<String>),
}

/// What an abstract edit asks the core to do.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Resolve and apply a request.
    Request(TxnRequest),
    /// Add strokes that arrived as binary records, with their points already checked.
    Strokes {
        /// The request's metadata.
        meta: StrokeTxnMeta,
        /// The strokes.
        strokes: Vec<Arc<Stroke>>,
    },
    /// Import an asset, then resolve and apply the request that adds it to the table.
    Import {
        /// The asset the import makes.
        asset: Asset,
        /// The `addAsset` request.
        request: TxnRequest,
    },
    /// Undo the client's last step.
    Undo,
    /// Redo the client's last undone step.
    Redo,
}

/// Short text with letters, a space, a newline, an accented letter, a combining mark, a right-to-left letter,
/// and an emoji.
pub fn arb_text() -> impl Strategy<Value = String> {
    const CHARS: [char; 9] = ['a', 'b', 'z', ' ', '\n', 'é', '\u{301}', 'א', '🙂'];
    vec(proptest::sample::select(&CHARS[..]), 0..6).prop_map(String::from_iter)
}

fn arb_patch() -> impl Strategy<Value = PatchChoice> {
    prop_oneof![
        arb_text().prop_map(PatchChoice::Alt),
        any::<bool>().prop_map(PatchChoice::Decorative),
        any::<u8>().prop_map(PatchChoice::Lock),
        proptest::option::of(arb_text()).prop_map(PatchChoice::Fallback),
        proptest::option::of("[a-z]{1,6}").prop_map(PatchChoice::Style),
    ]
}

fn arb_block_edit() -> impl Strategy<Value = AbstractEdit> {
    let n = || 0usize..64;
    prop_oneof![
        6 => (n(), n(), arb_text()).prop_map(|(block, at, text)| AbstractEdit::Type { block, at, text }),
        3 => (n(), n(), n()).prop_map(|(block, at, len)| AbstractEdit::DeleteText { block, at, len }),
        1 => (n(), arb_text()).prop_map(|(block, text)| AbstractEdit::ReplaceText { block, text }),
        2 => (proptest::option::of(n()), arb_text(), any::<bool>(), any::<u64>())
            .prop_map(|(after, text, floating, salt)| AbstractEdit::InsertText { after, text, floating, salt }),
        1 => (proptest::option::of(n()), any::<u64>())
            .prop_map(|(after, salt)| AbstractEdit::InsertDrawing { after, salt }),
        2 => (n(), any::<i16>(), any::<i16>(), proptest::option::of(n()))
            .prop_map(|(block, dx, dy, after)| AbstractEdit::MoveBlock { block, dx, dy, after }),
        2 => (n(), arb_patch()).prop_map(|(block, patch)| AbstractEdit::PatchBlock { block, patch }),
        1 => n().prop_map(|block| AbstractEdit::DeleteBlock { block }),
    ]
}

fn arb_ink_edit() -> impl Strategy<Value = AbstractEdit> {
    let n = || 0usize..64;
    prop_oneof![
        4 => (n(), vec(any::<(i8, i8, u16)>(), 1..24), any::<u8>(), any::<u64>())
            .prop_map(|(block, points, style, salt)| AbstractEdit::Draw { block, points, style, salt }),
        2 => (n(), n()).prop_map(|(stroke, count)| AbstractEdit::EraseStrokes { stroke, count }),
        1 => (n(), n(), any::<i8>(), any::<i8>(), any::<u8>()).prop_map(|(stroke, count, dx, dy, scale)| {
            AbstractEdit::TransformStrokes { stroke, count, dx, dy, scale }
        }),
        1 => (n(), n(), any::<u8>(), any::<u8>())
            .prop_map(|(stroke, count, palette, width)| AbstractEdit::RestyleStrokes { stroke, count, palette, width }),
        1 => (n(), n(), n()).prop_map(|(stroke, count, block)| AbstractEdit::MoveStrokes { stroke, count, block }),
    ]
}

fn arb_page_edit() -> impl Strategy<Value = AbstractEdit> {
    prop_oneof![
        arb_text().prop_map(|title| AbstractEdit::SetTitle { title }),
        vec("[a-z/]{1,8}", 0..3).prop_map(|tags| AbstractEdit::SetTags { tags }),
        (any::<u8>(), any::<bool>(), any::<u8>()).prop_map(|(pattern, paginated, spacing)| AbstractEdit::SetView {
            pattern,
            paginated,
            spacing
        }),
        vec(0usize..64, 0..4).prop_map(|blocks| AbstractEdit::SetReadingOrder { blocks }),
        ("[a-z]{1,8}\\.png", any::<u64>()).prop_map(|(name, salt)| AbstractEdit::AddAsset { name, salt }),
        (0usize..8).prop_map(|asset| AbstractEdit::RemoveAsset { asset }),
    ]
}

/// One abstract edit: mostly typing and drawing, sometimes other block, ink, and page edits, undo, and redo.
pub fn arb_edit() -> impl Strategy<Value = AbstractEdit> {
    prop_oneof![
        6 => arb_block_edit(),
        4 => arb_ink_edit(),
        1 => arb_page_edit(),
        1 => Just(AbstractEdit::Undo),
        1 => Just(AbstractEdit::Redo),
    ]
}

/// A sequence of abstract edits.
pub fn arb_edits(len: Range<usize>) -> impl Strategy<Value = Vec<AbstractEdit>> {
    vec(arb_edit(), len)
}

/// The request an abstract edit makes on this page, or `None` if it has no valid target, or if it isn't a
/// request: drawing, importing an asset, undo, and redo. See [`to_action`] for those.
pub fn to_request(page: &Page, edit: &AbstractEdit, client: &ClientId, seq: u64) -> Option<TxnRequest> {
    match to_action(page, edit, client, seq)? {
        Action::Request(request) => Some(request),
        _ => None,
    }
}

/// What an abstract edit asks the core to do on this page, or `None` if it has no valid target.
pub fn to_action(page: &Page, edit: &AbstractEdit, client: &ClientId, seq: u64) -> Option<Action> {
    build::action(page, edit, client, seq)
}
