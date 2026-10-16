//! The Snap Layouts overlay over the Maximize button (ARCHITECTURE.md section 10.5, the second approach), behind
//! the `window.snapLayouts` flag.
//!
//! Windows 11 opens the Snap Layouts flyout when the Maximize button's hit test answers `HTMAXBUTTON`. WebView2's
//! own non-client region kinds (`MINIMIZE`, `MAXIMIZE`, and `CLOSE`) exist only for visual hosting, through
//! `ICoreWebView2CompositionController4`. Wry hosts WebView2 in a window, so the first approach doesn't apply. And
//! the WebView2 window covers the client area, so the main window never sees a hit test over the HTML button.
//!
//! So a small native child window sits exactly over the rectangle the interface reports, above the WebView2 window.
//! It never paints, so the HTML button shows through. Its `WM_NCHITTEST` answers `HTMAXBUTTON`, except along the
//! top resize border of a restored window, where it answers `HTTOP` so resizing from the top edge still works.
//!
//! The overlay sends its hover and pressed state to the page as `window://caption-state`, and the HTML button draws
//! them. A click maximizes or restores the main window with `WM_SYSCOMMAND`, as a native Maximize button does, and
//! a right-click opens the system menu. For assistive technology it answers `WM_GETOBJECT` with a UI Automation
//! provider ([`uia`]). The interface hides its own Maximize button from assistive technology while the overlay is
//! on, so there's exactly one.
//!
//! Minimize and Close stay HTML only. No Windows feature depends on their hit tests, and covering them would move
//! their hover, tooltips, and UI Automation out of WebView2.

mod proc;
#[cfg(test)]
mod tests;
pub mod uia;

use std::{
    cell::{Cell, RefCell},
    sync::{Arc, Once},
};

use tauri::{Emitter, Manager, WebviewWindow};
use windows::{
    core::{w, HSTRING, PCWSTR},
    Win32::{
        Foundation::HWND,
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Accessibility::{
                IRawElementProviderSimple, UIA_NamePropertyId, UiaClientsAreListening,
                UiaRaiseAutomationPropertyChangedEvent,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, FindWindowExW, GetWindowLongPtrW, IsZoomed, LoadCursorW,
                RegisterClassExW, SetWindowLongPtrW, SetWindowPos, SetWindowTextW, GWLP_USERDATA, HCURSOR, HWND_TOP,
                IDC_ARROW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WINDOW_EX_STYLE, WM_APP,
                WNDCLASSEXW, WS_CHILD, WS_CLIPSIBLINGS, WS_VISIBLE,
            },
        },
    },
};

use self::uia::{MaximizeProvider, SharedName};
use super::caption::{CaptionLabels, CaptionLayout, CaptionState, Rect};
use crate::events;

/// The overlay's window class. Tests and UI Automation scripts find the overlay by it.
pub const CLASS_NAME: PCWSTR = w!("OpenNoteSnapLayoutsOverlay");

/// Posted by the UI Automation provider's Invoke, so the maximize runs on the window's own thread.
pub(super) const WM_OVERLAY_INVOKE: u32 = WM_APP + 0x0A11;

/// Sends the overlay's hover and pressed state to the page.
type Emit = Box<dyn Fn(CaptionState)>;

/// The overlay's state. Its window owns it, and only the window's thread uses it.
pub(super) struct Overlay {
    emit: Emit,
    parent: HWND,
    rect: Cell<Rect>,
    labels: RefCell<CaptionLabels>,
    name: Arc<SharedName>,
    provider: RefCell<Option<IRawElementProviderSimple>>,
    state: Cell<CaptionState>,
    tracking: Cell<bool>,
}

impl Overlay {
    /// Sends the hover and pressed state to the page when it changed.
    pub(super) fn set_state(&self, hovered: bool, pressed: bool) {
        let state = CaptionState { hovered, pressed };
        if self.state.replace(state) != state {
            (self.emit)(state);
        }
    }

    /// Names the button for what a click does, Maximize or Restore, and tells UI Automation when that changes.
    fn update_name(&self, hwnd: HWND) {
        // SAFETY: `parent` is the live main window that owns this overlay.
        let maximized = unsafe { IsZoomed(self.parent) }.as_bool();
        let name = self.labels.borrow().for_state(maximized).to_owned();
        let Some(old) = self.name.set(&name) else {
            return;
        };
        // SAFETY: `hwnd` is this overlay; the provider is this overlay's own, and the values outlive the calls.
        unsafe {
            let _ = SetWindowTextW(hwnd, &HSTRING::from(name.as_str()));
            if let Some(provider) = self.provider.borrow().as_ref() {
                if UiaClientsAreListening().as_bool() {
                    let (old, new) = (old.as_str().into(), name.as_str().into());
                    let _ = UiaRaiseAutomationPropertyChangedEvent(provider, UIA_NamePropertyId, &old, &new);
                }
            }
        }
    }
}

/// Shows the overlay over `layout.maximize`, creating it the first time, with the layout's names. It sends its
/// state to `window`'s page as `window://caption-state`.
pub fn show(window: &WebviewWindow, parent: HWND, layout: &CaptionLayout) {
    let (app, label) = (window.app_handle().clone(), window.label().to_owned());
    show_with(parent, layout, move || {
        Box::new(move |state| {
            if let Err(error) = app.emit_to(label.as_str(), events::WINDOW_CAPTION_STATE, state) {
                log::warn!("Couldn't send the caption state: {error}");
            }
        })
    });
}

/// Shows the overlay, creating it with the sender from `emit` the first time.
fn show_with(parent: HWND, layout: &CaptionLayout, emit: impl FnOnce() -> Emit) {
    let Some(hwnd) = find(parent).or_else(|| create(parent, emit())) else {
        return;
    };
    // SAFETY: `hwnd` is an overlay this module created on this thread, so its user data is an `Overlay`.
    let Some(overlay) = (unsafe { overlay_of(hwnd) }) else {
        return;
    };
    overlay.rect.set(layout.maximize);
    *overlay.labels.borrow_mut() = layout.labels.clone();
    overlay.update_name(hwnd);
    place(hwnd, layout.maximize);
}

/// Removes the overlay, if there is one.
pub fn remove(parent: HWND) {
    if let Some(hwnd) = find(parent) {
        // SAFETY: the overlay is a child window this thread created.
        let _ = unsafe { DestroyWindow(hwnd) };
    }
}

/// After the main window was maximized, restored, or resized: renames the overlay and keeps it above the WebView2
/// window, which may have moved to the top.
pub fn parent_changed(parent: HWND) {
    let Some(hwnd) = find(parent) else {
        return;
    };
    // SAFETY: as in `show`.
    if let Some(overlay) = unsafe { overlay_of(hwnd) } {
        overlay.update_name(hwnd);
    }
    // SAFETY: `hwnd` is a live child window of this thread.
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
}

/// Scales the overlay after a DPI change, until the page reports the new layout.
pub fn scale(parent: HWND, factor: f64) {
    let Some(hwnd) = find(parent) else {
        return;
    };
    // SAFETY: as in `show`.
    if let Some(overlay) = unsafe { overlay_of(hwnd) } {
        let rect = overlay.rect.get().scaled(factor);
        overlay.rect.set(rect);
        place(hwnd, rect);
    }
}

fn find(parent: HWND) -> Option<HWND> {
    // SAFETY: a lookup by class among the main window's children.
    unsafe { FindWindowExW(Some(parent), None, CLASS_NAME, PCWSTR::null()) }.ok()
}

fn place(hwnd: HWND, rect: Rect) {
    let [left, top, right, bottom] = rect.to_pixels();
    let flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
    // SAFETY: `hwnd` is a live child window of this thread.
    let _ = unsafe { SetWindowPos(hwnd, Some(HWND_TOP), left, top, right - left, bottom - top, flags) };
}

/// The overlay's state, or `None` before `create` stored it.
///
/// # Safety
///
/// `hwnd` must be an overlay window of this class, used on its own thread.
pub(super) unsafe fn overlay_of<'a>(hwnd: HWND) -> Option<&'a Overlay> {
    // SAFETY: the caller's contract; the pointer is either null or the `Overlay` that `create` leaked.
    unsafe { (GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Overlay).as_ref() }
}

fn register_class() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| {
        // SAFETY: registers a class whose procedure and name are 'static.
        unsafe {
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let class = WNDCLASSEXW {
                cbSize: u32::try_from(std::mem::size_of::<WNDCLASSEXW>()).unwrap_or_default(),
                lpfnWndProc: Some(proc::window_proc),
                hInstance: instance.into(),
                hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or(HCURSOR::default()),
                lpszClassName: CLASS_NAME,
                ..Default::default()
            };
            if RegisterClassExW(&class) == 0 {
                log::warn!("Couldn't register the Snap Layouts overlay's window class.");
            }
        }
    });
}

fn create(parent: HWND, emit: Emit) -> Option<HWND> {
    register_class();
    // SAFETY: creates a child of the live main window on the thread that owns it. The `Overlay` box is leaked into
    // the window's user data and freed in `WM_NCDESTROY`.
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        let style = WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS;
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CLASS_NAME,
            PCWSTR::null(),
            style,
            0,
            0,
            0,
            0,
            Some(parent),
            None,
            Some(instance.into()),
            None,
        )
        .inspect_err(|error| log::warn!("Couldn't create the Snap Layouts overlay: {error}"))
        .ok()?;
        let name = Arc::new(SharedName::default());
        let overlay = Box::new(Overlay {
            emit,
            parent,
            rect: Cell::new(Rect {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            }),
            labels: RefCell::new(CaptionLabels {
                maximize: String::new(),
                restore: String::new(),
            }),
            provider: RefCell::new(Some(MaximizeProvider::create(hwnd, WM_OVERLAY_INVOKE, name.clone()))),
            name,
            state: Cell::new(CaptionState {
                hovered: false,
                pressed: false,
            }),
            tracking: Cell::new(false),
        });
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(overlay) as isize);
        Some(hwnd)
    }
}
