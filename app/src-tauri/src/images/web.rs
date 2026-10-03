//! Downloading a web image for import (Phase 4 ARCHITECTURE.md sections 12.2 and 15.5): only on the person's paste,
//! with `ureq` and Windows' TLS stack, as the updater does. A download gets 20 seconds and 50 MB; only `image/*`
//! responses count; at most 3 redirects, never to another scheme; no cookies, no `Referer`, and no proxy. Loopback,
//! link-local, private, and other non-public addresses are refused when the name resolves, so a pasted page can't
//! make the app reach into the local network.

use std::{
    io::Read,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    time::Duration,
};

use tauri::AppHandle;
use ureq::{
    http::Uri,
    unversioned::{
        resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver},
        transport::{DefaultConnector, NextTimeout},
    },
    Agent,
};

use super::{
    import::{check, convert_enabled, errors, on_blocking, open_page, store, too_large, Checked, MAX_IMAGE_BYTES},
    ImportedAsset,
};
use crate::ipc::{IpcError, IpcResult};

const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 3;

/// Which addresses a download may reach. Only the tests allow loopback, for their local server.
#[derive(Debug, Clone, Copy)]
struct Policy {
    allow_loopback: bool,
}

/// Whether an address is on the public internet. Everything a home or office network keeps to itself is refused.
fn is_public(ip: IpAddr, policy: Policy) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4, policy),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4, policy),
            None => is_public_v6(v6, policy),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr, policy: Policy) -> bool {
    let [a, b, ..] = ip.octets();
    if ip.is_loopback() {
        return policy.allow_loopback;
    }
    !(ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (64..128).contains(&b))
        || (a == 192 && b == 0 && ip.octets()[2] == 0)
        || (a == 198 && (18..20).contains(&b))
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr, policy: Policy) -> bool {
    if ip.is_loopback() {
        return policy.allow_loopback;
    }
    let first = ip.segments()[0];
    !(ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (first & 0xffc0) == 0xfec0
        || first == 0x2001 && ip.segments()[1] == 0x0db8
        || first == 0x0064 && ip.segments()[1] == 0xff9b)
}

/// The system resolver, keeping only the addresses the policy allows, so the connection can only go to them.
#[derive(Debug)]
struct GuardedResolver {
    inner: DefaultResolver,
    policy: Policy,
}

impl Resolver for GuardedResolver {
    fn resolve(
        &self,
        uri: &Uri,
        config: &ureq::config::Config,
        timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let found = self.inner.resolve(uri, config, timeout)?;
        let mut kept = self.empty();
        for address in found.iter().filter(|address| is_public(address.ip(), self.policy)) {
            kept.push(*address);
        }
        if kept.is_empty() {
            return Err(ureq::Error::BadUri(format!(
                "{} resolves only to addresses that aren't public",
                uri.host().unwrap_or("")
            )));
        }
        Ok(kept)
    }
}

fn agent(policy: Policy) -> Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    let config = Agent::config_builder()
        .tls_config(tls)
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .save_redirect_history(false)
        .timeout_global(Some(TIMEOUT))
        .user_agent(concat!("OpenNote/", env!("CARGO_PKG_VERSION")))
        .build();
    Agent::with_parts(
        config,
        DefaultConnector::new(),
        GuardedResolver {
            inner: DefaultResolver::default(),
            policy,
        },
    )
}

fn failed(message: impl Into<String>) -> IpcError {
    IpcError::new(errors::DOWNLOAD_FAILED, message)
}

/// An address the download may start from or be sent on to: http or https, with a host.
fn parse_url(text: &str) -> Result<Uri, IpcError> {
    let uri: Uri = text
        .trim()
        .parse()
        .map_err(|_| failed("The image address isn't valid."))?;
    match uri.scheme_str() {
        Some("http" | "https") if uri.host().is_some_and(|host| !host.is_empty()) => Ok(uri),
        _ => Err(failed("Only http and https images can be saved.")),
    }
}

/// A redirect's target, resolved against the address it came from, on the same scheme.
fn redirect(from: &Uri, location: &str) -> Result<Uri, IpcError> {
    let base = url_text(from);
    let next = resolve_reference(&base, location).ok_or_else(|| failed("The image's redirect isn't valid."))?;
    let next = parse_url(&next)?;
    if next.scheme_str() != from.scheme_str() {
        return Err(failed("The image's redirect changes the scheme."));
    }
    Ok(next)
}

fn url_text(uri: &Uri) -> String {
    uri.to_string()
}

/// A reference resolved against an absolute http(s) address: absolute, scheme-relative, root-relative, or relative.
fn resolve_reference(base: &str, reference: &str) -> Option<String> {
    let reference = reference.trim();
    if reference.contains("://") {
        return Some(reference.to_owned());
    }
    let (scheme, rest) = base.split_once("://")?;
    if let Some(stripped) = reference.strip_prefix("//") {
        return Some(format!("{scheme}://{stripped}"));
    }
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let origin = format!("{scheme}://{}", &rest[..authority_end]);
    if reference.starts_with('/') {
        return Some(format!("{origin}{reference}"));
    }
    if reference.contains(':') {
        // Another scheme, such as `file:` or `javascript:`.
        return Some(reference.to_owned());
    }
    let path = &rest[authority_end..];
    let path = path.split(['?', '#']).next().unwrap_or("");
    let directory = path.rfind('/').map_or("/", |end| &path[..=end]);
    Some(format!("{origin}{directory}{reference}"))
}

/// The bytes of a web image and its file name.
struct Download {
    bytes: Vec<u8>,
    name: String,
}

fn download(url: &str, policy: Policy) -> Result<Download, IpcError> {
    let agent = agent(policy);
    let mut current = parse_url(url)?;
    for _ in 0..=MAX_REDIRECTS {
        let response = agent
            .get(&url_text(&current))
            .call()
            .map_err(|error| failed(format!("The image couldn't be downloaded: {error}")))?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| failed("The image's redirect has no address."))?;
            current = redirect(&current, location)?;
            continue;
        }
        if status != 200 {
            return Err(failed(format!("The image's server answered {status}.")));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !content_type.trim_start().starts_with("image/") {
            return Err(IpcError::new(errors::UNSUPPORTED_TYPE, "The address isn't an image."));
        }
        if response
            .body()
            .content_length()
            .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
        {
            return Err(too_large());
        }
        let mut bytes = Vec::new();
        response
            .into_body()
            .into_reader()
            .take(MAX_IMAGE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| failed(format!("The image download stopped: {error}")))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(too_large());
        }
        return Ok(Download {
            bytes,
            name: name_from(&current),
        });
    }
    Err(failed("The image's address redirects too many times."))
}

/// The last part of the address's path, as the asset's original name.
fn name_from(uri: &Uri) -> String {
    let last = uri.path().rsplit('/').next().unwrap_or("");
    let decoded = super::import::percent_decode(last);
    let safe: String = decoded
        .chars()
        .filter(|c| !c.is_control() && !"\\/:*?\"<>|".contains(*c))
        .collect();
    if safe.trim().is_empty() {
        "image".to_owned()
    } else {
        safe.chars().take(120).collect()
    }
}

/// Downloads and checks a web image, without storing it.
fn fetch_checked(url: &str, policy: Policy, convert: bool) -> Result<Checked, IpcError> {
    let download = download(url, policy)?;
    // The server's type only has to say "image"; the bytes decide the format, as servers often mislabel them.
    check(download.bytes, &download.name, "", convert)
}

#[tauri::command]
pub async fn image_import_url(app: AppHandle, page: String, url: String) -> IpcResult<ImportedAsset> {
    let convert = convert_enabled(&app);
    on_blocking(move || {
        let handle = open_page(&app, &page)?;
        let checked = fetch_checked(&url, Policy { allow_loopback: false }, convert)?;
        store(&handle, checked)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        sync::{Arc, Mutex},
        thread,
    };

    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/images/fixtures");
    const TEST: Policy = Policy { allow_loopback: true };

    /// A local server that answers each request path with a canned response, and records the request headers.
    struct Server {
        base: String,
        requests: Arc<Mutex<Vec<String>>>,
    }

    fn serve(routes: Vec<(&'static str, Vec<u8>)>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    head.push_str(&line);
                }
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
                seen.lock().unwrap().push(head);
                let response = routes
                    .iter()
                    .find(|(route, _)| *route == path)
                    .map(|(_, response)| response.clone())
                    .unwrap_or_else(|| b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec());
                let _ = stream.write_all(&response);
            }
        });
        Server { base, requests }
    }

    fn response(content_type: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    fn redirect_to(location: &str) -> Vec<u8> {
        format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .into_bytes()
    }

    fn png() -> Vec<u8> {
        std::fs::read(format!("{FIXTURES}/png.png")).unwrap()
    }

    #[test]
    fn an_image_downloads_and_passes_the_probe() {
        let server = serve(vec![
            ("/pic%20one.png", response("image/png", &png())),
            ("/moved", redirect_to("/pic%20one.png")),
        ]);
        let checked = fetch_checked(&format!("{}/moved", server.base), TEST, false).unwrap();
        assert_eq!(
            (checked.name.as_str(), checked.width, checked.height),
            ("pic one.png", 6, 4)
        );
        let requests = server.requests.lock().unwrap();
        assert!(requests.iter().all(|head| {
            let lower = head.to_ascii_lowercase();
            !lower.contains("\ncookie:") && !lower.contains("\nreferer:")
        }));
    }

    #[test]
    fn other_types_and_oversized_answers_are_refused() {
        let mut big = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            MAX_IMAGE_BYTES + 1
        )
        .into_bytes();
        big.extend_from_slice(&png());
        let server = serve(vec![
            ("/page", response("text/html", b"<html></html>")),
            ("/big", big),
            ("/lie", response("image/png", b"<html>not a picture</html>")),
        ]);
        let code = |path: &str| {
            fetch_checked(&format!("{}{path}", server.base), TEST, false)
                .unwrap_err()
                .code
        };
        assert_eq!(code("/page"), errors::UNSUPPORTED_TYPE);
        assert_eq!(code("/big"), errors::TOO_LARGE);
        assert_eq!(code("/lie"), errors::UNSUPPORTED_TYPE);
        assert_eq!(code("/missing"), errors::DOWNLOAD_FAILED);
    }

    #[test]
    fn redirects_to_other_schemes_or_private_addresses_are_refused() {
        let server = serve(vec![
            ("/file", redirect_to("file:///C:/Windows/win.ini")),
            ("/https", redirect_to("https://example.com/a.png")),
            ("/private", redirect_to("http://10.0.0.1/a.png")),
            ("/a", redirect_to("/b")),
            ("/b", redirect_to("/c")),
            ("/c", redirect_to("/d")),
            ("/d", redirect_to("/e")),
            ("/e", response("image/png", &png())),
        ]);
        for path in ["/file", "/https", "/private", "/a"] {
            let error = fetch_checked(&format!("{}{path}", server.base), TEST, false).unwrap_err();
            assert_eq!(error.code, errors::DOWNLOAD_FAILED, "{path}: {}", error.message);
        }
    }

    #[test]
    fn local_and_private_addresses_are_refused_without_a_request() {
        let server = serve(vec![("/a.png", response("image/png", &png()))]);
        let strict = Policy { allow_loopback: false };
        for url in [
            format!("{}/a.png", server.base),
            "http://[::1]/a.png".to_owned(),
            "http://192.168.1.1/a.png".to_owned(),
            "http://169.254.169.254/latest".to_owned(),
            "ftp://example.com/a.png".to_owned(),
            "javascript:alert(1)".to_owned(),
        ] {
            let error = fetch_checked(&url, strict, false).unwrap_err();
            assert_eq!(error.code, errors::DOWNLOAD_FAILED, "{url}");
        }
        assert!(server.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn address_classes() {
        let strict = Policy { allow_loopback: false };
        for (ip, public) in [
            ("8.8.8.8", true),
            ("2606:4700::1111", true),
            ("127.0.0.1", false),
            ("10.1.2.3", false),
            ("172.16.0.1", false),
            ("100.64.0.1", false),
            ("::ffff:192.168.0.1", false),
            ("fd00::1", false),
            ("fe80::1", false),
            ("0.0.0.0", false),
        ] {
            assert_eq!(is_public(ip.parse().unwrap(), strict), public, "{ip}");
        }
    }

    #[test]
    fn references_resolve_against_the_page() {
        let base = "http://example.com/a/b.html?x=1";
        assert_eq!(
            resolve_reference(base, "c.png").as_deref(),
            Some("http://example.com/a/c.png")
        );
        assert_eq!(
            resolve_reference(base, "/c.png").as_deref(),
            Some("http://example.com/c.png")
        );
        assert_eq!(
            resolve_reference(base, "//cdn.example/c.png").as_deref(),
            Some("http://cdn.example/c.png")
        );
    }
}
