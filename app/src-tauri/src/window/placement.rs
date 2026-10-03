//! The saved window placement (ARCHITECTURE.md section 8.5). Rust saves a `WINDOWPLACEMENT` on move, resize, and
//! close, and restores it before showing the window, moved onto the nearest monitor's work area when its
//! rectangle is no longer visible.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::state::{DeviceStateStore, WindowState};

/// How long moves and resizes are folded together before the placement is saved.
pub const SAVE_DELAY: Duration = Duration::from_millis(400);

/// How much of a saved window must still be on a monitor for its position to be kept, in physical pixels. It
/// is enough of the title bar to grab: the width, and the height from the top edge.
const MIN_VISIBLE: (i32, i32) = (120, 48);

/// `SW_SHOWNORMAL` and `SW_SHOWMAXIMIZED`.
const SHOW_NORMAL: u32 = 1;
const SHOW_MAXIMIZED: u32 = 3;

/// The parts of `WINDOWPLACEMENT` the app keeps, matching the interface's `WindowPlacement`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct WindowPlacement {
    /// The `SW_*` show state, such as `SW_SHOWNORMAL` (1).
    pub show_cmd: u32,
    /// The restored rectangle: left, top, right, and bottom, in workspace coordinates.
    pub normal: [i32; 4],
}

/// A rectangle as left, top, right, and bottom.
pub type Edges = [i32; 4];

fn width(rect: Edges) -> i32 {
    rect[2] - rect[0]
}

fn height(rect: Edges) -> i32 {
    rect[3] - rect[1]
}

/// Whether `rect` can still be grabbed: enough of its width is over the work area, and its top edge is too.
pub fn is_reachable(rect: Edges, work: Edges) -> bool {
    let overlap_width = rect[2].min(work[2]) - rect[0].max(work[0]);
    overlap_width >= MIN_VISIBLE.0.min(width(rect)) && rect[1] >= work[1] && rect[1] <= work[3] - MIN_VISIBLE.1
}

/// Moves `rect` into `work`, making it smaller first when it doesn't fit.
pub fn fit_into(rect: Edges, work: Edges) -> Edges {
    let (w, h) = (width(rect).min(width(work)), height(rect).min(height(work)));
    let left = rect[0].clamp(work[0], work[2] - w);
    let top = rect[1].clamp(work[1], work[3] - h);
    [left, top, left + w, top + h]
}

/// The rectangle to restore: the saved one if it's still reachable, otherwise moved into the work area.
pub fn restored_rect(saved: Edges, work: Edges) -> Edges {
    if is_reachable(saved, work) {
        saved
    } else {
        fit_into(saved, work)
    }
}

/// Reads the window's placement, or `None` while it can't be read.
#[cfg(windows)]
pub fn capture(window: &WebviewWindow) -> Option<WindowPlacement> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT};

    let hwnd = window.hwnd().ok()?;
    let mut placement = WINDOWPLACEMENT {
        length: u32::try_from(std::mem::size_of::<WINDOWPLACEMENT>()).ok()?,
        ..WINDOWPLACEMENT::default()
    };
    // SAFETY: `hwnd` is this process's window, and `placement` is a local with its length set.
    unsafe { GetWindowPlacement(hwnd, &mut placement).ok()? };
    let r = placement.rcNormalPosition;
    // A minimized window reopens restored, not minimized.
    let show_cmd = if placement.showCmd == SHOW_MAXIMIZED {
        SHOW_MAXIMIZED
    } else {
        SHOW_NORMAL
    };
    Some(WindowPlacement {
        show_cmd,
        normal: [r.left, r.top, r.right, r.bottom],
    })
}

#[cfg(not(windows))]
pub fn capture(_window: &WebviewWindow) -> Option<WindowPlacement> {
    None
}

/// Applies a saved placement to the window, which also shows it the way it was (normal or maximized). The
/// rectangle is moved onto the nearest monitor's work area when it is no longer visible. Returns false when
/// there was nothing to apply or it failed, so the caller shows the window at its default place.
#[cfg(windows)]
pub fn restore(window: &WebviewWindow, saved: &WindowPlacement) -> bool {
    use windows::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::WindowsAndMessaging::{SetWindowPlacement, WINDOWPLACEMENT},
    };

    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let [left, top, right, bottom] = saved.normal;
    let rect = RECT {
        left,
        top,
        right,
        bottom,
    };
    let mut info = MONITORINFO {
        cbSize: u32::try_from(std::mem::size_of::<MONITORINFO>()).unwrap_or(0),
        ..MONITORINFO::default()
    };
    // SAFETY: `rect` and `info` are locals with their sizes set, and the monitor handle comes from Windows.
    let has_monitor = unsafe {
        let monitor = MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(monitor, &mut info).as_bool()
    };
    if !has_monitor {
        return false;
    }
    // Workspace coordinates start at the primary work area's corner, so the saved rectangle moves by how far the
    // taskbar pushed that corner from the screen's.
    let (offset_x, offset_y) = workspace_offset();
    let work = [
        info.rcWork.left - offset_x,
        info.rcWork.top - offset_y,
        info.rcWork.right - offset_x,
        info.rcWork.bottom - offset_y,
    ];
    let [left, top, right, bottom] = restored_rect(saved.normal, work);
    let placement = WINDOWPLACEMENT {
        length: u32::try_from(std::mem::size_of::<WINDOWPLACEMENT>()).unwrap_or(0),
        showCmd: saved.show_cmd,
        rcNormalPosition: RECT {
            left,
            top,
            right,
            bottom,
        },
        ..WINDOWPLACEMENT::default()
    };
    // SAFETY: `hwnd` is this process's window and `placement` is a local with its length set.
    unsafe { SetWindowPlacement(hwnd, &placement).is_ok() }
}

#[cfg(not(windows))]
pub fn restore(_window: &WebviewWindow, _saved: &WindowPlacement) -> bool {
    false
}

/// How far the primary monitor's work area starts from the screen's corner (a taskbar on the top or left).
#[cfg(windows)]
fn workspace_offset() -> (i32, i32) {
    use windows::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY},
    };

    let mut info = MONITORINFO {
        cbSize: u32::try_from(std::mem::size_of::<MONITORINFO>()).unwrap_or(0),
        ..MONITORINFO::default()
    };
    // SAFETY: `info` is a local with its size set.
    let read = unsafe {
        let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        GetMonitorInfoW(primary, &mut info).as_bool()
    };
    if read {
        (
            info.rcWork.left - info.rcMonitor.left,
            info.rcWork.top - info.rcMonitor.top,
        )
    } else {
        (0, 0)
    }
}

/// Saves the main window's placement and maximized state now.
pub fn save_now(app: &AppHandle) {
    let Some(window) = app.get_webview_window(super::MAIN) else {
        return;
    };
    let Some(placement) = capture(&window) else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    app.state::<DeviceStateStore>().set_window(&WindowState {
        placement: Some(placement),
        maximized,
    });
}

/// Folds the many move and resize events of one drag into one save.
#[derive(Clone, Default)]
pub struct Saver {
    pending: Arc<AtomicBool>,
}

impl Saver {
    /// Saves the placement shortly, unless a save is already waiting.
    pub fn schedule(&self, app: &AppHandle) {
        if self.pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let (pending, app) = (Arc::clone(&self.pending), app.clone());
        thread::spawn(move || {
            thread::sleep(SAVE_DELAY);
            pending.store(false, Ordering::Release);
            save_now(&app);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Edges = [0, 0, 1920, 1040];

    #[test]
    fn keeps_a_window_that_is_still_on_the_monitor() {
        let saved = [100, 80, 1380, 880];
        assert_eq!(restored_rect(saved, WORK), saved);
    }

    #[test]
    fn keeps_a_window_partly_off_the_edge_when_its_title_bar_is_reachable() {
        let saved = [1700, 100, 2980, 900];
        assert!(is_reachable(saved, WORK));
        assert_eq!(restored_rect(saved, WORK), saved);
    }

    #[test]
    fn moves_a_window_from_a_monitor_that_is_gone() {
        // It was on a second monitor to the right, which is unplugged.
        let saved = [2000, 100, 3280, 900];
        assert!(!is_reachable(saved, WORK));
        assert_eq!(restored_rect(saved, WORK), [640, 100, 1920, 900]);
    }

    #[test]
    fn shrinks_a_window_larger_than_the_work_area() {
        let saved = [-50, -20, 2500, 1500];
        assert_eq!(fit_into(saved, WORK), [0, 0, 1920, 1040]);
    }

    #[test]
    fn a_window_above_the_work_area_comes_down() {
        let saved = [100, -600, 1380, 200];
        assert!(!is_reachable(saved, WORK));
        assert_eq!(restored_rect(saved, WORK), [100, 0, 1380, 800]);
    }

    #[test]
    fn reads_the_saved_shape() {
        let saved: WindowPlacement =
            serde_json::from_str(r#"{"showCmd":3,"normal":[10,20,1290,820]}"#).expect("parses");
        assert_eq!(saved.show_cmd, SHOW_MAXIMIZED);
        assert_eq!(saved.normal, [10, 20, 1290, 820]);
    }
}
