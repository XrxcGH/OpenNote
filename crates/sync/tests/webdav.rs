//! Sync through a WebDAV server: a small one in this process, on a loopback port, that keeps files in memory and
//! asks for a test user name and password. Nothing reaches a network.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use common::*;
use opennote_sync::{Backend, SyncError, WebDavBackend, WebDavConfig};
use zeroize::Zeroizing;

#[derive(Default)]
struct Dav {
    files: BTreeMap<String, Vec<u8>>,
    dirs: BTreeSet<String>,
    requests: Vec<String>,
}

/// "Basic " and the base64 of `sam:test-only`.
const AUTH: &str = "Basic c2FtOnRlc3Qtb25seQ==";

fn serve(listener: TcpListener, dav: Arc<Mutex<Dav>>, no_move: bool) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let dav = dav.clone();
        thread::spawn(move || {
            let _ = connection(stream, dav, no_move);
        });
    }
}

fn connection(stream: TcpStream, dav: Arc<Mutex<Dav>>, no_move: bool) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut out = stream;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let mut parts = line.split_whitespace();
        let (method, target) = (
            parts.next().unwrap_or("").to_owned(),
            parts.next().unwrap_or("").to_owned(),
        );
        let mut headers = BTreeMap::new();
        loop {
            let mut header = String::new();
            reader.read_line(&mut header)?;
            let header = header.trim_end();
            if header.is_empty() {
                break;
            }
            if let Some((k, v)) = header.split_once(':') {
                headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_owned());
            }
        }
        let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let mut body = vec![0; len];
        reader.read_exact(&mut body)?;
        let (status, reply) = handle(&dav, &method, &target, &headers, body, no_move);
        let head_only = method == "HEAD";
        write!(out, "HTTP/1.1 {status} X\r\nContent-Length: {}\r\n", reply.len())?;
        if status == 207 {
            write!(out, "Content-Type: application/xml\r\n")?;
        }
        write!(out, "\r\n")?;
        if !head_only {
            out.write_all(&reply)?;
        }
        out.flush()?;
    }
}

fn parent(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/"),
        None => "/".into(),
    }
}

fn handle(
    dav: &Mutex<Dav>,
    method: &str,
    target: &str,
    headers: &BTreeMap<String, String>,
    body: Vec<u8>,
    no_move: bool,
) -> (u16, Vec<u8>) {
    let mut dav = dav.lock().expect("lock");
    dav.requests.push(format!("{method} {target}"));
    if headers.get("authorization").map(String::as_str) != Some(AUTH) {
        return (401, Vec::new());
    }
    let path = target.to_owned();
    let dir_exists = |dav: &Dav, dir: &str| dir == "/" || dir == "/dav/" || dav.dirs.contains(dir);
    match method {
        "MKCOL" => {
            if dav.dirs.contains(&path) || dav.files.contains_key(path.trim_end_matches('/')) {
                (405, Vec::new())
            } else if !dir_exists(&dav, &parent(&path)) {
                (409, Vec::new())
            } else {
                dav.dirs.insert(path);
                (201, Vec::new())
            }
        }
        "PUT" => {
            if !dir_exists(&dav, &parent(&path)) {
                return (409, Vec::new());
            }
            dav.files.insert(path, body);
            (201, Vec::new())
        }
        "GET" | "HEAD" => match dav.files.get(&path) {
            Some(bytes) => (200, bytes.clone()),
            None => (404, Vec::new()),
        },
        "DELETE" => {
            let removed = dav.files.remove(&path).is_some();
            (if removed { 204 } else { 404 }, Vec::new())
        }
        "MOVE" if no_move => (405, Vec::new()),
        "MOVE" => {
            let destination = headers.get("destination").cloned().unwrap_or_default();
            let to = destination
                .split_once("://")
                .and_then(|(_, r)| r.split_once('/'))
                .map(|(_, p)| format!("/{p}"));
            match (to, dav.files.remove(&path)) {
                (Some(to), Some(bytes)) if dir_exists(&dav, &parent(&to)) => {
                    dav.files.insert(to, bytes);
                    (201, Vec::new())
                }
                (_, Some(bytes)) => {
                    dav.files.insert(path, bytes);
                    (409, Vec::new())
                }
                _ => (404, Vec::new()),
            }
        }
        "PROPFIND" => {
            if !dav.dirs.contains(&path) && path != "/dav/" {
                return (404, Vec::new());
            }
            let mut xml = String::from(r#"<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">"#);
            let entry = |href: &str, folder: bool| {
                let kind = if folder { "<D:collection/>" } else { "" };
                format!("<D:response><D:href>{href}</D:href><D:propstat><D:prop><D:resourcetype>{kind}</D:resourcetype></D:prop></D:propstat></D:response>")
            };
            xml.push_str(&entry(&path, true));
            for dir in dav.dirs.iter().filter(|d| parent(d) == path && **d != path) {
                xml.push_str(&entry(dir, true));
            }
            for file in dav.files.keys().filter(|f| parent(f) == path) {
                // Some servers send whole addresses and escape characters; the client must cope.
                xml.push_str(&entry(
                    &format!("http://127.0.0.1{}", file.replacen("/dav/", "/d%61v/", 1)),
                    false,
                ));
            }
            xml.push_str("</D:multistatus>");
            (207, xml.into_bytes())
        }
        _ => (405, Vec::new()),
    }
}

fn server(no_move: bool) -> (String, Arc<Mutex<Dav>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds");
    let port = listener.local_addr().expect("addr").port();
    let dav = Arc::new(Mutex::new(Dav::default()));
    let shared = dav.clone();
    thread::spawn(move || serve(listener, shared, no_move));
    (format!("http://127.0.0.1:{port}/dav/"), dav)
}

fn backend(url: &str, password: &str) -> Arc<dyn Backend> {
    let config = WebDavConfig {
        url: url.to_owned(),
        username: "sam".into(),
        password: Zeroizing::new(password.into()),
    };
    Arc::new(WebDavBackend::new(&config).expect("backend"))
}

#[test]
fn two_devices_sync_through_a_webdav_server() {
    for no_move in [false, true] {
        let (url, dav) = server(no_move);
        let store = backend(&url, "test-only");
        let d = devices(store.clone(), 2);
        d[0].write(
            &format!("{}/page.json", page_dir(1)),
            &page(1, "Over WebDAV", 1, &[], 1_000, &[]),
        );
        d[0].write("Bio/big.bin", &vec![8u8; 1024 * 1024 + 9]);
        settle(&d, 3);
        assert_eq!(d[1].files(), d[0].files());
        d[1].remove("Bio/big.bin");
        settle(&d, 3);
        assert_eq!(d[0].read("Bio/big.bin"), None);
        let dav = dav.lock().expect("lock");
        assert!(
            dav.files.keys().all(|k| !k.contains("Bio") && !k.contains("page")),
            "no names on the server"
        );
        assert!(
            !dav.files.keys().any(|k| k.starts_with("/dav/tmp/") && no_move),
            "direct puts leave no temp files"
        );
        if !no_move {
            assert!(
                dav.requests.iter().any(|r| r.starts_with("MOVE ")),
                "blobs are moved into place"
            );
        }
    }
}

#[test]
fn a_wrong_password_says_so_calmly() {
    let (url, _) = server(false);
    let store = backend(&url, "wrong");
    let error = store.put("vault", b"x").unwrap_err();
    assert!(
        matches!(&error, SyncError::Storage(why) if why.contains("user name or password")),
        "{error}"
    );
    assert!(error.to_string().contains("Check the folder or server"));
}

#[test]
fn a_server_that_is_not_there_is_an_error_not_a_hang() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);
    let store = backend(&format!("http://127.0.0.1:{port}/dav/"), "test-only");
    assert!(matches!(store.get("vault"), Err(SyncError::Storage(_))));
}
