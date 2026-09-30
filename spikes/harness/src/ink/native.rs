//! A native baseline: a plain window that draws ink with the Windows Graphics Device Interface (GDI)
//! as soon as each pen message arrives. Any windowed app, whatever its interface toolkit, goes through
//! the same compositor, so this shows the floor that WebView2's numbers should be compared with.

use std::sync::mpsc::{channel, Sender};
use std::time::Duration;

use serde_json::{json, Value};
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, Touch, TouchPhase, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::platform::windows::WindowExtWindows;
use tao::window::{Window, WindowBuilder};
use windows::Win32::Foundation::{COLORREF, HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, CreatePen, CreateSolidBrush, DeleteObject, FillRect, GdiFlush, GetDC, LineTo, MoveToEx, ReleaseDC,
    ScreenToClient, SelectObject, PS_SOLID,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::Pointer::{GetPointerInfo, POINTER_FLAG_INCONTACT, POINTER_INFO};
use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

use super::measure::{self, Rig, Surface};
use super::pen::{Pen, Target};
use super::{report, SEED, WINDOW_SIZE};
use crate::common::capture::{ChangeWatcher, Region};
use crate::common::webview::ClientArea;
use crate::common::Result;

/// The mode name in the results.
pub const MODE: &str = "native-gdi";
/// The same colors as the page: ink is text.primary and paper is surface.page, as 0x00BBGGRR.
const INK: COLORREF = COLORREF(0x0021_252B);
const PAPER: COLORREF = COLORREF(0x00F6_FCFF);
/// Line width in physical pixels, about as wide as the page's ink.
const INK_WIDTH: i32 = 12;

enum NativeEvent {
    Clear(Sender<()>),
    Exit,
}

/// Opens the native window, times pen moves on it, and closes it.
pub fn measure(samples: usize, nominal_hz: u32) -> Result<Value> {
    let mut event_loop = EventLoopBuilder::<NativeEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("OpenNote spike: native ink baseline")
        .with_inner_size(LogicalSize::new(WINDOW_SIZE.0, WINDOW_SIZE.1))
        .build(&event_loop)?;
    center(&window);
    window.set_always_on_top(true);
    window.set_focus();
    let hwnd = window.hwnd();
    let (proxy, exit) = (event_loop.create_proxy(), event_loop.create_proxy());
    let worker = std::thread::spawn(move || {
        let outcome = drive(hwnd, proxy, samples, nominal_hz);
        let _ = exit.send_event(NativeEvent::Exit);
        outcome
    });
    let mut last: Option<POINT> = None;
    event_loop.run_return(|event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::Touch(touch),
                ..
            } => last = draw(hwnd, &touch, last),
            Event::RedrawRequested(_) => paint_paper(hwnd),
            Event::UserEvent(NativeEvent::Clear(done)) => {
                paint_paper(hwnd);
                last = None;
                let _ = done.send(());
            }
            Event::UserEvent(NativeEvent::Exit)
            | Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *flow = ControlFlow::Exit,
            _ => {}
        }
    });
    drop(window);
    worker.join().map_err(|_| "The native baseline's thread panicked.")?
}

/// Times pen moves on the native window, from the measurement thread.
fn drive(hwnd: isize, proxy: EventLoopProxy<NativeEvent>, samples: usize, nominal_hz: u32) -> Result<Value> {
    std::thread::sleep(Duration::from_millis(700));
    let surface = NativeSurface { proxy };
    surface.clear()?;
    let target = Target {
        hwnd,
        area: client_area(hwnd)?,
    };
    let (x, y) = target.area.to_screen(WINDOW_SIZE.0 / 2.0, WINDOW_SIZE.1 / 2.0);
    let mut watcher = ChangeWatcher::new(Region::around(x, y, measure::REGION_PX))?;
    let frame_ms = 1000.0 / f64::from(nominal_hz.max(1));
    let mut rig = Rig {
        surface: &surface,
        watcher: &mut watcher,
        target,
        page: WINDOW_SIZE,
        frame_ms,
    };
    let pen_samples = measure::latency_samples(&mut rig, &mut Pen::new(target)?, samples, SEED)?;
    Ok(json!({
        "mode": MODE,
        "page": { "native_gdi_window": true },
        "refresh": { "frame_ms": report::round(frame_ms, 3), "source": "nominal refresh rate" },
        "latency": { "synthetic_pen": report::latency_report(&pen_samples, &[], 0.0, frame_ms) },
    }))
}

/// Clearing the native window: the UI thread paints paper and says when it's done.
struct NativeSurface {
    proxy: EventLoopProxy<NativeEvent>,
}

impl Surface for NativeSurface {
    fn clear(&self) -> Result<()> {
        let (done, wait) = channel();
        self.proxy
            .send_event(NativeEvent::Clear(done))
            .map_err(|_| "The native window has closed.")?;
        wait.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "The native window didn't clear in time.")?;
        Ok(())
    }
}

/// Draws a line from the last point to the pen, straight to the window, and returns the new point.
fn draw(hwnd: isize, touch: &Touch, last: Option<POINT>) -> Option<POINT> {
    if matches!(touch.phase, TouchPhase::Ended | TouchPhase::Cancelled) {
        return None;
    }
    // The pointer's pixel location, which injected pens always report. tao also reports a hovering
    // pen as a touch, so only a pen in contact draws.
    let mut info = POINTER_INFO::default();
    unsafe { GetPointerInfo(touch.id as u32, &mut info) }.ok()?;
    if (info.pointerFlags & POINTER_FLAG_INCONTACT).0 == 0 {
        return None;
    }
    let mut point = info.ptPixelLocation;
    if !unsafe { ScreenToClient(handle(hwnd), &mut point) }.as_bool() {
        return last;
    }
    let from = last.unwrap_or(point);
    unsafe {
        let window = handle(hwnd);
        let context = GetDC(Some(window));
        let pen = CreatePen(PS_SOLID, INK_WIDTH, INK);
        let previous = SelectObject(context, pen.into());
        let _ = MoveToEx(context, from.x, from.y, None);
        let _ = LineTo(context, point.x, point.y);
        SelectObject(context, previous);
        let _ = DeleteObject(pen.into());
        ReleaseDC(Some(window), context);
        let _ = GdiFlush();
    }
    Some(point)
}

fn paint_paper(hwnd: isize) {
    let window = handle(hwnd);
    let mut rect = RECT::default();
    unsafe {
        if GetClientRect(window, &mut rect).is_err() {
            return;
        }
        let context = GetDC(Some(window));
        let brush = CreateSolidBrush(PAPER);
        FillRect(context, &rect, brush);
        let _ = DeleteObject(brush.into());
        ReleaseDC(Some(window), context);
        let _ = GdiFlush();
    }
}

/// The client area in physical screen pixels, read with Win32 so any thread can ask.
fn client_area(hwnd: isize) -> Result<ClientArea> {
    let window = handle(hwnd);
    let mut rect = RECT::default();
    let mut origin = POINT::default();
    unsafe { GetClientRect(window, &mut rect)? };
    if !unsafe { ClientToScreen(window, &mut origin) }.as_bool() {
        return Err("The native window has no position on screen.".into());
    }
    Ok(ClientArea {
        x: origin.x,
        y: origin.y,
        width: (rect.right - rect.left) as u32,
        height: (rect.bottom - rect.top) as u32,
        scale: f64::from(unsafe { GetDpiForWindow(window) }) / 96.0,
    })
}

fn center(window: &Window) {
    if let Some(monitor) = window.current_monitor() {
        let (screen, size) = (monitor.position(), monitor.size());
        let outer = window.outer_size();
        let x = screen.x + (size.width as i32 - outer.width as i32) / 2;
        let y = screen.y + (size.height as i32 - outer.height as i32) / 2;
        window.set_outer_position(PhysicalPosition::new(x, y.max(screen.y)));
    }
}

fn handle(hwnd: isize) -> HWND {
    HWND(hwnd as *mut core::ffi::c_void)
}
