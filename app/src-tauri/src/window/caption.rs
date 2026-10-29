//! The caption layout the interface reports (ARCHITECTURE.md section 10.4). The interface measures its caption
//! buttons after every layout, zoom, text scale, density, maximize, and DPI change. It reports the Maximize
//! button's rectangle, so Rust never computes it and the Snap Layouts overlay always matches the HTML button.
//!
//! A report also says which frame the window needs. With `Some`, the page draws its own caption buttons and the
//! window drops the native frame. With `None`, the page draws none and the native frame comes back
//! ([`super::custom_frame`]). With `snapLayouts` set, [`super::snap_overlay`] puts a native window over Maximize
//! that answers `HTMAXBUTTON`, so hovering it opens the Windows 11 Snap Layouts flyout (section 10.5).

use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::ipc::{IpcError, IpcResult};

/// The longest caption button name the interface may report, in characters.
pub const MAX_LABEL_CHARS: usize = 100;

/// The largest coordinate or size accepted, in physical pixels. Larger values can't be a real window.
const MAX_PIXELS: f64 = 100_000.0;

/// A rectangle in physical pixels, relative to the client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    /// The rectangle scaled by `factor`, as a DPI change scales physical pixels.
    pub fn scaled(self, factor: f64) -> Rect {
        Rect {
            x: self.x * factor,
            y: self.y * factor,
            width: self.width * factor,
            height: self.height * factor,
        }
    }

    /// The whole pixels the rectangle covers: left, top, right, and bottom, each edge rounded to the nearest pixel,
    /// so neighboring rectangles never overlap or leave a gap.
    pub fn to_pixels(self) -> [i32; 4] {
        // The values are validated to lie within ±MAX_PIXELS, so the casts can't truncate.
        #[allow(clippy::cast_possible_truncation)]
        let round = |value: f64| value.round() as i32;
        [
            round(self.x),
            round(self.y),
            round(self.x + self.width),
            round(self.y + self.height),
        ]
    }

    fn is_valid(self) -> bool {
        let in_range = |value: f64| value.is_finite() && value.abs() <= MAX_PIXELS;
        [self.x, self.y, self.width, self.height].into_iter().all(in_range) && self.width >= 0.0 && self.height >= 0.0
    }
}

/// Where the Maximize button is, its accessible names, and whether the Snap Layouts overlay covers it, matching
/// the interface's `CaptionLayout`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionLayout {
    pub maximize: Rect,
    #[cfg_attr(test, ts(inline))]
    pub labels: CaptionLabels,
    /// The `window.snapLayouts` flag: put the native overlay over Maximize.
    pub snap_layouts: bool,
}

/// The overlay button's name when the window is restored or maximized, from the interface's strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CaptionLabels {
    pub maximize: String,
    pub restore: String,
}

impl CaptionLabels {
    /// The name for the button's current action: Restore while maximized, Maximize otherwise.
    pub fn for_state(&self, maximized: bool) -> &str {
        if maximized {
            &self.restore
        } else {
            &self.maximize
        }
    }
}

/// The payload of `window://caption-state`: the overlay's hover and pressed state, drawn by the HTML button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct CaptionState {
    pub hovered: bool,
    pub pressed: bool,
}

/// The overlay's state, managed by Tauri.
#[derive(Debug, Default)]
pub struct CaptionOverlay {
    /// `None` until the first report, then the last layout reported.
    reported: Mutex<Option<Option<CaptionLayout>>>,
}

impl CaptionOverlay {
    /// The last layout the interface reported, or `None` while it reports no caption buttons.
    pub fn layout(&self) -> Option<CaptionLayout> {
        self.reported
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .flatten()
    }

    /// Stores `layout`, and returns false when it equals the last report. The first report always counts, so the
    /// frame follows the page even when the window was created with the other frame.
    fn replace(&self, layout: Option<CaptionLayout>) -> bool {
        let mut reported = self.reported.lock().unwrap_or_else(PoisonError::into_inner);
        let changed = reported.as_ref() != Some(&layout);
        *reported = Some(layout);
        changed
    }

    /// Forgets every report, so the next one counts as the first. With `keep_layout`, a layout that the page
    /// reported stays, and nothing is forgotten. Returns whether it forgot.
    pub fn forget(&self, keep_layout: bool) -> bool {
        let mut reported = self.reported.lock().unwrap_or_else(PoisonError::into_inner);
        if keep_layout && reported.as_ref().is_some_and(Option::is_some) {
            return false;
        }
        *reported = None;
        true
    }
}

/// Registers the overlay's state. `lib.rs` calls it during setup.
pub fn init(app: &AppHandle) {
    app.manage(CaptionOverlay::default());
}

/// Checks a layout from the interface: finite rectangles of a size a window can have, and short names.
pub fn validate(layout: &CaptionLayout) -> IpcResult<()> {
    if !layout.maximize.is_valid() {
        return Err(IpcError::invalid(
            "layout.maximize",
            "The Maximize button's rectangle isn't a usable size.",
        ));
    }
    let labels = [&layout.labels.maximize, &layout.labels.restore];
    if labels
        .iter()
        .any(|label| label.trim().is_empty() || label.chars().count() > MAX_LABEL_CHARS)
    {
        return Err(IpcError::invalid(
            "layout.labels",
            "The caption button names must have 1 to 100 characters.",
        ));
    }
    Ok(())
}

/// Records the caption layout and applies it: the custom frame and the overlay for `Some`, the native frame for
/// `None`. Repeating the last layout does nothing.
#[tauri::command]
pub fn window_set_caption_layout(window: WebviewWindow, layout: Option<CaptionLayout>) -> IpcResult<()> {
    if let Some(layout) = &layout {
        validate(layout)?;
    }
    if !window.state::<CaptionOverlay>().replace(layout.clone()) {
        return Ok(());
    }
    super::custom_frame::apply(&window, layout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> CaptionLayout {
        CaptionLayout {
            maximize: Rect {
                x: 1611.0,
                y: 0.0,
                width: 69.0,
                height: 60.0,
            },
            labels: CaptionLabels {
                maximize: "Maximize".into(),
                restore: "Restore".into(),
            },
            snap_layouts: true,
        }
    }

    #[test]
    fn reads_the_interface_json() {
        let json = r#"{"maximize":{"x":1.5,"y":0,"width":69,"height":60},
            "labels":{"maximize":"Maximize","restore":"Restore"},"snapLayouts":false}"#;
        let parsed: CaptionLayout = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.maximize.x, 1.5);
        assert!(!parsed.snap_layouts);
        assert_eq!(parsed.labels.for_state(true), "Restore");
        assert_eq!(parsed.labels.for_state(false), "Maximize");
    }

    #[test]
    fn accepts_a_real_layout() {
        assert_eq!(validate(&layout()), Ok(()));
    }

    #[test]
    fn rejects_unusable_rectangles_and_names() {
        let mut bad = layout();
        bad.maximize.width = f64::NAN;
        assert_eq!(validate(&bad).unwrap_err().field.as_deref(), Some("layout.maximize"));
        bad = layout();
        bad.maximize.height = -1.0;
        assert!(validate(&bad).is_err());
        bad = layout();
        bad.maximize.x = 1e9;
        assert!(validate(&bad).is_err());
        bad = layout();
        bad.labels.restore = " ".into();
        assert_eq!(validate(&bad).unwrap_err().field.as_deref(), Some("layout.labels"));
        bad = layout();
        bad.labels.maximize = "x".repeat(MAX_LABEL_CHARS + 1);
        assert!(validate(&bad).is_err());
    }

    #[test]
    fn rounds_each_edge_so_neighbors_meet() {
        let left = Rect {
            x: 10.4,
            y: 0.0,
            width: 68.8,
            height: 59.6,
        };
        let right = Rect {
            x: 79.2,
            y: 0.0,
            width: 69.0,
            height: 59.6,
        };
        assert_eq!(left.to_pixels(), [10, 0, 79, 60]);
        assert_eq!(right.to_pixels()[0], left.to_pixels()[2]);
    }

    #[test]
    fn scales_with_a_dpi_change() {
        let rect = layout().maximize.scaled(2.0 / 1.5);
        assert_eq!(rect.to_pixels(), [2148, 0, 2240, 80]);
    }

    #[test]
    fn remembers_only_changes() {
        let overlay = CaptionOverlay::default();
        assert!(overlay.replace(Some(layout())));
        assert!(!overlay.replace(Some(layout())));
        assert_eq!(overlay.layout(), Some(layout()));
        assert!(overlay.replace(None));
        assert!(!overlay.replace(None));
        assert_eq!(overlay.layout(), None);
    }

    #[test]
    fn applies_the_first_report_even_without_caption_buttons() {
        assert!(CaptionOverlay::default().replace(None));
    }

    #[test]
    fn forgets_reports_so_the_next_one_applies() {
        let overlay = CaptionOverlay::default();
        // Before any report, and after a report of no caption buttons, there is nothing to keep.
        assert!(overlay.forget(true));
        assert!(overlay.replace(None));
        assert!(overlay.forget(true));
        assert!(overlay.replace(None));
        // A layout stays unless the page is gone.
        assert!(overlay.replace(Some(layout())));
        assert!(!overlay.forget(true));
        assert_eq!(overlay.layout(), Some(layout()));
        assert!(overlay.forget(false));
        assert_eq!(overlay.layout(), None);
        assert!(overlay.replace(Some(layout())));
    }
}
