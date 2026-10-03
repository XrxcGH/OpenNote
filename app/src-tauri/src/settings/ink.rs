//! The `ink` settings group and the ink device state that Phase 5 reads (Phase 5 architecture sections 17.1 and
//! 17.2, change P2-3). Settings hold the pens and how tools behave, and roam with the person. The device state
//! holds what depends on this device's pens and screens. Both were added with defaults, so no version changes.
//! Phase 5 owns this file from here on.

use serde::{Deserialize, Serialize};

use super::validate::{self, Check};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct InkSettings {
    pub pens: Vec<PenSlot>,
    pub pen_selects_and_types: bool,
    pub handedness: Handedness,
    #[cfg_attr(test, ts(inline))]
    pub touch: TouchInk,
    #[cfg_attr(test, ts(inline))]
    pub eraser: Eraser,
    #[cfg_attr(test, ts(inline))]
    pub lasso: Lasso,
    #[cfg_attr(test, ts(inline))]
    pub shapes: Shapes,
    #[cfg_attr(test, ts(inline))]
    pub gestures: Gestures,
    pub anchor_to_text: bool,
    #[cfg_attr(test, ts(inline))]
    pub zoom_box: ZoomBox,
    pub contrast_ink: ContrastInk,
    pub low_latency: LowLatency,
}

impl Default for InkSettings {
    fn default() -> Self {
        let pen = |id: &str, tool, color: &str, width| PenSlot {
            id: id.into(),
            tool,
            color: color.into(),
            width,
            pressure: (tool != PenTool::Highlighter).then_some(true),
        };
        Self {
            pens: vec![
                pen("p1", PenTool::Pen, "ink", 0.5),
                pen("p2", PenTool::Pen, "indigo", 0.5),
                pen("p3", PenTool::Pen, "brick", 0.5),
                pen("p4", PenTool::Pen, "fern", 0.7),
                pen("p5", PenTool::Pencil, "walnut", 0.7),
                pen("h1", PenTool::Highlighter, "honey", 4.0),
                pen("h2", PenTool::Highlighter, "mint", 4.0),
            ],
            pen_selects_and_types: false,
            handedness: Handedness::Right,
            touch: TouchInk::default(),
            eraser: Eraser::default(),
            lasso: Lasso::default(),
            shapes: Shapes::default(),
            gestures: Gestures::default(),
            anchor_to_text: true,
            zoom_box: ZoomBox::default(),
            contrast_ink: ContrastInk::KeepLegible,
            low_latency: LowLatency::Auto,
        }
    }
}

impl InkSettings {
    /// The most pen slots the palette holds.
    pub const MAX_PENS: usize = 32;

    pub fn check(&self, check: &mut Check) {
        let pens = &self.pens;
        check.that(
            "ink.pens",
            (1..=Self::MAX_PENS).contains(&pens.len()),
            "There must be 1 to 32 pens.",
        );
        for (index, pen) in pens.iter().enumerate() {
            let unique = pens[..index].iter().all(|other| other.id != pen.id);
            check.that("ink.pens", unique, "Two pens have the same id.");
            check.chars("ink.pens", &pen.id, (1, 32));
            check.range("ink.pens", pen.width, (0.1, 20.0));
            let highlighter = pen.tool == PenTool::Highlighter;
            check.that(
                "ink.pens",
                validate::ink_color(&pen.color, highlighter),
                "A pen's color isn't valid.",
            );
        }
        check.range(
            "ink.touch.palmGraceMs",
            f64::from(self.touch.palm_grace_ms),
            (300.0, 2_000.0),
        );
        check.range("ink.shapes.holdMs", f64::from(self.shapes.hold_ms), (300.0, 1_500.0));
        check.that(
            "ink.eraser.size",
            [1, 2, 4, 8, 16].contains(&self.eraser.size),
            "The eraser size is 1, 2, 4, 8, or 16 mm.",
        );
        let picks = &self.lasso.picks;
        let distinct = picks.iter().enumerate().all(|(i, pick)| !picks[..i].contains(pick));
        check.that("ink.lasso.picks", distinct, "The lasso lists a kind twice.");
        check.that(
            "ink.zoomBox.magnification",
            (2..=4).contains(&self.zoom_box.magnification),
            "The zoom box magnifies 2, 3, or 4 times.",
        );
    }
}

/// A slot on the pen palette.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct PenSlot {
    pub id: String,
    pub tool: PenTool,
    /// A palette name, or `#rrggbb` (`#rrggbbaa` for highlighters), as in spec section 2.7.
    pub color: String,
    /// The nominal width in millimeters, 0.1 to 20.
    pub width: f64,
    /// Whether pressure changes the width. Highlighters have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub pressure: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PenTool {
    Pen,
    Pencil,
    Highlighter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum Handedness {
    #[default]
    Right,
    Left,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TouchInk {
    /// Draw with a finger when no pen is near.
    pub draws: bool,
    /// How long a touch stroke waits for a pen before it's committed, 300 to 2,000 ms.
    pub palm_grace_ms: u32,
    pub two_finger_scroll_near_pen: bool,
}

impl Default for TouchInk {
    fn default() -> Self {
        Self {
            draws: false,
            palm_grace_ms: 500,
            two_finger_scroll_near_pen: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Eraser {
    #[cfg_attr(test, ts(inline))]
    pub mode: EraserMode,
    /// The partial eraser's size in millimeters: 1, 2, 4, 8, or 16.
    pub size: u8,
    #[cfg_attr(test, ts(inline))]
    pub erases: Erases,
    pub return_to_last_tool: bool,
    pub show_target: bool,
}

impl Default for Eraser {
    fn default() -> Self {
        Self {
            mode: EraserMode::Stroke,
            size: 4,
            erases: Erases::All,
            return_to_last_tool: false,
            show_target: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum EraserMode {
    #[default]
    Stroke,
    Partial,
}

/// What the eraser removes: all ink, only highlighter, only pens (pen and pencil), or one tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Erases {
    #[default]
    All,
    Highlighter,
    Pens,
    Pen,
    Pencil,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Lasso {
    #[cfg_attr(test, ts(inline))]
    pub shape: LassoShape,
    pub picks: Vec<LassoPick>,
    #[cfg_attr(test, ts(inline))]
    pub inside: LassoInside,
}

impl Default for Lasso {
    fn default() -> Self {
        Self {
            shape: LassoShape::Free,
            picks: vec![
                LassoPick::Ink,
                LassoPick::Highlighter,
                LassoPick::Text,
                LassoPick::Images,
                LassoPick::Shapes,
            ],
            inside: LassoInside::Mostly,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum LassoShape {
    #[default]
    Free,
    Rectangle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum LassoPick {
    Ink,
    Highlighter,
    Text,
    Images,
    Shapes,
}

/// How much of something must be inside the lasso to be picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum LassoInside {
    #[default]
    Mostly,
    Any,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Shapes {
    /// Holding still at the end of a stroke snaps it to a shape.
    pub hold: bool,
    /// How long to hold, 300 to 1,500 ms.
    pub hold_ms: u32,
    pub ink_to_shape: bool,
}

impl Default for Shapes {
    fn default() -> Self {
        Self {
            hold: true,
            hold_ms: 500,
            ink_to_shape: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Gestures {
    pub scribble_erase: bool,
    pub circle_select: bool,
    pub two_finger_undo: bool,
    pub three_finger_redo: bool,
}

impl Default for Gestures {
    fn default() -> Self {
        Self {
            scribble_erase: true,
            circle_select: true,
            two_finger_undo: true,
            three_finger_redo: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ZoomBox {
    /// 2, 3, or 4 times.
    pub magnification: u8,
    pub auto_advance: bool,
}

impl Default for ZoomBox {
    fn default() -> Self {
        Self {
            magnification: 3,
            auto_advance: true,
        }
    }
}

/// Ink under a Windows contrast theme: keep pen colors that stand out, or use the theme's text color.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum ContrastInk {
    #[default]
    KeepLegible,
    TextColor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum LowLatency {
    #[default]
    Auto,
    On,
    Off,
}

/// The ink device state lives in its own file to keep each under the length limit.
pub use super::ink_device::{
    curve_rises, BarrelAction, EraserEndAction, InkDeviceState, InkTool, PaletteDock, PaletteState, PenCurve, PenDevice,
};

#[cfg(test)]
#[path = "ink_tests.rs"]
mod tests;
