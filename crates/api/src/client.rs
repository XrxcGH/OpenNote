//! A client of the local API, for the `opennote` tool, the MCP server, and the tests.
//!
//! The app writes where it listens to `api-endpoint.json` in its local data folder (not secret), and keeps the key
//! that proves the listener is OpenNote's in the credential store. A client first asks `GET /v1/hello` with a
//! random nonce and checks the answer against that key, so it never sends its token to another program that took
//! the port or the pipe's name.

use std::{fmt, fs, io, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    grants::{random_hex, same},
    guard::PIPE_HOST,
    hmac::hmac_hex,
    http::{read_response, write_request, Limits, Request, Response},
};

/// Where the app listens, as `api-endpoint.json` says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub port: u16,
    #[serde(default)]
    pub pipe: Option<String>,
}

/// The file's name in the app's local data folder.
pub const DISCOVERY_FILE: &str = "api-endpoint.json";

/// The credential that holds the proof key, as hex.
pub const PROOF_TARGET: &str = "OpenNote/api/endpoint";

pub fn write_discovery(path: &Path, discovery: &Discovery) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::write(path, serde_json::to_vec_pretty(discovery).map_err(io::Error::other)?)
}

pub fn read_discovery(path: &Path) -> Option<Discovery> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// How to reach the listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    Tcp(u16),
    Pipe(String),
}

/// Why a call failed before the API answered.
#[derive(Debug)]
pub enum ClientError {
    /// Nothing listens: OpenNote isn't running, or "Let apps on this PC connect" is off.
    NotRunning,
    /// Something listens that can't prove it is OpenNote.
    NotOpenNote,
    Io(io::Error),
}

impl fmt::Display for ClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRunning => f.write_str(
                "OpenNote isn't running, or apps can't connect. Open OpenNote, and check Settings, Privacy, App permissions.",
            ),
            Self::NotOpenNote => f.write_str("The program listening isn't OpenNote, so nothing was sent to it."),
            Self::Io(error) => write!(f, "The connection to OpenNote failed: {error}"),
        }
    }
}

impl std::error::Error for ClientError {}

/// A client with an optional token.
#[derive(Debug, Clone)]
pub struct Client {
    pub endpoint: Endpoint,
    pub token: Option<String>,
}

impl Client {
    pub fn new(endpoint: Endpoint) -> Client {
        Client { endpoint, token: None }
    }

    pub fn with_token(mut self, token: Option<String>) -> Client {
        self.token = token;
        self
    }

    fn host(&self) -> String {
        match &self.endpoint {
            Endpoint::Tcp(port) => format!("127.0.0.1:{port}"),
            Endpoint::Pipe(_) => PIPE_HOST.to_owned(),
        }
    }

    /// Sends one request and reads the answer.
    pub fn send(&self, mut request: Request) -> Result<Response, ClientError> {
        if let Some(token) = &self.token {
            request
                .headers
                .push(("Authorization".into(), format!("Bearer {token}")));
        }
        let host = self.host();
        let limits = Limits {
            head: 16 * 1024,
            body: 64 * 1024 * 1024,
        };
        let refused = |error: io::Error| match error.kind() {
            io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound => ClientError::NotRunning,
            _ => ClientError::Io(error),
        };
        let read = |error| match error {
            crate::http::HttpError::Io(error) => ClientError::Io(error),
            other => ClientError::Io(io::Error::other(other.to_string())),
        };
        match &self.endpoint {
            Endpoint::Tcp(port) => {
                let mut stream = crate::server::connect_tcp(*port).map_err(refused)?;
                write_request(&mut stream, &request, &host).map_err(ClientError::Io)?;
                read_response(&mut stream, &limits).map_err(read)
            }
            #[cfg(windows)]
            Endpoint::Pipe(name) => {
                let mut stream = crate::server::connect_pipe(name).map_err(|_| ClientError::NotRunning)?;
                write_request(&mut stream, &request, &host).map_err(ClientError::Io)?;
                read_response(&mut stream, &limits).map_err(read)
            }
            #[cfg(not(windows))]
            Endpoint::Pipe(_) => Err(ClientError::NotRunning),
        }
    }

    /// `GET`, with query pairs.
    pub fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Response, ClientError> {
        self.send(Request {
            method: "GET".into(),
            path: path.into(),
            query: query
                .iter()
                .map(|(key, value)| ((*key).into(), (*value).into()))
                .collect(),
            ..Request::default()
        })
    }

    /// `POST` with a JSON body.
    pub fn post(&self, path: &str, body: &Value) -> Result<Response, ClientError> {
        self.send(Request {
            method: "POST".into(),
            path: path.into(),
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: serde_json::to_vec(body).unwrap_or_default(),
            ..Request::default()
        })
    }

    /// Checks that the listener knows `key`, before any token is sent.
    pub fn verify(&self, key: &[u8]) -> Result<(), ClientError> {
        let nonce = random_hex(16);
        let answer = Client::new(self.endpoint.clone()).get("/v1/hello", &[("nonce", &nonce)])?;
        let proof = answer
            .json_body()
            .and_then(|body| body["proof"].as_str().map(str::to_owned))
            .unwrap_or_default();
        if answer.status == 200 && same(&proof, &hmac_hex(key, nonce.as_bytes())) {
            Ok(())
        } else {
            Err(ClientError::NotOpenNote)
        }
    }
}

/// Decodes hex, for the proof key.
pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok())
        .collect()
}
