//! Pasted tokens, school connectors, the real registry without client IDs, and the interface catalog fixture.

use super::*;

fn token_def(
    needs_base_url: bool,
    placement: Placement,
    account_pointer: &'static str,
    check_url: &'static str,
) -> TokenDef {
    TokenDef {
        needs_base_url,
        placement,
        // A form token goes in a post, as Moodle's does.
        check_method: if matches!(placement, Placement::FormField(_)) {
            Method::Post
        } else {
            Method::Get
        },
        check_url,
        check_form: &[],
        account_pointer,
    }
}

fn scripted(replies: Vec<(u16, serde_json::Value)>) -> Arc<ScriptedHttp> {
    let http = ScriptedHttp::default();
    *http.replies.lock().expect("lock") = replies;
    Arc::new(http)
}

fn token_connector(id: &'static str, def: TokenDef, hosts: &'static [&'static str]) -> &'static ConnectorDef {
    let template = connector(id, Auth::Token(def));
    Box::leak(Box::new(ConnectorDef { hosts, ..*template }))
}

#[test]
fn a_pasted_token_is_checked_stored_in_the_credential_store_and_used_with_its_scheme() {
    let http = scripted(vec![(200, json!({ "name": "Sam Student" }))]);
    let def = token_connector(
        "tokened",
        token_def(
            false,
            Placement::Header("Token"),
            "/name",
            "https://tokens.example/api/auth/",
        ),
        &["tokens.example"],
    );
    let rig = Rig::new(registry(vec![def]), http.clone(), None);
    assert_eq!(
        rig.state("tokened"),
        StateView::NotConnected,
        "a token connector never needs setup"
    );

    let input = ConnectInput {
        token: Some("  pasted-token-value-1234  ".into()),
        base_url: None,
    };
    let view = rig.connectors.connect("tokened", input).expect("connects");
    assert_eq!(view.state, connected("Sam Student"));
    assert_eq!(
        rig.store.get("OpenNote/tokened/Sam Student"),
        Ok(Some(Secret::new("pasted-token-value-1234")))
    );
    assert!(!rig.files_text().contains("pasted-token-value-1234"));
    assert_eq!(
        http.seen.lock().expect("lock")[0].headers,
        [("Authorization".to_owned(), "Token pasted-token-value-1234".to_owned())]
    );

    let request = HttpRequest::new(Method::Get, "https://tokens.example/api/highlights");
    rig.connectors.request("tokened", &[], request, 1000).expect("answers");
    assert_eq!(
        http.seen.lock().expect("lock")[1].headers[0].1,
        "Token pasted-token-value-1234"
    );
    let foreign = HttpRequest::new(Method::Get, "https://other.example/api");
    assert_eq!(
        rig.connectors
            .request("tokened", &[], foreign, 1000)
            .map(|_| ())
            .map_err(|e| e.failure),
        Err(Failure::ForeignHost)
    );
}

#[test]
fn a_token_the_service_refuses_is_not_kept() {
    let http = scripted(vec![(401, json!({ "detail": "Invalid token." }))]);
    let def = token_connector(
        "tokened",
        token_def(
            false,
            Placement::Header("Token"),
            "",
            "https://tokens.example/api/auth/",
        ),
        &["tokens.example"],
    );
    let rig = Rig::new(registry(vec![def]), http, None);
    let outcome = rig.connectors.connect(
        "tokened",
        ConnectInput {
            token: Some("wrong-token-value-12".into()),
            base_url: None,
        },
    );
    assert_eq!(outcome.map(|_| ()).map_err(|e| e.failure), Err(Failure::Rejected));
    assert_eq!(rig.state("tokened"), StateView::NotConnected);
    assert_eq!(rig.store.get("OpenNote/tokened/default"), Ok(None));
    for bad in [
        None,
        Some(String::new()),
        Some("short".to_owned()),
        Some("has a space in it".to_owned()),
    ] {
        let outcome = rig.connectors.connect(
            "tokened",
            ConnectInput {
                token: bad,
                base_url: None,
            },
        );
        assert_eq!(outcome.map(|_| ()).map_err(|e| e.failure), Err(Failure::BadInput));
    }
}

#[test]
fn a_school_connector_talks_only_to_the_schools_own_host() {
    let http = scripted(vec![(200, json!({ "fullname": "Sam Student" }))]);
    let mut def = token_def(
        true,
        Placement::FormField("wstoken"),
        "/fullname",
        "/webservice/rest/server.php",
    );
    def.check_form = &[("wsfunction", "core_webservice_get_site_info")];
    let def = token_connector("school", def, &[]);
    let rig = Rig::new(registry(vec![def]), http.clone(), None);

    for bad in [
        "http://school.example.edu",
        "https://127.0.0.1",
        "https://school.example.edu@evil.example",
        "",
    ] {
        let input = ConnectInput {
            token: Some("school-token-abcdef12".into()),
            base_url: Some(bad.into()),
        };
        let outcome = rig
            .connectors
            .connect("school", input)
            .map(|_| ())
            .map_err(|e| e.failure);
        assert_eq!(outcome, Err(Failure::BadInput), "{bad}");
    }
    assert!(
        http.seen.lock().expect("lock").is_empty(),
        "nothing was sent for a bad address"
    );

    let input = ConnectInput {
        token: Some("school-token-abcdef12".into()),
        base_url: Some("School.Example.edu/moodle/".into()),
    };
    let view = rig.connectors.connect("school", input).expect("connects");
    assert_eq!(view.state, connected("Sam Student"));
    assert_eq!(view.base_url.as_deref(), Some("https://school.example.edu/moodle"));
    assert_eq!(view.hosts, ["school.example.edu"]);
    {
        let seen = http.seen.lock().expect("lock");
        assert_eq!(seen[0].hosts, ["school.example.edu"]);
        assert_eq!(
            seen[0].url,
            "https://school.example.edu/moodle/webservice/rest/server.php"
        );
        assert!(seen[0].body.contains("wstoken=school-token-abcdef12"));
        assert!(seen[0].body.contains("wsfunction=core_webservice_get_site_info"));
    }
    assert!(rig.files_text().contains("https://school.example.edu/moodle"));
    assert!(!rig.files_text().contains("school-token-abcdef12"));

    let foreign = HttpRequest::new(Method::Post, "https://other.example.edu/webservice/rest/server.php");
    assert_eq!(
        rig.connectors
            .request("school", &[], foreign, 1000)
            .map(|_| ())
            .map_err(|e| e.failure),
        Err(Failure::ForeignHost)
    );
}

#[test]
fn the_real_registry_signs_in_nowhere_without_client_ids() {
    let rig = Rig::new(
        crate::connectors::registry::CONNECTORS,
        Arc::new(UreqHttp::default()),
        None,
    );
    let list = rig.connectors.list();
    assert_eq!(list.len(), crate::connectors::registry::CONNECTORS.len());
    let oauth_ids = ["microsoft", "google", "slack", "dropbox", "box", "vimeo"];
    for view in &list {
        let expected = if oauth_ids.contains(&view.id) {
            StateView::NeedsSetup
        } else {
            StateView::NotConnected
        };
        assert_eq!(view.state, expected, "{}", view.id);
    }
}

/// The interface's fake host builds its catalog from this file, so the web build and the component tests show
/// exactly what the real registry sends. Rewrite it after a deliberate change with `UPDATE_WIRE=1 cargo test`.
#[test]
fn the_interfaces_catalog_is_the_registrys_own_list() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/features/connectors/registry.fixture.json");
    let rig = Rig::new(
        crate::connectors::registry::CONNECTORS,
        Arc::new(UreqHttp::default()),
        None,
    );
    let actual = serde_json::to_value(rig.connectors.list()).expect("serializes");
    if std::env::var_os("UPDATE_WIRE").is_some() {
        let text = serde_json::to_string_pretty(&actual).expect("serializes");
        fs::write(&path, format!("{text}\n")).expect("writes the fixture");
    }
    let saved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("the fixture exists")).expect("json");
    assert_eq!(
        saved,
        actual,
        "run UPDATE_WIRE=1 cargo test -p opennote connectors to rewrite {}",
        path.display()
    );
}

#[test]
fn a_401_on_one_endpoint_expires_a_pasted_token_only_when_the_token_check_fails_too() {
    let http = scripted(vec![
        (200, json!({ "name": "Sam" })),
        (401, json!({ "errors": "Insufficient scopes on access token." })),
        (200, json!({ "name": "Sam" })),
        (401, json!({})),
        (401, json!({})),
    ]);
    let def = token_connector(
        "tokened",
        token_def(
            false,
            Placement::Header("Bearer"),
            "/name",
            "https://tokens.example/api/me",
        ),
        &["tokens.example"],
    );
    let rig = Rig::new(registry(vec![def]), http, None);
    let input = ConnectInput {
        token: Some("pasted-token-value-1234".into()),
        base_url: None,
    };
    rig.connectors.connect("tokened", input).expect("connects");
    let ask = || {
        let request = HttpRequest::new(Method::Get, "https://tokens.example/api/analytics");
        rig.connectors
            .request("tokened", &[], request, 1000)
            .map(|_| ())
            .map_err(|e| e.failure)
    };
    assert_eq!(ask(), Err(Failure::Rejected), "the token still checks out");
    assert_eq!(rig.state("tokened"), connected("Sam"));
    assert_eq!(ask(), Err(Failure::Expired), "the token check is refused too");
    assert_ne!(rig.state("tokened"), connected("Sam"));
}
