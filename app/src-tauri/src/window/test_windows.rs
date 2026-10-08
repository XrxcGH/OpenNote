//! Real, hidden Win32 windows for the window module's tests. Each test thread owns the windows it creates, and
//! nothing is ever shown, so the tests run on a build machine without disturbing a desktop.

use std::sync::Once;

use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{ClientToScreen, MapWindowPoints},
        System::{
            Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
            LibraryLoader::GetModuleHandleW,
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowRect, PeekMessageW, RegisterClassExW, MSG,
            PM_REMOVE, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSEXW, WS_OVERLAPPEDWINDOW,
        },
    },
};

const PARENT_CLASS: PCWSTR = w!("OpenNoteTestParent");

/// A window that destroys itself when dropped.
pub struct TestWindow(pub HWND);

impl Drop for TestWindow {
    fn drop(&mut self) {
        // SAFETY: the test thread created this window and still owns it.
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

unsafe extern "system" fn default_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: Windows calls this with a live window of this class.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Registers a window class that only does the default handling.
pub fn register(class: PCWSTR) {
    // SAFETY: the procedure is the system's, and `class` names a 'static string.
    unsafe {
        let class = WNDCLASSEXW {
            cbSize: u32::try_from(std::mem::size_of::<WNDCLASSEXW>()).unwrap_or_default(),
            lpfnWndProc: Some(default_proc),
            hInstance: GetModuleHandleW(None).unwrap_or_default().into(),
            lpszClassName: class,
            ..Default::default()
        };
        // Registering twice fails harmlessly, so each test may call this.
        RegisterClassExW(&class);
    }
}

/// A hidden, resizable top-level window with a 800 × 600 window rectangle, and COM for UI Automation.
pub fn parent() -> TestWindow {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| register(PARENT_CLASS));
    // SAFETY: plain window creation on the test thread; COM may already be initialized, which is fine.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PARENT_CLASS,
            w!("OpenNote test"),
            WS_OVERLAPPEDWINDOW,
            100,
            100,
            800,
            600,
            None,
            None,
            None,
            None,
        )
        .expect("a test window");
        TestWindow(hwnd)
    }
}

/// A child window of `class` over `rect` in the parent's client area.
pub fn child(parent: HWND, class: PCWSTR, style: WINDOW_STYLE, rect: RECT) -> TestWindow {
    register(class);
    // SAFETY: plain window creation on the test thread.
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            PCWSTR::null(),
            style,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            Some(parent),
            None,
            None,
            None,
        )
    };
    TestWindow(hwnd.expect("a test child window"))
}

/// A window's rectangle relative to its parent's client area.
pub fn rect_in_parent(hwnd: HWND, parent: HWND) -> RECT {
    let mut rect = RECT::default();
    // SAFETY: both windows are live on this thread; the two points of `rect` are written in place.
    unsafe {
        let _ = GetWindowRect(hwnd, &mut rect);
        let points = std::slice::from_raw_parts_mut((&raw mut rect).cast::<POINT>(), 2);
        MapWindowPoints(None, Some(parent), points);
    }
    rect
}

/// A screen point for a point in `hwnd`'s client area, packed as a mouse message's `lparam`.
pub fn screen_lparam(hwnd: HWND, x: i32, y: i32) -> LPARAM {
    let mut point = POINT { x, y };
    // SAFETY: `hwnd` is live on this thread.
    let _ = unsafe { ClientToScreen(hwnd, &mut point) };
    // Mouse messages carry each coordinate as the low 16 bits of a signed value.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let (x, y) = (point.x as u16 as usize, point.y as u16 as usize);
    #[allow(clippy::cast_possible_wrap)]
    let packed = ((y << 16) | x) as isize;
    LPARAM(packed)
}

/// The posted message `message` waiting for `hwnd`, removing it, or `None`.
pub fn take_posted(hwnd: HWND, message: u32) -> Option<WPARAM> {
    let mut msg = MSG::default();
    // SAFETY: reads this thread's queue.
    let found = unsafe { PeekMessageW(&mut msg, Some(hwnd), message, message, PM_REMOVE) }.as_bool();
    found.then_some(msg.wParam)
}
