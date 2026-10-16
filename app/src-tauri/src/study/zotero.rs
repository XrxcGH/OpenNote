//! Zotero's local API (Citation helper): the desktop program, if it is running on this computer, lists the
//! person's library at a fixed loopback address. Nothing leaves the computer, no other address is ever asked, and
//! Zotero must have "Allow other applications on this computer to communicate with Zotero" turned on.

use std::{io::Read, time::Duration};

use ureq::Agent;

/// The only address this module talks to.
const URL: &str = "http://127.0.0.1:23119/api/users/0/items/top?format=json&limit=100";
const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// The library's top-level items as Zotero's JSON. The errors are `unreachable` (Zotero is not running) and
/// `disabled` (it is running with the local API off).
pub fn fetch() -> Result<String, String> {
    let config = Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(8)))
        .build();
    let agent = Agent::new_with_config(config);
    let mut response = agent
        .get(URL)
        .header("Zotero-API-Version", "3")
        .call()
        .map_err(|_| "unreachable".to_owned())?;
    match response.status().as_u16() {
        200 => {}
        403 | 404 => return Err("disabled".to_owned()),
        other => return Err(format!("Zotero answered with status {other}.")),
    }
    let mut body = String::new();
    response
        .body_mut()
        .as_reader()
        .take(MAX_BYTES)
        .read_to_string(&mut body)
        .map_err(|error| error.to_string())?;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_only_the_loopback_address() {
        assert!(URL.starts_with("http://127.0.0.1:23119/"));
    }
}
