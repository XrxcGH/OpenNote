//! The document model: pages, blocks, ink, assets, the notebook tree, Trash, and history (spec 4 to 13).
//!
//! These types hold everything a file holds, including unknown keys in `extra`, so a reader can write back what
//! it read. Blocks, strokes, and point data sit behind `Arc`, so a save snapshot copies pointers.

pub mod asset;
pub mod block;
pub mod blocks;
pub mod history;
pub mod ink;
pub mod notebook;
pub mod page;
pub mod section;
pub mod stroke;
pub mod trash;
pub mod validate;
pub mod view;

use std::fmt;
use std::marker::PhantomData;

use serde::de::{self, Deserializer, Visitor};
use serde::{Deserialize, Serialize, Serializer};
use thiserror::Error;

pub use asset::Asset;
pub use block::{
    Block, BlockData, Crop, Fallback, FileData, FileDisplay, Frame, ImageData, InkAnchor, InkBlockData, InkRole, Lock,
    OtherData, TableCell, TableColumn, TableData, TableRow, TextData,
};
pub use blocks::Blocks;
pub use history::{VersionEntry, VersionReason, VersionsFile};
pub use ink::{Ink, InkRecord, SegmentRef, StrokeProps};
pub use notebook::{
    Group, NotebookFile, NotebookStyles, NotebookTree, PageNode, PageNodeState, SectionNode, StyleSpec, TreeChild,
    MAX_STYLES, MAX_STYLE_NAME_CHARS, STYLE_NAMES,
};
pub use page::{Access, DeviceRef, FormatInfo, Page, ReadOnlyReason, Rect, Revision, Warning};
pub use section::{Moving, PageEntry, SectionFile};
pub use stroke::{Affine, BBox, Channels, Point, Stroke, StrokeStyle};
pub use trash::{TrashItemFile, TrashKind, TrashOrigin, TrashReason};
pub use view::{Background, Layout, Orientation, PageView, Paper, PaperSize, Pattern, ViewMode};

use crate::id::Id;

/// A JSON object. Writers never rely on its key order, because another crate could turn on `serde_json`'s
/// `preserve_order` feature. The canonical writer sorts keys itself.
pub type JsonMap = serde_json::Map<String, serde_json::Value>;

/// A change to the model that would break one of its rules.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum ModelError {
    /// The ID is already used on the page.
    #[error("the ID {0} is already used")]
    DuplicateId(Id),
    /// Nothing on the page has the ID.
    #[error("nothing has the ID {0}")]
    MissingId(Id),
    /// Not a color of spec 2.7.
    #[error("{0:?} is not a color")]
    InvalidColor(String),
}

/// An enum whose values are written as fixed names, such as `"paginated"`.
pub trait NamedValue: Sized + Copy + 'static {
    /// Every value, in declaration order.
    const ALL: &'static [Self];

    /// The value's name in files and on the wire.
    fn name(self) -> &'static str;

    /// The value with this name, if the name is known.
    fn from_name(text: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|value| value.name() == text)
    }
}

/// Declares an enum whose values are written as names, implementing [`NamedValue`] and serde for it.
macro_rules! named_enum {
    ($(#[$meta:meta])* $name:ident { $($(#[$vmeta:meta])* $variant:ident = $text:literal,)+ }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum $name {
            $($(#[$vmeta])* $variant,)+
        }

        impl $crate::model::NamedValue for $name {
            const ALL: &'static [$name] = &[$($name::$variant,)+];
            fn name(self) -> &'static str {
                match self {
                    $($name::$variant => $text,)+
                }
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str($crate::model::NamedValue::name(*self))
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<$name, D::Error> {
                let text = <String as serde::Deserialize>::deserialize(deserializer)?;
                <$name as $crate::model::NamedValue>::from_name(&text)
                    .ok_or_else(|| serde::de::Error::custom(format!("unknown value {text:?}")))
            }
        }
    };
}
pub(crate) use named_enum;

/// A known enum value, or an unknown one kept exactly as written (spec 2.9).
#[derive(Clone, PartialEq, Eq, Hash)]
pub enum Named<T> {
    /// A value this version knows.
    Known(T),
    /// A value from a newer version. Readers keep it and show a neutral default.
    Unknown(Box<str>),
}

impl<T: NamedValue> Named<T> {
    /// Reads a name, keeping unknown names.
    pub fn parse(text: &str) -> Named<T> {
        match T::from_name(text) {
            Some(value) => Named::Known(value),
            None => Named::Unknown(text.into()),
        }
    }

    /// The name as written.
    pub fn as_str(&self) -> &str {
        match self {
            Named::Known(value) => value.name(),
            Named::Unknown(text) => text,
        }
    }

    /// The known value, if there is one.
    pub fn known(&self) -> Option<T> {
        match self {
            Named::Known(value) => Some(*value),
            Named::Unknown(_) => None,
        }
    }

    /// The known value, or `fallback` for an unknown one.
    pub fn or(&self, fallback: T) -> T {
        self.known().unwrap_or(fallback)
    }
}

impl<T: NamedValue> From<T> for Named<T> {
    fn from(value: T) -> Named<T> {
        Named::Known(value)
    }
}

impl<T: NamedValue + Default> Default for Named<T> {
    fn default() -> Named<T> {
        Named::Known(T::default())
    }
}

impl<T: NamedValue> fmt::Debug for Named<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Named::Known(value) => write!(f, "{}", value.name()),
            Named::Unknown(text) => write!(f, "unknown {text:?}"),
        }
    }
}

impl<T: NamedValue> Serialize for Named<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de, T: NamedValue> Deserialize<'de> for Named<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Named<T>, D::Error> {
        struct NamedVisitor<T>(PhantomData<T>);
        impl<T: NamedValue> Visitor<'_> for NamedVisitor<T> {
            type Value = Named<T>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a name")
            }
            fn visit_str<E: de::Error>(self, text: &str) -> Result<Named<T>, E> {
                Ok(Named::parse(text))
            }
        }
        deserializer.deserialize_str(NamedVisitor(PhantomData))
    }
}

/// The brand pen names, in palette slot order 1 to 7 (spec 2.7 and 9.3).
pub const PEN_NAMES: [&str; 7] = ["ink", "indigo", "brick", "fern", "plum", "amber", "walnut"];

/// The brand highlighter names, in palette slot order 32 to 36.
pub const HIGHLIGHTER_NAMES: [&str; 5] = ["honey", "mint", "rose", "apricot", "lilac"];

/// A color (spec 2.7): a palette name, a hexadecimal color, or the theme's rule color.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum Color {
    /// A pen or highlighter name. Unknown names from newer versions are kept.
    Palette(Box<str>),
    /// `#rrggbb`.
    Rgb([u8; 3]),
    /// `#rrggbbaa`, where alpha is allowed.
    Rgba([u8; 4]),
    /// `rule`, the theme's rule color, for paper backgrounds.
    Rule,
}

impl Color {
    /// Reads a color. Hexadecimal digits may be uppercase; they are written in lowercase.
    pub fn parse(text: &str) -> Result<Color, ModelError> {
        let invalid = || ModelError::InvalidColor(text.to_owned());
        if text == "rule" {
            return Ok(Color::Rule);
        }
        if let Some(hex) = text.strip_prefix('#') {
            let bytes = parse_hex(hex).ok_or_else(invalid)?;
            return match *bytes.as_slice() {
                [r, g, b] => Ok(Color::Rgb([r, g, b])),
                [r, g, b, a] => Ok(Color::Rgba([r, g, b, a])),
                _ => Err(invalid()),
            };
        }
        let mut chars = text.chars();
        let starts_with_letter = chars.next().is_some_and(|c| c.is_ascii_lowercase());
        if starts_with_letter && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Ok(Color::Palette(text.into()));
        }
        Err(invalid())
    }

    /// The color as written in files.
    pub fn to_text(&self) -> String {
        match self {
            Color::Palette(name) => name.to_string(),
            Color::Rgb([r, g, b]) => format!("#{r:02x}{g:02x}{b:02x}"),
            Color::Rgba([r, g, b, a]) => format!("#{r:02x}{g:02x}{b:02x}{a:02x}"),
            Color::Rule => "rule".to_owned(),
        }
    }

    /// Whether this is one of the brand pen names, the colors the navigation tree offers as chips.
    pub fn is_pen(&self) -> bool {
        matches!(self, Color::Palette(name) if PEN_NAMES.contains(&&**name))
    }
}

fn parse_hex(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
        .collect()
}

impl Serialize for Color {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_text())
    }
}

impl<'de> Deserialize<'de> for Color {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Color, D::Error> {
        let text = String::deserialize(deserializer)?;
        Color::parse(&text).map_err(de::Error::custom)
    }
}

#[cfg(test)]
mod tests;
