//! Tauri's resize border for undecorated windows, made safe for assistive technology (ADR 0017).
//!
//! Tauri resizes an undecorated window from its top edge with a child window, `TAURI_DRAG_RESIZE_BORDERS`. The
//! window covers the whole client area, and a window region cuts it down to the top border. Mouse hit tests follow
//! the region, but UI Automation's don't. They found that window everywhere, so Narrator's mouse and touch
//! exploration read "TAURI_DRAG_RESIZE_WINDOW, pane" over the whole page instead of the page itself.
//!
//! With the undecorated shadow, Windows draws the other resize borders outside the client area, so only the top
//! border needs the window. A subclass keeps its rectangle to that strip. It also answers UI Automation with a
//! provider that leaves the window out of the control and content views, so screen readers don't announce it.

use std::ffi::c_void;

use windows::{
    core::{implement, w, Error, IUnknown, Result, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{GetWindowRgnBox, GDI_REGION_TYPE, RGN_ERROR},
        System::Variant::VARIANT,
        UI::{
            Accessibility::{
                IRawElementProviderSimple, IRawElementProviderSimple_Impl, ProviderOptions,
                ProviderOptions_ServerSideProvider, UIA_IsContentElementPropertyId, UIA_IsControlElementPropertyId,
                UiaDisconnectProvider, UiaHostProviderFromHwnd, UiaReturnRawElementProvider, UiaRootObjectId,
                UIA_PATTERN_ID, UIA_PROPERTY_ID,
            },
            HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                FindWindowExW, GetClientRect, GetParent, IsZoomed, SetWindowPos, SM_CYFRAME, SWP_NOACTIVATE,
                SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINDOWPOS, WM_GETOBJECT, WM_NCDESTROY, WM_WINDOWPOSCHANGING,
            },
        },
    },
};

/// Tauri's window class for the resize border.
const CLASS_NAME: PCWSTR = w!("TAURI_DRAG_RESIZE_BORDERS");

/// Identifies this subclass among the window's others ("ONRB").
const SUBCLASS_ID: usize = 0x4F4E_5242;

/// Whether a region's bounding box is only the top border strip, as Tauri cuts it with the undecorated shadow.
pub fn is_top_strip(region_bottom: i32, strip: i32) -> bool {
    region_bottom <= strip
}

/// Subclasses Tauri's resize border window once, if there is one, and keeps it to the top strip.
pub fn install(parent: HWND) {
    // SAFETY: a lookup among the live main window's children, on the thread that owns them.
    let Ok(border) = (unsafe { FindWindowExW(Some(parent), None, CLASS_NAME, PCWSTR::null()) }) else {
        return;
    };
    // SAFETY: `border` is Tauri's child window on this thread. The provider box lives until `WM_NCDESTROY`.
    unsafe {
        let mut existing = 0;
        if !GetWindowSubclass(border, Some(subclass_proc), SUBCLASS_ID, Some(&mut existing)).as_bool() {
            let provider: IRawElementProviderSimple = HiddenPane {
                hwnd: border.0 as isize,
            }
            .into();
            let data = Box::into_raw(Box::new(provider));
            if !SetWindowSubclass(border, Some(subclass_proc), SUBCLASS_ID, data as usize).as_bool() {
                drop(Box::from_raw(data));
                return;
            }
        }
        clamp(border, parent);
    }
}

/// The top border's height at the window's DPI, as Tauri measures it.
///
/// # Safety
///
/// `hwnd` must be a live window.
unsafe fn strip_height(hwnd: HWND) -> i32 {
    // SAFETY: the caller's contract.
    unsafe { GetSystemMetricsForDpi(SM_CYFRAME, GetDpiForWindow(hwnd)) }
}

/// Whether Tauri cut the window down to the top strip. Without the shadow it keeps all four borders, and then the
/// window must keep its full size.
///
/// # Safety
///
/// `border` must be a live window.
unsafe fn only_top(border: HWND) -> bool {
    let mut bounds = RECT::default();
    // SAFETY: the caller's contract; `bounds` outlives the call.
    let kind: GDI_REGION_TYPE = unsafe { GetWindowRgnBox(border, &mut bounds) };
    // SAFETY: as above.
    kind != RGN_ERROR && is_top_strip(bounds.bottom, unsafe { strip_height(border) })
}

/// The height the resize border may have: the top strip, or nothing while the main window is maximized. Then
/// the top edge belongs to the caption buttons, and dragging it restores the window.
///
/// # Safety
///
/// `border` must be Tauri's resize border window, on its thread.
unsafe fn allowed_height(border: HWND) -> i32 {
    // SAFETY: the caller's contract.
    unsafe {
        match GetParent(border) {
            Ok(parent) if IsZoomed(parent).as_bool() => 0,
            _ => strip_height(border),
        }
    }
}

/// Shrinks the window to the top strip now; the subclass keeps it there.
///
/// # Safety
///
/// `border` must be Tauri's resize border window and `parent` the main window, on their thread.
unsafe fn clamp(border: HWND, parent: HWND) {
    // SAFETY: the caller's contract.
    unsafe {
        if !only_top(border) {
            return;
        }
        let height = allowed_height(border);
        let mut client = RECT::default();
        let _ = GetClientRect(parent, &mut client);
        let width = if height == 0 { 0 } else { client.right };
        let flags = SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE;
        let _ = SetWindowPos(border, None, 0, 0, width, height, flags);
    }
}

/// Limits a pending move or resize to `allowed` pixels of height.
fn limit_height(pos: &mut WINDOWPOS, allowed: i32) {
    if pos.flags.0 & SWP_NOSIZE.0 == 0 {
        pos.cy = pos.cy.min(allowed);
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
    // SAFETY: Windows calls this on the window's thread with the box `install` stored, freed in `WM_NCDESTROY`.
    // `WM_WINDOWPOSCHANGING` carries a valid, writable `WINDOWPOS`.
    unsafe {
        let provider = data as *mut IRawElementProviderSimple;
        match msg {
            WM_WINDOWPOSCHANGING => {
                if only_top(hwnd) {
                    limit_height(&mut *(lparam.0 as *mut WINDOWPOS), allowed_height(hwnd));
                }
            }
            WM_GETOBJECT => {
                // The object id is a 32-bit value in the low half of `lparam`.
                #[allow(clippy::cast_possible_truncation)]
                if lparam.0 as i32 == UiaRootObjectId {
                    return UiaReturnRawElementProvider(hwnd, wparam, lparam, &*provider);
                }
            }
            WM_NCDESTROY => {
                let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
                UiaReturnRawElementProvider(hwnd, WPARAM(0), LPARAM(0), None::<&IRawElementProviderSimple>);
                let provider = Box::from_raw(provider);
                let _ = UiaDisconnectProvider(&*provider);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}

/// A provider that keeps the resize border out of UI Automation's control and content views.
#[implement(IRawElementProviderSimple)]
struct HiddenPane {
    hwnd: isize,
}

impl IRawElementProviderSimple_Impl for HiddenPane_Impl {
    fn ProviderOptions(&self) -> Result<ProviderOptions> {
        Ok(ProviderOptions_ServerSideProvider)
    }

    fn GetPatternProvider(&self, _pattern: UIA_PATTERN_ID) -> Result<IUnknown> {
        Err(Error::empty())
    }

    fn GetPropertyValue(&self, property: UIA_PROPERTY_ID) -> Result<VARIANT> {
        Ok(
            if property == UIA_IsControlElementPropertyId || property == UIA_IsContentElementPropertyId {
                VARIANT::from(false)
            } else {
                VARIANT::default()
            },
        )
    }

    fn HostRawElementProvider(&self) -> Result<IRawElementProviderSimple> {
        // SAFETY: UI Automation checks the handle; a destroyed window gives an error.
        unsafe { UiaHostProviderFromHwnd(HWND(self.hwnd as *mut c_void)) }
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::{
        Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_DIFF},
        UI::WindowsAndMessaging::{WS_CHILD, WS_VISIBLE},
    };

    use super::*;
    use crate::window::test_windows::{self, rect_in_parent, TestWindow};

    #[test]
    fn recognizes_the_top_strip_only() {
        assert!(is_top_strip(8, 8));
        assert!(is_top_strip(0, 8));
        assert!(!is_top_strip(1243, 8));
    }

    #[test]
    fn hides_the_pane_from_the_control_and_content_views() {
        let provider: IRawElementProviderSimple = HiddenPane { hwnd: 0 }.into();
        // SAFETY: plain COM calls on a provider this test owns.
        unsafe {
            for property in [UIA_IsControlElementPropertyId, UIA_IsContentElementPropertyId] {
                let value = provider.GetPropertyValue(property).unwrap();
                assert!(!bool::try_from(&value).unwrap());
            }
            assert!(provider.GetPropertyValue(UIA_PROPERTY_ID(30005)).unwrap().is_empty());
        }
    }

    /// Tauri's border window over the whole client area, cut by `region` as Tauri cuts it.
    fn tauri_border(main: HWND, region: impl FnOnce(i32, i32, i32) -> HRGN) -> (TestWindow, RECT, i32) {
        let mut client = RECT::default();
        // SAFETY: `main` is live on this thread.
        let _ = unsafe { GetClientRect(main, &mut client) };
        let border = test_windows::child(main, CLASS_NAME, WS_CHILD | WS_VISIBLE, client);
        // SAFETY: as above; the window takes ownership of the region.
        let strip = unsafe { strip_height(border.0) };
        unsafe { SetWindowRgn(border.0, Some(region(client.right, client.bottom, strip)), false) };
        (border, client, strip)
    }

    fn height(border: HWND, main: HWND) -> i32 {
        let rect = rect_in_parent(border, main);
        rect.bottom - rect.top
    }

    // These tests call `clamp` rather than `install`: `SetWindowSubclass` loads only with the Common Controls 6
    // manifest, which Tauri gives the app but not test executables. The running app's check is in ADR 0017.
    #[test]
    fn shrinks_the_border_to_the_top_strip() {
        let main = test_windows::parent();
        // SAFETY: creates a region for the window to own.
        let (border, client, strip) =
            tauri_border(main.0, |width, _, strip| unsafe { CreateRectRgn(0, 0, width, strip) });
        // SAFETY: both windows are live on this thread.
        unsafe { clamp(border.0, main.0) };
        assert_eq!(height(border.0, main.0), strip);
        assert_eq!(rect_in_parent(border.0, main.0).right, client.right);
    }

    #[test]
    fn limits_later_resizes_to_the_strip() {
        let mut stretch = WINDOWPOS {
            cx: 1920,
            cy: 1243,
            ..Default::default()
        };
        limit_height(&mut stretch, 6);
        assert_eq!((stretch.cx, stretch.cy), (1920, 6));
        let mut maximized = WINDOWPOS {
            cy: 1243,
            ..Default::default()
        };
        limit_height(&mut maximized, 0);
        assert_eq!(maximized.cy, 0);
        let mut move_only = WINDOWPOS {
            cy: 1243,
            flags: SWP_NOSIZE,
            ..Default::default()
        };
        limit_height(&mut move_only, 6);
        assert_eq!(move_only.cy, 1243);
    }

    #[test]
    fn leaves_a_border_on_all_four_edges_alone() {
        let main = test_windows::parent();
        // Without the shadow, Tauri keeps a ring around the whole client area.
        // SAFETY: creates regions; the combined one goes to the window, and the inner one is freed.
        let (border, client, _) = tauri_border(main.0, |width, height, strip| unsafe {
            let ring = CreateRectRgn(0, 0, width, height);
            let inner = CreateRectRgn(strip, strip, width - strip, height - strip);
            CombineRgn(Some(ring), Some(ring), Some(inner), RGN_DIFF);
            let _ = DeleteObject(inner.into());
            ring
        });
        // SAFETY: both windows are live on this thread.
        unsafe { clamp(border.0, main.0) };
        assert_eq!(height(border.0, main.0), client.bottom);
    }
}
