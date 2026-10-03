//! The Snap Layouts overlay over the Maximize button, behind the `window.snapLayouts` flag (ARCHITECTURE.md
//! section 10.5). The interface reports the button's rectangle after every layout change, and Rust keeps it, so
//! the overlay always matches the HTML button. The layout work package builds the overlay after its spike.

use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::ipc::IpcResult;

/// A rectangle in physical pixels, relative to the client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Where the Maximize button is, and its accessible names, matching the interface's `CaptionLayout`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct CaptionLayout {
    pub maximize: Rect,
    #[cfg_attr(test, ts(inline))]
    pub labels: CaptionLabels,
}

/// The overlay button's name when the window is restored or maximized, from the interface's strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CaptionLabels {
    pub maximize: String,
    pub restore: String,
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
    layout: Mutex<Option<CaptionLayout>>,
}

impl CaptionOverlay {
    /// The last layout the interface reported, or `None` while it reports no caption buttons.
    pub fn layout(&self) -> Option<CaptionLayout> {
        self.layout.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

/// Registers the overlay's state. `lib.rs` calls it during setup.
pub fn init(app: &AppHandle) {
    app.manage(CaptionOverlay::default());
}

/// Records the Maximize button's rectangle, or `None` when the title bar has no caption buttons.
#[tauri::command]
pub fn window_set_caption_layout(window: WebviewWindow, layout: Option<CaptionLayout>) -> IpcResult<()> {
    let overlay = window.state::<CaptionOverlay>();
    *overlay.layout.lock().unwrap_or_else(PoisonError::into_inner) = layout;
    Ok(())
}
