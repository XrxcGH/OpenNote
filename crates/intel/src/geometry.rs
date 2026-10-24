//! Shapes shared by the engines: rectangles and language tags.

use serde::{Deserialize, Serialize};

use crate::error::IntelError;

/// An axis-aligned rectangle, with the origin at the top left and y growing downward.
///
/// For OCR the unit is image pixels. For ink it is the page units of the strokes that went in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Left edge.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width, never negative.
    pub width: f32,
    /// Height, never negative.
    pub height: f32,
}

impl Rect {
    /// The right edge.
    pub fn right(&self) -> f32 {
        self.x + self.width
    }

    /// The bottom edge.
    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }

    /// The smallest rectangle that holds both.
    pub fn union(&self, other: &Rect) -> Rect {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        Rect {
            x,
            y,
            width: self.right().max(other.right()) - x,
            height: self.bottom().max(other.bottom()) - y,
        }
    }

    /// The smallest rectangle that holds every rectangle, or `None` for an empty list.
    pub fn union_all<'a>(rects: impl IntoIterator<Item = &'a Rect>) -> Option<Rect> {
        rects.into_iter().copied().reduce(|a, b| a.union(&b))
    }
}

/// A language as a BCP 47 tag, such as `en-US`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Language(String);

impl Language {
    /// Wraps a tag after a light check: letters, digits, and hyphens, between 2 and 35 characters.
    pub fn new(tag: &str) -> Result<Language, IntelError> {
        let valid_chars = tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if valid_chars && (2..=35).contains(&tag.len()) {
            Ok(Language(tag.to_owned()))
        } else {
            Err(IntelError::InvalidInput(format!("\"{tag}\" is not a language tag")))
        }
    }

    /// The tag.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The part before the first hyphen, such as `en` for `en-US`, in lowercase.
    pub fn primary(&self) -> String {
        self.0.split('-').next().unwrap_or_default().to_ascii_lowercase()
    }
}

impl std::fmt::Display for Language {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn union_covers_both_rectangles() {
        let a = Rect {
            x: 10.0,
            y: 10.0,
            width: 5.0,
            height: 5.0,
        };
        let b = Rect {
            x: 0.0,
            y: 12.0,
            width: 4.0,
            height: 20.0,
        };
        let u = a.union(&b);
        assert_eq!((u.x, u.y, u.right(), u.bottom()), (0.0, 10.0, 15.0, 32.0));
        assert_eq!(Rect::union_all(&[]), None);
    }

    #[test]
    fn language_tags_are_checked() {
        assert_eq!(Language::new("en-US").unwrap().primary(), "en");
        assert!(Language::new("").is_err());
        assert!(Language::new("en US").is_err());
    }
}
