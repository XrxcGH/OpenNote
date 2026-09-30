//! A tiny HTTP server on 127.0.0.1 for the integration tests, which only `test-endpoints` builds may read. Each
//! route answers with a status, optional headers, and a body. Requests are recorded by path.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
};

#[derive(Clone)]
pub struct Route {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Route {
    pub fn ok(body: impl Into<Vec<u8>>) -> Route {
        Route {
            status: 200,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    pub fn redirect(to: &str) -> Route {
        Route {
            status: 302,
            headers: vec![("Location".into(), to.into())],
            body: Vec::new(),
        }
    }

    pub fn status(status: u16) -> Route {
        Route {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct Server {
    routes: Arc<Mutex<HashMap<String, Route>>>,
    requests: Arc<Mutex<Vec<String>>>,
    pub base: String,
}

impl Server {
    /// Starts serving on a free port. The thread lives until the test process ends.
    pub fn start() -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
        let port = listener.local_addr().expect("an address").port();
        let server = Server {
            base: format!("http://127.0.0.1:{port}"),
            ..Server::default()
        };
        let serving = server.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let serving = serving.clone();
                thread::spawn(move || serving.answer(stream));
            }
        });
        server
    }

    pub fn route(&self, path: &str, route: Route) {
        self.routes.lock().expect("lock").insert(path.to_owned(), route);
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// The paths requested so far, in order.
    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().expect("lock").clone()
    }

    fn answer(&self, mut stream: TcpStream) {
        let mut reader = BufReader::new(stream.try_clone().expect("a clone"));
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return;
        }
        let mut line = String::new();
        while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
            line.clear();
        }
        let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_owned();
        self.requests.lock().expect("lock").push(path.clone());
        let route = self.routes.lock().expect("lock").get(&path).cloned();
        let route = route.unwrap_or_else(|| Route::status(404));
        let mut head = format!(
            "HTTP/1.1 {} X\r\nContent-Length: {}\r\n",
            route.status,
            route.body.len()
        );
        for (name, value) in &route.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("Connection: close\r\n\r\n");
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(&route.body);
    }
}
