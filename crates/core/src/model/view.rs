//! View settings of a page (spec 5.4): layout, mode, paper, and background.

use super::{named_enum, Color, JsonMap, Named};
use crate::id::BlockId;

named_enum! {
    /// How new blocks are placed (spec 5.4).
    #[derive(Default)]
    Layout {
        /// New blocks float anywhere, as in OneNote.
        #[default]
        Freeform = "freeform",
        /// New blocks stack like a document.
        Flow = "flow",
    }
}

named_enum! {
    /// Whether the page is one endless sheet or pages of paper.
    #[derive(Default)]
    ViewMode {
        /// One endless sheet.
        #[default]
        Infinite = "infinite",
        /// Sheets of paper.
        Paginated = "paginated",
    }
}

named_enum! {
    /// A paper size label for the interface. `Paper::width` and `height` are the truth.
    #[derive(Default)]
    PaperSize {
        /// A4.
        A4 = "a4",
        /// A5.
        A5 = "a5",
        /// US Letter.
        #[default]
        Letter = "letter",
        /// US Legal.
        Legal = "legal",
        /// Tabloid.
        Tabloid = "tabloid",
        /// Any other size.
        Custom = "custom",
    }
}

named_enum! {
    /// Paper orientation, a label for the interface.
    #[derive(Default)]
    Orientation {
        /// Taller than wide.
        #[default]
        Portrait = "portrait",
        /// Wider than tall.
        Landscape = "landscape",
    }
}

named_enum! {
    /// A paper background pattern.
    #[derive(Default)]
    Pattern {
        /// No pattern.
        #[default]
        Plain = "plain",
        /// Lines.
        Ruled = "ruled",
        /// A square grid.
        Grid = "grid",
        /// A dot grid.
        Dots = "dots",
        /// An isometric grid.
        Isometric = "isometric",
        /// Cornell note-taking layout.
        Cornell = "cornell",
        /// Music staff lines.
        Staff = "staff",
        /// A saved template.
        Template = "template",
    }
}

/// Layout, paper, and background (spec 5.4).
#[derive(Clone, Debug, PartialEq)]
pub struct PageView {
    /// How new blocks are placed.
    pub layout: Named<Layout>,
    /// Endless or paginated.
    pub mode: Named<ViewMode>,
    /// The paper.
    pub paper: Paper,
    /// The background pattern.
    pub background: Background,
    /// On flow pages, the width of the text column. `None` means the reading width.
    pub content_width: Option<f64>,
    /// Block IDs in the order screen readers read them (spec 6.2). Empty means the default order.
    pub reading_order: Vec<BlockId>,
    /// Unknown keys.
    pub extra: JsonMap,
}

impl Default for PageView {
    fn default() -> PageView {
        PageView {
            layout: Named::default(),
            mode: Named::default(),
            paper: Paper::default(),
            background: Background::default(),
            content_width: None,
            reading_order: Vec::new(),
            extra: JsonMap::new(),
        }
    }
}

/// The paper of a page.
#[derive(Clone, Debug, PartialEq)]
pub struct Paper {
    /// A label for the interface.
    pub size: Named<PaperSize>,
    /// A label for the interface.
    pub orientation: Named<Orientation>,
    /// The width in page units, as oriented.
    pub width: f64,
    /// The height in page units, as oriented.
    pub height: f64,
    /// Top, right, bottom, and left margins in page units.
    pub margins: [f64; 4],
    /// Unknown keys.
    pub extra: JsonMap,
}

impl Default for Paper {
    fn default() -> Paper {
        Paper {
            size: Named::default(),
            orientation: Named::default(),
            width: 816.0,
            height: 1_056.0,
            margins: [72.0; 4],
            extra: JsonMap::new(),
        }
    }
}

/// The background pattern of the paper.
#[derive(Clone, Debug, PartialEq)]
pub struct Background {
    /// The pattern.
    pub pattern: Named<Pattern>,
    /// Line or grid spacing in page units.
    pub spacing: f64,
    /// `Color::Rule`, a palette name, or a hexadecimal color.
    pub color: Color,
    /// Draws a margin line on ruled paper.
    pub margin_line: bool,
    /// The ID of a saved template, for the `template` pattern.
    pub template: Option<crate::id::Id>,
    /// Unknown keys.
    pub extra: JsonMap,
}

impl Default for Background {
    fn default() -> Background {
        Background {
            pattern: Named::default(),
            spacing: 26.46,
            color: Color::Rule,
            margin_line: false,
            template: None,
            extra: JsonMap::new(),
        }
    }
}
