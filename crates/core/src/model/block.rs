//! Blocks (spec 6): the common fields and the version 1 types.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::{named_enum, JsonMap, Named};
use crate::id::{AssetId, BlockId, ColumnId, ElementId, Id, RowId};
use crate::order::OrderKey;
use crate::time::Timestamp;

named_enum! {
    /// What a lock prevents (spec 6.1).
    Lock {
        /// The block can't be moved or resized.
        Position = "position",
        /// The block can't be moved, resized, or edited.
        All = "all",
    }
}

named_enum! {
    /// The role of an ink block (spec 8.1).
    #[derive(Default)]
    InkRole {
        /// The page's handwriting layer.
        #[default]
        Layer = "layer",
        /// A drawing area.
        Drawing = "drawing",
    }
}

named_enum! {
    /// How a file block is shown.
    #[derive(Default)]
    FileDisplay {
        /// An icon with the file's name.
        #[default]
        Icon = "icon",
        /// A preview of the file.
        Preview = "preview",
    }
}

/// One block of a page (spec 6.1).
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    /// Unique within the page.
    pub id: BlockId,
    /// Position among the page's blocks.
    pub order: OrderKey,
    /// Position and size. `None` makes the block flow.
    pub frame: Option<Frame>,
    /// What the lock prevents, if the block is locked.
    pub lock: Option<Named<Lock>>,
    /// When the block was made.
    pub created: Timestamp,
    /// The last change to this block.
    pub modified: Timestamp,
    /// The type and its fields.
    pub data: BlockData,
    /// A readable stand-in, required for types newer than version 1 (spec 6.5).
    pub fallback: Option<Fallback>,
    /// Unknown keys of the block object.
    pub extra: JsonMap,
}

impl Block {
    /// The block's `type` as written.
    pub fn type_name(&self) -> &str {
        match &self.data {
            BlockData::Text(_) => "text",
            BlockData::Ink(_) => "ink",
            BlockData::Image(_) => "image",
            BlockData::File(_) => "file",
            BlockData::Table(_) => "table",
            BlockData::Other(other) => &other.type_name,
        }
    }

    /// Whether the block sits at a position of its own (spec 6.2).
    pub fn is_floating(&self) -> bool {
        self.frame.as_ref().is_some_and(Frame::is_floating)
    }
}

/// The type of a block and the fields of its `data`.
#[derive(Clone, Debug, PartialEq)]
pub enum BlockData {
    /// A text box.
    Text(TextData),
    /// A place for strokes.
    Ink(InkBlockData),
    /// An image.
    Image(ImageData),
    /// An attachment.
    File(FileData),
    /// A table.
    Table(TableData),
    /// Any other type, kept verbatim (spec 6.5).
    Other(OtherData),
}

/// A text box: OpenNote Markdown and its elements (spec 6.3 and 6.6).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TextData {
    /// The text, in OpenNote Markdown.
    pub markdown: Arc<str>,
    /// Element IDs, one for each paragraph, heading, list item, and other element, in document order.
    pub ids: Vec<ElementId>,
    /// Tags of single elements.
    pub tags: BTreeMap<ElementId, Vec<String>>,
    /// Named styles of single elements.
    pub styles: BTreeMap<ElementId, String>,
    /// Elements whose to-do tag is checked off.
    pub checked: BTreeSet<ElementId>,
    /// Unknown keys of `data`.
    pub extra: JsonMap,
}

/// An ink block's fields (spec 6.3 and 8.1).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct InkBlockData {
    /// The handwriting layer or a drawing area.
    pub role: Named<InkRole>,
    /// A cached count of live strokes.
    pub stroke_count: u32,
    /// Ties the block to a character of text, so handwriting follows its paragraph.
    pub anchor: Option<InkAnchor>,
    /// A description for screen readers, for drawings.
    pub alt: String,
    /// The drawing only decorates the page.
    pub decorative: bool,
    /// Unknown keys of `data`.
    pub extra: JsonMap,
}

/// Where anchored handwriting is tied to text (spec 8.1).
#[derive(Clone, Debug, PartialEq)]
pub struct InkAnchor {
    /// A text block's ID, or a text element's ID.
    pub block: Id,
    /// Unicode code points of the element's displayed text before the anchored character.
    pub offset: u32,
    /// Unknown keys.
    pub extra: JsonMap,
}

/// An image block's fields.
#[derive(Clone, Debug, PartialEq)]
pub struct ImageData {
    /// The image in the asset table.
    pub asset: AssetId,
    /// A description for screen readers.
    pub alt: String,
    /// The image only decorates the page.
    pub decorative: bool,
    /// The part of the image shown. `None` shows all of it.
    pub crop: Option<Crop>,
    /// Unknown keys of `data`.
    pub extra: JsonMap,
}

/// A crop as fractions of the image, from 0 to 1.
#[derive(Clone, Debug, PartialEq)]
pub struct Crop {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
    /// Unknown keys.
    pub extra: JsonMap,
}

/// A file block's fields.
#[derive(Clone, Debug, PartialEq)]
pub struct FileData {
    /// The file in the asset table.
    pub asset: AssetId,
    /// An icon or a preview.
    pub display: Named<FileDisplay>,
    /// A description for screen readers.
    pub alt: String,
    /// The file only decorates the page.
    pub decorative: bool,
    /// Unknown keys of `data`.
    pub extra: JsonMap,
}

/// A table block's fields (spec 6.3).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TableData {
    /// Whether the first row is a header row.
    pub header: bool,
    /// The columns, in order.
    pub columns: Vec<TableColumn>,
    /// The rows, in order.
    pub rows: Vec<TableRow>,
    /// Unknown keys of `data`.
    pub extra: JsonMap,
}

/// A table column.
#[derive(Clone, Debug, PartialEq)]
pub struct TableColumn {
    /// The column's ID, which keys its cells.
    pub id: ColumnId,
    /// The width in page units, if set.
    pub width: Option<f64>,
    /// Unknown keys.
    pub extra: JsonMap,
}

/// A table row.
#[derive(Clone, Debug, PartialEq)]
pub struct TableRow {
    /// The row's ID.
    pub id: RowId,
    /// Cells by column ID.
    pub cells: BTreeMap<ColumnId, TableCell>,
    /// Unknown keys.
    pub extra: JsonMap,
}

/// A table cell: inline Markdown with hard breaks.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TableCell {
    /// The cell's text.
    pub markdown: String,
    /// Unknown keys.
    pub extra: JsonMap,
}

/// An unknown type, or a known type whose data failed to read (spec 6.5).
#[derive(Clone, Debug, PartialEq)]
pub struct OtherData {
    /// The `type` as written.
    pub type_name: Box<str>,
    /// The `data` object, kept exactly.
    pub data: JsonMap,
    /// Why a known type couldn't be read, or `None` for an unknown type.
    pub unreadable: Option<String>,
}

/// Position and size (spec 6.2). Every field is optional.
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct Frame {
    /// Left edge in page units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// Top edge in page units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    /// Width in page units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    /// Height in page units. `None` on a floating block means as tall as its content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    /// Rotation in degrees, clockwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotate: Option<f64>,
    /// Unknown keys.
    #[serde(flatten)]
    pub extra: JsonMap,
}

impl Frame {
    /// A frame with both `x` and `y` makes its block float.
    pub fn is_floating(&self) -> bool {
        self.x.is_some() && self.y.is_some()
    }
}

/// A readable stand-in for a block (spec 6.5).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Fallback {
    /// Markdown that describes the block.
    pub markdown: String,
    /// An image of the block from the asset table.
    pub image: Option<AssetId>,
    /// Unknown keys.
    pub extra: JsonMap,
}
