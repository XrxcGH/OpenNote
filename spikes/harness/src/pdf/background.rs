//! Exporting from a second, hidden WebView in the same window, as an app could do to keep the visible page
//! responsive. Printing lays out every page on the page's main thread, so a long export in the visible WebView
//! stalls ink and typing. This module opens the same page in a hidden WebView and prints from there.
//!
//! WebView objects must stay on the UI thread, so the hidden one lives in a thread-local slot there.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use wry::http::{header::CONTENT_TYPE, Request, Response};
use wry::{WebView, WebViewBuilder};

use crate::common::webview::{web_root, Controller};
use crate::common::Result;

thread_local! {
    static HIDDEN: RefCell<Option<WebView>> = const { RefCell::new(None) };
}

/// Runs `task` on the UI thread with the hidden WebView. Must be called on the UI thread.
pub fn with_hidden<R>(task: impl FnOnce(&WebView) -> R) -> Option<R> {
    HIDDEN.with(|slot| slot.borrow().as_ref().map(task))
}

/// The hidden page, and the messages it sends.
pub struct Hidden {
    messages: Receiver<Value>,
    next_call: Cell<u64>,
}

impl Hidden {
    /// Opens the spike page in a hidden WebView and waits until it is ready.
    pub fn open(controller: &Controller, timeout: Duration) -> Result<Hidden> {
        let (sender, messages) = channel::<Value>();
        let built: std::result::Result<(), String> = controller.on_ui(move |_, window| {
            let webview = WebViewBuilder::new()
                .with_custom_protocol("spike".into(), |_id, request| serve(&request))
                .with_ipc_handler(move |request: Request<String>| {
                    let message = serde_json::from_str(request.body()).unwrap_or(Value::Null);
                    let _ = sender.send(message);
                })
                .with_url("http://spike.localhost/pdf.html?auto=1")
                .with_visible(false)
                .build_as_child(window)
                .map_err(|error| error.to_string())?;
            HIDDEN.with(|slot| *slot.borrow_mut() = Some(webview));
            Ok(())
        })?;
        built?;
        let hidden = Hidden {
            messages,
            next_call: Cell::new(1),
        };
        hidden.wait(timeout, |message| message["type"] == "ready")?;
        Ok(hidden)
    }

    /// Calls a page function registered with `register()` and returns its result.
    pub fn call(&self, controller: &Controller, name: &str, args: Value, timeout: Duration) -> Result<Value> {
        let id = self.next_call.get();
        self.next_call.set(id + 1);
        let script = format!("window.__spike.call({id}, {}, {args})", json!(name));
        controller.on_ui(move |_, _| with_hidden(|webview| webview.evaluate_script(&script).is_ok()))?;
        let reply = self.wait(timeout, |message| message["type"] == "reply" && message["id"] == id)?;
        match reply["ok"].as_bool() {
            Some(true) => Ok(reply["value"].clone()),
            _ => Err(format!("{name} failed in the hidden page: {}", reply["error"]).into()),
        }
    }

    fn wait(&self, timeout: Duration, wanted: impl Fn(&Value) -> bool) -> Result<Value> {
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.messages.recv_timeout(left) {
                Ok(message) if wanted(&message) => return Ok(message),
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => return Err("The hidden page didn't answer in time.".into()),
                Err(RecvTimeoutError::Disconnected) => return Err("The hidden page has closed.".into()),
            }
        }
    }

    /// Closes the hidden WebView.
    pub fn close(self, controller: &Controller) -> Result<()> {
        controller.on_ui(|_, _| HIDDEN.with(|slot| slot.borrow_mut().take()).map(drop))?;
        Ok(())
    }
}

/// Serves the built spike pages to the hidden WebView.
fn serve(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().trim_start_matches('/');
    let bytes = (!path.split('/').any(|part| part == ".."))
        .then(|| std::fs::read(web_root().join(path)).ok())
        .flatten();
    let kind = match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    };
    let response = match bytes {
        Some(bytes) => Response::builder().header(CONTENT_TYPE, kind).body(Cow::Owned(bytes)),
        None => Response::builder().status(404).body(Cow::Borrowed(&b"Not found"[..])),
    };
    response.unwrap_or_else(|_| Response::new(Cow::Borrowed(&b""[..])))
}
