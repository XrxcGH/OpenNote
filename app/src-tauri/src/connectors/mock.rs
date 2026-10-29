//! A small HTTP server on 127.0.0.1 for the tests, standing in for a service's token and API endpoints. It
//! answers each path from a list of canned replies, in order, repeating the last one, and records every request so
//! a test can check what OpenNote sent. It also has the doubles for the browser and the clock.

use std::{
    io::{Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, PoisonError,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

impl Reply {
    pub fn json(status: u16, body: serde_json::Value) -> Reply {
        Reply {
            status,
            body: body.to_string(),
            headers: vec![("Content-Type".into(), "application/json".into())],
        }
    }

    pub fn empty(status: u16) -> Reply {
        Reply {
            status,
            body: String::new(),
            headers: Vec::new(),
        }
    }

    pub fn redirect(location: &str) -> Reply {
        Reply {
            status: 302,
            body: String::new(),
            headers: vec![("Location".into(), location.into())],
        }
    }
}

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    /// The path and the query.
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// The value of a field of a form body.
    pub fn field(&self, name: &str) -> Option<String> {
        url::form_urlencoded::parse(self.body.as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    }
}

type Routes = Arc<Mutex<Vec<(String, Vec<Reply>)>>>;

pub struct MockServer {
    port: u16,
    routes: Routes,
    seen: Arc<Mutex<Vec<Recorded>>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl MockServer {
    pub fn start() -> MockServer {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("binds a port");
        listener.set_nonblocking(true).expect("non-blocking");
        let port = listener.local_addr().expect("has an address").port();
        let routes: Routes = Arc::default();
        let seen: Arc<Mutex<Vec<Recorded>>> = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let (routes, seen, stop) = (Arc::clone(&routes), Arc::clone(&seen), Arc::clone(&stop));
            thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => serve(stream, &routes, &seen),
                        Err(_) => thread::sleep(Duration::from_millis(5)),
                    }
                }
            })
        };
        MockServer {
            port,
            routes,
            seen,
            stop,
            worker: Some(worker),
        }
    }

    /// Answers `path` with these replies in turn.
    pub fn route(&self, path: &str, replies: Vec<Reply>) -> &MockServer {
        self.routes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((path.to_owned(), replies));
        self
    }

    pub fn clear_routes(&self) {
        self.routes.lock().unwrap_or_else(PoisonError::into_inner).clear();
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// The requests to one path.
    pub fn requests_to(&self, path: &str) -> Vec<Recorded> {
        let wanted = |request: &&Recorded| request.target.split('?').next() == Some(path);
        self.requests().iter().filter(wanted).cloned().collect()
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn serve(mut stream: TcpStream, routes: &Routes, seen: &Arc<Mutex<Vec<Recorded>>>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    let path = request.target.split('?').next().unwrap_or_default().to_owned();
    seen.lock().unwrap_or_else(PoisonError::into_inner).push(request);
    let reply = {
        let mut routes = routes.lock().unwrap_or_else(PoisonError::into_inner);
        match routes.iter_mut().find(|(route, _)| *route == path) {
            Some((_, replies)) if replies.len() > 1 => replies.remove(0),
            Some((_, replies)) => replies.first().cloned().unwrap_or_else(|| Reply::empty(500)),
            None => Reply::empty(404),
        }
    };
    let mut head = format!(
        "HTTP/1.1 {} Reply\r\nContent-Length: {}\r\nConnection: close\r\n",
        reply.status,
        reply.body.len()
    );
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    let _ = stream.write_all(format!("{head}\r\n{}", reply.body).as_bytes());
    let _ = stream.flush();
}

fn read_request(stream: &mut TcpStream) -> Option<Recorded> {
    let mut data = Vec::new();
    let mut buffer = [0u8; 2048];
    let end = loop {
        if let Some(at) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            break at + 4;
        }
        let count = stream.read(&mut buffer).ok().filter(|count| *count > 0)?;
        data.extend_from_slice(&buffer[..count]);
    };
    let head = String::from_utf8_lossy(&data[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let (method, target) = (first.next()?.to_owned(), first.next()?.to_owned());
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
        .collect();
    let length = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    while data.len() < end + length {
        let count = stream.read(&mut buffer).ok().filter(|count| *count > 0)?;
        data.extend_from_slice(&buffer[..count]);
    }
    Some(Recorded {
        method,
        target,
        headers,
        body: String::from_utf8_lossy(&data[end..end + length]).into_owned(),
    })
}

/// Helpers that make a connector entry whose endpoints are on the mock server.
pub mod fixtures {
    use super::MockServer;
    use crate::connectors::registry::{
        Access, AccountFrom, Auth, ConnectorDef, Group, Method, OAuthDef, Redirect, Revoke, SecretUse,
        STANDARD_RESPONSE,
    };

    fn leak<T>(value: T) -> &'static T {
        Box::leak(Box::new(value))
    }

    pub fn leak_str(text: String) -> &'static str {
        Box::leak(text.into_boxed_str())
    }

    /// OAuth settings that point at `/authorize`, `/token`, `/revoke`, and `/me` of the mock.
    pub fn oauth(server: &MockServer) -> OAuthDef {
        OAuthDef {
            authorize_url: leak_str(server.url("/authorize")),
            token_url: leak_str(server.url("/token")),
            revoke: Revoke::Form {
                url: leak_str(server.url("/revoke")),
                with_client: false,
            },
            scope_param: "scope",
            scope_separator: " ",
            extra_params: &[("access_type", "offline")],
            pkce: true,
            secret: SecretUse::Optional,
            redirect: Redirect::AnyPort,
            account: AccountFrom::Call {
                method: Method::Get,
                url: leak_str(server.url("/me")),
                pointer: "/email",
            },
            response: STANDARD_RESPONSE,
        }
    }

    pub fn connector(id: &'static str, auth: Auth) -> &'static ConnectorDef {
        leak(ConnectorDef {
            id,
            name: "Example",
            group: Group::Other,
            features: &["importOneNote"],
            hosts: &["127.0.0.1"],
            access: &[
                Access {
                    scope: "scope-a",
                    capability: "calendarRead",
                    writes: false,
                },
                Access {
                    scope: "scope-b",
                    capability: "tasksWrite",
                    writes: true,
                },
            ],
            auth,
        })
    }

    pub fn registry(defs: Vec<&'static ConnectorDef>) -> &'static [ConnectorDef] {
        leak(defs.into_iter().copied().collect::<Vec<_>>()).as_slice()
    }
}
