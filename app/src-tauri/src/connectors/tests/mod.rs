//! The whole sign-in, from the card's Connect to the token on a request, against a local mock server and a browser
//! double. No real service, client ID, or token is involved: every value here is made up. `sign_in` covers signing
//! in, `session` covers renewing, requests, and disconnecting, and `pasted` covers pasted tokens and the catalog.

use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde_json::json;
use url::Url;

use super::{
    error::Failure,
    files::CONNECTIONS_FILE,
    http::{HostPolicy, Http, HttpError, HttpRequest, HttpResponse, UreqHttp},
    mock::{
        fixtures::{connector, oauth, registry},
        MockServer, Reply,
    },
    registry::{Auth, ConnectorDef, Method, Placement, Revoke, TokenDef},
    secret::Secret,
    service::{Connectors, Opener, Parts},
    store::{MemoryStore, SecretStore},
    view::{ConnectInput, RevokeOutcome, StateView},
};

const CLIENT_FILE: &str =
    r#"{"clients":{"example":{"clientId":"example-client-id","clientSecret":"example-client-secret"}}}"#;
const NOW: u64 = 1_790_000_000;

/// What the person does in the browser.
#[derive(Clone, Copy)]
enum Visit {
    Approve(&'static str),
    Refuse(&'static str),
    WrongState,
    Silent,
}

struct FakeBrowser {
    visit: Mutex<Visit>,
    opened: Mutex<Vec<String>>,
}

impl Opener for FakeBrowser {
    fn open(&self, url: &str) -> bool {
        self.opened.lock().expect("lock").push(url.to_owned());
        let visit = *self.visit.lock().expect("lock");
        let parsed = Url::parse(url).expect("a URL");
        let pair = |name: &str| {
            parsed
                .query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, v)| v.into_owned())
                .expect(name)
        };
        let (redirect, state) = (pair("redirect_uri"), pair("state"));
        let query = match visit {
            Visit::Silent => return true,
            Visit::Approve(code) => format!("code={code}&state={state}"),
            Visit::Refuse(reason) => format!("error={reason}&state={state}"),
            Visit::WrongState => "code=stolen&state=not-this-one".to_owned(),
        };
        thread::spawn(move || {
            let target = Url::parse(&redirect).expect("a redirect");
            let port = target.port().expect("a port");
            let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("the listener is open");
            let request = format!(
                "GET {}?{query} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n",
                target.path()
            );
            stream.write_all(request.as_bytes()).expect("sends");
            let mut answer = String::new();
            let _ = stream.read_to_string(&mut answer);
        });
        true
    }
}

/// An `Http` that answers from a script, and applies the host policy the way the real client does.
#[derive(Default)]
struct ScriptedHttp {
    replies: Mutex<Vec<(u16, serde_json::Value)>>,
    seen: Mutex<Vec<Seen>>,
}

/// One request the script saw: the hosts allowed for it, where it went, its headers, and its form body.
struct Seen {
    hosts: Vec<String>,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Http for ScriptedHttp {
    fn send(&self, policy: &HostPolicy, request: &HttpRequest, _max: usize) -> Result<HttpResponse, HttpError> {
        if !policy.allows(&request.url) {
            return Err(HttpError::ForeignHost);
        }
        let body = match &request.body {
            Some(super::http::Body::Form(fields)) => super::http::encode_form(fields),
            _ => String::new(),
        };
        self.seen.lock().expect("lock").push(Seen {
            hosts: policy.hosts().to_vec(),
            url: request.url.clone(),
            headers: request.headers.clone(),
            body,
        });
        let mut replies = self.replies.lock().expect("lock");
        let (status, body) = if replies.len() > 1 {
            replies.remove(0)
        } else {
            replies.first().cloned().unwrap_or((500, json!({})))
        };
        Ok(HttpResponse {
            status,
            content_type: None,
            body: body.to_string().into_bytes(),
            location: None,
        })
    }
}

struct Rig {
    dir: tempfile::TempDir,
    connectors: Connectors,
    store: Arc<MemoryStore>,
    browser: Arc<FakeBrowser>,
    offline: Arc<AtomicBool>,
    clock: Arc<AtomicU64>,
    registry: &'static [ConnectorDef],
    http: Arc<dyn Http>,
}

impl Rig {
    fn new(registry: &'static [ConnectorDef], http: Arc<dyn Http>, config: Option<&str>) -> Rig {
        let dir = tempfile::tempdir().expect("a temporary folder");
        if let Some(config) = config {
            fs::write(dir.path().join("connectors.json"), config).expect("writes the config");
        }
        let mut rig = Rig {
            dir,
            connectors: Connectors::with(Parts {
                config_file: "unused".into(),
                connections_file: "unused".into(),
                registry,
                store: Arc::new(MemoryStore::default()),
                http: Arc::clone(&http),
                opener: Arc::new(FakeBrowser {
                    visit: Mutex::new(Visit::Silent),
                    opened: Mutex::default(),
                }),
                offline: Arc::new(|| false),
                now: Arc::new(|| 0),
                wait: Duration::from_secs(1),
            }),
            store: Arc::new(MemoryStore::default()),
            browser: Arc::new(FakeBrowser {
                visit: Mutex::new(Visit::Silent),
                opened: Mutex::default(),
            }),
            offline: Arc::new(AtomicBool::new(false)),
            clock: Arc::new(AtomicU64::new(NOW)),
            registry,
            http,
        };
        rig.restart(Duration::from_secs(10));
        rig
    }

    /// Starts the service again over the same files and credentials, as the app does at launch.
    fn restart(&mut self, wait: Duration) {
        let (offline, clock) = (Arc::clone(&self.offline), Arc::clone(&self.clock));
        self.connectors = Connectors::with(Parts {
            config_file: self.dir.path().join("connectors.json"),
            connections_file: self.dir.path().join(CONNECTIONS_FILE),
            registry: self.registry,
            store: Arc::clone(&self.store) as Arc<dyn SecretStore>,
            http: Arc::clone(&self.http),
            opener: Arc::clone(&self.browser) as Arc<dyn Opener>,
            offline: Arc::new(move || offline.load(Ordering::Relaxed)),
            now: Arc::new(move || clock.load(Ordering::Relaxed)),
            wait,
        });
    }

    fn visit(&self, visit: Visit) {
        *self.browser.visit.lock().expect("lock") = visit;
    }

    fn opened(&self) -> Vec<String> {
        self.browser.opened.lock().expect("lock").clone()
    }

    fn state(&self, id: &str) -> StateView {
        self.connectors.view(id).expect("a view").state
    }

    /// Every byte of every file the app wrote. The connectors file is the owner's, not the app's.
    fn files_text(&self) -> String {
        fn walk(dir: &Path, out: &mut String) {
            for entry in fs::read_dir(dir).expect("reads").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, out);
                } else if path.file_name().is_some_and(|name| name != "connectors.json") {
                    out.push_str(&fs::read_to_string(&path).unwrap_or_default());
                }
            }
        }
        let mut text = String::new();
        walk(self.dir.path(), &mut text);
        text
    }
}

/// An OAuth connector on the mock server, signed in with a client from the connectors file.
fn oauth_rig(server: &MockServer) -> Rig {
    let def = connector("example", Auth::OAuth(oauth(server)));
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "access-one", "refresh_token": "refresh-one", "expires_in": 3600, "scope": "scope-a scope-b" }),
        )],
    );
    server.route("/me", vec![Reply::json(200, json!({ "email": "sam@example.com" }))]);
    server.route("/revoke", vec![Reply::empty(200)]);
    server.route("/api/things", vec![Reply::json(200, json!({ "things": [] }))]);
    Rig::new(registry(vec![def]), Arc::new(UreqHttp::default()), Some(CLIENT_FILE))
}

fn connect(rig: &Rig) -> Result<StateView, Failure> {
    rig.connectors
        .connect("example", ConnectInput::default())
        .map(|view| view.state)
        .map_err(|error| error.failure)
}

fn connected(account: &str) -> StateView {
    StateView::Connected {
        account: account.into(),
        connected_unix: NOW,
    }
}

mod pasted;
mod session;
mod sign_in;
mod transfer;
