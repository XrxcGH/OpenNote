//! Reading MIME messages: the `.mht` and `.mhtml` files that browsers and OneNote save as single web pages.
//!
//! A web page archive is a message in the MIME format. A `multipart/related` body holds the HTML first. Further
//! parts hold the images and styles that the page uses. A `Content-Location` or a `Content-ID` names each part.
//! The reader splits the parts and decodes their transfer encoding, which is base64 or quoted-printable. It also
//! flattens nested multiparts.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

/// A part of a message, decoded.
#[derive(Clone, Debug, Default)]
pub struct Part {
    /// The media type in lowercase, such as `text/html`.
    pub content_type: String,
    /// The `charset` parameter, if any.
    pub charset: Option<String>,
    /// The `Content-Location`, which the HTML uses as an address.
    pub location: Option<String>,
    /// The `Content-ID` without its angle brackets, which `cid:` addresses use.
    pub id: Option<String>,
    /// A file name from `Content-Disposition` or the type's `name` parameter.
    pub file_name: Option<String>,
    /// The decoded body.
    pub body: Vec<u8>,
}

/// A parsed message.
#[derive(Clone, Debug, Default)]
pub struct Message {
    /// The `Subject` header, decoded.
    pub subject: Option<String>,
    /// The `Date` header as written.
    pub date: Option<String>,
    /// The `From` header, decoded.
    pub from: Option<String>,
    /// The `To` header, decoded.
    pub to: Option<String>,
    /// The `Cc` header, decoded.
    pub cc: Option<String>,
    /// The parts that are not containers, in order.
    pub parts: Vec<Part>,
    /// The `start` parameter of a `multipart/related` message: the Content-ID of the main part.
    pub start: Option<String>,
}

/// The deepest nesting of multiparts that is followed.
const MAX_DEPTH: usize = 6;

/// Reads a message from its bytes.
pub fn parse(bytes: &[u8]) -> Message {
    let mut message = Message::default();
    let (headers, body) = split_headers(bytes);
    message.subject = header(&headers, "subject").map(|s| decode_words(&s));
    message.date = header(&headers, "date");
    message.from = header(&headers, "from").map(|s| decode_words(&s));
    message.to = header(&headers, "to").map(|s| decode_words(&s));
    message.cc = header(&headers, "cc").map(|s| decode_words(&s));
    if let Some(start) = header(&headers, "content-type").and_then(|ct| param(&ct, "start")) {
        message.start = Some(start.trim_matches(['<', '>']).to_owned());
    }
    read_entity(&headers, body, &mut message.parts, 0);
    message
}

type Headers = Vec<(String, String)>;

fn header(headers: &Headers, name: &str) -> Option<String> {
    headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone())
}

/// Splits a message or part into its unfolded headers and its body.
fn split_headers(bytes: &[u8]) -> (Headers, &[u8]) {
    let (head_end, body_start) = find_blank_line(bytes);
    let head = String::from_utf8_lossy(&bytes[..head_end]).into_owned();
    let mut headers: Headers = Vec::new();
    for line in head.lines() {
        if line.starts_with([' ', '\t']) {
            if let Some((_, value)) = headers.last_mut() {
                value.push(' ');
                value.push_str(line.trim());
            }
        } else if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
        }
    }
    (headers, &bytes[body_start..])
}

/// The end of the headers and the start of the body: a blank line, with `\r\n` or `\n` line ends.
fn find_blank_line(bytes: &[u8]) -> (usize, usize) {
    for (i, window) in bytes.windows(4).enumerate() {
        if window == b"\r\n\r\n" {
            return (i, i + 4);
        }
    }
    for (i, window) in bytes.windows(2).enumerate() {
        if window == b"\n\n" {
            return (i, i + 2);
        }
    }
    (bytes.len(), bytes.len())
}

/// The value of a parameter of a header such as `Content-Type`, without quotes.
fn param(value: &str, name: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    let needle = format!("{name}=");
    let mut from = 0;
    while let Some(found) = lower[from..].find(&needle) {
        let at = from + found;
        let boundary_ok = at == 0 || lower[..at].ends_with([';', ' ', '\t']);
        from = at + needle.len();
        if !boundary_ok {
            continue;
        }
        let rest = &value[from..];
        return Some(match rest.strip_prefix('"') {
            Some(quoted) => quoted.split('"').next().unwrap_or("").to_owned(),
            None => rest.split([';', ' ']).next().unwrap_or("").to_owned(),
        });
    }
    None
}

fn read_entity(headers: &Headers, body: &[u8], parts: &mut Vec<Part>, depth: usize) {
    let content_type = header(headers, "content-type").unwrap_or_else(|| "text/plain".to_owned());
    let base = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if base.starts_with("multipart/") && depth < MAX_DEPTH {
        if let Some(boundary) = param(&content_type, "boundary") {
            for piece in split_multipart(body, &boundary) {
                let (inner_headers, inner_body) = split_headers(piece);
                read_entity(&inner_headers, inner_body, parts, depth + 1);
            }
            return;
        }
    }
    let encoding = header(headers, "content-transfer-encoding")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let decoded = match encoding.as_str() {
        "base64" => {
            let packed: Vec<u8> = body.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
            STANDARD.decode(packed).unwrap_or_default()
        }
        "quoted-printable" => decode_quoted_printable(body),
        _ => body.to_vec(),
    };
    let disposition = header(headers, "content-disposition").unwrap_or_default();
    parts.push(Part {
        content_type: base,
        charset: param(&content_type, "charset"),
        location: header(headers, "content-location").map(|l| l.trim().to_owned()),
        id: header(headers, "content-id").map(|i| i.trim().trim_matches(['<', '>']).to_owned()),
        file_name: param(&disposition, "filename")
            .or_else(|| param(&content_type, "name"))
            .map(|n| decode_words(&n)),
        body: decoded,
    });
}

/// The bodies between the boundary lines of a multipart body.
fn split_multipart<'a>(body: &'a [u8], boundary: &str) -> Vec<&'a [u8]> {
    let marker = format!("--{boundary}");
    let marker = marker.as_bytes();
    let mut pieces = Vec::new();
    let mut starts = Vec::new();
    let mut at = 0;
    while at + marker.len() <= body.len() {
        let line_start = at == 0 || body[at - 1] == b'\n';
        if line_start && body[at..].starts_with(marker) {
            starts.push(at);
            at += marker.len();
        } else {
            at += 1;
        }
    }
    for pair in starts.windows(2) {
        let (from, to) = (pair[0] + marker.len(), pair[1]);
        let piece = &body[from..to];
        if piece.starts_with(b"--") {
            break;
        }
        pieces.push(trim_line_ends(piece));
    }
    pieces
}

/// Removes the line break after a boundary and the one before the next.
fn trim_line_ends(piece: &[u8]) -> &[u8] {
    let piece = piece
        .strip_prefix(b"\r\n")
        .or_else(|| piece.strip_prefix(b"\n"))
        .unwrap_or(piece);
    piece
        .strip_suffix(b"\r\n")
        .or_else(|| piece.strip_suffix(b"\n"))
        .unwrap_or(piece)
}

fn decode_quoted_printable(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] != b'=' {
            out.push(input[i]);
            i += 1;
            continue;
        }
        if input.get(i + 1) == Some(&b'\r') && input.get(i + 2) == Some(&b'\n') {
            i += 3;
        } else if input.get(i + 1) == Some(&b'\n') {
            i += 2;
        } else if let (Some(h), Some(l)) = (hex_digit(input.get(i + 1)), hex_digit(input.get(i + 2))) {
            out.push(h * 16 + l);
            i += 3;
        } else {
            out.push(b'=');
            i += 1;
        }
    }
    out
}

fn hex_digit(byte: Option<&u8>) -> Option<u8> {
    char::from(*byte?).to_digit(16).and_then(|d| u8::try_from(d).ok())
}

/// Decodes RFC 2047 encoded words such as `=?utf-8?B?...?=` in a header.
pub fn decode_words(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("=?") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(word_end) = after.find("?=") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let word = &after[..word_end];
        match decode_word(word) {
            Some(decoded) => out.push_str(&decoded),
            None => out.push_str(&rest[start..start + 4 + word_end]),
        }
        rest = &after[word_end + 2..];
        if rest.trim_start().starts_with("=?") {
            rest = rest.trim_start();
        }
    }
    out.push_str(rest);
    out
}

fn decode_word(word: &str) -> Option<String> {
    let mut pieces = word.splitn(3, '?');
    let (charset, encoding, data) = (pieces.next()?, pieces.next()?, pieces.next()?);
    let bytes = match encoding.to_ascii_lowercase().as_str() {
        "b" => STANDARD.decode(data).ok()?,
        "q" => decode_quoted_printable(data.replace('_', " ").as_bytes()),
        _ => return None,
    };
    Some(crate::text::decode_labelled(&bytes, charset).text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<u8> {
        let png = STANDARD.encode(b"\x89PNG fake bytes");
        format!(
            "From: <Saved by OneNote>\r\nSubject: =?utf-8?B?Q2Fmw6k=?= notes\r\nDate: Fri, 02 Oct 2026 10:15:00 +0000\r\n\
             MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_Part_1\"; type=\"text/html\"\r\n\r\n\
             ------=_Part_1\r\nContent-Type: text/html; charset=\"windows-1252\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\
             Content-Location: file:///C:/notes/page.htm\r\n\r\n<p>caf=E9 =\r\nau lait</p>\r\n\
             ------=_Part_1\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <img1@host>\r\n\
             Content-Location: file:///C:/notes/image001.png\r\n\r\n{png}\r\n------=_Part_1--\r\n"
        )
        .into_bytes()
    }

    #[test]
    fn parts_are_split_and_decoded() {
        let message = parse(&sample());
        assert_eq!(message.subject.as_deref(), Some("Caf\u{e9} notes"));
        assert_eq!(message.parts.len(), 2);
        let html = &message.parts[0];
        assert_eq!(html.content_type, "text/html");
        assert_eq!(html.charset.as_deref(), Some("windows-1252"));
        assert_eq!(html.location.as_deref(), Some("file:///C:/notes/page.htm"));
        assert_eq!(html.body, b"<p>caf\xe9 au lait</p>");
        let image = &message.parts[1];
        assert_eq!(
            (image.content_type.as_str(), image.id.as_deref()),
            ("image/png", Some("img1@host"))
        );
        assert_eq!(image.body, b"\x89PNG fake bytes");
    }

    #[test]
    fn nested_multiparts_and_plain_messages_work() {
        let nested = b"Content-Type: multipart/mixed; boundary=outer\n\n--outer\nContent-Type: multipart/alternative; boundary=inner\n\n\
            --inner\nContent-Type: text/plain\n\nplain\n--inner\nContent-Type: text/html\n\n<b>html</b>\n--inner--\n--outer--\n";
        let message = parse(nested);
        assert_eq!(message.parts.len(), 2);
        assert_eq!(message.parts[1].body, b"<b>html</b>");
        let plain = parse(b"Subject: Hi\n\nJust text");
        assert_eq!(
            (plain.parts.len(), plain.parts[0].body.as_slice()),
            (1, &b"Just text"[..])
        );
    }

    #[test]
    fn encoded_words_decode_and_odd_ones_stay() {
        assert_eq!(decode_words("=?iso-8859-1?Q?caf=E9_noir?="), "caf\u{e9} noir");
        assert_eq!(decode_words("plain =? broken"), "plain =? broken");
        assert_eq!(decode_words("=?utf-8?B?QQ==?= =?utf-8?B?Qg==?="), "AB");
    }
}
