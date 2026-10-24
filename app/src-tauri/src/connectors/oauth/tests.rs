//! The sign-in requests against a local mock server: the address, the code exchange, the refresh, and the revoke.

use serde_json::json;

use super::*;
use crate::connectors::{
    http::UreqHttp,
    mock::{
        fixtures::{connector, oauth},
        MockServer, Reply,
    },
    registry::Auth,
};

const REDIRECT: &str = "http://127.0.0.1:4711/callback";

fn client(secret: Option<&str>) -> Client {
    Client {
        id: "example-client-id".into(),
        secret: secret.map(Secret::new),
        redirect_port: None,
    }
}

/// Runs `check` with an exchange against the mock, with the given OAuth settings changed by `adjust`.
fn with_exchange<R>(
    server: &MockServer,
    secret: Option<&str>,
    adjust: impl FnOnce(&mut OAuthDef),
    check: impl FnOnce(&Exchange) -> R,
) -> R {
    let mut settings = oauth(server);
    adjust(&mut settings);
    let def = connector("example", Auth::OAuth(settings));
    let http = UreqHttp::default();
    let policy = HostPolicy::new(["127.0.0.1"]);
    let client = client(secret);
    check(&Exchange {
        http: &http,
        policy: &policy,
        def,
        oauth: &settings,
        client: &client,
    })
}

fn query_of(url: &str) -> std::collections::HashMap<String, String> {
    Url::parse(url)
        .expect("a URL")
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect()
}

#[test]
fn the_sign_in_address_carries_state_pkce_scopes_and_the_loopback_redirect() {
    let server = MockServer::start();
    let url = with_exchange(
        &server,
        Some("never-in-the-address"),
        |_| {},
        |exchange| {
            exchange
                .authorize_url(REDIRECT, "the-state", Some("the-challenge"))
                .expect("builds")
        },
    );
    assert!(url.starts_with(&server.url("/authorize")));
    let query = query_of(&url);
    assert_eq!(query["response_type"], "code");
    assert_eq!(query["client_id"], "example-client-id");
    assert_eq!(query["redirect_uri"], REDIRECT);
    assert_eq!(query["state"], "the-state");
    assert_eq!(query["code_challenge"], "the-challenge");
    assert_eq!(query["code_challenge_method"], "S256");
    assert_eq!(query["scope"], "scope-a scope-b");
    assert_eq!(query["access_type"], "offline");
    assert!(!url.contains("never-in-the-address") && !query.contains_key("client_secret"));
}

#[test]
fn a_service_without_pkce_gets_no_challenge_and_slack_style_scopes_go_in_their_own_parameter() {
    let server = MockServer::start();
    let url = with_exchange(
        &server,
        None,
        |settings| {
            settings.pkce = false;
            settings.scope_param = "user_scope";
            settings.scope_separator = ",";
        },
        |exchange| exchange.authorize_url(REDIRECT, "s", Some("c")).expect("builds"),
    );
    let query = query_of(&url);
    assert!(!query.contains_key("code_challenge") && !query.contains_key("scope"));
    assert_eq!(query["user_scope"], "scope-a,scope-b");
}

#[test]
fn trades_the_code_for_tokens_with_the_verifier_and_the_client() {
    let server = MockServer::start();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3599, "scope": "scope-a scope-b" }),
        )],
    );
    let tokens = with_exchange(
        &server,
        Some("example-secret"),
        |_| {},
        |exchange| {
            exchange
                .exchange_code(&Secret::new("the-code"), Some("the-verifier"), REDIRECT)
                .expect("exchanges")
        },
    );
    assert_eq!(tokens.access.expose(), "access-1");
    assert_eq!(tokens.refresh.as_ref().map(Secret::expose), Some("refresh-1"));
    assert_eq!(tokens.expires_in, Some(3599));
    assert_eq!(tokens.scopes, Some(vec!["scope-a".to_owned(), "scope-b".to_owned()]));

    let sent = &server.requests_to("/token")[0];
    assert_eq!(sent.method, "POST");
    assert_eq!(sent.header("content-type"), Some("application/x-www-form-urlencoded"));
    for (name, value) in [
        ("grant_type", "authorization_code"),
        ("code", "the-code"),
        ("code_verifier", "the-verifier"),
        ("redirect_uri", REDIRECT),
        ("client_id", "example-client-id"),
        ("client_secret", "example-secret"),
    ] {
        assert_eq!(sent.field(name).as_deref(), Some(value), "{name}");
    }
}

#[test]
fn the_client_secret_is_left_out_when_the_service_takes_pkce_alone() {
    let server = MockServer::start();
    server.route("/token", vec![Reply::json(200, json!({ "access_token": "a" }))]);
    with_exchange(
        &server,
        Some("configured-anyway"),
        |settings| settings.secret = SecretUse::Never,
        |exchange| {
            exchange
                .exchange_code(&Secret::new("c"), Some("v"), REDIRECT)
                .expect("exchanges");
        },
    );
    assert_eq!(server.requests_to("/token")[0].field("client_secret"), None);
}

#[test]
fn reads_nested_answers_and_numbers_sent_as_text() {
    let server = MockServer::start();
    server.route(
        "/token",
        vec![Reply::json(
            200,
            json!({ "ok": true, "authed_user": { "access_token": "user-token", "scope": "chat:write,files:write", "expires_in": "43200" },
                    "team": { "name": "Study group" } }),
        )],
    );
    let tokens = with_exchange(
        &server,
        None,
        |settings| {
            settings.response = crate::connectors::registry::Pointers {
                access: "/authed_user/access_token",
                refresh: "/authed_user/refresh_token",
                expires_in: "/authed_user/expires_in",
                scope: "/authed_user/scope",
            };
        },
        |exchange| {
            exchange
                .exchange_code(&Secret::new("c"), None, REDIRECT)
                .expect("exchanges")
        },
    );
    assert_eq!(tokens.access.expose(), "user-token");
    assert!(tokens.refresh.is_none());
    assert_eq!(tokens.expires_in, Some(43200));
    assert_eq!(
        tokens.scopes,
        Some(vec!["chat:write".to_owned(), "files:write".to_owned()])
    );
}

#[test]
fn a_refused_exchange_is_a_rejection_and_a_server_error_is_a_network_failure() {
    let server = MockServer::start();
    let cases = [
        (Reply::json(400, json!({ "error": "invalid_grant" })), Failure::Rejected),
        (
            Reply::json(200, json!({ "ok": false, "error": "invalid_code" })),
            Failure::Rejected,
        ),
        (Reply::json(200, json!({ "token_type": "bearer" })), Failure::Rejected),
        (Reply::empty(200), Failure::Rejected),
        (Reply::empty(503), Failure::Network),
    ];
    for (reply, expected) in cases {
        server.route("/token", vec![reply]);
        let outcome = with_exchange(
            &server,
            None,
            |_| {},
            |exchange| exchange.exchange_code(&Secret::new("c"), None, REDIRECT).map(|_| ()),
        );
        assert_eq!(outcome, Err(expected));
        server.clear_routes();
    }
}

#[test]
fn refreshes_with_the_refresh_token_and_tells_a_dead_one_from_a_busy_server() {
    let server = MockServer::start();
    server.route(
        "/token",
        vec![
            Reply::json(
                200,
                json!({ "access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600 }),
            ),
            Reply::json(400, json!({ "error": "invalid_grant" })),
            Reply::empty(502),
        ],
    );
    with_exchange(
        &server,
        None,
        |_| {},
        |exchange| {
            let tokens = exchange.refresh(&Secret::new("refresh-1")).expect("refreshes");
            assert_eq!(tokens.access.expose(), "access-2");
            assert_eq!(tokens.refresh.as_ref().map(Secret::expose), Some("refresh-2"));
            assert_eq!(
                exchange.refresh(&Secret::new("refresh-2")).map(|_| ()),
                Err(Failure::Expired)
            );
            assert_eq!(
                exchange.refresh(&Secret::new("refresh-2")).map(|_| ()),
                Err(Failure::Network)
            );
        },
    );
    let first = &server.requests_to("/token")[0];
    assert_eq!(first.field("grant_type").as_deref(), Some("refresh_token"));
    assert_eq!(first.field("refresh_token").as_deref(), Some("refresh-1"));
    assert_eq!(first.field("code"), None);
}

#[test]
fn never_sends_to_a_token_endpoint_outside_the_pinned_hosts() {
    let server = MockServer::start();
    let outcome = with_exchange(
        &server,
        None,
        |settings| settings.token_url = "https://evil.example/token",
        |exchange| exchange.exchange_code(&Secret::new("c"), None, REDIRECT).map(|_| ()),
    );
    assert_eq!(outcome, Err(Failure::ForeignHost));
    assert!(server.requests().is_empty());
}

#[test]
fn a_redirect_off_the_pinned_hosts_is_not_followed() {
    let server = MockServer::start();
    server.route("/token", vec![Reply::redirect("https://evil.example/steal")]);
    let outcome = with_exchange(
        &server,
        None,
        |_| {},
        |exchange| exchange.exchange_code(&Secret::new("c"), None, REDIRECT).map(|_| ()),
    );
    assert_eq!(outcome, Err(Failure::ForeignHost));
}

#[test]
fn revokes_in_the_way_each_service_asks() {
    let server = MockServer::start();
    server.route("/revoke", vec![Reply::empty(200)]);
    let token = Secret::new("the-token");
    let form = with_exchange(&server, None, |_| {}, |exchange| exchange.revoke(&token));
    assert_eq!(form, Ok(true));
    assert_eq!(
        server.requests_to("/revoke")[0].field("token").as_deref(),
        Some("the-token")
    );

    let with_client = with_exchange(
        &server,
        Some("example-secret"),
        |settings| {
            settings.revoke = Revoke::Form {
                url: crate::connectors::mock::fixtures::leak_str(server.url("/revoke")),
                with_client: true,
            }
        },
        |exchange| exchange.revoke(&token),
    );
    assert_eq!(with_client, Ok(true));
    let sent = &server.requests_to("/revoke")[1];
    assert_eq!(sent.field("client_id").as_deref(), Some("example-client-id"));
    assert_eq!(sent.field("client_secret").as_deref(), Some("example-secret"));

    let bearer = with_exchange(
        &server,
        None,
        |settings| {
            settings.revoke = Revoke::BearerDelete {
                url: crate::connectors::mock::fixtures::leak_str(server.url("/revoke")),
            }
        },
        |exchange| exchange.revoke(&token),
    );
    assert_eq!(bearer, Ok(true));
    let sent = &server.requests_to("/revoke")[2];
    assert_eq!(
        (sent.method.as_str(), sent.header("authorization")),
        ("DELETE", Some("Bearer the-token"))
    );

    let none = with_exchange(
        &server,
        None,
        |settings| settings.revoke = Revoke::None,
        |exchange| exchange.revoke(&token),
    );
    assert_eq!(none, Ok(false));
    assert_eq!(server.requests_to("/revoke").len(), 3);
}

#[test]
fn a_revoke_the_service_cannot_do_right_now_is_reported() {
    let server = MockServer::start();
    server.route("/revoke", vec![Reply::empty(503), Reply::empty(403)]);
    let token = Secret::new("t");
    with_exchange(
        &server,
        None,
        |_| {},
        |exchange| {
            assert_eq!(exchange.revoke(&token), Err(Failure::Network));
            assert_eq!(exchange.revoke(&token), Err(Failure::Rejected));
        },
    );
}
