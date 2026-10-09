//! The local API over a real loopback listener, with notes in memory: tokens, grants, and their notebooks, locked
//! sections, the Host and Origin checks, approval before changes, revoking, pairing, and the access log.

use std::{
    io::{Read, Write},
    net::TcpStream,
    time::Instant,
};

use opennote_api::{
    client::{Client, ClientError, Endpoint},
    http::{Request, Response},
    testing::TestApi,
    Access, Decision, Outcome, Question, Scope,
};
use serde_json::{json, Value};

fn client(test: &TestApi, token: Option<&str>) -> Client {
    Client::new(Endpoint::Tcp(test.port)).with_token(token.map(str::to_owned))
}

fn allow(access: Access, notebooks: Scope) -> Decision {
    Decision::Allow {
        access: Some(access),
        notebooks: Some(notebooks),
        always: false,
    }
}

/// Pairs a program the way the `opennote` tool does, with the person's answer scripted.
fn pair(test: &TestApi, decision: Decision) -> Result<String, Response> {
    test.approver.answer(decision);
    let answer = client(test, None)
        .post("/v1/pair", &json!({ "name": "opennote", "kind": "cli" }))
        .expect("an answer");
    if answer.status != 200 {
        return Err(answer);
    }
    Ok(answer.json_body().expect("json")["token"]
        .as_str()
        .expect("a token")
        .to_owned())
}

fn bio_reader(test: &TestApi) -> String {
    pair(test, allow(Access::Read, Scope::Notebooks(vec!["nb-bio".into()]))).expect("paired")
}

fn body(response: &Response) -> Value {
    response.json_body().unwrap_or(Value::Null)
}

/// Sends raw bytes, for the header checks the client never gets wrong.
fn raw(port: u16, text: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connects");
    stream.write_all(text.as_bytes()).expect("sends");
    let mut answer = String::new();
    let _ = stream.read_to_string(&mut answer);
    answer
}

#[test]
fn a_request_without_a_valid_token_gets_nothing_and_is_logged() {
    let test = TestApi::start();
    let answer = client(&test, None).get("/v1/notebooks", &[]).expect("an answer");
    assert_eq!(answer.status, 401);
    let made_up = format!("onapi_{}_{}", "0".repeat(16), "1".repeat(64));
    assert_eq!(
        client(&test, Some(&made_up))
            .get("/v1/notebooks", &[])
            .expect("an answer")
            .status,
        401
    );
    let log = test.api.log.recent(5);
    assert!(log
        .iter()
        .all(|entry| entry.outcome == Outcome::Refused && entry.app == "-"));
    assert!(log
        .iter()
        .all(|entry| !serde_json::to_string(entry).expect("json").contains(&made_up)));
}

#[test]
fn a_new_app_asks_the_person_and_starts_read_only_on_the_chosen_notebook() {
    let test = TestApi::start();
    let token = bio_reader(&test);
    let asked = test.approver.asked();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].app_name, "opennote");
    assert!(matches!(
        asked[0].question,
        Question::Connect {
            wants: Access::Read,
            ..
        }
    ));

    let me = body(&client(&test, Some(&token)).get("/v1/me", &[]).expect("me"));
    assert_eq!(me["access"], "read");
    assert_eq!(me["askBeforeWrites"], true);

    let notebooks = body(
        &client(&test, Some(&token))
            .get("/v1/notebooks", &[])
            .expect("notebooks"),
    );
    assert_eq!(notebooks["notebooks"], json!([{ "id": "nb-bio", "title": "Biology" }]));
    let page = client(&test, Some(&token))
        .get("/v1/pages/p-mito", &[("format", "md")])
        .expect("a page");
    assert_eq!(page.status, 200);
    assert_eq!(
        String::from_utf8_lossy(&page.body),
        "# Mitochondria\n\nThe powerhouse of the cell."
    );
}

#[test]
fn a_declined_app_gets_no_token() {
    let test = TestApi::start();
    let refused = pair(&test, Decision::Deny).expect_err("declined");
    assert_eq!(refused.status, 403);
    assert_eq!(body(&refused)["error"], "declined");
    assert!(test.api.grants.apps().is_empty());
}

#[test]
fn a_grant_reaches_only_its_notebooks() {
    let test = TestApi::start();
    let token = bio_reader(&test);
    let reader = client(&test, Some(&token));
    for path in [
        "/v1/pages/p-standup",
        "/v1/sections/s-meet/pages",
        "/v1/notebooks/nb-work/sections",
    ] {
        let answer = reader.get(path, &[]).expect("an answer");
        assert_eq!(answer.status, 403, "{path}");
        assert_eq!(body(&answer)["error"], "notInGrant", "{path}");
    }
    let hits = body(&reader.get("/v1/search", &[("q", "mitochondria")]).expect("search"));
    let ids: Vec<&str> = hits["hits"]
        .as_array()
        .expect("hits")
        .iter()
        .filter_map(|hit| hit["page"]["id"].as_str())
        .collect();
    assert_eq!(
        ids,
        ["p-mito"],
        "the other notebook and the locked section are left out"
    );
}

#[test]
fn locked_sections_are_never_read_even_with_every_notebook() {
    let test = TestApi::start();
    let token = pair(&test, allow(Access::ReadWrite, Scope::All)).expect("paired");
    let app = client(&test, Some(&token));
    for path in [
        "/v1/pages/p-secret",
        "/v1/sections/s-diary/pages",
        "/v1/sections/s-diary/export",
    ] {
        let answer = app.get(path, &[]).expect("an answer");
        assert_eq!(answer.status, 423, "{path}");
    }
    let append = app
        .post("/v1/pages/p-secret/append", &json!({ "markdown": "x" }))
        .expect("an answer");
    assert_eq!(append.status, 423);
    let create = app
        .post("/v1/sections/s-diary/pages", &json!({ "title": "x" }))
        .expect("an answer");
    assert_eq!(create.status, 423);
    assert!(
        test.approver.asked().len() == 1,
        "nobody is asked about a locked section"
    );
    let hits = body(&app.get("/v1/search", &[("q", "secret")]).expect("search"));
    assert_eq!(hits["hits"], json!([]));
    assert!(test
        .api
        .log
        .recent(20)
        .iter()
        .any(|entry| entry.detail.as_deref() == Some("locked")));
}

#[test]
fn writes_need_the_access_and_the_persons_approval_and_land_in_page_history() {
    let test = TestApi::start();
    let reader = bio_reader(&test);
    let refused = client(&test, Some(&reader))
        .post("/v1/pages/p-mito/append", &json!({ "markdown": "More." }))
        .expect("an answer");
    assert_eq!(refused.status, 403, "a read-only grant can't write");

    let writer = pair(&test, allow(Access::ReadWrite, Scope::Notebooks(vec!["nb-bio".into()]))).expect("paired");
    let app = client(&test, Some(&writer));
    // The person says no.
    let declined = app
        .post("/v1/pages/p-mito/append", &json!({ "markdown": "More." }))
        .expect("an answer");
    assert_eq!(declined.status, 403);
    assert_eq!(body(&declined)["error"], "declined");
    assert_eq!(
        test.backend.markdown("p-mito").as_deref(),
        Some("The powerhouse of the cell.")
    );

    // The person says yes, once.
    test.approver.answer(Decision::Allow {
        access: None,
        notebooks: None,
        always: false,
    });
    let done = app
        .post("/v1/pages/p-mito/append", &json!({ "markdown": "More." }))
        .expect("an answer");
    assert_eq!(done.status, 200);
    assert_eq!(test.backend.history("p-mito"), ["Changed via opennote"]);
    let asked = test.approver.asked();
    assert!(
        matches!(&asked.last().expect("a question").question, Question::Change { target, .. } if target == "Mitochondria")
    );

    // And then from now on.
    test.approver.answer(Decision::Allow {
        access: None,
        notebooks: None,
        always: true,
    });
    let created = app
        .post(
            "/v1/sections/s-cells/pages",
            &json!({ "title": "Ribosomes", "markdown": "Make proteins.", "sourceUrl": "https://example.org/ribosome" }),
        )
        .expect("an answer");
    assert_eq!(created.status, 201);
    let id = body(&created)["page"]["id"].as_str().expect("an id").to_owned();
    assert_eq!(test.backend.history(&id), ["Added via opennote"]);
    let asked_before = test.approver.asked().len();
    let again = app
        .post("/v1/pages/p-mito/append", &json!({ "markdown": "Even more." }))
        .expect("an answer");
    assert_eq!(again.status, 200);
    assert_eq!(test.approver.asked().len(), asked_before, "no question after 'always'");
}

#[test]
fn bad_bodies_are_refused_before_anyone_is_asked() {
    let test = TestApi::start();
    let token = pair(&test, allow(Access::ReadWrite, Scope::All)).expect("paired");
    let app = client(&test, Some(&token));
    for bad in [
        json!({ "title": "" }),
        json!({ "title": "x".repeat(201) }),
        json!({ "title": "x", "sourceUrl": "javascript:alert(1)" }),
        json!({ "title": "x", "attachments": [{ "name": "a.png", "mime": "image/png", "data": "!!" }] }),
        json!({ "markdown": "no title" }),
    ] {
        let answer = app.post("/v1/sections/s-cells/pages", &bad).expect("an answer");
        assert_eq!(answer.status, 400, "{bad}");
    }
    let plain = app
        .send(Request {
            method: "POST".into(),
            path: "/v1/pages/p-mito/append".into(),
            headers: vec![("Content-Type".into(), "text/plain".into())],
            body: br#"{"markdown":"x"}"#.to_vec(),
            ..Request::default()
        })
        .expect("an answer");
    assert_eq!(
        plain.status, 415,
        "a body that isn't JSON would skip a browser's preflight"
    );
    assert_eq!(test.approver.asked().len(), 1, "only the pairing was asked");
}

#[test]
fn revoking_stops_the_token_at_once() {
    let test = TestApi::start();
    let token = bio_reader(&test);
    let app = client(&test, Some(&token));
    assert_eq!(app.get("/v1/notebooks", &[]).expect("ok").status, 200);
    let id = test.api.grants.apps()[0].id.clone();
    assert!(test.api.grants.revoke(&id).expect("revoked"));
    assert_eq!(app.get("/v1/notebooks", &[]).expect("an answer").status, 401);
    assert!(test.secrets.is_empty(), "the token's hash is gone too");
}

#[test]
fn foreign_hosts_and_web_pages_are_refused() {
    let test = TestApi::start();
    let token = bio_reader(&test);
    let port = test.port;
    let rebinding = raw(
        port,
        &format!("GET /v1/notebooks HTTP/1.1\r\nHost: evil.example:{port}\r\nAuthorization: Bearer {token}\r\n\r\n"),
    );
    assert!(rebinding.starts_with("HTTP/1.1 421"), "{rebinding}");
    let no_host = raw(port, "GET /v1/status HTTP/1.1\r\n\r\n");
    assert!(no_host.starts_with("HTTP/1.1 421"), "{no_host}");
    let page = raw(
        port,
        &format!("GET /v1/notebooks HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\nAuthorization: Bearer {token}\r\n\r\n"),
    );
    assert!(page.starts_with("HTTP/1.1 403"), "{page}");
    assert!(!page.contains("Access-Control-Allow-Origin"));
    let http_page = raw(
        port,
        &format!("GET /v1/status HTTP/1.1\r\nHost: localhost:{port}\r\nOrigin: http://localhost:3000\r\n\r\n"),
    );
    assert!(http_page.starts_with("HTTP/1.1 403"), "{http_page}");
    let smuggle = raw(
        port,
        &format!("POST /v1/pair HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"),
    );
    assert!(smuggle.starts_with("HTTP/1.1 411"), "{smuggle}");
}

#[test]
fn an_extension_pairs_with_a_code_and_its_token_works_only_from_that_extension() {
    let test = TestApi::start();
    let extension = format!("chrome-extension://{}", "abcdefghijklmnop".repeat(2));
    let (code, _) = test.api.pairing.new_code(
        Access::AddPages,
        Scope::Notebooks(vec!["nb-bio".into()]),
        Instant::now(),
    );
    let send = |path: &str, method: &str, origin: &str, token: Option<&str>, body: Option<Value>| {
        let mut headers = vec![("Origin".to_owned(), origin.to_owned())];
        if body.is_some() {
            headers.push(("Content-Type".into(), "application/json".into()));
        }
        client(&test, token)
            .send(Request {
                method: method.into(),
                path: path.into(),
                headers,
                body: body
                    .map(|body| serde_json::to_vec(&body).expect("json"))
                    .unwrap_or_default(),
                ..Request::default()
            })
            .expect("an answer")
    };
    let preflight = send("/v1/pair/code", "OPTIONS", &extension, None, None);
    assert_eq!(preflight.status, 204);
    assert_eq!(
        preflight.header("access-control-allow-origin"),
        Some(extension.as_str())
    );
    assert_eq!(preflight.header("access-control-allow-private-network"), Some("true"));

    let wrong = send(
        "/v1/pair/code",
        "POST",
        &extension,
        None,
        Some(json!({ "code": "AAAA-AAAA", "name": "Clipper", "kind": "clipper" })),
    );
    assert_eq!(wrong.status, 403);
    let paired = send(
        "/v1/pair/code",
        "POST",
        &extension,
        None,
        Some(json!({ "code": code, "name": "Clipper", "kind": "clipper" })),
    );
    assert_eq!(paired.status, 200, "{:?}", body(&paired));
    let token = body(&paired)["token"].as_str().expect("a token").to_owned();
    assert!(
        test.approver.asked().is_empty(),
        "the person made the code, so nobody is asked"
    );

    let sections = send("/v1/notebooks/nb-bio/sections", "GET", &extension, Some(&token), None);
    assert_eq!(sections.status, 200, "an add-pages grant sees where it can save");
    let read = send("/v1/pages/p-mito", "GET", &extension, Some(&token), None);
    assert_eq!(read.status, 403, "but reads nothing");
    let clip = send(
        "/v1/sections/s-cells/pages",
        "POST",
        &extension,
        Some(&token),
        Some(json!({ "title": "Clipped", "markdown": "Text", "sourceUrl": "https://example.org/a" })),
    );
    assert_eq!(clip.status, 201);
    let elsewhere = send(
        "/v1/notebooks",
        "GET",
        &format!("chrome-extension://{}", "p".repeat(32)),
        Some(&token),
        None,
    );
    assert_eq!(elsewhere.status, 403, "another extension can't use this token");
    let program = client(&test, Some(&token))
        .get("/v1/notebooks", &[])
        .expect("an answer");
    assert_eq!(program.status, 403, "nor can a program without the extension's origin");

    let used = send(
        "/v1/pair/code",
        "POST",
        &extension,
        None,
        Some(json!({ "code": code, "name": "Again", "kind": "clipper" })),
    );
    assert_eq!(used.status, 403, "a code works once");
}

#[test]
fn programs_cant_pair_as_a_web_page_and_web_pages_cant_ask() {
    let test = TestApi::start();
    let page = client(&test, None)
        .send(Request {
            method: "POST".into(),
            path: "/v1/pair".into(),
            headers: vec![
                ("Origin".into(), "https://addin.example.org".into()),
                ("Content-Type".into(), "application/json".into()),
            ],
            body: br#"{"name":"x","kind":"cli"}"#.to_vec(),
            ..Request::default()
        })
        .expect("an answer");
    assert_eq!(page.status, 403);
    assert!(test.approver.asked().is_empty());
}

#[test]
fn the_listener_proves_it_is_opennote_before_a_token_is_sent() {
    let test = TestApi::start();
    let app = client(&test, None);
    app.verify(&test.api.proof_key()).expect("the right key");
    assert!(matches!(app.verify(b"another key"), Err(ClientError::NotOpenNote)));
}

#[test]
fn the_access_log_names_each_read_and_change_without_text_or_tokens() {
    let test = TestApi::start();
    let token = pair(&test, allow(Access::ReadWrite, Scope::All)).expect("paired");
    test.approver.answer(Decision::Allow {
        access: None,
        notebooks: None,
        always: false,
    });
    let app = client(&test, Some(&token));
    app.get("/v1/pages/p-mito", &[]).expect("read");
    app.post("/v1/daily", &json!({ "markdown": "Called the lab." }))
        .expect("daily");
    let log = test.api.log.recent(10);
    let actions: Vec<&str> = log.iter().map(|entry| entry.action.as_str()).collect();
    assert!(actions.contains(&"page.read") && actions.contains(&"daily.append") && actions.contains(&"pair"));
    let text = serde_json::to_string(&log).expect("json");
    assert!(!text.contains("Called the lab") && !text.contains("powerhouse") && !text.contains(&token));
    assert!(log.iter().any(|entry| entry.title.as_deref() == Some("Mitochondria")));
}

#[test]
fn backup_needs_every_notebook_and_approval() {
    let test = TestApi::start();
    let some = pair(&test, allow(Access::ReadWrite, Scope::Notebooks(vec!["nb-bio".into()]))).expect("paired");
    assert_eq!(
        client(&test, Some(&some))
            .post("/v1/backup", &json!({}))
            .expect("an answer")
            .status,
        403
    );
    let all = pair(&test, allow(Access::ReadWrite, Scope::All)).expect("paired");
    test.approver.answer(Decision::Allow {
        access: None,
        notebooks: None,
        always: false,
    });
    let done = client(&test, Some(&all))
        .post("/v1/backup", &json!({}))
        .expect("an answer");
    assert_eq!(done.status, 200);
    assert_eq!(body(&done)["folder"], r"D:\Backups\OpenNote");
}

#[cfg(windows)]
#[test]
fn the_named_pipe_answers_with_the_same_checks() {
    use std::sync::Arc;

    use opennote_api::server::Server;

    let test = TestApi::start();
    let name = format!("OpenNote-api-test-{}", std::process::id());
    let server = Server::start(Arc::clone(&test.api), 0, Some(&name)).expect("starts");
    assert_eq!(server.pipe(), Some(name.as_str()));
    let pipe = Client::new(Endpoint::Pipe(name.clone()));
    pipe.verify(&test.api.proof_key()).expect("the pipe proves itself");
    assert_eq!(pipe.get("/v1/notebooks", &[]).expect("an answer").status, 401);
    let token = bio_reader(&test);
    let answer = pipe
        .clone()
        .with_token(Some(token))
        .get("/v1/notebooks", &[])
        .expect("an answer");
    assert_eq!(answer.status, 200);
    server.stop();
    assert!(matches!(pipe.get("/v1/status", &[]), Err(ClientError::NotRunning)));
}
