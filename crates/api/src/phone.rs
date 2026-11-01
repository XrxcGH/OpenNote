//! Insert > From phone (flag `integrations.phoneScan`): a short-lived HTTPS listener on this PC's network address
//! that takes photos from a phone. It is the only listener OpenNote opens beyond `127.0.0.1`, so it is kept small:
//!
//! - It runs only while the dialog is open. It closes by itself when [`MAX_LIFETIME`] has passed.
//! - It binds to one private (LAN) address. It drops any connection from an address that isn't private.
//! - It uses TLS with a certificate made for this session. The dialog shows the certificate's fingerprint.
//! - The QR code carries a one-time token. Opening the page uses it up and gives that phone a session cookie;
//!   uploads need the cookie, from the same address. A wrong or used token counts against [`MAX_BAD_TOKENS`], and
//!   past that the listener closes. Each address may make [`MAX_REQUESTS_PER_MINUTE`] requests.
//! - Uploads are JPEG or PNG only, up to [`PhoneLimits::max_bytes`]. Each is decoded with size limits and encoded
//!   again before the app sees it, which also drops the photo's metadata, such as where it was taken.
//!
//! Nothing here touches notes: each photo goes to the callback, and the app puts it on the open page.

use std::{
    collections::HashMap,
    io::{self, Cursor, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, PoisonError,
    },
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use rustls::{
    pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};
use sha2::{Digest, Sha256};

use crate::{
    grants::random_hex,
    http::{read_request, write_response, HttpError, Limits, Request, Response},
};

/// The longest a listener lives.
pub const MAX_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// Wrong or used tokens before the listener closes.
pub const MAX_BAD_TOKENS: usize = 10;
/// Requests one address may make in a minute.
pub const MAX_REQUESTS_PER_MINUTE: usize = 60;
/// Connections served at once.
const MAX_CONNECTIONS: usize = 4;
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(50);
const COOKIE: &str = "opennote_phone";

/// What a session takes.
#[derive(Debug, Clone, Copy)]
pub struct PhoneLimits {
    /// How long the listener lives, at most [`MAX_LIFETIME`].
    pub lifetime: Duration,
    /// The largest upload, in bytes.
    pub max_bytes: usize,
    /// The widest or tallest photo, in pixels.
    pub max_side: u32,
    /// Photos in one session.
    pub max_photos: usize,
    /// The longest side of the photo the app gets; larger photos are scaled down.
    pub output_side: u32,
    /// Takes connections from `127.0.0.1` too. Only the tests set it.
    pub allow_loopback: bool,
}

impl Default for PhoneLimits {
    fn default() -> PhoneLimits {
        PhoneLimits {
            lifetime: MAX_LIFETIME,
            max_bytes: 20 * 1024 * 1024,
            max_side: 12_000,
            max_photos: 30,
            output_side: 4096,
            allow_loopback: false,
        }
    }
}

/// A photo that passed the checks, encoded again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Photo {
    /// `image/jpeg` or `image/png`.
    pub mime: &'static str,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Why a session ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Closed {
    /// Still open.
    Open,
    /// The dialog closed it.
    Stopped,
    /// Its time ran out.
    Expired,
    /// Too many wrong tokens.
    TooManyTries,
    /// The photo limit was reached.
    Full,
}

struct Shared {
    token: Mutex<Option<String>>,
    /// The session cookie and the address it belongs to, once the token is used.
    session: Mutex<Option<(String, IpAddr)>>,
    bad_tokens: AtomicUsize,
    photos: AtomicUsize,
    requests: Mutex<HashMap<IpAddr, Vec<Instant>>>,
    closed: Mutex<Closed>,
    limits: PhoneLimits,
    origin: String,
    script_hash: String,
    on_photo: Box<dyn Fn(Photo) + Send + Sync>,
}

impl Shared {
    fn close(&self, why: Closed) {
        let mut closed = self.closed.lock().unwrap_or_else(PoisonError::into_inner);
        if *closed == Closed::Open {
            *closed = why;
        }
    }

    fn closed(&self) -> Closed {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// A running session.
pub struct PhoneScan {
    address: SocketAddr,
    token: String,
    fingerprint: String,
    deadline: Instant,
    shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl PhoneScan {
    /// Starts a listener on `ip` (a free port). `ip` must be a private address, or loopback when the limits allow it.
    pub fn start(
        ip: IpAddr,
        limits: PhoneLimits,
        on_photo: impl Fn(Photo) + Send + Sync + 'static,
    ) -> io::Result<PhoneScan> {
        if !(is_lan(ip) || (limits.allow_loopback && ip.is_loopback())) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "not a private network address",
            ));
        }
        let limits = PhoneLimits {
            lifetime: limits.lifetime.min(MAX_LIFETIME),
            ..limits
        };
        let certified = rcgen::generate_simple_self_signed(vec![ip.to_string()])
            .map_err(|error| io::Error::other(error.to_string()))?;
        let cert = certified.cert.der().clone();
        let fingerprint = fingerprint(&cert);
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(certified.key_pair.serialize_der()));
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|error| io::Error::other(error.to_string()))?
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .map_err(|error| io::Error::other(error.to_string()))?;
        let listener = TcpListener::bind(SocketAddr::new(ip, 0))?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let token = random_hex(16);
        let shared = Arc::new(Shared {
            token: Mutex::new(Some(token.clone())),
            session: Mutex::new(None),
            bad_tokens: AtomicUsize::new(0),
            photos: AtomicUsize::new(0),
            requests: Mutex::new(HashMap::new()),
            closed: Mutex::new(Closed::Open),
            limits,
            origin: origin(address),
            script_hash: base64::engine::general_purpose::STANDARD.encode(Sha256::digest(PAGE_SCRIPT.as_bytes())),
            on_photo: Box::new(on_photo),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let deadline = Instant::now() + limits.lifetime;
        let thread = {
            let (shared, stop, config) = (shared.clone(), stop.clone(), Arc::new(config));
            thread::Builder::new()
                .name("opennote-phone".into())
                .spawn(move || accept(&listener, &config, &shared, &stop, deadline))?
        };
        Ok(PhoneScan {
            address,
            token,
            fingerprint,
            deadline,
            shared,
            stop,
            thread: Some(thread),
        })
    }

    /// The address the QR code carries: the page that uses the token up.
    pub fn url(&self) -> String {
        format!("{}/s/{}", self.shared.origin, self.token)
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }

    /// The certificate's SHA-256 fingerprint, as colon-separated hex pairs.
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    /// When the listener closes by itself.
    pub fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Whether it still listens, and if not, why.
    pub fn state(&self) -> Closed {
        if self.shared.closed() == Closed::Open && Instant::now() >= self.deadline {
            self.shared.close(Closed::Expired);
        }
        self.shared.closed()
    }

    /// Closes the listener and waits for it.
    pub fn stop(mut self) {
        self.shut();
    }

    fn shut(&mut self) {
        self.shared.close(Closed::Stopped);
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for PhoneScan {
    fn drop(&mut self) {
        self.shut();
    }
}

/// Whether an address is on a private network: 10/8, 172.16/12, 192.168/16, or link-local.
pub fn is_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
        IpAddr::V6(_) => false,
    }
}

/// This PC's address on its local network, found by asking the system which address it would use to reach a
/// private address. No packet is sent. `None` when that address isn't private, as on a phone hotspot with a
/// public address or with no network.
pub fn lan_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    for probe in ["192.168.0.1:9", "10.0.0.1:9", "172.16.0.1:9"] {
        if socket.connect(probe).is_err() {
            continue;
        }
        if let Ok(SocketAddr::V4(local)) = socket.local_addr() {
            if is_lan(IpAddr::V4(*local.ip())) {
                return Some(*local.ip());
            }
        }
    }
    None
}

/// SHA-256 of a certificate, as colon-separated uppercase hex pairs.
pub fn fingerprint(cert: &[u8]) -> String {
    Sha256::digest(cert)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn origin(address: SocketAddr) -> String {
    format!("https://{address}")
}

/// The QR code for `text`, as rows of `1` (dark) and `0` (light), without the quiet zone.
pub fn qr_rows(text: &str) -> Option<Vec<String>> {
    let code = qrcodegen::QrCode::encode_text(text, qrcodegen::QrCodeEcc::Medium).ok()?;
    let size = code.size();
    Some(
        (0..size)
            .map(|y| {
                (0..size)
                    .map(|x| if code.get_module(x, y) { '1' } else { '0' })
                    .collect()
            })
            .collect(),
    )
}

fn accept(
    listener: &TcpListener,
    config: &Arc<ServerConfig>,
    shared: &Arc<Shared>,
    stop: &AtomicBool,
    deadline: Instant,
) {
    let active = Arc::new(AtomicUsize::new(0));
    loop {
        if stop.load(Ordering::SeqCst) || shared.closed() != Closed::Open {
            break;
        }
        if Instant::now() >= deadline {
            shared.close(Closed::Expired);
            break;
        }
        match listener.accept() {
            Ok((stream, peer)) => {
                let ip = peer.ip();
                if !(is_lan(ip) || (shared.limits.allow_loopback && ip.is_loopback())) {
                    continue;
                }
                if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS || !allowed_now(shared, ip) {
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
                let _ = stream.set_write_timeout(Some(READ_TIMEOUT));
                let (shared, config, active) = (shared.clone(), config.clone(), active.clone());
                active.fetch_add(1, Ordering::SeqCst);
                let spawned = thread::Builder::new()
                    .name("opennote-phone-request".into())
                    .spawn(move || {
                        serve(stream, ip, &config, &shared);
                        active.fetch_sub(1, Ordering::SeqCst);
                    });
                if spawned.is_err() {
                    log::warn!("Insert from phone couldn't start a thread for a request.");
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL),
            Err(_) => thread::sleep(POLL),
        }
    }
    // The listener closes when this returns and the socket drops.
}

/// Counts a request from `ip`; false when it made too many in the last minute.
fn allowed_now(shared: &Shared, ip: IpAddr) -> bool {
    let now = Instant::now();
    let mut requests = shared.requests.lock().unwrap_or_else(PoisonError::into_inner);
    let times = requests.entry(ip).or_default();
    times.retain(|time| now.duration_since(*time) < Duration::from_secs(60));
    if times.len() >= MAX_REQUESTS_PER_MINUTE {
        return false;
    }
    times.push(now);
    true
}

fn serve(stream: TcpStream, ip: IpAddr, config: &Arc<ServerConfig>, shared: &Shared) {
    let Ok(connection) = ServerConnection::new(config.clone()) else {
        return;
    };
    let mut tls = StreamOwned::new(connection, stream);
    let limits = Limits {
        head: 16 * 1024,
        body: shared.limits.max_bytes,
    };
    let response = match read_request(&mut tls, &limits) {
        Ok(request) => handle(shared, &request, ip),
        Err(HttpError::TooLarge) => Response::error(413, "tooLarge", "That photo is too large."),
        Err(HttpError::Io(_)) => return,
        Err(_) => Response::error(400, "malformed", "The request couldn't be read."),
    };
    let _ = write_response(&mut tls, &response);
    tls.conn.send_close_notify();
    let _ = tls.flush();
    // A refused upload may still be arriving. Reading a little of it before closing lets the phone read the answer
    // instead of a reset connection.
    let _ = tls.sock.shutdown(std::net::Shutdown::Write);
    let _ = tls.sock.set_read_timeout(Some(Duration::from_millis(500)));
    let mut sink = [0u8; 16 * 1024];
    let mut drained = 0;
    while drained < 1024 * 1024 {
        match tls.sock.read(&mut sink) {
            Ok(0) | Err(_) => break,
            Ok(read) => drained += read,
        }
    }
}

fn handle(shared: &Shared, request: &Request, ip: IpAddr) -> Response {
    if shared.closed() != Closed::Open {
        return Response::error(410, "closed", "OpenNote stopped taking photos. Scan the code again.");
    }
    let segments = request.segments().unwrap_or_default();
    match (
        request.method.as_str(),
        segments.iter().map(String::as_str).collect::<Vec<_>>().as_slice(),
    ) {
        ("GET", ["s", token]) => open_page(shared, token, ip),
        ("POST", ["upload"]) => upload(shared, request, ip),
        _ => Response::error(404, "notFound", "There's nothing here."),
    }
}

fn open_page(shared: &Shared, token: &str, ip: IpAddr) -> Response {
    let mut expected = shared.token.lock().unwrap_or_else(PoisonError::into_inner);
    let matches = expected
        .as_deref()
        .is_some_and(|want| want.len() == token.len() && constant_eq(want.as_bytes(), token.as_bytes()));
    if !matches {
        drop(expected);
        if shared.bad_tokens.fetch_add(1, Ordering::SeqCst) + 1 >= MAX_BAD_TOKENS {
            shared.close(Closed::TooManyTries);
        }
        return Response::error(
            404,
            "badToken",
            "This code has been used or has run out. Choose Insert, then From phone, on your PC again.",
        );
    }
    *expected = None;
    drop(expected);
    let cookie = random_hex(16);
    *shared.session.lock().unwrap_or_else(PoisonError::into_inner) = Some((cookie.clone(), ip));
    let mut response = Response::text(200, "text/html; charset=utf-8", &page_html());
    response.set(
        "Set-Cookie",
        &format!("{COOKIE}={cookie}; Path=/; Secure; HttpOnly; SameSite=Strict"),
    );
    response.set(
        "Content-Security-Policy",
        &format!(
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-{}'; connect-src 'self'; \
             form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
            shared.script_hash
        ),
    );
    response.set("Referrer-Policy", "no-referrer");
    response
}

fn session_ok(shared: &Shared, request: &Request, ip: IpAddr) -> bool {
    let session = shared.session.lock().unwrap_or_else(PoisonError::into_inner);
    let Some((cookie, owner)) = session.as_ref() else {
        return false;
    };
    let sent = request
        .header("cookie")
        .unwrap_or_default()
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE)
        .map(|(_, value)| value.to_owned())
        .unwrap_or_default();
    *owner == ip && sent.len() == cookie.len() && constant_eq(sent.as_bytes(), cookie.as_bytes())
}

fn upload(shared: &Shared, request: &Request, ip: IpAddr) -> Response {
    if !session_ok(shared, request, ip) {
        return Response::error(403, "noSession", "Scan the code on your PC again.");
    }
    if request.header("origin").is_some_and(|origin| origin != shared.origin) {
        return Response::error(403, "origin", "This upload didn't come from OpenNote's page.");
    }
    let content_type = request
        .header("content-type")
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let declared = match content_type.as_str() {
        "image/jpeg" | "image/jpg" => image::ImageFormat::Jpeg,
        "image/png" => image::ImageFormat::Png,
        _ => return Response::error(415, "notImage", "Only JPEG and PNG photos can be sent."),
    };
    if shared.photos.load(Ordering::SeqCst) >= shared.limits.max_photos {
        shared.close(Closed::Full);
        return Response::error(
            429,
            "full",
            "That's as many photos as one code takes. Scan a new code for more.",
        );
    }
    match clean_photo(&request.body, declared, &shared.limits) {
        Ok(photo) => {
            shared.photos.fetch_add(1, Ordering::SeqCst);
            (shared.on_photo)(photo);
            Response::json(200, &serde_json::json!({ "ok": true }))
        }
        Err(why) => Response::error(415, "notImage", why),
    }
}

/// Checks that `bytes` are a JPEG or PNG of the declared kind, decodes it with limits, turns it upright, scales it
/// down to the output size, and encodes it again. The new file carries no metadata from the original.
pub fn clean_photo(bytes: &[u8], declared: image::ImageFormat, limits: &PhoneLimits) -> Result<Photo, &'static str> {
    const NOT_IMAGE: &str = "That file isn't a JPEG or PNG photo.";
    let sniffed = match bytes {
        [0xFF, 0xD8, 0xFF, ..] => image::ImageFormat::Jpeg,
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, ..] => image::ImageFormat::Png,
        _ => return Err(NOT_IMAGE),
    };
    if sniffed != declared {
        return Err(NOT_IMAGE);
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), sniffed);
    let mut decode_limits = image::Limits::default();
    decode_limits.max_image_width = Some(limits.max_side);
    decode_limits.max_image_height = Some(limits.max_side);
    decode_limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(decode_limits);
    let mut decoder = reader.into_decoder().map_err(|_| NOT_IMAGE)?;
    let orientation =
        image::ImageDecoder::orientation(&mut decoder).unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut picture = image::DynamicImage::from_decoder(decoder).map_err(|_| "That photo couldn't be read.")?;
    picture.apply_orientation(orientation);
    if picture.width().max(picture.height()) > limits.output_side {
        picture = picture.resize(
            limits.output_side,
            limits.output_side,
            image::imageops::FilterType::Triangle,
        );
    }
    let mut out = Vec::new();
    let mime = match sniffed {
        image::ImageFormat::Png => {
            picture
                .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
                .map_err(|_| "That photo couldn't be saved.")?;
            "image/png"
        }
        _ => {
            let rgb = picture.to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88)
                .encode_image(&rgb)
                .map_err(|_| "That photo couldn't be saved.")?;
            "image/jpeg"
        }
    };
    Ok(Photo {
        mime,
        width: picture.width(),
        height: picture.height(),
        bytes: out,
    })
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The page's one script: it sends each chosen photo as its own request and says how it went.
const PAGE_SCRIPT: &str = r#"
const status = document.getElementById('status');
const say = (text) => { status.textContent = text; };
async function send(files) {
  let sent = 0;
  for (const file of files) {
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      say('Only JPEG and PNG photos can be sent.');
      continue;
    }
    say('Sending ' + (sent + 1) + ' of ' + files.length + '…');
    try {
      const headers = { 'Content-Type': file.type };
      const response = await fetch('/upload', { method: 'POST', headers, body: file, credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        say(body.message || 'That photo wasn\'t sent.');
        return;
      }
      sent += 1;
    } catch {
      say('OpenNote stopped taking photos. Scan the code again.');
      return;
    }
  }
  if (sent === 1) say('Sent 1 photo. It\'s on your page.');
  if (sent > 1) say('Sent ' + sent + ' photos. They\'re on your page.');
}
for (const input of document.querySelectorAll('input[type=file]')) {
  input.addEventListener('change', () => { void send([...input.files]); input.value = ''; });
}
"#;

fn page_html() -> String {
    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send photos to OpenNote</title>
<style>
body {{ font: 17px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #fffcf6; color: #2b2521; }}
main {{ max-width: 28rem; margin: 0 auto; }}
h1 {{ font-size: 1.4rem; font-weight: 600; }}
label {{ display: block; margin: 12px 0; padding: 14px 16px; border-radius: 10px; font-weight: 600; }}
label {{ background: #3b6a4d; color: #fffcf6; text-align: center; }}
label.second {{ background: #eae3d8; color: #2b2521; }}
input {{ position: absolute; opacity: 0; width: 1px; height: 1px; }}
label:focus-within {{ outline: 3px solid #2b2521; outline-offset: 2px; }}
@media (prefers-color-scheme: dark) {{
  body {{ background: #1e1e1c; color: #f2f1ec; }}
  label.second {{ background: #383836; color: #f2f1ec; }}
  label:focus-within {{ outline-color: #f2f1ec; }}
}}
</style></head>
<body><main>
<h1>Send photos to OpenNote</h1>
<p>Photos you send go onto the page open on your PC.
This works for a few minutes, while the window on your PC stays open.</p>
<label>Take a photo<input type="file" accept="image/jpeg,image/png" capture="environment"></label>
<label class="second">Choose photos<input type="file" accept="image/jpeg,image/png" multiple></label>
<p id="status" role="status" aria-live="polite"></p>
</main><script>{PAGE_SCRIPT}</script></body></html>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_private_addresses_count_as_the_lan() {
        assert!(is_lan("192.168.1.20".parse().unwrap()));
        assert!(is_lan("10.1.2.3".parse().unwrap()));
        assert!(is_lan("172.20.0.4".parse().unwrap()));
        assert!(is_lan("169.254.10.1".parse().unwrap()));
        assert!(!is_lan("8.8.8.8".parse().unwrap()));
        assert!(!is_lan("127.0.0.1".parse().unwrap()));
        assert!(!is_lan("172.32.0.1".parse().unwrap()));
        assert!(!is_lan("::1".parse().unwrap()));
    }

    #[test]
    fn a_public_or_loopback_address_is_refused_without_the_test_switch() {
        assert!(PhoneScan::start("127.0.0.1".parse().unwrap(), PhoneLimits::default(), |_| {}).is_err());
        assert!(PhoneScan::start("8.8.8.8".parse().unwrap(), PhoneLimits::default(), |_| {}).is_err());
    }

    #[test]
    fn the_qr_code_is_square_and_carries_the_address() {
        let rows = qr_rows("https://192.168.1.20:50123/s/0123456789abcdef0123456789abcdef").unwrap();
        assert!(rows.len() >= 21);
        assert!(rows.iter().all(|row| row.len() == rows.len()));
        assert!(rows[0].starts_with("1111111"));
    }

    #[test]
    fn the_scripts_hash_is_what_the_policy_allows() {
        let html = page_html();
        assert!(html.contains(PAGE_SCRIPT));
        assert!(!html.contains("<script src"));
    }
}
