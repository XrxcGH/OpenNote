//! The ink part of the device state (Phase 5 architecture section 17.2, change P2-3). It holds each pen's
//! pressure curve and buttons, keyed by the pen's `persistentDeviceId` or `default`. It also holds where the
//! pen palette sits and the last tool. It depends on this device's pens and screens, so it stays in `state.json`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::validate::Check;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct InkDeviceState {
    /// Settings per pen, by `PointerEvent.persistentDeviceId`, or `default` for pens that report none.
    pub pens: BTreeMap<String, PenDevice>,
    pub palette: PaletteState,
    pub last_tool: InkTool,
    /// The id of the last pen slot used.
    pub last_pen: Option<String>,
    pub zoom_box_open: bool,
    /// This device's digitizer reports no hover.
    pub no_hover_pen: bool,
}

impl Default for InkDeviceState {
    fn default() -> Self {
        Self {
            pens: BTreeMap::from([("default".to_owned(), PenDevice::default())]),
            palette: PaletteState::default(),
            last_tool: InkTool::Pen,
            last_pen: Some("p2".into()),
            zoom_box_open: false,
            no_hover_pen: false,
        }
    }
}

impl InkDeviceState {
    pub fn check(&self, check: &mut Check) {
        check.that("ink.pens", self.pens.len() <= 64, "Too many pens are remembered.");
        for (id, pen) in &self.pens {
            check.chars("ink.pens", id, (1, 64));
            check.range("ink.pens", pen.min_width, (0.0, 0.6));
            check.that("ink.pens", pen.steady <= 10, "The steady pen goes from 0 to 10.");
            if let Some(curve) = pen.custom_curve {
                check.that("ink.pens", curve_rises(curve), "The pressure curve must never go down.");
            }
        }
        let wide = &self.palette.wide;
        check.range("ink.palette.wide.x", wide.x, (0.0, 1.0));
        check.range("ink.palette.wide.y", wide.y, (0.0, 1.0));
        if let Some(pen) = &self.last_pen {
            check.chars("ink.lastPen", pen, (1, 32));
        }
    }
}

/// True when the cubic Bézier from (0, 0) through the control points `[x1, y1, x2, y2]` to (1, 1) keeps its
/// control points in the unit square and never goes down or back.
pub fn curve_rises([x1, y1, x2, y2]: [f64; 4]) -> bool {
    let inside = [x1, y1, x2, y2]
        .iter()
        .all(|v| v.is_finite() && (0.0..=1.0).contains(v));
    let point = |t: f64, a: f64, b: f64| {
        let u = 1.0 - t;
        3.0 * u * u * t * a + 3.0 * u * t * t * b + t * t * t
    };
    let samples: Vec<(f64, f64)> = (0..=64)
        .map(|i| f64::from(i) / 64.0)
        .map(|t| (point(t, x1, x2), point(t, y1, y2)))
        .collect();
    inside
        && samples
            .windows(2)
            .all(|pair| pair[1].0 >= pair[0].0 - 1e-9 && pair[1].1 >= pair[0].1 - 1e-9)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct PenDevice {
    pub curve: PenCurve,
    /// The control points `[x1, y1, x2, y2]` of a custom curve.
    #[cfg_attr(test, ts(type = "[number, number, number, number] | null"))]
    pub custom_curve: Option<[f64; 4]>,
    /// The thinnest a light stroke gets, as a fraction of the nominal width, 0 to 0.6.
    pub min_width: f64,
    /// The steady pen's strength, 0 (off) to 10.
    pub steady: u8,
    pub barrel: BarrelAction,
    pub eraser_end: EraserEndAction,
}

impl Default for PenDevice {
    fn default() -> Self {
        Self {
            curve: PenCurve::Normal,
            custom_curve: None,
            min_width: 0.2,
            steady: 0,
            barrel: BarrelAction::Lasso,
            eraser_end: EraserEndAction::StrokeEraser,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PenCurve {
    Soft,
    #[default]
    Normal,
    Firm,
    Custom,
}

/// What the pen's barrel button does at contact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum BarrelAction {
    #[default]
    Lasso,
    StrokeEraser,
    PartialEraser,
    LastHighlighter,
    Pan,
    RightClick,
    Nothing,
}

/// What the pen's eraser end does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum EraserEndAction {
    #[default]
    StrokeEraser,
    PartialEraser,
    HighlighterEraser,
    Nothing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct PaletteState {
    #[cfg_attr(test, ts(inline))]
    pub wide: WidePalette,
    #[cfg_attr(test, ts(inline))]
    pub compact: CompactPalette,
    pub shown: bool,
    /// A pen has been seen on this device, so the palette offers pen tools.
    pub pen_seen: bool,
}

impl Default for PaletteState {
    fn default() -> Self {
        Self {
            wide: WidePalette::default(),
            compact: CompactPalette::default(),
            shown: true,
            pen_seen: false,
        }
    }
}

/// Where the palette sits in the wider size classes: a dock, or floating at fractions of the page pane.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct WidePalette {
    pub dock: PaletteDock,
    pub x: f64,
    pub y: f64,
    pub collapsed: bool,
}

impl Default for WidePalette {
    fn default() -> Self {
        Self {
            dock: PaletteDock::Float,
            x: 0.5,
            y: 1.0,
            collapsed: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CompactPalette {
    pub dock: PaletteDock,
    pub collapsed: bool,
}

impl Default for CompactPalette {
    fn default() -> Self {
        Self {
            dock: PaletteDock::BottomBar,
            collapsed: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PaletteDock {
    #[default]
    Float,
    Top,
    Bottom,
    Left,
    Right,
    BottomBar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum InkTool {
    Select,
    #[default]
    Pen,
    Pencil,
    Highlighter,
    Eraser,
    Lasso,
    Pan,
    InsertSpace,
}
