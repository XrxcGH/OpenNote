//! Insert > From phone, over real TLS on 127.0.0.1 (the tests' switch; the app binds to an address on the network). The client
//! pins the certificate by the fingerprint the dialog shows, the way a person compares it.

use std::{
    io::{Cursor, Write},
    net::{IpAddr, TcpStream},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use opennote_api::{
    http::{read_response, Limits, Response},
    phone::{fingerprint, Closed, PhoneLimits, PhoneScan, Photo, MAX_BAD_TOKENS},
};
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::CryptoProvider,
    pki_types::{CertificateDer, ServerName, UnixTime},
    ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned,
};

#[derive(Debug)]
struct Pin(String, Arc<CryptoProvider>);

impl ServerCertVerifier for Pin {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if fingerprint(end_entity) == self.0 {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("the fingerprint doesn't match".into()))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.1.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.1.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.1.signature_verification_algorithms.supported_schemes()
    }
}

struct Session {
    scan: PhoneScan,
    photos: Arc<Mutex<Vec<Photo>>>,
}

fn start(limits: PhoneLimits) -> Session {
    let photos = Arc::new(Mutex::new(Vec::new()));
    let sink = photos.clone();
    let scan = PhoneScan::start(
        "127.0.0.1".parse().unwrap(),
        PhoneLimits {
            allow_loopback: true,
            ..limits
        },
        move |photo| sink.lock().unwrap().push(photo),
    )
    .unwrap();
    Session { scan, photos }
}

fn send(scan: &PhoneScan, pin: &str, raw: &[u8]) -> std::io::Result<Response> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pin(pin.to_owned(), provider)))
        .with_no_client_auth();
    let connection = ClientConnection::new(Arc::new(config), ServerName::try_from("127.0.0.1").unwrap()).unwrap();
    let tcp = TcpStream::connect(scan.address())?;
    tcp.set_read_timeout(Some(Duration::from_secs(20)))?;
    let mut tls = StreamOwned::new(connection, tcp);
    tls.write_all(raw)?;
    tls.flush()?;
    read_response(&mut tls, &Limits::default()).map_err(|error| std::io::Error::other(error.to_string()))
}

fn get(scan: &PhoneScan, path: &str) -> Response {
    let raw = format!("GET {path} HTTP/1.1\r\nHost: {}\r\n\r\n", scan.address());
    send(scan, scan.fingerprint(), raw.as_bytes()).unwrap()
}

fn post(scan: &PhoneScan, cookie: Option<&str>, content_type: &str, body: &[u8]) -> Response {
    let mut raw = format!(
        "POST /upload HTTP/1.1\r\nHost: {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n",
        scan.address(),
        body.len()
    );
    if let Some(cookie) = cookie {
        raw.push_str(&format!("Cookie: {cookie}\r\n"));
    }
    raw.push_str("\r\n");
    let mut bytes = raw.into_bytes();
    bytes.extend_from_slice(body);
    send(scan, scan.fingerprint(), &bytes).unwrap()
}

fn path_of(scan: &PhoneScan) -> String {
    let url = scan.url();
    url[url.find("/s/").unwrap()..].to_owned()
}

fn cookie_of(response: &Response) -> String {
    let set = response.header("set-cookie").unwrap();
    set.split(';').next().unwrap().to_owned()
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let picture = image::RgbImage::from_pixel(width, height, image::Rgb([200, 120, 40]));
    let mut out = Vec::new();
    image::DynamicImage::ImageRgb8(picture)
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

fn jpeg(width: u32, height: u32) -> Vec<u8> {
    let picture = image::RgbImage::from_pixel(width, height, image::Rgb([20, 120, 240]));
    let mut out = Vec::new();
    image::DynamicImage::ImageRgb8(picture)
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Jpeg)
        .unwrap();
    out
}

#[test]
fn a_phone_opens_the_page_once_and_sends_photos() {
    let session = start(PhoneLimits::default());
    let page = get(&session.scan, &path_of(&session.scan));
    assert_eq!(page.status, 200);
    assert!(String::from_utf8_lossy(&page.body).contains("Send photos to OpenNote"));
    assert!(page
        .header("content-security-policy")
        .unwrap()
        .contains("default-src 'none'"));
    let cookie = cookie_of(&page);
    assert!(page.header("set-cookie").unwrap().contains("HttpOnly"));

    assert_eq!(
        post(&session.scan, Some(&cookie), "image/png", &png(40, 30)).status,
        200
    );
    assert_eq!(
        post(&session.scan, Some(&cookie), "image/jpeg", &jpeg(64, 48)).status,
        200
    );
    let photos = session.photos.lock().unwrap();
    assert_eq!(photos.len(), 2);
    assert_eq!(
        (photos[0].mime, photos[0].width, photos[0].height),
        ("image/png", 40, 30)
    );
    assert_eq!(photos[1].mime, "image/jpeg");
    assert_eq!(&photos[1].bytes[..3], &[0xFF, 0xD8, 0xFF]);
}

#[test]
fn the_token_works_once_and_a_wrong_one_is_refused() {
    let session = start(PhoneLimits::default());
    let path = path_of(&session.scan);
    assert_eq!(get(&session.scan, &path).status, 200);
    assert_eq!(get(&session.scan, &path).status, 404, "a used token");
    assert_eq!(
        get(&session.scan, "/s/00000000000000000000000000000000").status,
        404,
        "a wrong token"
    );
    assert_eq!(session.scan.state(), Closed::Open);
}

#[test]
fn too_many_wrong_tokens_close_the_listener() {
    let session = start(PhoneLimits::default());
    for _ in 0..MAX_BAD_TOKENS {
        get(&session.scan, "/s/ffffffffffffffffffffffffffffffff");
    }
    assert_eq!(session.scan.state(), Closed::TooManyTries);
    thread::sleep(Duration::from_millis(300));
    let raw = format!("GET {} HTTP/1.1\r\n\r\n", path_of(&session.scan));
    let refused = send(&session.scan, session.scan.fingerprint(), raw.as_bytes());
    assert!(
        refused.is_err(),
        "the listener is closed, so even the right token gets nothing"
    );
}

#[test]
fn an_expired_session_closes_its_listener() {
    let session = start(PhoneLimits {
        lifetime: Duration::from_millis(300),
        ..PhoneLimits::default()
    });
    thread::sleep(Duration::from_millis(700));
    assert_eq!(session.scan.state(), Closed::Expired);
    let raw = format!("GET {} HTTP/1.1\r\n\r\n", path_of(&session.scan));
    assert!(send(&session.scan, session.scan.fingerprint(), raw.as_bytes()).is_err());
}

#[test]
fn a_stopped_session_takes_no_connections() {
    let session = start(PhoneLimits::default());
    let address = session.scan.address();
    session.scan.stop();
    assert!(TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_err());
}

#[test]
fn an_oversized_photo_is_refused() {
    let session = start(PhoneLimits {
        max_bytes: 2_000,
        ..PhoneLimits::default()
    });
    let cookie = cookie_of(&get(&session.scan, &path_of(&session.scan)));
    let big = vec![0u8; 5_000];
    // The listener answers from the length alone and closes before reading the body.
    let mut raw = format!(
        "POST /upload HTTP/1.1\r\nContent-Type: image/png\r\nContent-Length: {}\r\nCookie: {cookie}\r\n\r\n",
        big.len()
    )
    .into_bytes();
    raw.extend_from_slice(&big[..100]);
    let response = send(&session.scan, session.scan.fingerprint(), &raw).unwrap();
    assert_eq!(response.status, 413);
    assert!(session.photos.lock().unwrap().is_empty());
}

#[test]
fn a_photo_too_wide_to_decode_safely_is_refused() {
    let session = start(PhoneLimits {
        max_side: 100,
        ..PhoneLimits::default()
    });
    let cookie = cookie_of(&get(&session.scan, &path_of(&session.scan)));
    assert_eq!(
        post(&session.scan, Some(&cookie), "image/png", &png(300, 10)).status,
        415
    );
    assert!(session.photos.lock().unwrap().is_empty());
}

#[test]
fn files_that_arent_jpeg_or_png_are_refused() {
    let session = start(PhoneLimits::default());
    let cookie = cookie_of(&get(&session.scan, &path_of(&session.scan)));
    assert_eq!(
        post(&session.scan, Some(&cookie), "text/html", b"<script>x</script>").status,
        415
    );
    assert_eq!(
        post(&session.scan, Some(&cookie), "image/png", b"not a picture at all").status,
        415
    );
    assert_eq!(
        post(&session.scan, Some(&cookie), "image/jpeg", &png(10, 10)).status,
        415,
        "a PNG called a JPEG"
    );
    let mut cut = png(50, 50);
    cut.truncate(cut.len() / 2);
    assert_eq!(
        post(&session.scan, Some(&cookie), "image/png", &cut).status,
        415,
        "a cut-off file"
    );
    assert!(session.photos.lock().unwrap().is_empty());
}

#[test]
fn uploads_need_the_session_cookie() {
    let session = start(PhoneLimits::default());
    assert_eq!(
        post(&session.scan, None, "image/png", &png(10, 10)).status,
        403,
        "before the page is opened"
    );
    get(&session.scan, &path_of(&session.scan));
    assert_eq!(post(&session.scan, None, "image/png", &png(10, 10)).status, 403);
    let wrong = "opennote_phone=00000000000000000000000000000000";
    assert_eq!(post(&session.scan, Some(wrong), "image/png", &png(10, 10)).status, 403);
    assert!(session.photos.lock().unwrap().is_empty());
}

#[test]
fn a_client_that_doesnt_match_the_fingerprint_gets_nothing() {
    let session = start(PhoneLimits::default());
    let raw = format!("GET {} HTTP/1.1\r\n\r\n", path_of(&session.scan));
    let wrong_pin = "00".repeat(32);
    assert!(send(&session.scan, &wrong_pin, raw.as_bytes()).is_err());
    // The token wasn't sent, so it still works.
    assert_eq!(get(&session.scan, &path_of(&session.scan)).status, 200);
}

#[test]
fn the_listener_binds_only_where_it_was_told() {
    let session = start(PhoneLimits::default());
    assert_eq!(session.scan.address().ip(), "127.0.0.1".parse::<IpAddr>().unwrap());
    assert!(session.scan.url().starts_with("https://127.0.0.1:"));
    assert_eq!(session.scan.fingerprint().split(':').count(), 32);
}
