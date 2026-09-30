//! The production fetcher against a local server: redirects are followed only to allowed URLs, errors keep their
//! status, and a response that passes its size limit stops.

#[path = "support/server.rs"]
mod server;

use opennote_updater::{
    config::TEST_ENDPOINTS,
    fetch::{Fetch, FetchError, UreqFetch, Url},
};
use server::{Route, Server};

fn get(server: &Server, path: &str, max: u64) -> Result<Vec<u8>, FetchError> {
    let url = Url::parse(&server.url(path)).expect("test builds accept 127.0.0.1");
    let mut body = Vec::new();
    UreqFetch::default().get(&url, max, &mut body)?;
    Ok(body)
}

// The tests only build as a test-endpoints build: Cargo.toml's dev-dependency on this crate turns the feature on.
const _: () = assert!(TEST_ENDPOINTS);

#[test]
fn reads_a_file_and_follows_redirects() {
    let server = Server::start();
    server.route("/latest.json", Route::ok("{}"));
    server.route("/download", Route::redirect(&server.url("/cdn/file")));
    server.route("/cdn/file", Route::redirect("/cdn/file2"));
    server.route("/cdn/file2", Route::ok("the exe"));
    assert_eq!(get(&server, "/latest.json", 64).expect("reads"), b"{}");
    assert_eq!(get(&server, "/download", 64).expect("follows"), b"the exe");
    assert_eq!(
        server.requests(),
        ["/latest.json", "/download", "/cdn/file", "/cdn/file2"]
    );
}

#[test]
fn refuses_a_redirect_to_a_url_that_isnt_allowed() {
    let server = Server::start();
    server.route("/download", Route::redirect("http://example.org/file"));
    assert!(matches!(get(&server, "/download", 64), Err(FetchError::InsecureUrl(_))));
    server.route("/loop", Route::redirect("/loop"));
    assert!(matches!(get(&server, "/loop", 64), Err(FetchError::Unreachable(_))));
}

#[test]
fn keeps_the_status_of_an_error() {
    let server = Server::start();
    server.route("/gone", Route::status(410));
    assert!(matches!(get(&server, "/gone", 64), Err(FetchError::Status(410))));
    assert!(matches!(get(&server, "/missing", 64), Err(FetchError::Status(404))));
}

#[test]
fn stops_at_the_size_limit() {
    let server = Server::start();
    server.route("/big", Route::ok(vec![7u8; 1000]));
    assert!(matches!(
        get(&server, "/big", 999),
        Err(FetchError::TooLarge { limit: 999 })
    ));
    assert_eq!(get(&server, "/big", 1000).expect("fits").len(), 1000);
}
