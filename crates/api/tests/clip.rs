//! What the app receives from the browser clipper and the mail add-ins (extensions/; docs/help/web-clipper.md).
//! A clip or a message becomes a page with its source and its files.
//! It comes from the extension or add-in that paired, and only within the grant the person's code gave.

use std::time::Instant;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use opennote_api::{
    client::{Client, Endpoint},
    http::{Request, Response},
    testing::TestApi,
    Access, Scope,
};
use serde_json::{json, Value};

fn send(test: &TestApi, method: &str, path: &str, origin: &str, token: Option<&str>, body: Option<Value>) -> Response {
    let mut headers = vec![("Origin".to_owned(), origin.to_owned())];
    if body.is_some() {
        headers.push(("Content-Type".into(), "application/json".into()));
    }
    Client::new(Endpoint::Tcp(test.port))
        .with_token(token.map(str::to_owned))
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
}

fn paired(test: &TestApi, origin: &str, kind: &str) -> String {
    let (code, _) = test.api.pairing.new_code(
        Access::AddPages,
        Scope::Notebooks(vec!["nb-bio".into()]),
        Instant::now(),
    );
    let answer = send(
        test,
        "POST",
        "/v1/pair/code",
        origin,
        None,
        Some(json!({ "code": code, "name": kind, "kind": kind })),
    );
    assert_eq!(answer.status, 200, "{:?}", answer.json_body());
    answer.json_body().expect("json")["token"]
        .as_str()
        .expect("a token")
        .to_owned()
}

#[test]
fn a_firefox_clip_with_a_region_picture_lands_as_a_page_with_its_source() {
    let test = TestApi::start();
    let firefox = "moz-extension://0f3a6c2e-1d4b-4c6e-9b1a-2a3b4c5d6e7f";
    let token = paired(&test, firefox, "clipper");
    let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nnot really a picture");
    let clip = send(
        &test,
        "POST",
        "/v1/sections/s-cells/pages",
        firefox,
        Some(&token),
        Some(json!({
            "title": "Cell diagram",
            "markdown": "",
            "sourceUrl": "https://example.org/cells",
            "attachments": [{ "name": "Clip.png", "mime": "image/png", "data": png }],
        })),
    );
    assert_eq!(clip.status, 201, "{:?}", clip.json_body());
    let id = clip.json_body().expect("json")["page"]["id"]
        .as_str()
        .expect("an id")
        .to_owned();
    let markdown = test.backend.markdown(&id).expect("the page");
    assert!(
        markdown.starts_with("Source: <https://example.org/cells>"),
        "{markdown}"
    );
    assert!(markdown.contains("[Clip.png]"), "{markdown}");
    assert_eq!(test.backend.history(&id), vec!["Added via clipper".to_owned()]);
    assert!(
        test.approver.asked().is_empty(),
        "a clip the person made doesn't ask again"
    );
}

#[test]
fn a_mail_add_in_saves_a_message_from_its_own_https_origin_only() {
    let test = TestApi::start();
    let addin = "https://addin.example.org";
    let token = paired(&test, addin, "mail");
    let message = json!({
        "title": "Field trip",
        "markdown": "**From:** Ms. Rivera\n\n---\n\nBring boots.",
        "sourceUrl": "https://outlook.office.com/mail/deeplink/read/AAMk",
        "attachments": [{ "name": "Permission.pdf", "mime": "application/pdf", "data": STANDARD.encode(b"%PDF-1.7") }],
    });
    let saved = send(
        &test,
        "POST",
        "/v1/sections/s-cells/pages",
        addin,
        Some(&token),
        Some(message.clone()),
    );
    assert_eq!(saved.status, 201, "{:?}", saved.json_body());
    assert_eq!(saved.header("access-control-allow-origin"), Some(addin));
    let other = send(
        &test,
        "POST",
        "/v1/sections/s-cells/pages",
        "https://other.example.org",
        Some(&token),
        Some(message),
    );
    assert_eq!(other.status, 403, "another site can't use the add-in's token");
    let clipper_kind = send(
        &test,
        "POST",
        "/v1/pair/code",
        addin,
        None,
        Some(json!({ "code": "AAAA-AAAA", "name": "x", "kind": "clipper" })),
    );
    assert_eq!(clipper_kind.status, 403, "only a mail add-in pairs from a web page");
}

#[test]
fn clips_stay_inside_the_grant_and_out_of_locked_sections() {
    let test = TestApi::start();
    let chrome = format!("chrome-extension://{}", "abcdefghijklmnop".repeat(2));
    let token = paired(&test, &chrome, "clipper");
    let page = json!({ "title": "Clip", "markdown": "Text" });
    let locked = send(
        &test,
        "POST",
        "/v1/sections/s-diary/pages",
        &chrome,
        Some(&token),
        Some(page.clone()),
    );
    assert_eq!(locked.status, 423);
    let elsewhere = send(
        &test,
        "POST",
        "/v1/sections/s-meet/pages",
        &chrome,
        Some(&token),
        Some(page),
    );
    assert_eq!(elsewhere.status, 403, "the code gave Biology only");
    let script = send(
        &test,
        "POST",
        "/v1/sections/s-cells/pages",
        &chrome,
        Some(&token),
        Some(json!({ "title": "x", "sourceUrl": "javascript:alert(1)" })),
    );
    assert_eq!(script.status, 400);
    let too_many: Vec<Value> = (0..11)
        .map(|at| json!({ "name": format!("{at}.txt"), "mime": "text/plain", "data": "QQ==" }))
        .collect();
    let crowded = send(
        &test,
        "POST",
        "/v1/sections/s-cells/pages",
        &chrome,
        Some(&token),
        Some(json!({ "title": "x", "attachments": too_many })),
    );
    assert_eq!(crowded.status, 400);
    let pages_before = test.backend.page_count();
    assert_eq!(pages_before, 3, "nothing refused was added");
}
