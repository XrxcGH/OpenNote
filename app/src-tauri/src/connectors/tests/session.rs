//! Using a connection: renewing tokens, requests, expiry, disconnecting, and changing accounts.

use super::*;

#[test]
fn a_token_is_renewed_before_it_ends_and_a_rotated_refresh_token_replaces_the_old_one() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    let token = |rig: &Rig| {
        rig.connectors
            .access_token("example", &["calendarRead"])
            .expect("a token")
            .expose()
            .to_owned()
    };

    assert_eq!(token(&rig), "access-one");
    assert_eq!(
        server.requests_to("/token").len(),
        1,
        "the one from sign-in is still good"
    );

    server.clear_routes();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "access-two", "refresh_token": "refresh-two", "expires_in": 3600 }),
        )],
    );
    rig.clock.store(NOW + 3600 - 60, Ordering::Relaxed);
    assert_eq!(token(&rig), "access-two");
    let renewal = &server.requests_to("/token")[1];
    assert_eq!(renewal.field("grant_type").as_deref(), Some("refresh_token"));
    assert_eq!(renewal.field("refresh_token").as_deref(), Some("refresh-one"));
    assert_eq!(
        rig.store.get("OpenNote/example/sam@example.com"),
        Ok(Some(Secret::new("refresh-two")))
    );
    assert_eq!(token(&rig), "access-two");
    assert_eq!(
        server.requests_to("/token").len(),
        2,
        "one renewal, and the next call used it"
    );
}

#[test]
fn a_restart_keeps_the_connection_and_renews_from_the_credential_store() {
    let server = MockServer::start();
    let mut rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    server.clear_routes();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "access-after-restart", "expires_in": 3600 }),
        )],
    );
    rig.restart(Duration::from_secs(5));
    assert_eq!(rig.state("example"), connected("sam@example.com"));
    let token = rig.connectors.access_token("example", &[]).expect("a token");
    assert_eq!(token.expose(), "access-after-restart");
}

#[test]
fn access_the_connection_lacks_is_reported_not_guessed() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    server.clear_routes();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "a", "refresh_token": "r", "scope": "scope-a" }),
        )],
    );
    server.route("/me", vec![Reply::json(200, json!({ "email": "sam@example.com" }))]);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    assert!(rig.connectors.access_token("example", &["calendarRead"]).is_ok());
    let missing = rig
        .connectors
        .access_token("example", &["tasksWrite"])
        .map(|_| ())
        .map_err(|e| e.failure);
    assert_eq!(missing, Err(Failure::MissingAccess));
    assert_eq!(
        rig.connectors
            .access_token("nothing", &[])
            .map(|_| ())
            .map_err(|e| e.failure),
        Err(Failure::Unknown)
    );
}

#[test]
fn a_refused_renewal_marks_the_sign_in_expired_until_the_person_reconnects() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    server.clear_routes();
    server.route("/token", vec![Reply::json(400, json!({ "error": "invalid_grant" }))]);
    rig.clock.store(NOW + 4000, Ordering::Relaxed);
    let outcome = rig
        .connectors
        .access_token("example", &[])
        .map(|_| ())
        .map_err(|e| e.failure);
    assert_eq!(outcome, Err(Failure::Expired));
    assert_eq!(
        rig.state("example"),
        StateView::Expired {
            account: "sam@example.com".into()
        }
    );
    assert!(!rig.connectors.is_connected("example"));
    assert!(fs::read_to_string(rig.dir.path().join(CONNECTIONS_FILE))
        .expect("reads")
        .contains("\"expired\": true"));
    let again = rig
        .connectors
        .access_token("example", &[])
        .map(|_| ())
        .map_err(|e| e.failure);
    assert_eq!(again, Err(Failure::Expired));
    assert_eq!(
        server.requests_to("/token").len(),
        2,
        "an expired sign-in isn't retried on every call"
    );

    server.clear_routes();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "fresh", "refresh_token": "fresh-refresh", "expires_in": 3600 }),
        )],
    );
    server.route("/me", vec![Reply::json(200, json!({ "email": "sam@example.com" }))]);
    rig.visit(Visit::Approve("c2"));
    assert!(matches!(connect(&rig), Ok(StateView::Connected { account, .. }) if account == "sam@example.com"));
    assert!(rig.connectors.is_connected("example"));
}

#[test]
fn requests_carry_the_token_and_go_only_to_allowed_hosts() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    let get = |url: String, headers: Vec<(&str, &str)>| {
        let mut request = HttpRequest::new(Method::Get, url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        rig.connectors
            .request("example", &["calendarRead"], request, 10_000)
            .map_err(|e| e.failure)
    };
    let answer = get(server.url("/api/things"), vec![("Accept", "application/json")]).expect("answers");
    assert_eq!(answer.status, 200);
    let sent = &server.requests_to("/api/things")[0];
    assert_eq!(sent.header("authorization"), Some("Bearer access-one"));
    assert_eq!(sent.header("accept"), Some("application/json"));

    assert_eq!(
        get("https://evil.example/steal".into(), vec![]).map(|_| ()),
        Err(Failure::ForeignHost)
    );
    assert_eq!(
        get("https://127.0.0.1.evil.example/".into(), vec![]).map(|_| ()),
        Err(Failure::ForeignHost)
    );
    assert_eq!(
        get(server.url("/api/things"), vec![("Authorization", "Bearer mine")]).map(|_| ()),
        Err(Failure::BadInput)
    );
    assert_eq!(
        server.requests_to("/api/things").len(),
        1,
        "the refused ones were never sent"
    );
}

#[test]
fn a_401_renews_the_token_once_and_a_second_401_expires_the_sign_in() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    server.clear_routes();
    server.route("/api/things", vec![Reply::empty(401), Reply::json(200, json!({}))]);
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "access-renewed", "expires_in": 3600 }),
        )],
    );
    let request = || HttpRequest::new(Method::Get, server.url("/api/things"));
    let answer = rig
        .connectors
        .request("example", &[], request(), 1000)
        .expect("answers");
    assert_eq!(answer.status, 200);
    assert_eq!(
        server.requests_to("/api/things")[1].header("authorization"),
        Some("Bearer access-renewed")
    );

    server.clear_routes();
    server.route("/api/things", vec![Reply::empty(401)]);
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "access-again", "expires_in": 3600 }),
        )],
    );
    let outcome = rig
        .connectors
        .request("example", &[], request(), 1000)
        .map(|_| ())
        .map_err(|e| e.failure);
    assert_eq!(outcome, Err(Failure::Expired));
    assert_eq!(
        rig.state("example"),
        StateView::Expired {
            account: "sam@example.com".into()
        }
    );
}

#[test]
fn disconnecting_revokes_deletes_the_credential_and_forgets_the_account() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    let done = rig.connectors.disconnect("example").expect("disconnects");
    assert_eq!(done.revoke, RevokeOutcome::Revoked);
    assert_eq!(done.view.state, StateView::NotConnected);
    assert_eq!(
        server.requests_to("/revoke")[0].field("token").as_deref(),
        Some("refresh-one")
    );
    assert_eq!(rig.store.get("OpenNote/example/sam@example.com"), Ok(None));
    assert!(!rig.files_text().contains("sam@example.com"));
    assert!(!rig.connectors.is_connected("example"));
    assert_eq!(
        rig.connectors.disconnect("example").expect("again").revoke,
        RevokeOutcome::Nothing
    );
}

#[test]
fn a_service_that_cannot_be_told_still_disconnects_here() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    server.clear_routes();
    server.route("/revoke", vec![Reply::empty(503)]);
    let done = rig.connectors.disconnect("example").expect("disconnects");
    assert_eq!(done.revoke, RevokeOutcome::Failed);
    assert_eq!(rig.store.get("OpenNote/example/sam@example.com"), Ok(None));
    assert_eq!(rig.state("example"), StateView::NotConnected);
}

#[test]
fn a_service_with_no_revoke_endpoint_says_so() {
    let server = MockServer::start();
    let mut settings = oauth(&server);
    settings.revoke = Revoke::None;
    let def = connector("example", Auth::OAuth(settings));
    server.route(
        "/token",
        vec![Reply::json(200, json!({ "access_token": "a", "refresh_token": "r" }))],
    );
    server.route("/me", vec![Reply::json(200, json!({ "email": "sam@example.com" }))]);
    let rig = Rig::new(registry(vec![def]), Arc::new(UreqHttp::default()), Some(CLIENT_FILE));
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    assert_eq!(
        rig.connectors.disconnect("example").expect("disconnects").revoke,
        RevokeOutcome::NotSupported
    );
}

#[test]
fn signing_in_as_another_account_replaces_the_old_credential() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    server.clear_routes();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "a2", "refresh_token": "refresh-other" }),
        )],
    );
    server.route("/me", vec![Reply::json(200, json!({ "email": "lee@example.com" }))]);
    assert_eq!(connect(&rig), Ok(connected("lee@example.com")));
    assert_eq!(rig.store.get("OpenNote/example/sam@example.com"), Ok(None));
    assert_eq!(
        rig.store.get("OpenNote/example/lee@example.com"),
        Ok(Some(Secret::new("refresh-other")))
    );
}
