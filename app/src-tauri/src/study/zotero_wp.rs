//! Zotero's word-processor integration (Citation helper): OpenNote acts as a word processor that Zotero can drive.
//! Zotero listens on a loopback port for word-processor plugins. The plugin sends one integration command; Zotero
//! then shows its own dialogs and drives the page with calls such as `Document_insertField` and `Field_setText`,
//! ending with `Document_complete`. This module speaks the framing and runs that exchange; the page answers each
//! call (features/citations/zoteroWp in the interface), because the page is the document.
//!
//! Frames are a 32-bit transaction number and a 32-bit payload length, both big-endian, then the payload: JSON, or
//! text starting `ERR:` for a failed call. Commands from us use transaction 0 and get no reply; Zotero's calls use
//! other numbers, which our reply repeats. Written from Zotero's published protocol description. Nothing but the
//! loopback address is ever asked, and nothing leaves the computer.

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    sync::{mpsc, Mutex},
    time::Duration,
};

use serde_json::{json, Value};

/// Zotero's word-processor integration port.
pub const PORT: u16 = 23116;
/// The largest payload accepted: a long bibliography's rich text is a few megabytes at most.
const MAX_FRAME: usize = 32 * 1024 * 1024;
/// The integration template version this client speaks.
const TEMPLATE_VERSION: u32 = 1;

/// The commands Zotero's menu offers a word processor.
pub const COMMANDS: [&str; 6] = [
    "addEditCitation",
    "addEditBibliography",
    "addNote",
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

/// One call from Zotero.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub txid: u32,
    pub method: String,
    pub args: Vec<Value>,
}

/// How a session ended.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Calls Zotero made.
    pub calls: usize,
    /// Zotero finished with `Document_complete`. False when it closed the connection, as it does when the person
    /// cancels its dialog.
    pub completed: bool,
    /// Calls answered with an error.
    pub errors: usize,
}

fn read_frame(stream: &mut impl Read) -> Result<Option<(u32, Vec<u8>)>, SessionError> {
    let mut head = [0u8; 8];
    let mut got = 0;
    while got < head.len() {
        match stream.read(&mut head[got..]) {
            Ok(0) if got == 0 => return Ok(None),
            Ok(0) => return Err(SessionError::Protocol("the connection closed inside a frame header".into())),
            Ok(n) => got += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => return Err(SessionError::Io(error.to_string())),
        }
    }
    let txid = u32::from_be_bytes([head[0], head[1], head[2], head[3]]);
    let len = usize::try_from(u32::from_be_bytes([head[4], head[5], head[6], head[7]])).unwrap_or(usize::MAX);
    if len > MAX_FRAME {
        return Err(SessionError::Protocol(format!("a frame of {len} bytes is over the limit")));
    }
    let mut payload = vec![0u8; len];
    stream.read_exact(&mut payload).map_err(|error| SessionError::Io(error.to_string()))?;
    Ok(Some((txid, payload)))
}

fn write_frame(stream: &mut impl Write, txid: u32, payload: &[u8]) -> Result<(), SessionError> {
    let len = u32::try_from(payload.len())
        .ok()
        .filter(|len| *len as usize <= MAX_FRAME)
        .ok_or_else(|| SessionError::Protocol("a reply was too large".into()))?;
    let mut buffer = Vec::with_capacity(8 + payload.len());
    buffer.extend_from_slice(&txid.to_be_bytes());
    buffer.extend_from_slice(&len.to_be_bytes());
    buffer.extend_from_slice(payload);
    stream
        .write_all(&buffer)
        .and_then(|()| stream.flush())
        .map_err(|error| SessionError::Io(error.to_string()))
}

/// Reads `[method, [args...]]`, or the bare `[method, arg, ...]`.
fn parse_call(txid: u32, payload: &[u8]) -> Result<Call, String> {
    let Value::Array(items) = serde_json::from_slice::<Value>(payload).map_err(|error| format!("not JSON: {error}"))?
    else {
        return Err("a call must be a JSON array".into());
    };
    let mut items = items.into_iter();
    let Some(Value::String(method)) = items.next() else {
        return Err("a call must start with the method name".into());
    };
    let rest: Vec<Value> = items.collect();
    let args = match <[Value; 1]>::try_from(rest) {
        Ok([Value::Array(args)]) => args,
        Ok([one]) => vec![one],
        Err(rest) => rest,
    };
    Ok(Call { txid, method, args })
}

fn encode_reply(reply: &Result<Value, String>) -> Vec<u8> {
    match reply {
        Ok(value) => serde_json::to_vec(value).unwrap_or_else(|_| b"null".to_vec()),
        Err(message) => format!("ERR:{message}").into_bytes(),
    }
}

/// Runs one command against Zotero at `addr`, answering each call with `answer` until `Document_complete`.
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
    let mut stream = TcpStream::connect_timeout(&addr, connect_timeout)
        .map_err(|error| SessionError::NotRunning(error.to_string()))?;
    let _ = stream.set_nodelay(true);
    stream
        .set_read_timeout(Some(idle_timeout))
        .map_err(|error| SessionError::Io(error.to_string()))?;
    let payload = serde_json::to_vec(&json!({ "command": command, "templateVersion": TEMPLATE_VERSION }))
        .map_err(|error| SessionError::Protocol(error.to_string()))?;
    write_frame(&mut stream, 0, &payload)?;
    serve(&mut stream, answer)
}

/// Answers calls on an open connection until the session ends.
pub fn serve<S: Read + Write>(
    stream: &mut S,
    answer: &mut dyn FnMut(&Call) -> Result<Value, String>,
) -> Result<Outcome, SessionError> {
    let mut outcome = Outcome::default();
    while let Some((txid, payload)) = read_frame(stream)? {
        if txid == 0 {
            continue;
        }
        outcome.calls += 1;
        let (reply, done) = match parse_call(txid, &payload) {
            Ok(call) => {
                let done = call.method == "Document_complete";
                (answer(&call), done)
            }
            Err(message) => (Err(message), false),
        };
        if reply.is_err() {
            outcome.errors += 1;
        }
        write_frame(stream, txid, &encode_reply(&reply))?;
        if done {
            outcome.completed = true;
            break;
        }
    }
    Ok(outcome)
}

/// The page's answer to a call, waiting for the session that asked.
type Pending = Mutex<Option<mpsc::Sender<(u32, Result<Value, String>)>>>;
static PENDING: Pending = Mutex::new(None);

/// Runs a command for the page: each call is handed to `send` (which delivers it to the page), and the session waits
/// for [`reply`]. Only one command runs at a time.
pub fn run_for_page(command: &str, send: &mut dyn FnMut(&Call), addr: SocketAddr) -> Result<Outcome, SessionError> {
    let (tx, rx) = mpsc::channel();
    {
        let mut slot = PENDING.lock().map_err(|_| SessionError::Io("the session lock is broken".into()))?;
        if slot.is_some() {
            return Err(SessionError::Io("a Zotero command is already running".into()));
        }
        *slot = Some(tx);
    }
    let result = run_session(addr, command, Duration::from_secs(3), Duration::from_secs(60 * 60), &mut |call| {
        send(call);
        loop {
            match rx.recv_timeout(Duration::from_secs(60 * 30)) {
                Ok((txid, answer)) if txid == call.txid => return answer,
                Ok(_) => {}
                Err(_) => return Err("the page did not answer".into()),
            }
        }
    });
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

    type Heard = (Value, Vec<Vec<u8>>);

    /// A pretend Zotero: reads the command, makes `calls`, collects the replies, and closes.
    fn pretend_zotero(calls: Vec<Value>) -> (SocketAddr, std::thread::JoinHandle<Heard>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let (txid, payload) = read_frame(&mut stream).expect("frame").expect("command");
            assert_eq!(txid, 0);
            let command: Value = serde_json::from_slice(&payload).expect("json");
            let mut replies = Vec::new();
            for (index, call) in calls.iter().enumerate() {
                let tx = u32::try_from(index).expect("small") + 1;
                write_frame(&mut stream, tx, &serde_json::to_vec(call).expect("json")).expect("write");
                let (back, body) = read_frame(&mut stream).expect("frame").expect("reply");
                assert_eq!(back, tx);
                replies.push(body);
            }
            (command, replies)
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
    fn sends_the_command_and_answers_each_call_until_complete() {
        let calls = vec![
            json!(["Application_getActiveDocument", [3]]),
            json!(["Document_getDocumentData", [1]]),
            json!(["Document_complete", [1]]),
        ];
        let (addr, zotero) = pretend_zotero(calls);
        let mut seen = Vec::new();
        let outcome = quick(addr, "addEditCitation", &mut |call| {
            seen.push((call.method.clone(), call.args.clone()));
            match call.method.as_str() {
                "Application_getActiveDocument" => Ok(json!([3, 1])),
                "Document_getDocumentData" => Err("no data".into()),
                _ => Ok(Value::Null),
            }
        })
        .expect("session");
        let (command, replies) = zotero.join().expect("zotero");
        assert_eq!(command, json!({ "command": "addEditCitation", "templateVersion": 1 }));
        assert_eq!(replies, vec![b"[3,1]".to_vec(), b"ERR:no data".to_vec(), b"null".to_vec()]);
        assert_eq!(seen[0], ("Application_getActiveDocument".to_owned(), vec![json!(3)]));
        assert_eq!(outcome, Outcome { calls: 3, completed: true, errors: 1 });
    }

    #[test]
    fn a_closed_connection_is_a_cancelled_session() {
        let (addr, zotero) = pretend_zotero(vec![json!(["Application_getActiveDocument", [3]])]);
        let outcome = quick(addr, "refresh", &mut |_| Ok(json!([3, 1]))).expect("session");
        zotero.join().expect("zotero");
        assert_eq!(outcome, Outcome { calls: 1, completed: false, errors: 0 });
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
    fn a_bad_call_is_answered_with_an_error() {
        let (addr, zotero) = pretend_zotero(vec![json!({ "not": "a call" }), json!(["Document_complete", [1]])]);
        let outcome = quick(addr, "refresh", &mut |_| Ok(Value::Null)).expect("session");
        let (_, replies) = zotero.join().expect("zotero");
        assert!(String::from_utf8_lossy(&replies[0]).starts_with("ERR:"));
        assert_eq!(outcome.errors, 1);
        assert!(outcome.completed);
    }

    #[test]
    fn an_oversized_frame_is_refused() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&u32::MAX.to_be_bytes());
        let result = read_frame(&mut bytes.as_slice());
        assert!(matches!(result, Err(SessionError::Protocol(_))));
    }

    #[test]
    fn talks_only_to_the_loopback_address() {
        assert!(default_addr().ip().is_loopback());
        assert_eq!(default_addr().port(), 23116);
    }

    #[test]
    fn the_page_answers_through_the_pending_slot() {
        let (addr, zotero) = pretend_zotero(vec![
            json!(["Application_getActiveDocument", [3]]),
            json!(["Document_complete", [1]]),
        ]);
        let (call_tx, call_rx) = mpsc::channel::<Call>();
        let page = std::thread::spawn(move || {
            for call in call_rx {
                let value = if call.method == "Document_complete" { Value::Null } else { json!([3, 7]) };
                while !reply(call.txid, Ok(value.clone())) {
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
        let (_, replies) = zotero.join().expect("zotero");
        assert_eq!(replies[0], b"[3,7]".to_vec());
        assert!(outcome.completed);
        assert!(!reply(1, Ok(Value::Null)), "no session is waiting afterwards");
    }
}
