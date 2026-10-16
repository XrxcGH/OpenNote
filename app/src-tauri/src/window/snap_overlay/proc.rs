//! The overlay's window procedure: hit testing, hover and pressed state, clicks, the system menu, and UI
//! Automation.

use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::ClientToScreen,
    UI::{
        Accessibility::{
            IRawElementProviderSimple, UiaDisconnectProvider, UiaReturnRawElementProvider, UiaRootObjectId,
        },
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
        WindowsAndMessaging::{
            DefWindowProcW, GetWindowLongPtrW, IsZoomed, PostMessageW, SetWindowLongPtrW, GWLP_USERDATA, GWL_STYLE,
            HTMAXBUTTON, HTTOP, SC_MAXIMIZE, SC_RESTORE, SM_CYFRAME, WM_DESTROY, WM_GETOBJECT, WM_NCDESTROY,
            WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE,
            WM_NCRBUTTONDOWN, WM_NCRBUTTONUP, WM_SYSCOMMAND, WS_SIZEBOX,
        },
    },
};

use super::{overlay_of, Overlay, WM_OVERLAY_INVOKE};
use crate::window::system_menu;

/// What a point over the overlay is: the top resize border of a restored, resizable window, or Maximize.
pub fn hit_test(point_y: i32, client_top: i32, border: i32, resizable: bool, maximized: bool) -> u32 {
    if resizable && !maximized && point_y < client_top + border {
        HTTOP
    } else {
        HTMAXBUTTON
    }
}

/// Maximizes or restores the main window the way its caption button would.
fn toggle_maximize(parent: HWND) {
    // SAFETY: posting to the live main window.
    unsafe {
        let command = if IsZoomed(parent).as_bool() {
            SC_RESTORE
        } else {
            SC_MAXIMIZE
        };
        let _ = PostMessageW(Some(parent), WM_SYSCOMMAND, WPARAM(command as usize), LPARAM(0));
    }
}

/// The screen point in a non-client mouse message's `lparam`.
fn point_from(lparam: LPARAM) -> POINT {
    // The low and high words are signed 16-bit coordinates.
    #[allow(clippy::cast_possible_truncation)]
    let (x, y) = (lparam.0 as u32 as u16 as i16, (lparam.0 as u32 >> 16) as u16 as i16);
    POINT {
        x: i32::from(x),
        y: i32::from(y),
    }
}

/// The hit test for a screen point, from the main window's style, state, and DPI.
///
/// # Safety
///
/// `parent` must be the live main window.
unsafe fn hit_test_at(parent: HWND, point: POINT) -> u32 {
    // SAFETY: the caller's contract.
    unsafe {
        let mut origin = POINT::default();
        let _ = ClientToScreen(parent, &mut origin);
        let border = GetSystemMetricsForDpi(SM_CYFRAME, GetDpiForWindow(parent));
        let style = u32::try_from(GetWindowLongPtrW(parent, GWL_STYLE)).unwrap_or_default();
        let resizable = style & WS_SIZEBOX.0 != 0;
        hit_test(point.y, origin.y, border, resizable, IsZoomed(parent).as_bool())
    }
}

/// Starts tracking the pointer's exit, so `WM_NCMOUSELEAVE` clears the hover state.
///
/// # Safety
///
/// `hwnd` must be the overlay that owns `overlay`, on its own thread.
unsafe fn track_leave(hwnd: HWND, overlay: &Overlay) {
    if overlay.tracking.get() {
        return;
    }
    let mut track = TRACKMOUSEEVENT {
        cbSize: u32::try_from(std::mem::size_of::<TRACKMOUSEEVENT>()).unwrap_or_default(),
        dwFlags: TME_LEAVE | TME_NONCLIENT,
        hwndTrack: hwnd,
        dwHoverTime: 0,
    };
    // SAFETY: the caller's contract; `track` outlives the call.
    overlay.tracking.set(unsafe { TrackMouseEvent(&mut track) }.is_ok());
}

/// Hands UI Automation the provider for the overlay's root element, or `None` without one.
///
/// # Safety
///
/// As for `track_leave`, with the `WM_GETOBJECT` message's parameters.
unsafe fn automation_provider(hwnd: HWND, overlay: &Overlay, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
    // The object id is a 32-bit value in the low half of `lparam`, as UI Automation's samples compare it.
    #[allow(clippy::cast_possible_truncation)]
    let object_id = lparam.0 as i32;
    if object_id != UiaRootObjectId {
        return None;
    }
    let provider = overlay.provider.borrow();
    // SAFETY: the caller's contract; the provider belongs to this overlay.
    provider
        .as_ref()
        .map(|provider| unsafe { UiaReturnRawElementProvider(hwnd, wparam, lparam, provider) })
}

/// Tells UI Automation the element is gone and clears the page's hover state.
///
/// # Safety
///
/// As for `track_leave`, while the overlay handles `WM_DESTROY`.
unsafe fn disconnect(hwnd: HWND, overlay: &Overlay) {
    if let Some(provider) = overlay.provider.borrow_mut().take() {
        // SAFETY: the caller's contract.
        unsafe {
            UiaReturnRawElementProvider(hwnd, WPARAM(0), LPARAM(0), None::<&IRawElementProviderSimple>);
            let _ = UiaDisconnectProvider(&provider);
        }
    }
    overlay.set_state(false, false);
}

/// What the overlay does with a message, or `None` for the default handling.
///
/// # Safety
///
/// As for `track_leave`.
unsafe fn handle(hwnd: HWND, overlay: &Overlay, msg: u32, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
    let over_button = wparam.0 == HTMAXBUTTON as usize;
    let parent = overlay.parent;
    // SAFETY: the caller's contract; `parent` is the live main window.
    unsafe {
        match msg {
            WM_NCHITTEST => Some(LRESULT(hit_test_at(parent, point_from(lparam)) as isize)),
            WM_NCMOUSEMOVE => {
                overlay.set_state(over_button, over_button && overlay.state.get().pressed);
                track_leave(hwnd, overlay);
                // Windows shows the Snap Layouts flyout from the default handling of hovering HTMAXBUTTON.
                None
            }
            WM_NCMOUSELEAVE => {
                overlay.tracking.set(false);
                overlay.set_state(false, false);
                Some(LRESULT(0))
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK if over_button => {
                overlay.set_state(true, true);
                Some(LRESULT(0))
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
                // The top resize border: the main window runs the resize.
                let _ = PostMessageW(Some(parent), WM_NCLBUTTONDOWN, wparam, lparam);
                Some(LRESULT(0))
            }
            WM_NCLBUTTONUP => {
                if over_button && overlay.state.get().pressed {
                    overlay.set_state(true, false);
                    toggle_maximize(parent);
                }
                Some(LRESULT(0))
            }
            WM_NCRBUTTONDOWN => Some(LRESULT(0)),
            WM_NCRBUTTONUP => {
                overlay.set_state(false, false);
                system_menu::track(parent, point_from(lparam));
                Some(LRESULT(0))
            }
            WM_OVERLAY_INVOKE => {
                toggle_maximize(parent);
                Some(LRESULT(0))
            }
            WM_GETOBJECT => automation_provider(hwnd, overlay, wparam, lparam),
            WM_DESTROY => {
                disconnect(hwnd, overlay);
                None
            }
            _ => None,
        }
    }
}

pub(super) unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: Windows calls this on the overlay's thread. `overlay_of` reads the state `create` stored, which
    // `WM_NCDESTROY` frees last, after clearing the pointer.
    unsafe {
        let Some(overlay) = overlay_of(hwnd) else {
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        };
        if msg == WM_NCDESTROY {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            drop(Box::from_raw(std::ptr::from_ref(overlay).cast_mut()));
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }
        handle(hwnd, overlay, msg, wparam, lparam).unwrap_or_else(|| DefWindowProcW(hwnd, msg, wparam, lparam))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_maximize_over_the_button() {
        assert_eq!(hit_test(130, 100, 6, true, false), HTMAXBUTTON);
        assert_eq!(hit_test(106, 100, 6, true, false), HTMAXBUTTON);
    }

    #[test]
    fn leaves_the_top_resize_border_to_resizing() {
        assert_eq!(hit_test(100, 100, 6, true, false), HTTOP);
        assert_eq!(hit_test(105, 100, 6, true, false), HTTOP);
    }

    #[test]
    fn has_no_resize_border_when_maximized_or_fixed() {
        assert_eq!(hit_test(100, 100, 6, true, true), HTMAXBUTTON);
        assert_eq!(hit_test(100, 100, 6, false, false), HTMAXBUTTON);
    }

    #[test]
    fn reads_signed_screen_points() {
        let lparam = LPARAM(((-5_i16 as u16 as isize) << 16) | (-1920_i16 as u16 as isize));
        let point = point_from(lparam);
        assert_eq!((point.x, point.y), (-1920, -5));
    }
}
