//! A WebDAV server as storage: Nextcloud, ownCloud, a NAS, or any server that speaks RFC 4918. A blob is written
//! to `tmp/` and moved into place, so readers never see half of one. Servers without MOVE get a direct PUT.
//!
//! The address must use HTTPS, except for a server on this computer (`localhost`, `127.0.0.1`, or `[::1]`), so the
//! sign-in never crosses a network in the clear. The password stays in a `zeroize` buffer and is never logged.

use std::collections::HashSet;
use std::io::Read;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use quick_xml::events::Event;
use quick_xml::Reader;
use ureq::http::{Method, Request};
use ureq::Agent;
use zeroize::Zeroizing;

use super::{check, max_size, too_large, valid_name, Backend};
use crate::crypto::{hex, random};
use crate::error::{Result, SyncError};

/// The biggest response read: a head of a very large notebook fits well inside it.
const MAX_BODY: u64 = 256 * 1024 * 1024;
/// How deep a listing goes.
const MAX_DEPTH: usize = 4;

/// Where the server is and how to sign in.
#[derive(Clone)]
pub struct WebDavConfig {
    /// The folder's address, such as `https://cloud.example.com/remote.php/dav/files/sam/OpenNote/`.
    pub url: String,
    /// The user name, or empty for none.
    pub username: String,
    /// The password or app password.
    pub password: Zeroizing<String>,
}

impl std::fmt::Debug for WebDavConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebDavConfig")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// Storage on a WebDAV server.
pub struct WebDavBackend {
    base: String,
    /// The path part of `base`, to read hrefs against.
    base_path: String,
    auth: Option<Zeroizing<String>>,
    agent: Agent,
    made: Mutex<HashSet<String>>,
}

fn net(error: ureq::Error) -> SyncError {
    SyncError::Storage(match error {
        ureq::Error::Timeout(_) => "the server took too long to answer".into(),
        ureq::Error::HostNotFound => "the server's name wasn't found".into(),
        ureq::Error::ConnectionFailed => "the connection failed".into(),
        _ => "the connection broke".into(),
    })
}

fn status_error(status: u16) -> SyncError {
    SyncError::Storage(match status {
        401 | 403 => "the server refused the user name or password".into(),
        507 => "the server is out of space".into(),
        _ => format!("the server answered {status}"),
    })
}

/// Splits `scheme://host/path` into the host and the path, and checks the scheme.
fn parse(url: &str) -> Result<(String, String)> {
    let bad = || SyncError::Storage("the address isn't a WebDAV folder address".into());
    let (scheme, rest) = url.split_once("://").ok_or_else(bad)?;
    let (host, path) = rest
        .split_once('/')
        .map(|(h, p)| (h, format!("/{p}")))
        .unwrap_or((rest, "/".into()));
    let bare = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let name = if bare.starts_with('[') {
        bare.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        bare.split(':').next().unwrap_or("").to_owned()
    };
    let local = matches!(name.as_str(), "localhost" | "127.0.0.1" | "[::1]");
    match scheme.to_ascii_lowercase().as_str() {
        "https" => {}
        "http" if local => {}
        "http" => return Err(SyncError::Storage("the address must start with https://".into())),
        _ => return Err(bad()),
    }
    if host.is_empty() || host.contains('@') {
        return Err(bad());
    }
    Ok((format!("{scheme}://{host}"), path))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let pair = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(pair, 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The hrefs of a PROPFIND answer, each with whether it is a folder.
fn read_multistatus(xml: &[u8]) -> Vec<(String, bool)> {
    let mut reader = Reader::from_reader(xml);
    let mut out = Vec::new();
    let (mut href, mut folder, mut in_href) = (None::<String>, false, false);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                "response" => {
                    href = None;
                    folder = false;
                }
                "href" => in_href = true,
                "collection" => folder = true,
                _ => {}
            },
            Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() == "collection" {
                    folder = true;
                }
            }
            Ok(Event::Text(t)) if in_href => {
                let text: &str = t.as_ref();
                let text = text.trim().to_owned();
                href = Some(href.unwrap_or_default() + &text);
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                "href" => in_href = false,
                "response" => {
                    if let Some(h) = href.take() {
                        out.push((h, folder));
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
        if out.len() > 1_000_000 {
            break;
        }
    }
    out
}

impl WebDavBackend {
    /// Storage at the configured folder. Nothing is sent until the first request.
    pub fn new(config: &WebDavConfig) -> Result<WebDavBackend> {
        let url = if config.url.ends_with('/') {
            config.url.clone()
        } else {
            format!("{}/", config.url)
        };
        let (_, base_path) = parse(&url)?;
        let auth = (!config.username.is_empty() || !config.password.is_empty()).then(|| {
            let joined = Zeroizing::new(format!("{}:{}", config.username, config.password.as_str()));
            Zeroizing::new(format!("Basic {}", base64(joined.as_bytes())))
        });
        let agent: Agent = Agent::config_builder()
            .http_status_as_error(false)
            .allow_non_standard_methods(true)
            .timeout_global(Some(Duration::from_secs(120)))
            .build()
            .into();
        Ok(WebDavBackend {
            base: url,
            base_path,
            auth,
            agent,
            made: Mutex::new(HashSet::new()),
        })
    }

    fn request(&self, method: &str, name: &str, body: Vec<u8>, headers: &[(&str, String)]) -> Result<(u16, Vec<u8>)> {
        let mut response = self.send(method, name, body, headers)?;
        let status = response.status().as_u16();
        let bytes = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY)
            .read_to_vec()
            .map_err(net)?;
        Ok((status, bytes))
    }

    fn send(
        &self,
        method: &str,
        name: &str,
        body: Vec<u8>,
        headers: &[(&str, String)],
    ) -> Result<ureq::http::Response<ureq::Body>> {
        let method = Method::from_bytes(method.as_bytes()).map_err(|_| SyncError::Storage("bad method".into()))?;
        let mut builder = Request::builder().method(method).uri(format!("{}{}", self.base, name));
        if let Some(auth) = &self.auth {
            builder = builder.header("Authorization", auth.as_str());
        }
        for (key, value) in headers {
            builder = builder.header(*key, value.as_str());
        }
        let request = builder
            .body(body)
            .map_err(|_| SyncError::Storage("the address isn't valid".into()))?;
        self.agent.run(request).map_err(net)
    }

    fn make_dirs(&self, name: &str) -> Result<()> {
        let parts: Vec<&str> = name.split('/').collect();
        let mut dir = String::new();
        for part in &parts[..parts.len().saturating_sub(1)] {
            dir.push_str(part);
            dir.push('/');
            if self.made.lock().unwrap_or_else(PoisonError::into_inner).contains(&dir) {
                continue;
            }
            let (status, _) = self.request("MKCOL", &dir, Vec::new(), &[])?;
            // 201 made it, 405 says it exists already.
            if !(status == 201 || status == 405 || (200..300).contains(&status)) {
                return Err(status_error(status));
            }
            self.made
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(dir.clone());
        }
        Ok(())
    }

    /// The names under `dir` (which ends with a slash, or is empty for the root).
    fn walk(&self, dir: &str, depth: usize, out: &mut Vec<String>) -> Result<()> {
        if depth > MAX_DEPTH {
            return Ok(());
        }
        let body =
            br#"<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>"#;
        let (status, xml) = self.request(
            "PROPFIND",
            dir,
            body.to_vec(),
            &[("Depth", "1".into()), ("Content-Type", "application/xml".into())],
        )?;
        if status == 404 {
            return Ok(());
        }
        if status != 207 {
            return Err(status_error(status));
        }
        for (href, folder) in read_multistatus(&xml) {
            let path = match href.split_once("://") {
                Some((_, rest)) => rest.split_once('/').map(|(_, p)| format!("/{p}")).unwrap_or_default(),
                None => href,
            };
            let path = percent_decode(&path);
            let Some(rel) = path.strip_prefix(&self.base_path) else {
                continue;
            };
            let rel = rel.trim_end_matches('/');
            if rel.is_empty() || !valid_name(rel) || format!("{rel}/") == dir || !rel.starts_with(dir) {
                continue;
            }
            if folder {
                self.walk(&format!("{rel}/"), depth + 1, out)?;
            } else {
                out.push(rel.to_owned());
            }
        }
        Ok(())
    }
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

impl Backend for WebDavBackend {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>> {
        check(name)?;
        let mut response = self.send("GET", name, Vec::new(), &[])?;
        match response.status().as_u16() {
            200 => {
                // Read one byte past what OpenNote ever writes under this name, never the whole of a longer body.
                let limit = max_size(name);
                let mut bytes = Vec::new();
                response
                    .body_mut()
                    .with_config()
                    .limit(u64::MAX)
                    .reader()
                    .take(limit + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| SyncError::Storage(format!("the server's answer broke off ({})", e.kind())))?;
                if bytes.len() as u64 > limit {
                    return Err(too_large());
                }
                Ok(Some(bytes))
            }
            404 | 410 => Ok(None),
            status => Err(status_error(status)),
        }
    }

    fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
        check(name)?;
        self.make_dirs(name)?;
        self.make_dirs("tmp/x")?;
        let temp = format!("tmp/{}", hex(&random::<8>()?));
        let (status, _) = self.request("PUT", &temp, bytes.to_vec(), &[])?;
        if !(200..300).contains(&status) {
            return Err(status_error(status));
        }
        let destination = format!("{}{}", self.base, name);
        let (status, _) = self.request(
            "MOVE",
            &temp,
            Vec::new(),
            &[("Destination", destination), ("Overwrite", "T".into())],
        )?;
        if (200..300).contains(&status) {
            return Ok(());
        }
        // A server without MOVE: put the blob directly, then tidy up.
        let _ = self.request("DELETE", &temp, Vec::new(), &[]);
        match self.request("PUT", name, bytes.to_vec(), &[])? {
            (status, _) if (200..300).contains(&status) => Ok(()),
            (status, _) => Err(status_error(status)),
        }
    }

    fn exists(&self, name: &str) -> Result<bool> {
        check(name)?;
        match self.request("HEAD", name, Vec::new(), &[])? {
            (200..=299, _) => Ok(true),
            (404 | 410, _) => Ok(false),
            (status, _) => Err(status_error(status)),
        }
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>> {
        let dir = prefix
            .rsplit_once('/')
            .map(|(dir, _)| format!("{dir}/"))
            .unwrap_or_default();
        let mut out = Vec::new();
        self.walk(&dir, 0, &mut out)?;
        out.retain(|name| name.starts_with(prefix) && !name.starts_with("tmp/"));
        out.sort();
        out.dedup();
        Ok(out)
    }

    fn delete(&self, name: &str) -> Result<()> {
        check(name)?;
        match self.request("DELETE", name, Vec::new(), &[])? {
            (200..=299 | 404 | 410, _) => Ok(()),
            (status, _) => Err(status_error(status)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_must_be_https_unless_on_this_computer() {
        assert!(parse("https://cloud.example.com/dav/").is_ok());
        assert!(parse("http://127.0.0.1:8080/dav/").is_ok());
        assert!(parse("http://localhost/dav/").is_ok());
        assert!(parse("http://[::1]:9/").is_ok());
        assert!(parse("http://cloud.example.com/dav/").is_err());
        assert!(parse("ftp://cloud.example.com/").is_err());
        assert!(
            parse("https://user:pw@cloud.example.com/").is_err(),
            "no passwords in the address"
        );
        assert!(parse("cloud.example.com").is_err());
    }

    #[test]
    fn basic_auth_and_hrefs_are_read_the_standard_way() {
        // RFC 7617's example: "Aladdin:open sesame".
        assert_eq!(base64(b"Aladdin:open sesame"), "QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(percent_decode("/dav/a%20b/c"), "/dav/a b/c");
        assert_eq!(percent_decode("100%"), "100%");
        let xml = br#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
            <d:response><d:href>/dav/h/</d:href><d:propstat><d:prop>
              <d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
            <d:response><d:href>https://x.example/dav/h/ab/1</d:href>
              <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
            </d:multistatus>"#;
        assert_eq!(
            read_multistatus(xml),
            [
                ("/dav/h/".to_owned(), true),
                ("https://x.example/dav/h/ab/1".to_owned(), false)
            ]
        );
        assert!(read_multistatus(b"<not xml").is_empty());
    }
}
