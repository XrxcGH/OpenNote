use std::{net::TcpStream, sync::Arc};

use super::*;

const STATE: &str = "state-value-0123456789abcdef-xyz";

fn head(target: &str, port: u16) -> String {
    format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUser-Agent: test\r\n\r\n")
}

fn judge_target(target: &str) -> Verdict {
    judge(&head(target, 5555), 5555, STATE)
}

#[test]
fn a_return_with_the_right_state_and_a_code_ends_the_wait() {
    let verdict = judge_target(&format!("/callback?code=abc%2F123&state={STATE}"));
    assert_eq!(verdict.status, 200);
    assert_eq!(verdict.page, Page::Done);
    assert_eq!(verdict.end, Some(Ok(Callback::Code(Secret::new("abc/123")))));
}

#[test]
fn the_wrong_state_ends_the_attempt_and_no_code_is_kept() {
    let verdict = judge_target("/callback?code=abc&state=somebody-elses-state-value-123456");
    assert_eq!(verdict.end, Some(Err(Ended::Mismatch)));
    assert_eq!(verdict.page, Page::Failed);
}

#[test]
fn a_missing_state_is_a_mismatch_too() {
    assert_eq!(judge_target("/callback?code=abc").end, Some(Err(Ended::Mismatch)));
    assert_eq!(judge_target("/callback").end, Some(Err(Ended::Mismatch)));
}

#[test]
fn a_return_with_the_state_but_no_code_is_not_accepted() {
    assert_eq!(
        judge_target(&format!("/callback?state={STATE}")).end,
        Some(Err(Ended::Mismatch))
    );
    assert_eq!(
        judge_target(&format!("/callback?code=&state={STATE}")).end,
        Some(Err(Ended::Mismatch))
    );
}

#[test]
fn the_wrong_path_is_ignored_and_the_wait_goes_on() {
    for target in [
        "/",
        "/favicon.ico",
        "/callback/",
        "/callbackx",
        "/x/callback",
        "/CALLBACK",
    ] {
        let verdict = judge_target(&format!("{target}?code=abc&state={STATE}"));
        assert_eq!(verdict.status, 404, "{target}");
        assert_eq!(verdict.end, None, "{target}");
    }
}

#[test]
fn other_methods_and_other_host_names_are_ignored() {
    let post = format!("POST /callback?code=a&state={STATE} HTTP/1.1\r\nHost: 127.0.0.1:5555\r\n\r\n");
    assert_eq!(judge(&post, 5555, STATE).end, None);
    let rebound = format!("GET /callback?code=a&state={STATE} HTTP/1.1\r\nHost: evil.example:5555\r\n\r\n");
    assert_eq!(judge(&rebound, 5555, STATE).end, None);
    let other_port = format!("GET /callback?code=a&state={STATE} HTTP/1.1\r\nHost: 127.0.0.1:6666\r\n\r\n");
    assert_eq!(judge(&other_port, 5555, STATE).end, None);
    let no_host = format!("GET /callback?code=a&state={STATE} HTTP/1.1\r\n\r\n");
    assert_eq!(judge(&no_host, 5555, STATE).end, None);
}

#[test]
fn a_refusal_keeps_only_a_short_plain_code() {
    let verdict = judge_target(&format!(
        "/callback?error=access_denied&state={STATE}&error_description=%3Cscript%3E"
    ));
    assert_eq!(verdict.end, Some(Ok(Callback::Refused("access_denied".into()))));
    let odd = judge_target(&format!("/callback?error=%3Cb%3Ex%3C%2Fb%3E&state={STATE}"));
    assert_eq!(odd.end, Some(Ok(Callback::Refused("bxb".into()))));
}

/// Sends one request and reads the whole answer.
fn request(port: u16, target: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(head(target, port).as_bytes())?;
    let mut answer = String::new();
    stream.read_to_string(&mut answer)?;
    Ok(answer)
}

fn never_canceled() -> AtomicBool {
    AtomicBool::new(false)
}

#[test]
fn accepts_one_return_then_closes_the_port() {
    let listener = Listener::bind(0).expect("binds");
    let port = listener.port();
    assert_eq!(listener.redirect_uri(), format!("http://127.0.0.1:{port}/callback"));
    let client = thread::spawn(move || {
        // A stray request first, as a browser makes for the icon, then the real return.
        let stray = request(port, "/favicon.ico").expect("answered");
        let page = request(port, &format!("/callback?code=the-code&state={STATE}")).expect("answered");
        (stray, page)
    });
    let outcome = listener.wait(STATE, Duration::from_secs(10), &never_canceled());
    assert_eq!(outcome, Ok(Callback::Code(Secret::new("the-code"))));
    let (stray, page) = client.join().expect("the client finished");
    assert!(stray.starts_with("HTTP/1.1 404"), "{stray}");
    assert!(page.starts_with("HTTP/1.1 200"), "{page}");
    assert!(page.contains("You can close this tab"));
    // The listener is gone, so a second request, with the same good code or not, reaches nothing.
    assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err());
}

#[test]
fn the_page_never_repeats_anything_from_the_address() {
    let listener = Listener::bind(0).expect("binds");
    let port = listener.port();
    let client =
        thread::spawn(move || request(port, "/callback?error=%3Cscript%3Ealert(1)&state=wrong&code=top-secret"));
    let outcome = listener.wait(STATE, Duration::from_secs(10), &never_canceled());
    assert_eq!(outcome, Err(Ended::Mismatch));
    let page = client.join().expect("finished").expect("answered");
    for echoed in ["script", "alert", "top-secret", "wrong"] {
        assert!(!page.contains(echoed), "the page repeated {echoed}");
    }
    assert!(page.contains("Referrer-Policy: no-referrer"));
    assert!(page.contains("Cache-Control: no-store"));
}

#[test]
fn a_wrong_state_closes_the_port_so_a_later_good_return_finds_nothing() {
    let listener = Listener::bind(0).expect("binds");
    let port = listener.port();
    let client = thread::spawn(move || request(port, &format!("/callback?code=c&state=wrong-{STATE}")));
    assert_eq!(
        listener.wait(STATE, Duration::from_secs(10), &never_canceled()),
        Err(Ended::Mismatch)
    );
    client.join().expect("finished").expect("answered");
    assert!(request(port, &format!("/callback?code=c&state={STATE}")).is_err());
}

#[test]
fn gives_up_after_the_time_limit() {
    let listener = Listener::bind(0).expect("binds");
    let started = Instant::now();
    let outcome = listener.wait(STATE, Duration::from_millis(150), &never_canceled());
    assert_eq!(outcome, Err(Ended::TimedOut));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn the_real_limit_is_five_minutes() {
    assert_eq!(WAIT, Duration::from_secs(300));
}

#[test]
fn stops_when_canceled() {
    let listener = Listener::bind(0).expect("binds");
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancel);
    let canceler = thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        flag.store(true, Ordering::Relaxed);
    });
    assert_eq!(
        listener.wait(STATE, Duration::from_secs(30), &cancel),
        Err(Ended::Canceled)
    );
    canceler.join().expect("finished");
}

#[test]
fn listens_on_the_loopback_address_only() {
    let listener = Listener::bind(0).expect("binds");
    let address = listener.socket.local_addr().expect("has an address");
    assert!(address.ip().is_loopback());
    assert_eq!(address.ip().to_string(), "127.0.0.1");
}

#[test]
fn a_fixed_port_that_is_taken_is_an_error_not_a_second_listener() {
    let first = Listener::bind(0).expect("binds");
    assert!(Listener::bind(first.port()).is_err());
}
