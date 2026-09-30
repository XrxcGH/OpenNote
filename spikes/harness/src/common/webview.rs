//! A window with one WebView2 page, driven from a measurement thread.
//!
//! [`run`] opens the window on the main thread and runs the spike's driver on a second thread. The driver
//! gets a [`Controller`], which sends work to the UI thread and waits for the answer. WebView2 objects
//! never leave the UI thread.
//!
//! Pages come from `spikes/web/dist` at `http://spike.localhost/`. A page talks to the harness with
//! `window.ipc.postMessage(JSON.stringify(message))`, where each message has a `type`. The page helper in
//! `spikes/web/common.ts` wraps this, and answers [`Controller::call`] with `reply` messages.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::window::{Window, WindowBuilder};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::HSTRING;
use wry::http::{header::CONTENT_TYPE, Request, Response};
use wry::{WebView, WebViewBuilder, WebViewExtWindows};

use super::Result;

/// How long the driver waits for the UI thread to run a task.
const UI_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the driver waits for an asynchronous WebView2 call, such as a DevTools method.
const ASYNC_TIMEOUT: Duration = Duration::from_secs(30);

type UiTask = Box<dyn FnOnce(&WebView, &Window) + Send>;

enum UserEvent {
    Run(UiTask),
    Exit,
}

/// The window to open and the page to show in it.
pub struct WindowSpec {
    pub title: String,
    /// A page in `spikes/web/dist`, such as `ink.html`.
    pub page: String,
    /// The query string without the `?`, such as `mode=canvas2d&auto=1`.
    pub query: String,
    /// Inner size in logical pixels.
    pub width: f64,
    pub height: f64,
}

/// The webview's client area on screen, in physical pixels, with the display scale (1.5 at 150%).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClientArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

impl ClientArea {
    /// Converts a point in CSS pixels, relative to the page's viewport, to physical screen pixels.
    /// Assumes the page zoom is 100%, which the spikes never change.
    pub fn to_screen(self, css_x: f64, css_y: f64) -> (i32, i32) {
        (
            self.x + (css_x * self.scale).round() as i32,
            self.y + (css_y * self.scale).round() as i32,
        )
    }
}

/// Where the built spike pages live.
pub fn web_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web/dist")
}

/// Opens the window and runs `driver` on a second thread until it returns or the window closes.
/// The driver's result is returned. Closing the window sends a `{"type":"closed"}` message.
pub fn run<F>(spec: WindowSpec, driver: F) -> Result<()>
where
    F: FnOnce(Controller) -> Result<()> + Send + 'static,
{
    if !web_root().join(&spec.page).exists() {
        return Err(format!(
            "{} is missing. Build the pages first with npm run spikes:web.",
            spec.page
        )
        .into());
    }
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title(&spec.title)
        .with_inner_size(LogicalSize::new(spec.width, spec.height))
        .build(&event_loop)?;
    let (inbox, messages) = channel::<Value>();
    let ipc_inbox = inbox.clone();
    let webview = WebViewBuilder::new()
        .with_custom_protocol("spike".into(), |_id, request| serve(&request))
        .with_ipc_handler(move |request: Request<String>| {
            let _ = ipc_inbox.send(parse_message(request.body()));
        })
        .with_devtools(true)
        .with_url(format!("http://spike.localhost/{}?{}", spec.page, spec.query))
        .build(&window)?;

    let controller = Controller::new(event_loop.create_proxy(), messages);
    let exit = event_loop.create_proxy();
    let worker = std::thread::spawn(move || {
        let outcome = driver(controller);
        let _ = exit.send_event(UserEvent::Exit);
        outcome
    });

    event_loop.run_return(|event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Run(task)) => task(&webview, &window),
            Event::UserEvent(UserEvent::Exit) => *control_flow = ControlFlow::Exit,
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                let _ = inbox.send(json!({ "type": "closed" }));
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
    worker.join().map_err(|_| "The spike's measurement thread panicked.")?
}

/// Drives the page from the measurement thread. Every method blocks until the UI thread answers.
pub struct Controller {
    proxy: EventLoopProxy<UserEvent>,
    messages: Receiver<Value>,
    /// Messages that arrived while waiting for something else, oldest first.
    pending: RefCell<VecDeque<Value>>,
    next_call: Cell<u64>,
}

impl Controller {
    fn new(proxy: EventLoopProxy<UserEvent>, messages: Receiver<Value>) -> Controller {
        Controller {
            proxy,
            messages,
            pending: RefCell::new(VecDeque::new()),
            next_call: Cell::new(1),
        }
    }

    /// Runs `task` on the UI thread with the webview and window, and returns what it returns.
    pub fn on_ui<R, T>(&self, task: T) -> Result<R>
    where
        R: Send + 'static,
        T: FnOnce(&WebView, &Window) -> R + Send + 'static,
    {
        self.on_ui_async(UI_TIMEOUT, move |webview, window, done| {
            let _ = done.send(task(webview, window));
        })
    }

    /// Starts work on the UI thread that finishes later, such as a WebView2 call with a completion
    /// handler. `start` gets a sender, and the work sends its result through it. Waits up to `timeout`.
    pub fn on_ui_async<R, T>(&self, timeout: Duration, start: T) -> Result<R>
    where
        R: Send + 'static,
        T: FnOnce(&WebView, &Window, Sender<R>) + Send + 'static,
    {
        let (done, result) = channel();
        self.proxy
            .send_event(UserEvent::Run(Box::new(move |webview, window| {
                start(webview, window, done)
            })))
            .map_err(|_| "The spike window has closed.")?;
        result.recv_timeout(timeout).map_err(|error| match error {
            RecvTimeoutError::Timeout => format!("The UI thread didn't answer within {timeout:?}.").into(),
            RecvTimeoutError::Disconnected => "The UI task ended without an answer.".into(),
        })
    }

    /// Runs a JavaScript expression and returns its value as JSON. Promises are not awaited; use
    /// [`Controller::call`] for async page functions. Exceptions come back as null.
    pub fn eval(&self, script: &str) -> Result<Value> {
        let script = script.to_string();
        let raw: Result<String> = self.on_ui_async(ASYNC_TIMEOUT, move |webview, _, done| {
            let reply = done.clone();
            let callback = move |json: String| {
                let _ = reply.send(Ok(json));
            };
            if let Err(error) = webview.evaluate_script_with_callback(&script, callback) {
                let _ = done.send(Err(error.to_string().into()));
            }
        })?;
        Ok(serde_json::from_str(&raw?).unwrap_or(Value::Null))
    }

    /// Calls a function the page registered with `register()` in `common.ts`, awaits it, and returns its
    /// result. A thrown error becomes an `Err`.
    pub fn call(&self, name: &str, args: Value, timeout: Duration) -> Result<Value> {
        let id = self.next_call.get();
        self.next_call.set(id + 1);
        let script = format!("window.__spike.call({id}, {}, {args})", Value::from(name));
        self.eval(&script)?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let message = self
                .receive(left)?
                .ok_or_else(|| format!("The page didn't finish {name} in time."))?;
            if message["type"] == "reply" && message["id"] == id {
                return match message["ok"].as_bool() {
                    Some(true) => Ok(message["value"].clone()),
                    _ => Err(format!("{name} failed in the page: {}", message["error"]).into()),
                };
            }
            if message["type"] == "closed" {
                self.pending.borrow_mut().push_back(message);
                return Err("The spike window has closed.".into());
            }
            self.pending.borrow_mut().push_back(message);
        }
    }

    /// The next message from the page that isn't a reply, oldest first. None after `timeout`.
    pub fn next_message(&self, timeout: Duration) -> Result<Option<Value>> {
        if let Some(message) = self.pending.borrow_mut().pop_front() {
            return Ok(Some(message));
        }
        self.receive(timeout)
    }

    /// Waits for a message with the given `type`, keeping any others for [`Controller::next_message`].
    pub fn wait_for(&self, kind: &str, timeout: Duration) -> Result<Value> {
        let position = self.pending.borrow().iter().position(|message| message["type"] == kind);
        if let Some(index) = position {
            return Ok(self.pending.borrow_mut().remove(index).unwrap_or_default());
        }
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let message = self
                .receive(left)?
                .ok_or_else(|| format!("No \"{kind}\" message arrived in time."))?;
            if message["type"] == kind {
                return Ok(message);
            }
            self.pending.borrow_mut().push_back(message);
        }
    }

    fn receive(&self, timeout: Duration) -> Result<Option<Value>> {
        match self.messages.recv_timeout(timeout) {
            Ok(message) => Ok(Some(message)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err("The spike window has closed.".into()),
        }
    }

    /// Calls a Chrome DevTools Protocol method, such as `Input.dispatchKeyEvent`, and returns its result.
    /// Input sent this way reaches the page as trusted events, without touching other windows.
    pub fn cdp(&self, method: &str, params: Value) -> Result<Value> {
        let (name, params) = (method.to_string(), params.to_string());
        let raw: std::result::Result<String, String> = self.on_ui_async(ASYNC_TIMEOUT, move |webview, _, done| {
            let reply = done.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |outcome, json| {
                let _ = reply.send(outcome.map(|()| json).map_err(|error| error.to_string()));
                Ok(())
            }));
            let started = unsafe {
                webview
                    .webview()
                    .CallDevToolsProtocolMethod(&HSTRING::from(&name), &HSTRING::from(&params), &handler)
            };
            if let Err(error) = started {
                let _ = done.send(Err(error.to_string()));
            }
        })?;
        let json = raw.map_err(|error| format!("{method} failed: {error}"))?;
        Ok(serde_json::from_str(&json)?)
    }

    /// The webview's client area on screen, in physical pixels.
    pub fn client_area(&self) -> Result<ClientArea> {
        self.on_ui(|_, window| {
            let position = window.inner_position().unwrap_or_default();
            let size = window.inner_size();
            ClientArea {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale: window.scale_factor(),
            }
        })
    }

    /// Brings the window to the front and gives it focus. With `topmost`, it stays above other windows,
    /// so injected input can't land in another app.
    pub fn raise(&self, topmost: bool) -> Result<()> {
        self.on_ui(move |_, window| {
            window.set_always_on_top(topmost);
            window.set_focus();
        })
    }
}

/// Turns an IPC body into a message. Anything that isn't a JSON object becomes `{"type":"text"}`.
fn parse_message(body: &str) -> Value {
    match serde_json::from_str::<Value>(body) {
        Ok(message @ Value::Object(_)) => message,
        _ => json!({ "type": "text", "value": body }),
    }
}

/// Serves a file from the built pages. The headers make the page cross-origin isolated, which gives
/// `performance.now()` its finest resolution.
fn serve(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let file = (!path.split('/').any(|part| part == ".."))
        .then(|| std::fs::read(web_root().join(path)).ok())
        .flatten();
    let builder = Response::builder()
        .header("Cross-Origin-Opener-Policy", "same-origin")
        .header("Cross-Origin-Embedder-Policy", "require-corp")
        .header("Cache-Control", "no-store");
    let response = match file {
        Some(bytes) => builder.header(CONTENT_TYPE, content_type(path)).body(Cow::Owned(bytes)),
        None => builder.status(404).body(Cow::Borrowed(&b"Not found"[..])),
    };
    response.unwrap_or_else(|_| Response::new(Cow::Borrowed(&b""[..])))
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_page_messages() {
        assert_eq!(parse_message(r#"{"type":"ready"}"#)["type"], "ready");
        assert_eq!(parse_message("hello"), json!({ "type": "text", "value": "hello" }));
        assert_eq!(parse_message("[1,2]")["type"], "text");
    }

    #[test]
    fn serves_only_files_inside_the_web_root() {
        let request = |uri: &str| Request::builder().uri(uri).body(Vec::new()).unwrap();
        assert_eq!(serve(&request("http://spike.localhost/../Cargo.toml")).status(), 404);
        assert_eq!(serve(&request("http://spike.localhost/missing.html")).status(), 404);
        assert_eq!(content_type("assets/ink-1a2b.js"), "text/javascript; charset=utf-8");
    }

    #[test]
    fn converts_css_pixels_to_screen_pixels() {
        let area = ClientArea {
            x: 100,
            y: 50,
            width: 1200,
            height: 800,
            scale: 1.5,
        };
        assert_eq!(area.to_screen(10.0, 20.0), (115, 80));
    }
}
