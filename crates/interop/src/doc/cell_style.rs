//! The look of a table cell from a table's `data.sheet` (spec 6.3, `R-SHT-7`), resolved for one cell, so the
//! exports draw cells as the spreadsheet does. The reader of `data.sheet` fills it; the document model only holds
//! it. A missing key means the default of `R-SHT-8`.

/// The resolved style of one cell.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CellStyle {
    /// The font of the whole cell. The marks of its runs go on top (`R-SHT-9`).
    pub font: CellFont,
    /// The background.
    pub fill: Option<Fill>,
    /// The borders.
    pub border: CellBorders,
    /// The alignment.
    pub align: CellAlign,
    /// The padding in points.
    pub pad: Pad,
}

// The numbers of a style come from the grammar of `data.sheet`, which has no NaN, so equality is total and the
// document tree can stay `Eq`.
impl Eq for CellStyle {}

/// The font of a cell.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CellFont {
    /// A font name or a theme token.
    pub family: Option<String>,
    /// Points, 1 to 1638.
    pub size: Option<f64>,
    /// 100 to 900. It wins over `bold`.
    pub weight: Option<u16>,
    /// Weight 700 when `true`, 400 when `false`.
    pub bold: Option<bool>,
    /// Italic.
    pub italic: Option<bool>,
    /// An underline style (Appendix D.5), an accounting style, or `none`.
    pub underline: Option<String>,
    /// `single`, `double`, or `none`.
    pub strike: Option<String>,
    /// A color (Appendix D.7).
    pub color: Option<String>,
    /// `super`, `sub`, or `none`.
    pub script: Option<String>,
}

/// The background of a cell.
#[derive(Clone, Debug, PartialEq)]
pub enum Fill {
    /// No fill, overriding a lower layer.
    None,
    /// One color.
    Color(String),
    /// An OOXML pattern, such as `gray125`, with its colors.
    Pattern {
        /// The pattern name.
        pattern: String,
        /// The color of the pattern.
        color: Option<String>,
        /// The background color.
        back: Option<String>,
    },
    /// A linear gradient.
    Gradient {
        /// The angle in degrees, 0 to 359.
        angle: u16,
        /// The stops: where, from 0 to 1, and the color there.
        stops: Vec<(f64, String)>,
    },
}

/// The borders of a cell. Each side replaces a lower layer's side whole.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CellBorders {
    /// Top.
    pub top: Option<CellBorder>,
    /// Right.
    pub right: Option<CellBorder>,
    /// Bottom.
    pub bottom: Option<CellBorder>,
    /// Left.
    pub left: Option<CellBorder>,
    /// The diagonal from the bottom left to the top right.
    pub diagonal_up: Option<CellBorder>,
    /// The diagonal from the top left to the bottom right.
    pub diagonal_down: Option<CellBorder>,
}

/// One border of a cell.
#[derive(Clone, Debug, PartialEq)]
pub struct CellBorder {
    /// One of the 13 OOXML names, such as `thin` or `double`, or `none`.
    pub style: String,
    /// The color, or `None` for the text color.
    pub color: Option<String>,
    /// The width in points, which wins over the width the style implies.
    pub width: Option<f64>,
}

/// The alignment of a cell's content.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CellAlign {
    /// `general`, `left`, `center`, `right`, `fill`, `justify`, `centerAcross`, or `distributed`.
    pub horizontal: Option<String>,
    /// `top`, `middle`, `bottom`, `justify`, or `distributed`.
    pub vertical: Option<String>,
    /// `wrap`, `overflow`, or `clip`.
    pub wrap: Option<String>,
    /// Whether the text shrinks to fit.
    pub shrink: Option<bool>,
    /// Degrees from -90 to 90, or `None` with `stacked` set.
    pub rotate: Option<i16>,
    /// Whether the letters are stacked.
    pub stacked: bool,
    /// Indent levels, 0 to 15, each 3 characters wide.
    pub indent: Option<u8>,
    /// `context`, `ltr`, or `rtl`.
    pub dir: Option<String>,
}

/// Padding in points.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pad {
    /// Top.
    pub top: Option<f64>,
    /// Right.
    pub right: Option<f64>,
    /// Bottom.
    pub bottom: Option<f64>,
    /// Left.
    pub left: Option<f64>,
}
