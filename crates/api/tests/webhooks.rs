//! Webhook deliveries against a local mock receiver: the signature, retries after a failure, giving up on a refusal,
//! the notebook scope, locked pages, and the access log.

use std::{
    net::TcpListener,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use opennote_api::{
    access_log::AccessLog,
    backend::PageInfo,
    grants::{ConfigFile, Grants, MemorySecrets, SecretStore},
    hmac::hmac_hex,
    http::{read_request, write_response, Limits, Request, Response},
    webhooks::{secret_target, Dispatcher, HookEvent, PageEvent, Poster, Webhook},
    Outcome, Scope,
};

/// A receiver on 127.0.0.1 that answers with the scripted statuses in turn, then 200.
struct Receiver {
    port: u16,
    got: Arc<Mutex<Vec<Request>>>,
}

impl Receiver {
    fn start(statuses: Vec<u16>) -> Receiver {
        let listener = TcpListener::bind("127.0.0.1:0").expect("binds");
        let port = listener.local_addr().expect("an address").port();
        let got = Arc::new(Mutex::new(Vec::new()));
        let seen = got.clone();
        thread::spawn(move || {
            let mut statuses = statuses.into_iter();
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let Ok(request) = read_request(&mut stream, &Limits::default()) else {
                    continue;
                };
                seen.lock().expect("lock").push(request);
                let _ = write_response(&mut stream, &Response::new(statuses.next().unwrap_or(200)));
            }
        });
        Receiver { port, got }
    }

    fn requests(&self) -> Vec<Request> {
        self.got.lock().expect("lock").clone()
    }
}

/// Posts over plain HTTP to the receiver, whatever the hook's address, so no test leaves this PC.
struct ToReceiver(u16);

impl Poster for ToReceiver {
    fn post(&self, _url: &str, headers: &[(String, String)], body: &[u8]) -> Result<u16, String> {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", self.0)).map_err(|error| error.to_string())?;
        let request = Request {
            method: "POST".into(),
            path: "/hook".into(),
            headers: headers.to_vec(),
            body: body.to_vec(),
            ..Request::default()
        };
        opennote_api::http::write_request(&mut stream, &request, "receiver").map_err(|error| error.to_string())?;
        let response =
            opennote_api::http::read_response(&mut stream, &Limits::default()).map_err(|error| error.to_string())?;
        Ok(response.status)
    }
}

struct Setup {
    dispatcher: Dispatcher,
    log: Arc<AccessLog>,
    receiver: Receiver,
}

fn hook(id: &str, notebooks: Scope) -> Webhook {
    Webhook {
        id: id.into(),
        name: format!("Hook {id}"),
        url: "https://hooks.example.org/catch".into(),
        events: vec![HookEvent::PageCreated, HookEvent::TagAdded],
        notebooks,
        include_text: false,
        enabled: true,
    }
}

fn setup(statuses: Vec<u16>, hooks: Vec<Webhook>, secret: &str) -> Setup {
    let receiver = Receiver::start(statuses);
    let secrets = Arc::new(MemorySecrets::default());
    for one in &hooks {
        secrets.put(&secret_target(&one.id), secret).expect("stored");
    }
    let grants = Arc::new(Grants::new(ConfigFile::memory(), secrets.clone()));
    grants.change(|config| config.webhooks = hooks).expect("saved");
    let log = Arc::new(AccessLog::memory());
    let backoff = vec![Duration::from_millis(50), Duration::from_millis(50)];
    let dispatcher = Dispatcher::start(
        grants,
        secrets,
        log.clone(),
        Arc::new(ToReceiver(receiver.port)),
        backoff,
        || {},
    );
    Setup {
        dispatcher,
        log,
        receiver,
    }
}

fn event(kind: HookEvent, notebook: &str, locked: bool) -> PageEvent {
    PageEvent {
        kind,
        page: PageInfo {
            id: "p1".into(),
            notebook_id: notebook.into(),
            section_id: "s1".into(),
            title: "Cell walls".into(),
            modified: None,
        },
        locked,
        tag: (kind == HookEvent::TagAdded).then(|| "exam".to_owned()),
        text: Some("The private text".into()),
    }
}

fn wait_for(what: impl Fn() -> bool) {
    let start = Instant::now();
    while !what() {
        assert!(start.elapsed() < Duration::from_secs(10), "timed out");
        thread::sleep(Duration::from_millis(10));
    }
}

fn header<'a>(request: &'a Request, name: &str) -> &'a str {
    request.header(name).unwrap_or_default()
}

#[test]
fn a_delivery_is_signed_and_carries_no_text_unless_asked() {
    let test = setup(vec![], vec![hook("h1", Scope::All)], "s3cret-for-tests");
    assert_eq!(test.dispatcher.publish(&event(HookEvent::PageCreated, "nb1", false)), 1);
    wait_for(|| test.receiver.requests().len() == 1);
    let request = &test.receiver.requests()[0];
    let timestamp = header(request, "x-opennote-timestamp");
    let mut signed = format!("{timestamp}.").into_bytes();
    signed.extend_from_slice(&request.body);
    assert_eq!(
        header(request, "x-opennote-signature"),
        format!("sha256={}", hmac_hex(b"s3cret-for-tests", &signed))
    );
    let body: serde_json::Value = serde_json::from_slice(&request.body).expect("json");
    assert_eq!(body["event"], "pageCreated");
    assert_eq!(body["page"]["title"], "Cell walls");
    assert_eq!(body["page"]["link"], "opennote://page/p1");
    assert!(!String::from_utf8_lossy(&request.body).contains("private text"));
    wait_for(|| {
        test.log
            .recent(10)
            .iter()
            .any(|entry| entry.outcome == Outcome::Allowed)
    });
    let entry = &test.log.recent(10)[0];
    assert_eq!(entry.action, "webhook.deliver");
    assert_eq!(entry.app, "webhook:h1");
    assert_eq!(entry.detail.as_deref(), Some("HTTP 200"));
}

#[test]
fn a_failed_delivery_is_tried_again_until_it_lands() {
    let test = setup(vec![500, 503], vec![hook("h1", Scope::All)], "k");
    test.dispatcher.publish(&event(HookEvent::TagAdded, "nb1", false));
    wait_for(|| test.receiver.requests().len() == 3);
    wait_for(|| test.log.recent(10).len() == 3);
    let details: Vec<String> = test
        .log
        .recent(10)
        .iter()
        .rev()
        .filter_map(|entry| entry.detail.clone())
        .collect();
    assert_eq!(
        details,
        [
            "HTTP 500, will try again (1 of 3)",
            "HTTP 503, will try again (2 of 3)",
            "HTTP 200"
        ]
    );
    let body: serde_json::Value = serde_json::from_slice(&test.receiver.requests()[2].body).expect("json");
    assert_eq!(body["tag"], "exam");
    assert_eq!(test.dispatcher.waiting(), 0);
}

#[test]
fn a_refusal_ends_the_delivery_and_retries_stop_after_the_last_wait() {
    let refused = setup(vec![404], vec![hook("h1", Scope::All)], "k");
    refused.dispatcher.publish(&event(HookEvent::PageCreated, "nb1", false));
    wait_for(|| refused.log.recent(10).len() == 1);
    thread::sleep(Duration::from_millis(200));
    assert_eq!(refused.receiver.requests().len(), 1);
    assert_eq!(refused.log.recent(10)[0].outcome, Outcome::Failed);

    let down = setup(vec![500, 500, 500, 500], vec![hook("h1", Scope::All)], "k");
    down.dispatcher.publish(&event(HookEvent::PageCreated, "nb1", false));
    wait_for(|| down.log.recent(10).len() == 3);
    thread::sleep(Duration::from_millis(300));
    assert_eq!(down.receiver.requests().len(), 3);
    assert_eq!(down.dispatcher.waiting(), 0);
}

#[test]
fn only_hooks_for_the_notebook_and_the_event_hear_and_locked_pages_send_nothing() {
    let mut changed_only = hook("h3", Scope::All);
    changed_only.events = vec![HookEvent::PageChanged];
    let mut off = hook("h4", Scope::All);
    off.enabled = false;
    let test = setup(
        vec![],
        vec![
            hook("h1", Scope::Notebooks(vec!["nb1".into()])),
            hook("h2", Scope::Notebooks(vec!["nb2".into()])),
            changed_only,
            off,
        ],
        "k",
    );
    assert_eq!(test.dispatcher.publish(&event(HookEvent::PageCreated, "nb1", false)), 1);
    assert_eq!(test.dispatcher.publish(&event(HookEvent::PageCreated, "nb1", true)), 0);
    wait_for(|| test.receiver.requests().len() == 1);
    thread::sleep(Duration::from_millis(200));
    assert_eq!(header(&test.receiver.requests()[0], "x-opennote-hook"), "h1");
}

#[test]
fn a_test_delivery_reports_what_came_back() {
    let test = setup(vec![], vec![hook("h1", Scope::All)], "k");
    assert_eq!(test.dispatcher.test("h1"), Ok(200));
    assert!(test.dispatcher.test("nope").is_err());
    assert_eq!(test.log.recent(10)[0].action, "webhook.test");
}
