//! The loopback listener that receives the browser's return from a sign-in (RFC 8252 section 7.3). It binds
//! `127.0.0.1` only, on a random port unless the service needs a fixed one, and it answers on one exact path.
//!
//! It ends at the first request that is the sign-in coming back: the right path and a `state` value to check. A
//! request for anything else (the wrong path, the wrong method, the wrong `Host`, such as a page that probes the
//! port) gets a plain error and is ignored. A return with the wrong or missing `state` ends the attempt, because it
//! means the answer isn't for this sign-in. After the end the socket is closed, so a second request finds nothing.
//! Five minutes without a return ends it too. The page it shows says only that the tab can be closed, and it
//! never repeats anything from the address.

use std::{
    io::{self, Read, Write},
    net::{Ipv4Addr, Shutdown, TcpListener, TcpStream},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use super::{pkce, secret::Secret};

/// The only path that counts as the sign-in coming back.
pub const CALLBACK_PATH: &str = "/callback";

/// How long a sign-in waits for the person to finish in the browser.
pub const WAIT: Duration = Duration::from_secs(5 * 60);

/// The longest request head read, in bytes.
const MAX_HEAD: usize = 8 * 1024;
const POLL: Duration = Duration::from_millis(25);
const READ_LIMIT: Duration = Duration::from_secs(2);

/// What came back in the address.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    /// The authorization code. It works once, and only with this sign-in's verifier.
    Code(Secret),
    /// The service refused, such as `access_denied`. Only a short code of letters, digits, and `_` is kept.
    Refused(String),
}

/// Why the wait ended without a code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    Canceled,
    TimedOut,
    /// The return had the right state value but no usable code.
    Mismatch,
    Io,
}

pub struct Listener {
    socket: TcpListener,
    port: u16,
}

impl Listener {
    /// Listens on `127.0.0.1`. Port 0 picks a free port.
    pub fn bind(port: u16) -> io::Result<Listener> {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, port))?;
        socket.set_nonblocking(true)?;
        let port = socket.local_addr()?.port();
        Ok(Listener { socket, port })
    }

    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The address to give the service as the redirect URI.
    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    /// Waits for the return. The listener is consumed, so the port closes as soon as this ends.
    pub fn wait(self, state: &str, timeout: Duration, cancel: &AtomicBool) -> Result<Callback, Ended> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(Ended::Canceled);
            }
            if Instant::now() >= deadline {
                return Err(Ended::TimedOut);
            }
            match self.socket.accept() {
                Ok((stream, _)) => {
                    if let Some(end) = self.serve(stream, state) {
                        return end;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL),
                Err(_) => return Err(Ended::Io),
            }
        }
    }

    /// Answers one connection. Some(..) ends the wait, and None keeps waiting.
    fn serve(&self, mut stream: TcpStream, state: &str) -> Option<Result<Callback, Ended>> {
        // A socket accepted from a non-blocking listener may be non-blocking too.
        stream.set_nonblocking(false).ok()?;
        stream.set_read_timeout(Some(READ_LIMIT)).ok()?;
        stream.set_write_timeout(Some(READ_LIMIT)).ok()?;
        let head = read_head(&mut stream)?;
        let verdict = judge(&head, self.port, state);
        let _ = write_page(&mut stream, verdict.status, verdict.page);
        verdict.end
    }
}

/// Reads up to the blank line that ends the request head.
fn read_head(stream: &mut TcpStream) -> Option<String> {
    let mut head = Vec::new();
    let mut buffer = [0u8; 1024];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
        if head.len() >= MAX_HEAD {
            return None;
        }
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return None,
            Ok(count) => head.extend_from_slice(&buffer[..count]),
        }
    }
    Some(String::from_utf8_lossy(&head).into_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Done,
    Failed,
    Nothing,
}

#[derive(Debug, PartialEq, Eq)]
struct Verdict {
    status: u16,
    page: Page,
    end: Option<Result<Callback, Ended>>,
}

impl Verdict {
    fn ignore(status: u16) -> Verdict {
        Verdict {
            status,
            page: Page::Nothing,
            end: None,
        }
    }

    fn finish(end: Result<Callback, Ended>) -> Verdict {
        match end {
            Ok(Callback::Code(_)) => Verdict {
                status: 200,
                page: Page::Done,
                end: Some(end),
            },
            _ => Verdict {
                status: 400,
                page: Page::Failed,
                end: Some(end),
            },
        }
    }
}

/// Decides what a request head means. A pure function, so every case is tested without a socket.
fn judge(head: &str, port: u16, state: &str) -> Verdict {
    let mut lines = head.split("\r\n");
    let mut request = lines.next().unwrap_or_default().split(' ');
    let (method, target) = (request.next().unwrap_or_default(), request.next().unwrap_or_default());
    if method != "GET" {
        return Verdict::ignore(405);
    }
    let host = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim());
    // A page that makes the browser reach this port under another name is not the sign-in coming back.
    if host != Some(format!("127.0.0.1:{port}").as_str()) {
        return Verdict::ignore(400);
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Verdict::ignore(404);
    }
    let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let get = |name: &str| {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    // Any page in the browser can send a request here, and the fixed ports are public, so a wrong
    // or missing state is answered and ignored: it never ends the wait for the real return.
    if !get("state").is_some_and(|returned| pkce::same(returned, state)) {
        return Verdict {
            status: 400,
            page: Page::Failed,
            end: None,
        };
    }
    if let Some(error) = get("error") {
        let kept: String = error
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .take(64)
            .collect();
        return Verdict::finish(Ok(Callback::Refused(kept)));
    }
    match get("code") {
        Some(code) if !code.is_empty() && code.len() <= 4096 => Verdict::finish(Ok(Callback::Code(Secret::new(code)))),
        _ => Verdict::finish(Err(Ended::Mismatch)),
    }
}

const DONE_PAGE: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>OpenNote</title>\
<meta name=\"viewport\" content=\"width=device-width\">\
<style>body{font:16px system-ui,sans-serif;margin:3rem auto;max-width:30rem;padding:0 1rem;line-height:1.5}</style>\
<h1>You can close this tab</h1><p>OpenNote finished signing in. Go back to the app.</p></html>";

const FAILED_PAGE: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>OpenNote</title>\
<meta name=\"viewport\" content=\"width=device-width\">\
<style>body{font:16px system-ui,sans-serif;margin:3rem auto;max-width:30rem;padding:0 1rem;line-height:1.5}</style>\
<h1>You can close this tab</h1><p>The sign-in didn't finish. Go back to OpenNote to try again.</p></html>";

fn write_page(stream: &mut TcpStream, status: u16, page: Page) -> io::Result<()> {
    let (reason, body) = match (status, page) {
        (200, _) => ("OK", DONE_PAGE),
        (_, Page::Failed) => ("Bad Request", FAILED_PAGE),
        (404, _) => ("Not Found", ""),
        (405, _) => ("Method Not Allowed", ""),
        _ => ("Bad Request", ""),
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    stream.shutdown(Shutdown::Write)
}

#[cfg(test)]
mod tests;
