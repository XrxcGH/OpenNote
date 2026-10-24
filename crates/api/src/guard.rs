//! The checks every request passes before anything else: the `Host` header and the `Origin` header.
//!
//! A web page in any browser can send requests to `127.0.0.1`. Two defenses keep it out. A page that tricks DNS
//! into pointing its own name at this PC (DNS rebinding) still sends its own name as `Host`, so only
//! `127.0.0.1:<port>` and `localhost:<port>` are accepted. A page that calls the port directly sends its own
//! `Origin`, so a request with an `Origin` is accepted only from a browser extension, or from the one web origin a
//! mail add-in was paired from. Programs such as the `opennote` tool send no `Origin` at all. The named pipe takes
//! no network requests, so it only needs its own `Host` name.

/// How a request arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// The loopback listener on this port.
    Tcp { port: u16 },
    /// The named pipe, which only processes of this user on this PC can open.
    Pipe,
}

/// The `Host` a client of the named pipe sends.
pub const PIPE_HOST: &str = "opennote.pipe";

/// Whether the `Host` header names this listener.
pub fn host_ok(transport: Transport, host: Option<&str>) -> bool {
    let Some(host) = host.map(str::trim) else {
        return false;
    };
    match transport {
        Transport::Pipe => host.eq_ignore_ascii_case(PIPE_HOST),
        Transport::Tcp { port } => {
            let Some((name, given)) = host.rsplit_once(':') else {
                return false;
            };
            let name_ok = name == "127.0.0.1" || name.eq_ignore_ascii_case("localhost");
            name_ok && given.parse::<u16>().ok() == Some(port)
        }
    }
}

/// What kind of caller an `Origin` header names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    /// No `Origin`: a program, not a web page.
    None,
    /// A browser extension: Chrome and Edge (`chrome-extension://<32 letters a-p>`) or Firefox
    /// (`moz-extension://<uuid>`).
    Extension(String),
    /// An `https` web origin, which only a paired mail add-in may use.
    Web(String),
    /// Anything else, including `null` and `http` pages: always refused.
    Refused,
}

/// Reads an `Origin` header.
pub fn origin_of(header: Option<&str>) -> Origin {
    let Some(origin) = header.map(str::trim) else {
        return Origin::None;
    };
    if let Some(id) = origin.strip_prefix("chrome-extension://") {
        if id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
            return Origin::Extension(origin.to_owned());
        }
        return Origin::Refused;
    }
    if let Some(id) = origin.strip_prefix("moz-extension://") {
        let uuid = id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
        return if uuid {
            Origin::Extension(origin.to_owned())
        } else {
            Origin::Refused
        };
    }
    if let Some(rest) = origin.strip_prefix("https://") {
        let (host, port) = rest.rsplit_once(':').unwrap_or((rest, "443"));
        let host_ok = !host.is_empty()
            && host.contains('.')
            && host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.');
        let port_ok = port.parse::<u16>().is_ok();
        if host_ok && port_ok && !rest.contains(['/', '@', '?', '#']) {
            return Origin::Web(origin.to_ascii_lowercase());
        }
    }
    Origin::Refused
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_this_listener_as_the_host() {
        let tcp = Transport::Tcp { port: 49_213 };
        assert!(host_ok(tcp, Some("127.0.0.1:49213")));
        assert!(host_ok(tcp, Some("localhost:49213")));
        for host in [
            None,
            Some("127.0.0.1"),
            Some("127.0.0.1:80"),
            Some("evil.example:49213"),
            Some("127.0.0.1.evil.example:49213"),
            Some("[::1]:49213"),
            Some("opennote.pipe"),
        ] {
            assert!(!host_ok(tcp, host), "{host:?}");
        }
        assert!(host_ok(Transport::Pipe, Some("opennote.pipe")));
        assert!(!host_ok(Transport::Pipe, Some("127.0.0.1:49213")));
    }

    #[test]
    fn tells_programs_extensions_and_web_pages_apart() {
        assert_eq!(origin_of(None), Origin::None);
        let chrome = format!("chrome-extension://{}", "abcdefghijklmnop".repeat(2));
        assert_eq!(origin_of(Some(&chrome)), Origin::Extension(chrome.clone()));
        let firefox = "moz-extension://0f3a6c2e-1d4b-4c6e-9b1a-2a3b4c5d6e7f";
        assert_eq!(origin_of(Some(firefox)), Origin::Extension(firefox.into()));
        assert_eq!(
            origin_of(Some("https://Addin.Example.org")),
            Origin::Web("https://addin.example.org".into())
        );
        for origin in [
            "null",
            "http://localhost:3000",
            "https://evil.example/path",
            "https://user@evil.example",
            "chrome-extension://short",
            "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",
            "file://",
            "https://localhost",
        ] {
            assert_eq!(origin_of(Some(origin)), Origin::Refused, "{origin}");
        }
    }
}
