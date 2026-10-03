//! The main window's subclass for the custom frame (ARCHITECTURE.md section 10). It reports maximize and restore
//! to the interface as `window://maximized`, and keeps the Snap Layouts overlay's name and z-order in step with
//! them. When the window moves to a monitor with another DPI, it scales the overlay at once. The page's
//! `devicePixelRatio` changes too, so the page then reports the exact layout.
//!
//! Hit testing isn't here: the WebView2 window covers the client area, so the main window never receives
//! `WM_NCHITTEST` for it. WebView2 answers `app-region: drag` itself, Tauri answers the resize borders, and the
//! overlay answers Maximize.

use std::cell::Cell;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{IsZoomed, SIZE_MAXIMIZED, SIZE_MINIMIZED, WM_DPICHANGED, WM_NCDESTROY, WM_SIZE},
    },
};

use super::{resize_border, snap_overlay};
use crate::events;

/// Identifies this subclass among the window's others ("ONFR").
const SUBCLASS_ID: usize = 0x4F4E_4652;

struct Data {
    app: AppHandle,
    label: String,
    maximized: Cell<bool>,
    dpi: Cell<u32>,
}

impl Data {
    fn emit_maximized(&self) {
        if let Err(error) = self
            .app
            .emit_to(self.label.as_str(), events::WINDOW_MAXIMIZED, self.maximized.get())
        {
            log::warn!("Couldn't send the maximized state: {error}");
        }
    }
}

/// Subclasses the main window once, and sends its current maximized state so the page starts in step.
pub fn install(window: &WebviewWindow, hwnd: HWND) {
    // SAFETY: `hwnd` is this process's live main window, and this runs on the thread that owns it, as
    // `SetWindowSubclass` requires. The data box lives until `WM_NCDESTROY`, where the procedure frees it.
    unsafe {
        let mut existing = 0;
        if GetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, Some(&mut existing)).as_bool() {
            return;
        }
        let data = Box::into_raw(Box::new(Data {
            app: window.app_handle().clone(),
            label: window.label().to_owned(),
            maximized: Cell::new(IsZoomed(hwnd).as_bool()),
            dpi: Cell::new(GetDpiForWindow(hwnd)),
        }));
        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, data as usize).as_bool() {
            drop(Box::from_raw(data));
            log::warn!("Couldn't subclass the main window for the custom frame.");
            return;
        }
        (*data).emit_maximized();
    }
}

/// The DPI in the low word of `WM_DPICHANGED`'s `wparam`.
fn dpi_from(wparam: WPARAM) -> u32 {
    // Masked to 16 bits, so the value always fits.
    #[allow(clippy::cast_possible_truncation)]
    let dpi = (wparam.0 & 0xFFFF) as u32;
    dpi
}

impl Data {
    /// After a resize: reports a change between maximized and restored, and updates the overlay.
    fn resized(&self, hwnd: HWND, kind: WPARAM) {
        let kind = u32::try_from(kind.0).unwrap_or(u32::MAX);
        if kind == SIZE_MINIMIZED {
            return;
        }
        let maximized = kind == SIZE_MAXIMIZED;
        if self.maximized.replace(maximized) != maximized {
            self.emit_maximized();
        }
        snap_overlay::parent_changed(hwnd);
        resize_border::install(hwnd);
    }

    /// After a DPI change: scales the overlay by the ratio of the new DPI to the old one.
    fn dpi_changed(&self, hwnd: HWND, wparam: WPARAM) {
        let dpi = dpi_from(wparam);
        let old = self.dpi.replace(dpi);
        if old != 0 && dpi != old {
            snap_overlay::scale(hwnd, f64::from(dpi) / f64::from(old));
        }
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    // SAFETY: Windows calls this on the window's thread with the pointer `install` stored, which stays valid until
    // `WM_NCDESTROY` below frees it and removes the subclass.
    unsafe {
        if msg == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            drop(Box::from_raw(data as *mut Data));
            return DefSubclassProc(hwnd, msg, wparam, lparam);
        }
        let data = &*(data as *const Data);
        let result = DefSubclassProc(hwnd, msg, wparam, lparam);
        match msg {
            WM_SIZE => data.resized(hwnd, wparam),
            WM_DPICHANGED => data.dpi_changed(hwnd, wparam),
            _ => {}
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_new_dpi_from_the_low_word() {
        assert_eq!(dpi_from(WPARAM((144 << 16) | 144)), 144);
        assert_eq!(dpi_from(WPARAM(192)), 192);
    }
}
