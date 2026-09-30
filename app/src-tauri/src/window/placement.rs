//! The saved window placement (ARCHITECTURE.md section 8.5). Rust saves a `WINDOWPLACEMENT` on move, resize, and
//! close, and restores it before showing the window, moved onto the nearest monitor's work area when its
//! rectangle is no longer visible. The shell work package adds saving and restoring.

use serde::{Deserialize, Serialize};

/// The parts of `WINDOWPLACEMENT` the app keeps, matching the interface's `WindowPlacement`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    /// The `SW_*` show state, such as `SW_SHOWNORMAL` (1).
    pub show_cmd: u32,
    /// The restored rectangle: left, top, right, and bottom, in workspace coordinates.
    pub normal: [i32; 4],
}
