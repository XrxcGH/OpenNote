//! Signing in: the browser, the state check, the time limit, cancel, and what lands on disk.

use super::*;

#[test]
fn signs_in_through_the_browser_and_keeps_only_metadata_on_disk() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("the-auth-code"));
    assert_eq!(connect(&rig), Ok(connected("sam@example.com")));

    // The browser was sent to the service's own page, with state, an S256 challenge, and the loopback redirect.
    let opened = rig.opened();
    assert_eq!(opened.len(), 1);
    let url = Url::parse(&opened[0]).expect("a URL");
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert!(opened[0].starts_with(&server.url("/authorize")));
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(query["redirect_uri"].starts_with("http://127.0.0.1:") && query["redirect_uri"].ends_with("/callback"));
    assert_eq!(query["state"].len(), 32);

    // The code was traded with the verifier whose challenge the browser was given, and with the client.
    let exchange = &server.requests_to("/token")[0];
    assert_eq!(exchange.field("code").as_deref(), Some("the-auth-code"));
    let verifier = exchange.field("code_verifier").expect("a verifier");
    assert_eq!(crate::connectors::pkce::challenge(&verifier), query["code_challenge"]);
    assert_eq!(
        exchange.field("redirect_uri").as_deref(),
        Some(query["redirect_uri"].as_str())
    );
    assert_eq!(
        exchange.field("client_secret").as_deref(),
        Some("example-client-secret")
    );

    // The refresh token is in the credential store under the documented name, and nowhere on disk.
    assert_eq!(
        rig.store.get("OpenNote/example/sam@example.com"),
        Ok(Some(Secret::new("refresh-one")))
    );
    let on_disk = rig.files_text();
    for leak in [
        "refresh-one",
        "access-one",
        "the-auth-code",
        verifier.as_str(),
        "example-client-secret",
    ] {
        assert!(!on_disk.contains(leak), "{leak} is on disk");
    }
    let saved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(rig.dir.path().join(CONNECTIONS_FILE)).expect("reads")).expect("json");
    let entry = saved["connections"]["example"].as_object().expect("an entry").clone();
    let mut keys: Vec<_> = entry.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["account", "connectedUnix", "holds", "scopes"]);
    assert_eq!(entry["scopes"], json!(["scope-a", "scope-b"]));
    assert!(rig.connectors.is_connected("example"));
    let listed = format!("{:?}", rig.connectors.list());
    assert!(!listed.contains("access-one") && !listed.contains("refresh-one"));
}

#[test]
fn without_a_client_id_the_card_needs_setup_and_nothing_opens() {
    let server = MockServer::start();
    let def = connector("example", Auth::OAuth(oauth(&server)));
    let rig = Rig::new(registry(vec![def]), Arc::new(UreqHttp::default()), None);
    assert_eq!(rig.state("example"), StateView::NeedsSetup);
    rig.visit(Visit::Approve("x"));
    assert_eq!(connect(&rig), Err(Failure::NotConfigured));
    assert!(rig.opened().is_empty() && server.requests().is_empty());
}

#[test]
fn work_offline_stops_every_network_use_with_a_clear_reason() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Approve("c"));
    connect(&rig).expect("connects");
    let before = server.requests().len();

    rig.offline.store(true, Ordering::Relaxed);
    assert_eq!(connect(&rig), Err(Failure::Offline));
    assert_eq!(
        rig.connectors
            .access_token("example", &[])
            .map(|_| ())
            .map_err(|e| e.failure),
        Err(Failure::Offline)
    );
    let request = HttpRequest::new(Method::Get, server.url("/api/things"));
    assert_eq!(
        rig.connectors
            .request("example", &[], request, 1000)
            .map(|_| ())
            .map_err(|e| e.failure),
        Err(Failure::Offline)
    );
    assert_eq!(server.requests().len(), before, "nothing was sent while offline");

    // Disconnect still works on this computer, and says the service wasn't told.
    let done = rig.connectors.disconnect("example").expect("disconnects");
    assert_eq!(done.revoke, RevokeOutcome::SkippedOffline);
    assert_eq!(rig.store.get("OpenNote/example/sam@example.com"), Ok(None));
    assert_eq!(server.requests().len(), before);
}

#[test]
fn a_no_in_the_browser_connects_nothing() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Refuse("access_denied"));
    assert_eq!(connect(&rig), Err(Failure::Denied));
    assert!(server.requests_to("/token").is_empty());
    assert_eq!(rig.state("example"), StateView::NotConnected);
    assert!(!rig.connectors.view("example").expect("a view").pending);
}

#[test]
fn an_answer_with_the_wrong_state_is_never_traded_for_tokens() {
    let server = MockServer::start();
    let mut rig = oauth_rig(&server);
    rig.restart(Duration::from_millis(300));
    rig.visit(Visit::WrongState);
    // The stray answer is refused and the wait goes on until the real one, or the time limit.
    assert_eq!(connect(&rig), Err(Failure::TimedOut));
    assert!(server.requests_to("/token").is_empty());
    assert_eq!(rig.state("example"), StateView::NotConnected);
}

#[test]
fn a_sign_in_nobody_finishes_times_out_and_frees_the_connector() {
    let server = MockServer::start();
    let mut rig = oauth_rig(&server);
    rig.restart(Duration::from_millis(200));
    rig.visit(Visit::Silent);
    assert_eq!(connect(&rig), Err(Failure::TimedOut));
    assert!(!rig.connectors.view("example").expect("a view").pending);
    rig.visit(Visit::Approve("late"));
    assert_eq!(
        connect(&rig),
        Ok(connected("sam@example.com")),
        "the person can try again"
    );
}

#[test]
fn a_waiting_sign_in_shows_as_pending_can_be_canceled_and_blocks_a_second() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    rig.visit(Visit::Silent);
    let waiting = {
        let connectors = rig.connectors.clone();
        thread::spawn(move || {
            connectors
                .connect("example", ConnectInput::default())
                .map(|_| ())
                .map_err(|e| e.failure)
        })
    };
    while !rig.connectors.view("example").expect("a view").pending {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(connect(&rig), Err(Failure::Busy));
    rig.connectors.cancel("example");
    assert_eq!(waiting.join().expect("finished"), Err(Failure::Canceled));
    assert!(!rig.connectors.view("example").expect("a view").pending);
}

#[test]
fn a_sign_in_whose_record_cannot_be_saved_leaves_no_credential_behind() {
    let server = MockServer::start();
    let rig = oauth_rig(&server);
    // A folder where the connections file goes makes every write of it fail.
    fs::create_dir_all(rig.dir.path().join(CONNECTIONS_FILE)).expect("makes the folder");
    rig.visit(Visit::Approve("good"));
    assert_eq!(connect(&rig), Err(Failure::Storage));
    assert_eq!(rig.store.get("OpenNote/example/sam@example.com"), Ok(None));
    assert_eq!(rig.state("example"), StateView::NotConnected);
}
