//! The account calls that move files and state: a download lands in the transfer folder, an upload sends the parts
//! it was given with the connection's token, a resumable upload's `Location` comes back, and names outside the
//! folder are refused.

use super::*;
use crate::connectors::accounts;

fn call(rig: &Rig, name: &str, args: serde_json::Value) -> Result<serde_json::Value, crate::ipc::IpcError> {
    accounts::call(&rig.connectors, &rig.dir.path().join("accounts"), name, &args)
}

fn signed_in(server: &MockServer) -> Rig {
    let rig = oauth_rig(server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    rig
}

#[test]
fn a_download_is_written_to_the_transfer_folder_with_the_token() {
    let server = MockServer::start();
    let rig = signed_in(&server);
    server.route("/files/1", vec![Reply::json(200, json!({ "file": true }))]);
    let answer = call(
        &rig,
        "transfer.download",
        json!({
            "connector": "example", "access": ["calendarRead"], "file": "dl/one.json",
            "request": { "method": "GET", "url": server.url("/files/1") },
        }),
    )
    .expect("downloads");
    assert_eq!(answer["status"], 200);
    let path = answer["path"].as_str().expect("a path");
    assert_eq!(fs::read_to_string(path).expect("reads"), r#"{"file":true}"#);
    assert_eq!(
        server.requests_to("/files/1")[0].header("authorization"),
        Some("Bearer access-one")
    );
}

#[test]
fn a_failed_download_writes_nothing_and_says_what_the_service_said() {
    let server = MockServer::start();
    let rig = signed_in(&server);
    server.route("/files/2", vec![Reply::json(404, json!({ "error": "gone" }))]);
    let answer = call(
        &rig,
        "transfer.download",
        json!({
            "connector": "example", "access": [], "file": "missing.bin",
            "request": { "method": "GET", "url": server.url("/files/2") },
        }),
    )
    .expect("answers");
    assert_eq!(answer["status"], 404);
    assert!(answer["body"].as_str().expect("a body").contains("gone"));
    assert!(!Path::new(answer["path"].as_str().expect("a path")).exists());
}

#[test]
fn an_upload_sends_the_parts_in_order_and_returns_the_location() {
    let server = MockServer::start();
    let rig = signed_in(&server);
    call(&rig, "temp.write", json!({ "file": "up.bin", "part": { "kind": "text", "text": "0123456789" } }))
        .expect("writes");
    server.route(
        "/upload",
        vec![Reply {
            status: 200,
            body: "{}".into(),
            headers: vec![("Location".into(), server.url("/session/9"))],
        }],
    );
    let answer = call(
        &rig,
        "transfer.upload",
        json!({
            "connector": "example", "access": [], "contentType": "multipart/related; boundary=b",
            "request": { "method": "POST", "url": server.url("/upload") },
            "parts": [
                { "kind": "text", "text": "--b\r\n" },
                { "kind": "file", "file": "up.bin", "offset": 3, "length": 4 },
                { "kind": "text", "text": "\r\n--b--" },
            ],
        }),
    )
    .expect("uploads");
    assert_eq!(answer["status"], 200);
    assert_eq!(answer["location"], server.url("/session/9"));
    let sent = &server.requests_to("/upload")[0];
    assert_eq!(sent.body, "--b\r\n3456\r\n--b--");
    assert_eq!(sent.header("content-type"), Some("multipart/related; boundary=b"));
}

#[test]
fn the_folder_calls_refuse_names_outside_it_and_state_round_trips() {
    let server = MockServer::start();
    let rig = signed_in(&server);
    for file in ["../x", "/windows/system32/a.dll", r"a\b"] {
        let refused = call(&rig, "temp.read", json!({ "file": file }));
        assert!(refused.is_err(), "{file}");
    }
    assert_eq!(call(&rig, "state.get", json!({ "name": "readwise" })).expect("reads"), serde_json::Value::Null);
    call(&rig, "state.set", json!({ "name": "readwise", "value": { "cursor": "c1" } })).expect("writes");
    assert_eq!(
        call(&rig, "state.get", json!({ "name": "readwise" })).expect("reads"),
        json!({ "cursor": "c1" })
    );
    call(&rig, "state.delete", json!({ "name": "readwise" })).expect("deletes");
    assert_eq!(call(&rig, "state.get", json!({ "name": "readwise" })).expect("reads"), serde_json::Value::Null);
}

#[test]
fn a_client_typed_on_a_card_is_saved_and_clears_needs_setup() {
    let server = MockServer::start();
    let def = connector("example", Auth::OAuth(oauth(&server)));
    let rig = Rig::new(registry(vec![def]), Arc::new(UreqHttp::default()), None);
    assert_eq!(rig.state("example"), StateView::NeedsSetup);
    let view = call(&rig, "client.set", json!({ "connector": "example", "clientId": "typed-client-id" })).expect("saves");
    assert_eq!(view["state"]["kind"], "notConnected");
    assert_eq!(rig.state("example"), StateView::NotConnected);
    let refused = call(&rig, "client.set", json!({ "connector": "example", "clientId": "has space" }));
    assert!(refused.is_err());
}
