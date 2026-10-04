//! The tokens of the services behind OpenNote's connectors never survive the scrubber or the log's redaction. Each
//! value is made up and built from pieces, in the shape the service uses, so no secret scanner takes it for a real one.

use crate::scrub::{redact_secrets, Scrubber};

const BODY: &str = "Zx9Qw3Er5Ty7Ui1Op4As6Df8Gh2Jk0LmN";

/// Token-shaped values, by service.
fn shapes() -> Vec<(&'static str, String)> {
    vec![
        (
            "Microsoft access token",
            format!("{}.{BODY}.{BODY}", concat!("ey", "J0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9")),
        ),
        ("Microsoft refresh token", format!("0.{BODY}{BODY}")),
        ("Google access token", format!("{}.{BODY}{BODY}", concat!("ya", "29"))),
        ("Google refresh token", format!("1//0g{BODY}{BODY}")),
        ("Google authorization code", format!("4/0A{BODY}")),
        (
            "Slack user token",
            format!("{}-1234567890-1234567890-{BODY}", concat!("xo", "xp")),
        ),
        ("Dropbox access token", format!("sl.{BODY}{BODY}")),
        ("Box access token", BODY.to_owned()),
        ("Vimeo token", "0a1b2c3d4e5f60718293a4b5c6d7e8f9".to_owned()),
        ("Readwise token", format!("{BODY}12345678")),
        ("Canvas token", format!("7~{BODY}{BODY}")),
        ("Moodle token", "9f86d081884c7d659a2feaa0c55ad015".to_owned()),
    ]
}

/// The last 20 characters, which a redaction must not leave behind.
fn tail(token: &str) -> &str {
    &token[token.len() - 20..]
}

#[test]
fn the_scrubber_removes_each_services_token_wherever_it_appears() {
    for (name, token) in shapes() {
        for template in [
            "token is {}",
            "got {} back",
            "{}",
            "value={}",
            "\"x\":\"{}\"",
            "(token {})",
        ] {
            let scrubbed = Scrubber::new().text(&template.replace("{}", &token));
            assert!(!scrubbed.contains(tail(&token)), "{name}: {scrubbed}");
            // A quoted token goes with the quotes' text, and any other is replaced by a placeholder.
            assert!(
                scrubbed.contains("<token>") || scrubbed.contains("<text>"),
                "{name}: {scrubbed}"
            );
        }
    }
}

#[test]
fn the_log_redaction_removes_each_token_and_keeps_the_words_and_paths() {
    for (name, token) in shapes() {
        let line = format!("Couldn't renew the sign-in in D:/notes/sam ({token}) after 3 tries");
        let redacted = redact_secrets(&line);
        assert!(!redacted.contains(tail(&token)), "{name}: {redacted}");
        assert!(
            redacted.starts_with("Couldn't renew the sign-in in D:/notes/sam ("),
            "{name}: {redacted}"
        );
        assert!(
            redacted.ends_with(") after 3 tries") && redacted.contains("<token>"),
            "{name}: {redacted}"
        );
    }
}

#[test]
fn named_secrets_in_forms_headers_and_json_lose_their_values() {
    let long = format!("{BODY}{BODY}");
    for input in [
        format!("access_token={long}&token_type=bearer"),
        format!("refresh_token={long}"),
        format!("{{\"access_token\":\"{long}\"}}"),
        format!("Authorization: Bearer {long}"),
        "Authorization: Bearer short1".to_owned(),
        "client_secret=abc123".to_owned(),
        format!("code={long}&state=abc"),
    ] {
        let out = redact_secrets(&input);
        assert!(!out.contains(&BODY[..16]), "{input} -> {out}");
        assert!(out.contains("<token>"), "{input} -> {out}");
        assert_eq!(redact_secrets(&out), out, "redacting twice changes nothing");
    }
}

#[test]
fn the_log_redaction_leaves_ordinary_sentences_alone() {
    for line in [
        "Connected the Google connector.",
        "Couldn't reach slack.com: the connection timed out",
        "Renewing the sign-in for dropbox",
        "OpenNote/google/sam@example.com was removed",
        "token in the settings file was ignored",
    ] {
        assert_eq!(redact_secrets(line), line);
    }
}
