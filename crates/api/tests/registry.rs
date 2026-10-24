//! The command registry over the real API: `GET /v1/commands`, the read-back commands (inspect and render),
//! authors in page history, the per-instance key file, and `hostile_params_never_panic`, which sends every command
//! junk IDs, queries, and bodies.

use opennote_api::{
    client::{read_key_file, write_key_file, Client, Endpoint},
    commands::{Place, COMMANDS},
    guard::Transport,
    http::Request,
    testing::TestApi,
    Access, Decision, Scope,
};
use serde_json::{json, Value};

fn allow(access: Access, notebooks: Scope, always: bool) -> Decision {
    Decision::Allow {
        access: Some(access),
        notebooks: Some(notebooks),
        always,
    }
}

fn pair(test: &TestApi, decision: Decision) -> String {
    test.approver.answer(decision);
    let answer = Client::new(Endpoint::Tcp(test.port))
        .post("/v1/pair", &json!({ "name": "opennote", "kind": "cli" }))
        .expect("an answer");
    assert_eq!(answer.status, 200);
    answer.json_body().expect("json")["token"]
        .as_str()
        .expect("a token")
        .to_owned()
}

fn client(test: &TestApi, token: &str) -> Client {
    Client::new(Endpoint::Tcp(test.port)).with_token(Some(token.to_owned()))
}

#[test]
fn lists_every_command_with_what_this_app_may_run() {
    let test = TestApi::start();
    let token = pair(
        &test,
        allow(Access::Read, Scope::Notebooks(vec!["nb-bio".into()]), false),
    );
    let listed = client(&test, &token)
        .get("/v1/commands", &[])
        .expect("an answer")
        .json_body()
        .expect("json");
    let commands = listed["commands"].as_array().expect("a list");
    assert_eq!(commands.len(), COMMANDS.len());
    let find = |id: &str| commands.iter().find(|command| command["id"] == id).expect("listed");
    assert_eq!(find("page.inspect")["enabled"], true);
    assert_eq!(find("page.create")["enabled"], false);
    assert_eq!(find("page.create")["mcp"], "create_page");
    assert_eq!(find("page.create")["cli"], "new");
}

#[test]
fn inspect_and_render_let_an_agent_check_its_work_but_never_in_locked_sections() {
    let test = TestApi::start();
    let token = pair(&test, allow(Access::ReadWrite, Scope::All, false));
    let me = client(&test, &token);
    test.approver.answer(allow(Access::ReadWrite, Scope::All, false));
    let appended = me
        .post(
            "/v1/pages/p-mito/append",
            &json!({ "markdown": "## Membranes\n\nTwo of them.", "author": "Claude (copyedit)" }),
        )
        .expect("an answer");
    assert_eq!(appended.status, 200);
    assert_eq!(
        test.backend.history("p-mito"),
        ["Changed via opennote (Claude (copyedit))"]
    );

    let inspected = me.get("/v1/pages/p-mito/inspect", &[]).expect("an answer");
    assert_eq!(inspected.status, 200);
    let body = inspected.json_body().expect("json");
    assert_eq!(body["headings"], json!(["# Mitochondria", "## Membranes"]));
    assert!(body["words"].as_u64().unwrap_or(0) >= 6);
    assert_eq!(body["history"][0]["label"], "Changed via opennote (Claude (copyedit))");

    let rendered = me.get("/v1/pages/p-mito/render", &[]).expect("an answer");
    assert_eq!(rendered.status, 200);
    let body = rendered.json_body().expect("json");
    assert_eq!(body["mime"], "image/png");
    assert_eq!(body["strokes"], 1);
    let png = base64_decode(body["png"].as_str().expect("base64"));
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");

    for path in ["/v1/pages/p-secret/inspect", "/v1/pages/p-secret/render"] {
        assert_eq!(me.get(path, &[]).expect("an answer").status, 423, "{path}");
    }
    let too_long = me
        .post("/v1/daily", &json!({ "markdown": "x", "author": "a".repeat(61) }))
        .expect("an answer");
    assert_eq!(too_long.status, 400);

    // An author can't pose as another app's change.
    for spoof in ["x) via Outlook (", "(x) VIA Outlook (y)", "x [via] \"Outlook\""] {
        test.approver.answer(allow(Access::ReadWrite, Scope::All, false));
        let answer = me
            .post("/v1/pages/p-mito/append", &json!({ "markdown": "y", "author": spoof }))
            .expect("an answer");
        assert_eq!(answer.status, 200, "{spoof}");
    }
    let history = test.backend.history("p-mito");
    assert_eq!(
        &history[1..],
        [
            "Changed via opennote (x Outlook)",
            "Changed via opennote ((x) Outlook (y))",
            "Changed via opennote (x Outlook)",
        ]
    );
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .expect("valid base64")
}

#[test]
fn the_key_file_holds_exactly_one_256_bit_key() {
    let folder = tempfile::tempdir().expect("a folder");
    let path = folder.path().join("api-instance.key");
    let key = [7u8; 32];
    write_key_file(&path, &key).expect("written");
    assert_eq!(read_key_file(&path), Some(key.to_vec()));
    // A second start replaces it.
    write_key_file(&path, &[9u8; 32]).expect("written");
    assert_eq!(read_key_file(&path), Some(vec![9u8; 32]));
    assert!(write_key_file(&path, &[1u8; 16]).is_err());
    std::fs::write(&path, "abcd").expect("written");
    assert_eq!(read_key_file(&path), None);
    std::fs::write(&path, "z".repeat(64)).expect("written");
    assert_eq!(read_key_file(&path), None);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        write_key_file(&path, &key).expect("written");
        let mode = std::fs::metadata(&path).expect("there").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

/// Junk for an ID in a path.
const JUNK_IDS: &[&str] = &[
    "",
    "..",
    "%2e%2e",
    "..%2f..%2fwindows",
    "%00",
    "p-mito%00",
    "CON",
    "NUL.txt",
    "%E2%80%AEtxt",
    "p-secret",
    "nb-bio",
    "s-diary",
    "%ff%fe",
    "a%20b",
];

/// Junk for a value in a body or a query.
fn junk_values() -> Vec<Value> {
    let mut deep = json!(0);
    for _ in 0..200 {
        deep = json!([deep]);
    }
    vec![
        Value::Null,
        json!(true),
        json!(-1),
        json!(1e308),
        json!(u64::MAX),
        json!(""),
        json!(" "),
        json!("\u{0}\u{1}\u{7f}"),
        json!("\u{202e}\u{feff}"),
        json!("x".repeat(70_000)),
        json!("# ".repeat(5_000)),
        json!("https://a b"),
        json!("javascript:alert(1)"),
        json!([]),
        json!({}),
        json!({ "nested": { "deeper": [1, 2, 3] } }),
        deep,
    ]
}

#[test]
fn hostile_params_never_panic() {
    let test = TestApi::start();
    let token = pair(&test, allow(Access::ReadWrite, Scope::All, false));
    // Say yes to every change, so the junk reaches as far into each command as it can.
    for _ in 0..10_000 {
        test.approver.answer(allow(Access::ReadWrite, Scope::All, false));
    }
    let host = format!("127.0.0.1:{}", test.port);
    let send = |method: &str, path: String, query: Vec<(String, String)>, body: Vec<u8>| {
        let mut headers = vec![
            ("host".to_owned(), host.clone()),
            ("authorization".to_owned(), format!("Bearer {token}")),
        ];
        if !body.is_empty() {
            headers.push(("content-type".to_owned(), "application/json".to_owned()));
        }
        let request = Request {
            method: method.to_owned(),
            path: path.clone(),
            query,
            headers,
            body,
        };
        let response = test.api.handle(&request, Transport::Tcp { port: test.port });
        assert!(
            (200..500).contains(&response.status),
            "{method} {path} answered {}",
            response.status
        );
        assert!(response.json_body().is_some() || response.status == 204 || !response.body.is_empty());
    };
    let mut sent = 0;
    for command in COMMANDS {
        let holes = command.path.iter().filter(|part| **part == "{}").count();
        let ids: Vec<&str> = if holes == 0 { vec![""] } else { JUNK_IDS.to_vec() };
        for id in ids {
            let path = format!(
                "/v1/{}",
                command
                    .path
                    .iter()
                    .map(|part| if *part == "{}" { id } else { part })
                    .collect::<Vec<_>>()
                    .join("/")
            );
            // Junk in each parameter in turn, as the query or as the body.
            for param in command.params.iter().filter(|param| param.place != Place::Path) {
                for value in junk_values() {
                    let text = value.as_str().map_or_else(|| value.to_string(), str::to_owned);
                    let query = vec![(param.wire.to_owned(), text)];
                    let body = if command.method == "POST" {
                        serde_json::to_vec(&json!({ param.wire: value })).expect("json")
                    } else {
                        Vec::new()
                    };
                    send(command.method, path.clone(), query, body);
                    sent += 1;
                }
            }
            // Bodies that aren't objects, or aren't JSON at all.
            for body in [&b"null"[..], b"[]", b"\"x\"", b"{", b"\xff\xfe", b"{\"title\":1e999}"] {
                send(command.method, path.clone(), Vec::new(), body.to_vec());
                sent += 1;
            }
            // The wrong method.
            let other = if command.method == "GET" { "POST" } else { "GET" };
            send(other, path.clone(), Vec::new(), b"{}".to_vec());
            sent += 1;
        }
    }
    assert!(sent > 1_000, "only {sent} requests");
    // Nothing junk reached a locked page, and the notes still answer.
    assert_eq!(
        test.backend.markdown("p-secret").as_deref(),
        Some("A secret about mitochondria.")
    );
    assert_eq!(
        client(&test, &token)
            .get("/v1/notebooks", &[])
            .expect("an answer")
            .status,
        200
    );
}
