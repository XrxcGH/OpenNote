//! Checks on scopes, headers, and where a token goes on a request.

use super::*;
use crate::connectors::registry;

fn connection(scopes: &[&str]) -> Connection {
    Connection {
        account: "a".into(),
        scopes: scopes.iter().map(|s| (*s).to_owned()).collect(),
        connected_unix: 0,
        holds: Holds::Refresh,
        base_url: None,
        expired: false,
        last_used_unix: None,
    }
}

#[test]
fn granted_scopes_match_in_the_spellings_services_use() {
    let have = connection(&["https://graph.microsoft.com/Notes.Read", "openid"]);
    assert!(granted(&have, "Notes.Read"));
    assert!(granted(&have, "OPENID"));
    assert!(!granted(&have, "Calendars.Read"));
    assert!(!granted(&connection(&[]), "Notes.Read"));
}

#[test]
fn sign_in_scopes_count_as_granted_however_the_service_answers() {
    // Microsoft's token answer lists only the resource scopes; Google's spells email as a URL.
    let microsoft = connection(&["User.Read", "Calendars.Read"]);
    let google = connection(&[
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    for scope in ["openid", "email", "profile", "offline_access"] {
        assert!(granted(&microsoft, scope), "{scope}");
        assert!(granted(&google, scope), "{scope}");
    }
    assert!(!granted(&microsoft, "Notes.Read"));
}

#[test]
fn a_capability_stands_for_its_scopes_and_other_names_are_scopes() {
    let google = registry::find("google").expect("google");
    assert_eq!(
        expand(google, &["classroomRead"]),
        [
            "https://www.googleapis.com/auth/classroom.courses.readonly",
            "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
        ]
    );
    assert_eq!(expand(google, &["some-scope"]), ["some-scope"]);
    assert!(expand(google, &[]).is_empty());
}

#[test]
fn callers_cannot_set_the_token_or_name_the_server() {
    for name in [
        "Authorization",
        "authorization",
        "Cookie",
        "Host",
        "Proxy-Authorization",
        "Content-Length",
    ] {
        assert!(!header_ok(name, "x"), "{name}");
    }
    assert!(header_ok("Accept", "application/json"));
    assert!(!header_ok("X-Test", "a\r\nInjected: 1"));
    assert!(!header_ok("Bad Name", "x"));
    assert!(!header_ok("", "x"));
}

#[test]
fn the_token_goes_in_the_header_or_the_form_as_the_service_wants() {
    let token = Secret::new("tok-123");
    let request = || HttpRequest::new(registry::Method::Get, "https://example.test/");
    let header = with_token(request(), Placement::Header("Bearer"), &token).expect("signs");
    assert_eq!(
        header.headers,
        [("Authorization".to_owned(), "Bearer tok-123".to_owned())]
    );
    let form = with_token(request(), Placement::FormField("wstoken"), &token).expect("signs");
    let Some(Body::Form(fields)) = form.body else {
        panic!("a form body")
    };
    assert_eq!(fields, [("wstoken".to_owned(), "tok-123".to_owned())]);
    let bytes = HttpRequest {
        body: Some(Body::Bytes {
            content_type: "x".into(),
            data: vec![],
        }),
        ..request()
    };
    assert!(with_token(bytes, Placement::FormField("wstoken"), &token).is_none());
}
