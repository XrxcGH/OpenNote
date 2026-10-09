//! Just enough HTTP/1.1 for one request and one response per connection, with hard limits. The listener only ever
//! talks to programs on this PC, but any of them could be hostile, so every part of a request is bounded and
//! checked: the head is at most [`Limits::head`] bytes with at most 64 headers, a body needs `Content-Length` and
//! fits [`Limits::body`], and `Transfer-Encoding` is refused. The client in [`crate::client`] reads responses with
//! the same code.

use std::{
    fmt,
    io::{self, Read, Write},
};

/// The most headers one message may have.
pub const MAX_HEADERS: usize = 64;

/// Size limits for one message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// The request or status line and the headers.
    pub head: usize,
    /// The body.
    pub body: usize,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            head: 16 * 1024,
            // A clip with a full-page screenshot is the largest body the API takes.
            body: 25 * 1024 * 1024,
        }
    }
}

/// Why a message couldn't be read.
#[derive(Debug)]
pub enum HttpError {
    /// The connection closed or failed.
    Io(io::Error),
    /// The message isn't HTTP/1.1 the way this reader takes it.
    Malformed(&'static str),
    /// The head or the body is too large.
    TooLarge,
    /// `Transfer-Encoding`, which this reader never takes.
    Unsupported,
}

impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "the connection failed: {error}"),
            Self::Malformed(what) => write!(f, "the message is malformed: {what}"),
            Self::TooLarge => f.write_str("the message is too large"),
            Self::Unsupported => f.write_str("the message uses a transfer encoding"),
        }
    }
}

impl std::error::Error for HttpError {}

impl From<io::Error> for HttpError {
    fn from(error: io::Error) -> HttpError {
        HttpError::Io(error)
    }
}

/// A request, with header names in lowercase and the path's query split off.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Request {
    pub method: String,
    /// The path without its query, still percent-encoded.
    pub path: String,
    /// The query's pairs, decoded.
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    /// The first value of a header, by its lowercase name.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// The first value of a query parameter.
    pub fn query(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// The path's segments, decoded. `None` when a segment decodes to something a path segment can't be.
    pub fn segments(&self) -> Option<Vec<String>> {
        self.path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(|segment| {
                let decoded = percent_decode(segment)?;
                let plain = !decoded.is_empty() && !decoded.contains(['/', '\\']) && decoded != "..";
                plain.then_some(decoded)
            })
            .collect()
    }
}

/// A response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16) -> Response {
        Response {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    pub fn json(status: u16, value: &serde_json::Value) -> Response {
        let mut response = Response::new(status);
        response.body = serde_json::to_vec(value).unwrap_or_default();
        response.set("Content-Type", "application/json; charset=utf-8");
        response
    }

    pub fn text(status: u16, content_type: &str, text: &str) -> Response {
        let mut response = Response::new(status);
        response.body = text.as_bytes().to_vec();
        response.set("Content-Type", content_type);
        response
    }

    /// An error as `{ "error": code, "message": message }`.
    pub fn error(status: u16, code: &str, message: &str) -> Response {
        Response::json(status, &serde_json::json!({ "error": code, "message": message }))
    }

    pub fn set(&mut self, name: &str, value: &str) {
        self.headers.retain(|(key, _)| !key.eq_ignore_ascii_case(name));
        self.headers.push((name.to_owned(), value.to_owned()));
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// The body as JSON, for clients.
    pub fn json_body(&self) -> Option<serde_json::Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// The reason phrase of the statuses the API uses.
pub fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        421 => "Misdirected Request",
        423 => "Locked",
        429 => "Too Many Requests",
        501 => "Not Implemented",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

/// Reads the head of a message: everything up to the blank line. Bytes after it that were already read are
/// returned as the start of the body.
fn read_head(stream: &mut impl Read, limit: usize) -> Result<(String, Vec<u8>), HttpError> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        if let Some(end) = find(&buffer, b"\r\n\r\n") {
            // A whole head can arrive in one read, so the limit is checked here too.
            if end > limit {
                return Err(HttpError::TooLarge);
            }
            let rest = buffer.split_off(end + 4);
            buffer.truncate(end);
            let head = String::from_utf8(buffer).map_err(|_| HttpError::Malformed("the head isn't UTF-8"))?;
            return Ok((head, rest));
        }
        if buffer.len() > limit {
            return Err(HttpError::TooLarge);
        }
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(HttpError::Malformed("the connection closed inside the head"));
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn parse_headers<'a>(lines: impl Iterator<Item = &'a str>) -> Result<Vec<(String, String)>, HttpError> {
    let mut headers = Vec::new();
    for line in lines {
        if headers.len() >= MAX_HEADERS {
            return Err(HttpError::TooLarge);
        }
        let (name, value) = line
            .split_once(':')
            .ok_or(HttpError::Malformed("a header without a colon"))?;
        let token = !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b));
        if !token || value.contains(['\r', '\n', '\0']) {
            return Err(HttpError::Malformed("a header name or value that isn't allowed"));
        }
        headers.push((name.to_ascii_lowercase(), value.trim().to_owned()));
    }
    Ok(headers)
}

/// Reads the body that `headers` announce, after the `already` bytes that came with the head.
fn read_body(
    stream: &mut impl Read,
    headers: &[(String, String)],
    already: Vec<u8>,
    limit: usize,
) -> Result<Vec<u8>, HttpError> {
    if headers.iter().any(|(name, _)| name == "transfer-encoding") {
        return Err(HttpError::Unsupported);
    }
    let mut lengths = headers.iter().filter(|(name, _)| name == "content-length");
    let length = match (lengths.next(), lengths.next()) {
        (None, _) => 0,
        (Some((_, value)), None) => value
            .parse::<usize>()
            .map_err(|_| HttpError::Malformed("a Content-Length that isn't a number"))?,
        (Some(_), Some(_)) => return Err(HttpError::Malformed("two Content-Length headers")),
    };
    if length > limit {
        return Err(HttpError::TooLarge);
    }
    let mut body = already;
    if body.len() > length {
        return Err(HttpError::Malformed("more bytes than Content-Length says"));
    }
    let missing = length - body.len();
    let start = body.len();
    body.resize(length, 0);
    stream.read_exact(&mut body[start..start + missing])?;
    Ok(body)
}

/// Reads one request.
pub fn read_request(stream: &mut impl Read, limits: &Limits) -> Result<Request, HttpError> {
    let (head, rest) = read_head(stream, limits.head)?;
    let mut lines = head.split("\r\n");
    let line = lines.next().unwrap_or_default();
    let mut parts = line.split(' ');
    let (Some(method), Some(target), Some(version), None) = (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(HttpError::Malformed("the request line"));
    };
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err(HttpError::Malformed("the HTTP version"));
    }
    if method.is_empty() || !method.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(HttpError::Malformed("the method"));
    }
    if !target.starts_with('/') {
        return Err(HttpError::Malformed("a target that isn't a path"));
    }
    let headers = parse_headers(lines)?;
    let body = read_body(stream, &headers, rest, limits.body)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let query = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            let decode = |text: &str| percent_decode(&text.replace('+', " "));
            match (decode(key), decode(value)) {
                (Some(key), Some(value)) => Ok((key, value)),
                _ => Err(HttpError::Malformed("the query")),
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Request {
        method: method.to_owned(),
        path: path.to_owned(),
        query,
        headers,
        body,
    })
}

/// Writes one response and its framing headers. The connection closes after it.
pub fn write_response(stream: &mut impl Write, response: &Response) -> io::Result<()> {
    let mut head = format!("HTTP/1.1 {} {}\r\n", response.status, reason(response.status));
    for (name, value) in &response.headers {
        if name.eq_ignore_ascii_case("content-length") || name.eq_ignore_ascii_case("connection") {
            continue;
        }
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        response.body.len()
    ));
    stream.write_all(head.as_bytes())?;
    stream.write_all(&response.body)?;
    stream.flush()
}

/// Writes one request, for clients.
pub fn write_request(stream: &mut impl Write, request: &Request, host: &str) -> io::Result<()> {
    let mut target = request.path.clone();
    if !request.query.is_empty() {
        let pairs: Vec<String> = request
            .query
            .iter()
            .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
            .collect();
        target.push('?');
        target.push_str(&pairs.join("&"));
    }
    let mut head = format!("{} {target} HTTP/1.1\r\nHost: {host}\r\n", request.method);
    for (name, value) in &request.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        request.body.len()
    ));
    stream.write_all(head.as_bytes())?;
    stream.write_all(&request.body)?;
    stream.flush()
}

/// Reads one response, for clients.
pub fn read_response(stream: &mut impl Read, limits: &Limits) -> Result<Response, HttpError> {
    let (head, rest) = read_head(stream, limits.head)?;
    let mut lines = head.split("\r\n");
    let line = lines.next().unwrap_or_default();
    let status = line
        .split(' ')
        .nth(1)
        .and_then(|status| status.parse::<u16>().ok())
        .filter(|_| line.starts_with("HTTP/1."))
        .ok_or(HttpError::Malformed("the status line"))?;
    let headers = parse_headers(lines)?;
    let body = read_body(stream, &headers, rest, limits.body)?;
    Ok(Response { status, headers, body })
}

/// Decodes `%XX` escapes. `None` for a bad escape or text that isn't UTF-8.
pub fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = text.get(at + 1..at + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    let decoded = String::from_utf8(out).ok()?;
    (!decoded.contains('\0')).then_some(decoded)
}

/// Encodes everything but unreserved characters.
pub fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(raw: &str) -> Result<Request, HttpError> {
        read_request(&mut raw.as_bytes(), &Limits::default())
    }

    #[test]
    fn reads_a_request_with_a_body_and_a_query() {
        let raw =
            "POST /v1/search?q=cell%20wall&limit=5 HTTP/1.1\r\nHost: 127.0.0.1:5000\r\nContent-Length: 2\r\n\r\n{}";
        let request = read(raw).expect("a request");
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v1/search");
        assert_eq!(request.query("q"), Some("cell wall"));
        assert_eq!(request.query("limit"), Some("5"));
        assert_eq!(request.header("host"), Some("127.0.0.1:5000"));
        assert_eq!(request.body, b"{}");
    }

    #[test]
    fn refuses_what_it_does_not_take() {
        let limits = Limits { head: 64, body: 4 };
        let long = format!("GET / HTTP/1.1\r\nX: {}\r\n\r\n", "a".repeat(100));
        assert!(matches!(
            read_request(&mut long.as_bytes(), &limits),
            Err(HttpError::TooLarge)
        ));
        let big = "POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\n12345";
        assert!(matches!(
            read_request(&mut big.as_bytes(), &limits),
            Err(HttpError::TooLarge)
        ));
        for raw in [
            "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
            "GET http://evil/ HTTP/1.1\r\n\r\n",
            "GET / HTTP/2\r\n\r\n",
            "get / HTTP/1.1\r\n\r\n",
            "GET / HTTP/1.1\r\nBad Header: x\r\n\r\n",
            "GET / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx",
            "GET /?q=%zz HTTP/1.1\r\n\r\n",
        ] {
            assert!(read(raw).is_err(), "{raw}");
        }
        let many: String = (0..70).map(|at| format!("X{at}: 1\r\n")).collect();
        assert!(read(&format!("GET / HTTP/1.1\r\n{many}\r\n")).is_err());
    }

    #[test]
    fn path_segments_never_climb_or_hold_separators() {
        let request = |path: &str| Request {
            path: path.to_owned(),
            ..Request::default()
        };
        assert_eq!(
            request("/v1/pages/abc").segments(),
            Some(vec!["v1".into(), "pages".into(), "abc".into()])
        );
        assert_eq!(request("/v1/pages/..").segments(), None);
        assert_eq!(request("/v1/pages/a%2Fb").segments(), None);
        assert_eq!(request("/v1/pages/a%00b").segments(), None);
    }

    #[test]
    fn a_response_round_trips_through_the_client_reader() {
        let mut wire = Vec::new();
        let response = Response::json(201, &serde_json::json!({ "id": "p1" }));
        write_response(&mut wire, &response).expect("written");
        let back = read_response(&mut wire.as_slice(), &Limits::default()).expect("read");
        assert_eq!(back.status, 201);
        assert_eq!(back.json_body(), Some(serde_json::json!({ "id": "p1" })));
        assert_eq!(back.header("cache-control"), Some("no-store"));
    }

    #[test]
    fn encodes_and_decodes_query_text() {
        let text = "päge #1 & more/";
        assert_eq!(percent_decode(&percent_encode(text)).as_deref(), Some(text));
    }
}
