//! Runtime packs for the code studio (ADR 0070): Pyodide, YoWASP Clang, and the other large runtimes the person
//! downloads. Verified pack files reach the studio's workers through the read-only `opennote-pack` scheme, which
//! WebView2 reaches as `http://opennote-pack.localhost/<pack>/<file>`. The CSP's `connect-src` names the scheme.
//!
//! This stub lands first, so the scheme, the command names, and the permissions are in place. Until a pack is
//! verified the scheme answers every request with 404. code:L18 owns the module from here and fills it in.

use tauri::{
    http::{header, Response, StatusCode},
    Builder, Wry,
};

use crate::ipc::{IpcError, IpcResult};

pub const SCHEME: &str = "opennote-pack";

/// The answer while no pack is verified: nothing is served.
fn answer() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain")
        .header("X-Content-Type-Options", "nosniff")
        .body(Vec::new())
        .unwrap_or_default()
}

/// Registers the scheme. It only reads, and serves nothing until code:L18 adds verified packs.
pub fn register(builder: Builder<Wry>) -> Builder<Wry> {
    builder.register_uri_scheme_protocol(SCHEME, |_context, _request| answer())
}

/// The packs this device has, with their sizes. Not built yet.
#[tauri::command]
pub fn packs_list() -> IpcResult<Vec<serde_json::Value>> {
    Err(IpcError::not_implemented("The runtime pack list"))
}

/// Downloads a pack after the person agrees to its size. Not built yet.
#[tauri::command]
pub fn packs_download(pack: String) -> IpcResult<()> {
    let _ = pack;
    Err(IpcError::not_implemented("Runtime pack downloads"))
}

/// Removes a downloaded pack. Not built yet.
#[tauri::command]
pub fn packs_remove(pack: String) -> IpcResult<()> {
    let _ = pack;
    Err(IpcError::not_implemented("Removing a runtime pack"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_it_is_not_built_yet() {
        let code = crate::ipc::codes::NOT_IMPLEMENTED;
        assert_eq!(packs_list().expect_err("a stub").code, code);
        assert_eq!(packs_download("pyodide".into()).expect_err("a stub").code, code);
        assert_eq!(packs_remove("pyodide".into()).expect_err("a stub").code, code);
    }

    #[test]
    fn serves_nothing_until_a_pack_is_verified() {
        assert_eq!(answer().status(), StatusCode::NOT_FOUND);
        assert!(answer().body().is_empty());
    }

    /// The sources of one CSP directive in tauri.conf.json.
    fn csp_sources(directive: &str) -> Vec<String> {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");
        let csp = config["app"]["security"]["csp"].as_str().expect("a CSP string");
        csp.split(';')
            .map(str::trim)
            .find_map(|part| part.strip_prefix(directive))
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn the_csp_lets_workers_fetch_packs_and_adds_nothing_else() {
        let expected = [
            "ipc:",
            "http://ipc.localhost",
            "'self'",
            "opennote-asset:",
            "http://opennote-asset.localhost",
            "opennote-pack:",
            "http://opennote-pack.localhost",
        ];
        assert_eq!(csp_sources("connect-src "), expected);
    }
}
