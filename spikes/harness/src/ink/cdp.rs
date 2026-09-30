//! Pen input through the Chrome DevTools Protocol (CDP). The browser process dispatches it straight to
//! the page, which skips the Windows pointer stack. Comparing it with the synthetic pen shows how much
//! time Windows and WebView2's input routing add.

use std::sync::mpsc::{channel, Receiver, Sender};

use serde_json::{json, Value};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;
use wry::WebViewExtWindows;

use super::plan::PenPoint;
use super::Injector;
use crate::common::webview::Controller;
use crate::common::Result;

/// A pen driven through `Input.dispatchMouseEvent` with `pointerType: "pen"`.
pub struct CdpPen<'a> {
    controller: &'a Controller,
    failures: Receiver<String>,
    report: Sender<String>,
}

impl<'a> CdpPen<'a> {
    pub fn new(controller: &'a Controller) -> CdpPen<'a> {
        let (report, failures) = channel();
        CdpPen {
            controller,
            failures,
            report,
        }
    }

    /// Starts the call on the UI thread and returns without waiting for the page to handle it, so the
    /// screen watcher sees every frame. A failure shows up on the next call.
    fn dispatch(&mut self, kind: &str, point: &PenPoint, buttons: u32) -> Result<()> {
        if let Ok(error) = self.failures.try_recv() {
            return Err(format!("Input.dispatchMouseEvent failed: {error}").into());
        }
        let params = mouse_event(kind, point, buttons).to_string();
        let report = self.report.clone();
        let started = self.controller.on_ui(move |webview, _| {
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |outcome, _| {
                if let Err(error) = outcome {
                    let _ = report.send(error.to_string());
                }
                Ok(())
            }));
            let method = HSTRING::from("Input.dispatchMouseEvent");
            unsafe {
                webview
                    .webview()
                    .CallDevToolsProtocolMethod(&method, &HSTRING::from(params), &handler)
            }
            .map_err(|error| error.to_string())
        })?;
        started.map_err(|error| format!("Input.dispatchMouseEvent didn't start: {error}").into())
    }
}

/// The CDP parameters for one pen event. Coordinates are CSS pixels in the viewport.
fn mouse_event(kind: &str, point: &PenPoint, buttons: u32) -> Value {
    json!({
        "type": kind,
        "x": point.x,
        "y": point.y,
        "button": "left",
        "buttons": buttons,
        "clickCount": 1,
        "pointerType": "pen",
        "force": point.pressure,
        "tiltX": point.tilt_x,
        "tiltY": point.tilt_y,
    })
}

impl Injector for CdpPen<'_> {
    fn down(&mut self, point: &PenPoint) -> Result<()> {
        self.dispatch("mousePressed", point, 1)
    }

    fn move_to(&mut self, point: &PenPoint) -> Result<()> {
        self.dispatch("mouseMoved", point, 1)
    }

    fn up(&mut self, point: &PenPoint) -> Result<()> {
        self.dispatch("mouseReleased", point, 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_a_pen_event() {
        let point = PenPoint {
            x: 78.0,
            y: 50.5,
            pressure: 0.75,
            tilt_x: 20,
            tilt_y: -5,
        };
        let event = mouse_event("mouseMoved", &point, 1);
        assert_eq!(event["pointerType"], "pen");
        assert_eq!(event["force"], 0.75);
        assert_eq!((event["x"].as_f64(), event["tiltY"].as_i64()), (Some(78.0), Some(-5)));
    }
}
