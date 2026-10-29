use crate::scrub::Scrubber;

/// A scrubber that knows a made-up person.
fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber
}

/// Asserts that each input scrubs to the expected text.
fn assert_scrubs(cases: &[(&str, &str)]) {
    for (input, expected) in cases {
        assert_eq!(scrubber().text(input), *expected, "{input}");
    }
}

/// Asserts that each message comes out unchanged.
fn assert_kept(messages: &[&str]) {
    for message in messages {
        assert_eq!(scrubber().text(message), *message);
    }
}

#[test]
fn removes_device_and_account_identifiers() {
    assert_scrubs(&[
        (
            "volume 6B29FC40-CA47-1067-B31D-00DD010662DA mounted",
            "volume <id> mounted",
        ),
        (
            "class {6b29fc40-ca47-1067-b31d-00dd010662da} loaded",
            "class <id> loaded",
        ),
        (
            "account S-1-5-21-1004336348-1177238915-682003330-1001 denied",
            "account <id> denied",
        ),
        ("adapter 00:1A:2B:3C:4D:5E up", "adapter <id> up"),
        ("adapter 00-1a-2b-3c-4d-5e up", "adapter <id> up"),
        ("connect 192.168.1.20 refused", "connect <id> refused"),
        ("connect 192.168.1.20.", "connect <id>."),
    ]);
}

#[test]
fn leaves_numbers_that_are_not_identifiers() {
    assert_kept(&[
        "Windows 10.0.26200 x86_64",
        "version 1.2.3.4.5 of the format",
        "256.1.1.1 is not an address",
        "S-1-5-18 is a well known account",
        "took 12:30:45 to finish",
        "row 4294967295 of 10",
    ]);
}

#[test]
fn removes_long_key_like_strings() {
    // Built in pieces so secret scanners do not take the test value for a real key.
    let key = concat!("sk_", "live_", "4eC39HqLyjWDarjtT1zdp7dcABCDEFGH");
    assert_eq!(
        scrubber().text(&format!("header {key} rejected")),
        "header <token> rejected"
    );
    let digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    assert_eq!(scrubber().text(&format!("sha {digest}")), "sha <token>");
    // Long words and letters-only runs are text, not keys.
    let word = "Pneumonoultramicroscopicsilicovolcanoconiosis";
    assert_eq!(scrubber().text(word), word);
}

#[test]
fn removes_named_secrets_web_tokens_and_ipv6_addresses() {
    assert_scrubs(&[
        (
            "Authorization: Bearer abc123def456ghi789",
            "Authorization: Bearer <token>",
        ),
        ("Authorization: Basic dXNlcjpw", "Authorization: Basic <token>"),
        ("bearer abcdef rejected", "bearer <token> rejected"),
        // An access key ID in two pieces, so the repository's secret check doesn't flag this file.
        (
            concat!("aws key AKIA", "IOSFODNN7EXAMPLE rejected"),
            "aws key <token> rejected",
        ),
        ("password=hunter2 rejected", "password=<token> rejected"),
        ("PASSWORD: hunter rejected", "PASSWORD: <token> rejected"),
        ("api_key=abc&next=1", "api_key=<token>&next=1"),
        ("X-Api-Key: abc", "X-Api-Key: <token>"),
        ("accessToken=abc", "accessToken=<token>"),
        ("client_secret abc123", "client_secret <token>"),
        ("Cookie: session=abc; theme=dark", "Cookie: <token>; theme=dark"),
        (
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl",
            "jwt <token>",
        ),
        ("local address fe80::1c2a:3bff:fe4d:5e6f%12", "local address <id>"),
        ("server 2001:0db8:85a3:0000:0000:8a2e:0370:7334 up", "server <id> up"),
        ("peer [2001:db8::8a2e:370:7334]:443 closed", "peer [<id>]:443 closed"),
    ]);
}

#[test]
fn leaves_words_that_only_look_like_secrets() {
    assert_kept(&[
        "Press any key to continue",
        "unexpected token in JSON",
        "the monkey=banana hotkey: F5",
        "called `Token::parse()` early",
        "opennote_core::key::Store failed",
        "`Add::add` overflowed",
        "version 1.2.3 of opennote.notes.store",
        "took 12:30:45 to finish",
        "loopback ::1 and fe80::1",
    ]);
}
