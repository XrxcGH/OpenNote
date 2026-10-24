//! The overlay in a real, hidden window: placement, names, hit tests, button states, clicks, UI
//! Automation, DPI scaling, and removal.

use std::{cell::RefCell, rc::Rc};

use windows::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    UI::{
        Accessibility::UiaRootObjectId,
        WindowsAndMessaging::{
            GetWindowTextW, SendMessageW, HTMAXBUTTON, HTTOP, SC_MAXIMIZE, WM_GETOBJECT, WM_NCHITTEST,
            WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_SYSCOMMAND,
        },
    },
};

use super::{find, remove, scale, show_with, WM_OVERLAY_INVOKE};
use crate::window::{
    caption::{CaptionLabels, CaptionLayout, CaptionState, Rect},
    test_windows::{parent, rect_in_parent, screen_lparam, take_posted},
};

fn layout() -> CaptionLayout {
    CaptionLayout {
        maximize: Rect {
            x: 600.0,
            y: 0.0,
            width: 46.0,
            height: 40.0,
        },
        labels: CaptionLabels {
            maximize: "Maximize".into(),
            restore: "Restore".into(),
        },
        snap_layouts: true,
    }
}

fn text(hwnd: HWND) -> String {
    let mut buffer = [0u16; 64];
    // SAFETY: `hwnd` is live on this thread and the buffer outlives the call.
    let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..usize::try_from(length).unwrap_or(0)])
}

fn send(hwnd: HWND, message: u32, wparam: usize, lparam: LPARAM) -> isize {
    // SAFETY: a synchronous message to a live window of this thread.
    unsafe { SendMessageW(hwnd, message, Some(WPARAM(wparam)), Some(lparam)) }.0
}

const RESTING: CaptionState = CaptionState {
    hovered: false,
    pressed: false,
};

#[test]
fn stands_in_for_the_maximize_button() {
    let main = parent();
    let states = Rc::new(RefCell::new(Vec::new()));
    let sink = states.clone();
    show_with(main.0, &layout(), move || {
        Box::new(move |state| sink.borrow_mut().push(state))
    });
    let overlay = find(main.0).expect("the overlay");

    let placed = rect_in_parent(overlay, main.0);
    assert_eq!(
        (placed.left, placed.top, placed.right, placed.bottom),
        (600, 0, 646, 40)
    );
    assert_eq!(text(overlay), "Maximize");

    let center = screen_lparam(main.0, 623, 20);
    let top_edge = screen_lparam(main.0, 623, 0);
    assert_eq!(send(overlay, WM_NCHITTEST, 0, center), HTMAXBUTTON as isize);
    assert_eq!(send(overlay, WM_NCHITTEST, 0, top_edge), HTTOP as isize);

    let button = HTMAXBUTTON as usize;
    send(overlay, WM_NCMOUSEMOVE, button, center);
    send(overlay, WM_NCLBUTTONDOWN, button, center);
    send(overlay, WM_NCLBUTTONUP, button, center);
    send(overlay, WM_NCMOUSELEAVE, 0, LPARAM(0));
    let hovered = CaptionState {
        hovered: true,
        pressed: false,
    };
    let pressed = CaptionState {
        hovered: true,
        pressed: true,
    };
    assert_eq!(*states.borrow(), [hovered, pressed, hovered, RESTING]);
    assert_eq!(take_posted(main.0, WM_SYSCOMMAND), Some(WPARAM(SC_MAXIMIZE as usize)));

    // UI Automation gets a provider for the root element, and Invoke maximizes on the window's own thread.
    let object = LPARAM(UiaRootObjectId as isize);
    assert_ne!(send(overlay, WM_GETOBJECT, 0, object), 0);
    send(overlay, WM_OVERLAY_INVOKE, 0, LPARAM(0));
    assert_eq!(take_posted(main.0, WM_SYSCOMMAND), Some(WPARAM(SC_MAXIMIZE as usize)));

    scale(main.0, 1.5);
    let scaled = rect_in_parent(overlay, main.0);
    assert_eq!((scaled.left, scaled.right, scaled.bottom), (900, 969, 60));

    remove(main.0);
    assert!(find(main.0).is_none());
}

#[test]
fn ignores_releases_without_a_press() {
    let main = parent();
    show_with(main.0, &layout(), || Box::new(|_| {}));
    let overlay = find(main.0).expect("the overlay");
    send(
        overlay,
        WM_NCLBUTTONUP,
        HTMAXBUTTON as usize,
        screen_lparam(main.0, 623, 20),
    );
    assert_eq!(take_posted(main.0, WM_SYSCOMMAND), None);
}
