//! Pen input through the real Windows pointer stack, from a synthetic pen device. Windows delivers it
//! to WebView2 as WM_POINTER messages, like a Surface Pen, but without the digitizer's own delay.
//!
//! Before every injection the point is checked: it must lie in the spike window's client area, and the
//! window under it must belong to the spike window. Otherwise the run stops, so input can never land
//! in another app.

use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Controls::{
    CreateSyntheticPointerDevice, DestroySyntheticPointerDevice, HSYNTHETICPOINTERDEVICE, POINTER_FEEDBACK_NONE,
    POINTER_TYPE_INFO, POINTER_TYPE_INFO_0,
};
use windows::Win32::UI::Input::Pointer::{
    InjectSyntheticPointerInput, POINTER_FLAGS, POINTER_FLAG_DOWN, POINTER_FLAG_INCONTACT, POINTER_FLAG_INRANGE,
    POINTER_FLAG_UP, POINTER_FLAG_UPDATE, POINTER_INFO, POINTER_PEN_INFO,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, WindowFromPoint, GA_ROOT, PEN_FLAG_NONE, PEN_MASK_PRESSURE, PEN_MASK_TILT_X, PEN_MASK_TILT_Y, PT_PEN,
};

use super::plan::PenPoint;
use super::Injector;
use crate::common::webview::ClientArea;
use crate::common::Result;

/// Windows pen pressure runs from 0 to 1024.
const MAX_PRESSURE: f64 = 1024.0;

/// The spike window: its handle, and its client area on screen in physical pixels.
#[derive(Clone, Copy, Debug)]
pub struct Target {
    pub hwnd: isize,
    pub area: ClientArea,
}

impl Target {
    /// The screen point for a page point, once it's checked to reach the spike window.
    pub fn screen_point(&self, point: &PenPoint) -> Result<(i32, i32)> {
        let (x, y) = self.area.to_screen(point.x, point.y);
        self.check(x, y)?;
        Ok((x, y))
    }

    /// Fails unless (x, y) is inside the client area and over the spike window or one of its children.
    pub fn check(&self, x: i32, y: i32) -> Result<()> {
        if !inside(self.area, x, y) {
            return Err(format!("({x}, {y}) is outside the spike window, so no pen input was sent.").into());
        }
        let hit = unsafe { WindowFromPoint(POINT { x, y }) };
        let root = unsafe { GetAncestor(hit, GA_ROOT) };
        if hit.is_invalid() || root.0 as isize != self.hwnd {
            return Err(format!("Another window covers ({x}, {y}), so no pen input was sent.").into());
        }
        Ok(())
    }
}

/// True when a physical screen point lies inside the client area.
pub fn inside(area: ClientArea, x: i32, y: i32) -> bool {
    let (right, bottom) = (area.x + area.width as i32, area.y + area.height as i32);
    (area.x..right).contains(&x) && (area.y..bottom).contains(&y)
}

/// A synthetic pen, removed when dropped.
pub struct Pen {
    device: HSYNTHETICPOINTERDEVICE,
    target: Target,
    /// Where the pen touches the screen, if it does.
    contact: Option<PenPoint>,
}

impl Pen {
    pub fn new(target: Target) -> Result<Pen> {
        let device = unsafe { CreateSyntheticPointerDevice(PT_PEN, 1, POINTER_FEEDBACK_NONE) }
            .map_err(|error| format!("Windows couldn't create a synthetic pen: {error}"))?;
        Ok(Pen {
            device,
            target,
            contact: None,
        })
    }

    fn send(&mut self, point: &PenPoint, flags: POINTER_FLAGS) -> Result<()> {
        let (x, y) = self.target.screen_point(point)?;
        let info = POINTER_TYPE_INFO {
            r#type: PT_PEN,
            Anonymous: POINTER_TYPE_INFO_0 {
                penInfo: pen_info(x, y, point, flags),
            },
        };
        unsafe { InjectSyntheticPointerInput(self.device, &[info]) }
            .map_err(|error| format!("Windows refused the pen input: {error}").into())
    }
}

/// The pen report for one sample at physical screen point (x, y).
fn pen_info(x: i32, y: i32, point: &PenPoint, flags: POINTER_FLAGS) -> POINTER_PEN_INFO {
    POINTER_PEN_INFO {
        pointerInfo: POINTER_INFO {
            pointerType: PT_PEN,
            pointerFlags: flags,
            ptPixelLocation: POINT { x, y },
            ..Default::default()
        },
        penFlags: PEN_FLAG_NONE,
        penMask: PEN_MASK_PRESSURE | PEN_MASK_TILT_X | PEN_MASK_TILT_Y,
        pressure: (point.pressure.clamp(0.0, 1.0) * MAX_PRESSURE).round() as u32,
        rotation: 0,
        tiltX: point.tilt_x.clamp(-90, 90),
        tiltY: point.tilt_y.clamp(-90, 90),
    }
}

impl Injector for Pen {
    fn down(&mut self, point: &PenPoint) -> Result<()> {
        // A pen comes into range above the screen before it touches.
        self.send(point, POINTER_FLAG_INRANGE | POINTER_FLAG_UPDATE)?;
        self.send(point, POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT | POINTER_FLAG_DOWN)?;
        self.contact = Some(*point);
        Ok(())
    }

    fn move_to(&mut self, point: &PenPoint) -> Result<()> {
        self.send(
            point,
            POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT | POINTER_FLAG_UPDATE,
        )?;
        self.contact = Some(*point);
        Ok(())
    }

    fn up(&mut self, point: &PenPoint) -> Result<()> {
        self.send(point, POINTER_FLAG_INRANGE | POINTER_FLAG_UP)?;
        self.contact = None;
        // Then the pen leaves range.
        self.send(point, POINTER_FLAG_UPDATE)
    }
}

impl Drop for Pen {
    fn drop(&mut self) {
        if let Some(point) = self.contact {
            let _ = self.up(&point);
        }
        unsafe { DestroySyntheticPointerDevice(self.device) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: ClientArea = ClientArea {
        x: 300,
        y: 245,
        width: 1800,
        height: 1200,
        scale: 1.5,
    };

    #[test]
    fn keeps_points_inside_the_client_area() {
        assert!(inside(AREA, 300, 245));
        assert!(inside(AREA, 2099, 1444));
        assert!(!inside(AREA, 2100, 500));
        assert!(!inside(AREA, 500, 1445));
        assert!(!inside(AREA, 299, 500));
    }

    #[test]
    fn fills_in_a_pen_report() {
        let point = PenPoint {
            x: 10.0,
            y: 20.0,
            pressure: 0.5,
            tilt_x: 120,
            tilt_y: -15,
        };
        let info = pen_info(315, 275, &point, POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT);
        assert_eq!(info.pressure, 512);
        assert_eq!((info.tiltX, info.tiltY), (90, -15));
        assert_eq!(info.pointerInfo.ptPixelLocation, POINT { x: 315, y: 275 });
        assert_eq!(info.pointerInfo.pointerType, PT_PEN);
    }
}
