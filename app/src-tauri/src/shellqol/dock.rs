//! Dock to a screen edge: OpenNote becomes a narrow column at the left or right edge of its screen through the
//! Windows app-bar API, so other windows resize to leave room. The same call undocks it and puts the window back
//! where it was. The docked width is kept in the choices (`dockWidth`, in logical pixels).

use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::{arg, opt, prefs};
use crate::ipc::{IpcError, IpcResult};

/// The narrowest docked column, in logical pixels.
pub const MIN_WIDTH: i32 = 280;
/// The width a first dock uses, in logical pixels.
pub const DEFAULT_WIDTH: i32 = 420;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Left,
    Right,
}

impl Edge {
    fn parse(text: &str) -> Option<Edge> {
        match text {
            "left" => Some(Edge::Left),
            "right" => Some(Edge::Right),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Edge::Left => "left",
            Edge::Right => "right",
        }
    }
}

/// A rectangle as (left, top, right, bottom) in physical pixels.
pub type Rect = (i32, i32, i32, i32);

/// The column an edge takes of a monitor: `width` wide, clamped to between `min` and half the monitor, and as tall
/// as the monitor.
pub fn column(monitor: Rect, edge: Edge, width: i32, min: i32) -> Rect {
    let (left, top, right, bottom) = monitor;
    let half = ((right - left) / 2).max(1);
    let width = width.clamp(min.min(half), half);
    match edge {
        Edge::Left => (left, top, left + width, bottom),
        Edge::Right => (right - width, top, right, bottom),
    }
}

struct Docked {
    edge: Edge,
    restore: Rect,
    was_maximized: bool,
}

static DOCKED: Mutex<Option<Docked>> = Mutex::new(None);

fn lock() -> std::sync::MutexGuard<'static, Option<Docked>> {
    DOCKED.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "dock.status" => Ok(status()),
        "dock.toggle" => {
            let edge: Option<String> = opt(args, "edge")?;
            let edge = edge.as_deref().and_then(Edge::parse).unwrap_or(Edge::Right);
            let docked = lock().is_some();
            if docked {
                undock(app)?;
            } else {
                dock(app, edge)?;
            }
            Ok(status())
        }
        "dock.setWidth" => {
            let width: i32 = arg(args, "width")?;
            let mut patch = Map::new();
            patch.insert("dockWidth".to_owned(), json!(width.max(MIN_WIDTH)));
            prefs::write(app, &patch)?;
            Ok(status())
        }
        _ => Err(IpcError::invalid("name", "isn't a dock call")),
    }
}

fn status() -> Value {
    match lock().as_ref() {
        Some(docked) => json!({ "docked": true, "edge": docked.edge.name() }),
        None => json!({ "docked": false, "edge": Value::Null }),
    }
}

#[cfg(windows)]
fn main_window(app: &AppHandle) -> IpcResult<tauri::WebviewWindow> {
    app.get_webview_window("main")
        .ok_or_else(|| IpcError::new(crate::ipc::codes::INTERNAL, "There is no main window."))
}

#[cfg(windows)]
mod imp {
    use std::{ffi::c_void, mem::size_of};

    use windows::Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::{
            Shell::{SHAppBarMessage, ABE_LEFT, ABE_RIGHT, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA},
            WindowsAndMessaging::{
                GetWindowRect, IsZoomed, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE, WM_APP,
            },
        },
    };

    use super::{column, Edge, Rect};

    pub fn handle(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    fn tuple(rect: RECT) -> Rect {
        (rect.left, rect.top, rect.right, rect.bottom)
    }

    fn rect(value: Rect) -> RECT {
        RECT {
            left: value.0,
            top: value.1,
            right: value.2,
            bottom: value.3,
        }
    }

    pub fn is_maximized(hwnd: HWND) -> bool {
        // SAFETY: `hwnd` names this app's window.
        unsafe { IsZoomed(hwnd).as_bool() }
    }

    pub fn window_rect(hwnd: HWND) -> Option<Rect> {
        let mut out = RECT::default();
        // SAFETY: `out` is a valid RECT for the call to fill.
        unsafe { GetWindowRect(hwnd, &mut out).ok()? };
        Some(tuple(out))
    }

    fn monitor(hwnd: HWND) -> Option<Rect> {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..MONITORINFO::default()
        };
        // SAFETY: `info` has its size set, and `hwnd` names this app's window.
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            GetMonitorInfoW(monitor, &mut info)
                .as_bool()
                .then(|| tuple(info.rcMonitor))
        }
    }

    fn bar(hwnd: HWND, edge: Edge, bounds: Rect) -> APPBARDATA {
        APPBARDATA {
            cbSize: size_of::<APPBARDATA>() as u32,
            hWnd: hwnd,
            uCallbackMessage: WM_APP + 0x31,
            uEdge: match edge {
                Edge::Left => ABE_LEFT,
                Edge::Right => ABE_RIGHT,
            },
            rc: rect(bounds),
            lParam: LPARAM(0),
        }
    }

    pub fn restore_if_maximized(hwnd: HWND) {
        // SAFETY: `hwnd` names this app's window.
        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
    }

    /// Registers the window as an app bar on the edge and moves it into its column.
    pub fn dock(hwnd: HWND, edge: Edge, width: i32, min: i32) -> Result<(), String> {
        let screen = monitor(hwnd).ok_or("There is no screen to dock to.")?;
        let wanted = column(screen, edge, width, min);
        let mut data = bar(hwnd, edge, wanted);
        // SAFETY: `data` is a fully set APPBARDATA that lives across each call, and `hwnd` names this app's window.
        unsafe {
            if SHAppBarMessage(ABM_NEW, &mut data) == 0 {
                return Err("Windows wouldn't dock the window.".to_owned());
            }
            SHAppBarMessage(ABM_QUERYPOS, &mut data);
            // The query may have moved the inner edge for other bars; keep the width.
            let got = tuple(data.rc);
            let span = wanted.2 - wanted.0;
            let fitted = match edge {
                Edge::Left => (got.0, got.1, got.0 + span, got.3),
                Edge::Right => (got.2 - span, got.1, got.2, got.3),
            };
            data.rc = rect(fitted);
            SHAppBarMessage(ABM_SETPOS, &mut data);
            let placed = tuple(data.rc);
            SetWindowPos(
                hwnd,
                None,
                placed.0,
                placed.1,
                placed.2 - placed.0,
                placed.3 - placed.1,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            .map_err(|error| error.to_string())
        }
    }

    pub fn undock(hwnd: HWND, edge: Edge, restore: Rect) {
        let mut data = bar(hwnd, edge, restore);
        // SAFETY: `data` is a fully set APPBARDATA, and `hwnd` names this app's window.
        unsafe {
            SHAppBarMessage(ABM_REMOVE, &mut data);
            let _ = SetWindowPos(
                hwnd,
                None,
                restore.0,
                restore.1,
                restore.2 - restore.0,
                restore.3 - restore.1,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(windows)]
fn dock(app: &AppHandle, edge: Edge) -> IpcResult<()> {
    let window = main_window(app)?;
    let hwnd = imp::handle(window.hwnd()?.0 as isize);
    let was_maximized = imp::is_maximized(hwnd);
    if was_maximized {
        imp::restore_if_maximized(hwnd);
    }
    let restore =
        imp::window_rect(hwnd).ok_or_else(|| IpcError::new("internal", "Couldn't read the window's place."))?;
    let logical = prefs::read(app)
        .get("dockWidth")
        .and_then(Value::as_i64)
        .map_or(DEFAULT_WIDTH, |width| width as i32);
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = (f64::from(logical) * scale).round() as i32;
    let min = (f64::from(MIN_WIDTH) * scale).round() as i32;
    imp::dock(hwnd, edge, width, min).map_err(|message| IpcError::new("internal", message))?;
    *lock() = Some(Docked {
        edge,
        restore,
        was_maximized,
    });
    Ok(())
}

#[cfg(windows)]
fn undock(app: &AppHandle) -> IpcResult<()> {
    let Some(docked) = lock().take() else {
        return Ok(());
    };
    let window = main_window(app)?;
    let hwnd = imp::handle(window.hwnd()?.0 as isize);
    // The column's width becomes the remembered docked width, so the next dock opens as wide.
    if let Some(now) = imp::window_rect(hwnd) {
        let scale = window.scale_factor().unwrap_or(1.0);
        let logical = (f64::from(now.2 - now.0) / scale).round() as i64;
        let mut patch = Map::new();
        patch.insert("dockWidth".to_owned(), json!(logical.max(i64::from(MIN_WIDTH))));
        let _ = prefs::write(app, &patch);
    }
    imp::undock(hwnd, docked.edge, docked.restore);
    if docked.was_maximized {
        let _ = window.maximize();
    }
    Ok(())
}

#[cfg(not(windows))]
fn dock(_app: &AppHandle, _edge: Edge) -> IpcResult<()> {
    Err(IpcError::not_implemented("Docking"))
}

#[cfg(not(windows))]
fn undock(_app: &AppHandle) -> IpcResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = (0, 0, 1920, 1080);

    #[test]
    fn a_column_hugs_its_edge_and_fills_the_height() {
        assert_eq!(column(SCREEN, Edge::Left, 420, 280), (0, 0, 420, 1080));
        assert_eq!(column(SCREEN, Edge::Right, 420, 280), (1500, 0, 1920, 1080));
    }

    #[test]
    fn a_column_stays_between_the_minimum_and_half_the_screen() {
        assert_eq!(column(SCREEN, Edge::Left, 100, 280).2, 280);
        assert_eq!(column(SCREEN, Edge::Right, 5000, 280).0, 960);
        assert_eq!(
            column((1920, 0, 3840, 1080), Edge::Left, 420, 280),
            (1920, 0, 2340, 1080)
        );
    }

    #[test]
    fn edges_parse_by_name() {
        assert_eq!(Edge::parse("left"), Some(Edge::Left));
        assert_eq!(Edge::parse("top"), None);
    }
}
