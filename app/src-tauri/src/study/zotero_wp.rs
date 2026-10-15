//! Zotero's word-processor integration over its HTTP integration endpoints (the ones Zotero's own Google Docs
//! plugin uses). OpenNote acts as a word processor that Zotero drives:
//!
//! 1. `POST /connector/document/execCommand` with `{"command", "docId"}` starts a command. Zotero's answer is the
//!    first request it makes of the word processor: `{"command": "Application.getActiveDocument", "arguments": []}`.
//! 2. We answer a request with `POST /connector/document/respond`, whose JSON body is the result (or
//!    `{"error", "message", "stack"}` for a failure). The reply to that POST is Zotero's next request.
//! 3. This repeats (`Document.insertField`, `Field.setText`, ...) until Zotero's request is `Document.complete`.
//!
//! The spec is Zotero's published source. Zotero is AGPL-3.0, and none of its code is copied here.
//! - zotero/zotero `chrome/content/zotero/xpcom/server/server_connectorIntegration.js` (the two endpoints, the
//!   error body, and the 503 for a command already in progress),
//! - `chrome/content/zotero/xpcom/httpIntegrationClient.js` (every request name, its arguments, and the shape of
//!   each result), and
//! - `test/tests/server_connectorIntegrationTest.js` (request headers: `Content-Type: application/json` and
//!   `X-Zotero-Connector-API-Version`).
//!
//! Zotero listens on 127.0.0.1:23119. Nothing but the loopback address is ever asked, and nothing leaves the
//! computer. Request names arrive as `Document.insertField`; the page's bridge sees `Document_insertField`.
//! Written independently from that source: no code or structure comes from any other word-processor integration.

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    sync::{mpsc, Mutex},
    time::Duration,
};

use serde_json::{json, Value};

/// Zotero's local server port (the connector and integration endpoints).
pub const PORT: u16 = 23119;
/// The largest HTTP body accepted: a long bibliography's rich text is a few megabytes at most.
const MAX_BODY: usize = 32 * 1024 * 1024;
/// The connector API version sent with each request.
const API_VERSION: &str = "2";

/// The commands Zotero's menu offers a word processor that OpenNote supports (no notes: a page has no footnotes).
pub const COMMANDS: [&str; 5] = [
    "addEditCitation",
    "addEditBibliography",
    "refresh",
    "removeCodes",
    "setDocPrefs",
];

/// Why a session could not run or ended badly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    /// Nothing is listening: Zotero is not running.
    NotRunning(String),
    /// The connection failed part-way.
    Io(String),
    /// Zotero sent something that is not the protocol.
    Protocol(String),
}

/// One request from Zotero.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub txid: u32,
    pub method: String,
    pub args: Vec<Value>,
}

/// How a session ended.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Requests Zotero made, not counting the final `Document.complete`.
    pub calls: usize,
    /// Zotero finished with `Document.complete`. Zotero sends it after success, cancel, and error alike.
    pub completed: bool,
    /// Requests answered with an error.
    pub errors: usize,
}

/// One HTTP answer.
struct Reply {
    status: u16,
    body: Vec<u8>,
}

fn io_error(error: std::io::Error) -> SessionError {
    SessionError::Io(error.to_string())
}

/// POSTs JSON to a Zotero endpoint and reads the whole answer.
fn post(stream: &mut (impl Read + Write), path: &str, body: &[u8]) -> Result<Reply, SessionError> {
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nContent-Type: application/json\r\n\
         X-Zotero-Connector-API-Version: {API_VERSION}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|()| stream.write_all(body))
        .and_then(|()| stream.flush())
        .map_err(io_error)?;
    read_reply(stream)
}

fn read_reply(stream: &mut impl Read) -> Result<Reply, SessionError> {
    let mut data = Vec::new();
    let mut chunk = [0u8; 8192];
    let split = loop {
        if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            break at;
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err(SessionError::Io("Zotero closed the connection before answering".into())),
            Ok(n) => data.extend_from_slice(&chunk[..n]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => return Err(io_error(error)),
        }
    };
    let head = String::from_utf8_lossy(&data[..split]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split(' ').nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| SessionError::Protocol("Zotero's answer is not HTTP".into()))?;
    let length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok());
    let too_big = || SessionError::Protocol("an answer from Zotero is over the size limit".into());
    if length.is_some_and(|len| len > MAX_BODY) {
        return Err(too_big());
    }
    let mut body = data[split + 4..].to_vec();
    loop {
        if let Some(len) = length {
            if body.len() >= len {
                body.truncate(len);
                break;
            }
        }
        if body.len() > MAX_BODY {
            return Err(too_big());
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => body.extend_from_slice(&chunk[..n]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => return Err(io_error(error)),
        }
    }
    Ok(Reply { status, body })
}

/// One request and answer on a fresh connection (we ask the server to close after each).
fn exchange(
    addr: SocketAddr,
    connect: Duration,
    idle: Duration,
    path: &str,
    body: &[u8],
) -> Result<Reply, SessionError> {
    let mut stream =
        TcpStream::connect_timeout(&addr, connect).map_err(|error| SessionError::NotRunning(error.to_string()))?;
    let _ = stream.set_nodelay(true);
    stream.set_read_timeout(Some(idle)).map_err(io_error)?;
    post(&mut stream, path, body)
}

/// Reads Zotero's next request: `{"command": "Document.insertField", "arguments": [...]}`.
fn parse_call(txid: u32, reply: &Reply) -> Result<Call, SessionError> {
    if reply.status == 503 {
        return Err(SessionError::Io(
            "Zotero is already busy with a command; finish its window first".into(),
        ));
    }
    if reply.status != 200 {
        return Err(SessionError::Protocol(format!("Zotero answered {}", reply.status)));
    }
    let value: Value = serde_json::from_slice(&reply.body)
        .map_err(|error| SessionError::Protocol(format!("Zotero's request is not JSON: {error}")))?;
    let method = value
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| SessionError::Protocol("Zotero's request has no command".into()))?
        .replace('.', "_");
    let args = value
        .get("arguments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(Call { txid, method, args })
}

/// The body of a respond POST: the result, or the error shape Zotero shows the person as an alert.
fn encode_reply(reply: &Result<Value, String>) -> Vec<u8> {
    let value = match reply {
        Ok(value) => value.clone(),
        Err(message) => json!({ "error": "Alert", "message": message, "stack": "" }),
    };
    serde_json::to_vec(&value).unwrap_or_else(|_| b"null".to_vec())
}

/// Runs one command against Zotero at `addr`, answering each request with `answer` until `Document.complete`.
pub fn run_session(
    addr: SocketAddr,
    command: &str,
    connect_timeout: Duration,
    idle_timeout: Duration,
    answer: &mut dyn FnMut(&Call) -> Result<Value, String>,
) -> Result<Outcome, SessionError> {
    if !COMMANDS.contains(&command) {
        return Err(SessionError::Protocol(format!("{command} is not a Zotero command")));
    }
    let start = serde_json::to_vec(&json!({ "command": command, "docId": "opennote" }))
        .map_err(|error| SessionError::Protocol(error.to_string()))?;
    let mut reply = exchange(
        addr,
        connect_timeout,
        idle_timeout,
        "/connector/document/execCommand",
        &start,
    )?;
    let mut outcome = Outcome::default();
    let mut txid = 0u32;
    loop {
        txid = txid.saturating_add(1);
        let call = parse_call(txid, &reply)?;
        if call.method == "Document_complete" {
            // Nothing is sent back: Zotero's transaction is over. The page tidies up when it is told.
            let _ = answer(&call);
            outcome.completed = true;
            return Ok(outcome);
        }
        outcome.calls += 1;
        let result = answer(&call);
        if result.is_err() {
            outcome.errors += 1;
        }
        reply = exchange(
            addr,
            connect_timeout,
            idle_timeout,
            "/connector/document/respond",
            &encode_reply(&result),
        )?;
    }
}

/// The page's answer to a call, waiting for the session that asked.
type Pending = Mutex<Option<mpsc::Sender<(u32, Result<Value, String>)>>>;
static PENDING: Pending = Mutex::new(None);

/// Runs a command for the page: each call is handed to `send` (which delivers it to the page), and the session waits
/// for [`reply`]. Only one command runs at a time.
pub fn run_for_page(command: &str, send: &mut dyn FnMut(&Call), addr: SocketAddr) -> Result<Outcome, SessionError> {
    let (tx, rx) = mpsc::channel();
    {
        let mut slot = PENDING
            .lock()
            .map_err(|_| SessionError::Io("the session lock is broken".into()))?;
        if slot.is_some() {
            return Err(SessionError::Io("a Zotero command is already running".into()));
        }
        *slot = Some(tx);
    }
    let result = run_session(
        addr,
        command,
        Duration::from_secs(3),
        Duration::from_secs(60 * 60),
        &mut |call| {
            send(call);
            if call.method == "Document_complete" {
                // Zotero waits for no answer to this one; the page still hears it and tidies up.
                return Ok(Value::Null);
            }
            loop {
                match rx.recv_timeout(Duration::from_secs(60 * 30)) {
                    Ok((txid, answer)) if txid == call.txid => return answer,
                    Ok(_) => {}
                    Err(_) => return Err("the page did not answer".into()),
                }
            }
        },
    );
    if let Ok(mut slot) = PENDING.lock() {
        *slot = None;
    }
    result
}

/// Hands the page's answer to the waiting session. False when none is waiting.
pub fn reply(txid: u32, answer: Result<Value, String>) -> bool {
    PENDING
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|tx| tx.send((txid, answer)).is_ok()))
        .unwrap_or(false)
}

/// Zotero's address on this computer.
pub fn default_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], PORT))
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::*;

    /// What a pretend Zotero heard: each request's path, headers (lowercased) and JSON body.
    type Heard = Vec<(String, String, Value)>;

    fn read_request(stream: &mut TcpStream) -> (String, String, Value) {
        let mut data = Vec::new();
        let mut byte = [0u8; 1];
        while !data.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).expect("head");
            data.push(byte[0]);
        }
        let head = String::from_utf8(data).expect("utf8");
        let path = head.split(' ').nth(1).expect("path").to_owned();
        let length: usize = head
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse().expect("len"))
            })
            .expect("content-length");
        let mut body = vec![0u8; length];
        stream.read_exact(&mut body).expect("body");
        (
            path,
            head.to_ascii_lowercase(),
            serde_json::from_slice(&body).expect("json"),
        )
    }

    fn respond(stream: &mut TcpStream, status: u16, body: &Value) {
        let body = serde_json::to_vec(body).expect("json");
        let head = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        stream
            .write_all(head.as_bytes())
            .and_then(|()| stream.write_all(&body))
            .expect("write");
    }

    /// A pretend Zotero: after execCommand it makes `calls` one at a time (each is the answer to the previous
    /// request), and the last reply is whatever the client sends back.
    fn pretend_zotero(calls: Vec<Value>) -> (SocketAddr, std::thread::JoinHandle<Heard>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = std::thread::spawn(move || {
            let mut heard = Vec::new();
            for call in &calls {
                let (mut stream, _) = listener.accept().expect("accept");
                heard.push(read_request(&mut stream));
                respond(&mut stream, 200, call);
            }
            // The answer to the last non-complete request ends the exchange; Document.complete has none.
            if calls.len() > 1 && calls.last().is_some_and(|c| c["command"] != "Document.complete") {
                let (mut stream, _) = listener.accept().expect("accept");
                heard.push(read_request(&mut stream));
                respond(&mut stream, 200, &json!(null));
            }
            heard
        });
        (addr, handle)
    }

    fn quick(
        addr: SocketAddr,
        command: &str,
        answer: &mut dyn FnMut(&Call) -> Result<Value, String>,
    ) -> Result<Outcome, SessionError> {
        run_session(addr, command, Duration::from_secs(2), Duration::from_secs(5), answer)
    }

    #[test]
    fn starts_with_exec_command_then_answers_each_request_until_complete() {
        let (addr, zotero) = pretend_zotero(vec![
            json!({ "command": "Application.getActiveDocument", "arguments": [] }),
            json!({ "command": "Document.getDocumentData", "arguments": ["opennote"] }),
            json!({ "command": "Document.complete", "arguments": ["opennote"] }),
        ]);
        let mut seen = Vec::new();
        let outcome = quick(addr, "addEditCitation", &mut |call| {
            seen.push((call.method.clone(), call.args.clone()));
            match call.method.as_str() {
                "Application_getActiveDocument" => Ok(json!({ "documentID": "opennote" })),
                "Document_getDocumentData" => Err("no data".into()),
                _ => Ok(Value::Null),
            }
        })
        .expect("session");
        let heard = zotero.join().expect("zotero");
        assert_eq!(heard[0].0, "/connector/document/execCommand");
        assert_eq!(heard[0].2, json!({ "command": "addEditCitation", "docId": "opennote" }));
        assert!(heard[0].1.contains("content-type: application/json"));
        assert!(heard[0].1.contains("x-zotero-connector-api-version: 2"));
        assert_eq!(heard[1].0, "/connector/document/respond");
        assert_eq!(heard[1].2, json!({ "documentID": "opennote" }));
        assert_eq!(
            heard[2].2,
            json!({ "error": "Alert", "message": "no data", "stack": "" })
        );
        assert_eq!(seen[0], ("Application_getActiveDocument".to_owned(), vec![]));
        assert_eq!(
            seen[1],
            ("Document_getDocumentData".to_owned(), vec![json!("opennote")])
        );
        assert_eq!(seen[2].0, "Document_complete");
        assert_eq!(
            outcome,
            Outcome {
                calls: 2,
                completed: true,
                errors: 1
            }
        );
    }

    #[test]
    fn nothing_listening_means_zotero_is_not_running() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        let result = quick(addr, "refresh", &mut |_| Ok(Value::Null));
        assert!(matches!(result, Err(SessionError::NotRunning(_))), "{result:?}");
    }

    #[test]
    fn an_unknown_command_is_refused_before_connecting() {
        let result = quick(default_addr(), "format-disk", &mut |_| Ok(Value::Null));
        assert!(matches!(result, Err(SessionError::Protocol(_))));
    }

    #[test]
    fn a_busy_zotero_is_reported() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let zotero = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            read_request(&mut stream);
            stream
                .write_all(b"HTTP/1.1 503 Busy\r\nContent-Length: 4\r\n\r\nbusy")
                .expect("write");
        });
        let result = quick(addr, "refresh", &mut |_| Ok(Value::Null));
        zotero.join().expect("zotero");
        assert!(
            matches!(result, Err(SessionError::Io(ref m)) if m.contains("busy")),
            "{result:?}"
        );
    }

    #[test]
    fn something_that_is_not_zotero_is_a_protocol_error() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let zotero = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            read_request(&mut stream);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello")
                .expect("write");
        });
        let result = quick(addr, "refresh", &mut |_| Ok(Value::Null));
        zotero.join().expect("zotero");
        assert!(matches!(result, Err(SessionError::Protocol(_))), "{result:?}");
    }

    #[test]
    fn an_oversized_answer_is_refused() {
        let text = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", MAX_BODY + 1);
        let result = read_reply(&mut text.as_bytes());
        assert!(matches!(result, Err(SessionError::Protocol(_))));
    }

    #[test]
    fn talks_only_to_the_loopback_address() {
        assert!(default_addr().ip().is_loopback());
        assert_eq!(default_addr().port(), 23119);
    }

    #[test]
    fn the_page_answers_through_the_pending_slot() {
        let (addr, zotero) = pretend_zotero(vec![
            json!({ "command": "Application.getActiveDocument", "arguments": [] }),
            json!({ "command": "Document.complete", "arguments": ["opennote"] }),
        ]);
        let (call_tx, call_rx) = mpsc::channel::<Call>();
        let page = std::thread::spawn(move || {
            for call in call_rx {
                if call.method == "Document_complete" {
                    continue;
                }
                while !reply(call.txid, Ok(json!({ "documentID": "opennote" }))) {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        });
        let outcome = run_for_page(
            "addEditCitation",
            &mut |call| {
                let _ = call_tx.send(call.clone());
            },
            addr,
        )
        .expect("session");
        drop(call_tx);
        page.join().expect("page");
        let heard = zotero.join().expect("zotero");
        assert_eq!(heard[1].2, json!({ "documentID": "opennote" }));
        assert!(outcome.completed);
        assert!(!reply(1, Ok(Value::Null)), "no session is waiting afterwards");
    }
}
