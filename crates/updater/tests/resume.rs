//! Resuming a download (`updates.resume`) against a local server that cuts the connection off mid-file. The next
//! download asks for the rest with `Range` and `If-Range`; a server that ignores the range, or a file whose
//! `ETag` changed, starts it again; and the whole file is hashed and its signature checked before it is staged.

use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
};

use opennote_updater::{
    config::{Channel, ChannelUrls, Config, Limits, UpdaterDirs},
    fetch::{Fetch, FetchError, RangeSink, RangeStart, UreqFetch, Url},
    platform::PlatformKey,
    stage, Offer, UpdateError,
};
use semver::Version;
use sha2::{Digest, Sha256};

/// How the server answers the next request.
#[derive(Clone)]
struct Plan {
    body: Vec<u8>,
    etag: String,
    /// Close the connection after this many body bytes of the next response.
    cut_after: Option<usize>,
    /// Answer every range request with the whole file.
    ignore_range: bool,
}

/// The `Range` and `If-Range` headers of one request.
type Seen = (Option<String>, Option<String>);

#[derive(Clone)]
struct Server {
    plan: Arc<Mutex<Plan>>,
    /// The `Range` and `If-Range` headers of each request.
    seen: Arc<Mutex<Vec<Seen>>>,
    base: String,
}

impl Server {
    fn start(body: Vec<u8>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
        let base = format!("http://127.0.0.1:{}", listener.local_addr().expect("an address").port());
        let server = Server {
            plan: Arc::new(Mutex::new(Plan {
                body,
                etag: "\"v1\"".into(),
                cut_after: None,
                ignore_range: false,
            })),
            seen: Arc::default(),
            base,
        };
        let serving = server.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let serving = serving.clone();
                thread::spawn(move || serving.answer(stream));
            }
        });
        server
    }

    fn url(&self) -> String {
        format!("{}/OpenNote_Windows64.exe", self.base)
    }

    fn change(&self, change: impl FnOnce(&mut Plan)) {
        change(&mut self.plan.lock().expect("lock"));
    }

    fn answer(&self, mut stream: TcpStream) {
        let mut reader = BufReader::new(stream.try_clone().expect("a clone"));
        let (mut range, mut if_range) = (None, None);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                match name.trim().to_ascii_lowercase().as_str() {
                    "range" => range = Some(value.trim().to_owned()),
                    "if-range" => if_range = Some(value.trim().to_owned()),
                    _ => {}
                }
            }
        }
        self.seen.lock().expect("lock").push((range.clone(), if_range.clone()));
        let plan = {
            let mut plan = self.plan.lock().expect("lock");
            let snapshot = plan.clone();
            plan.cut_after = None;
            snapshot
        };
        let from = range
            .as_deref()
            .and_then(|range| range.strip_prefix("bytes="))
            .and_then(|range| range.trim_end_matches('-').parse::<usize>().ok())
            .filter(|_| !plan.ignore_range)
            .filter(|_| if_range.as_deref().is_none_or(|tag| tag == plan.etag));
        let (status, start) = match from {
            Some(from) if from < plan.body.len() => ("206 Partial Content", from),
            _ => ("200 OK", 0),
        };
        let total = plan.body.len();
        let mut head = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nETag: {}\r\nConnection: close\r\n",
            total - start,
            plan.etag
        );
        if start > 0 {
            head.push_str(&format!("Content-Range: bytes {start}-{}/{total}\r\n", total - 1));
        }
        head.push_str("\r\n");
        let _ = stream.write_all(head.as_bytes());
        let body = &plan.body[start..];
        let body = plan.cut_after.map_or(body, |cut| &body[..cut.min(body.len())]);
        let _ = stream.write_all(body);
        let _ = stream.flush();
        // Dropping the stream closes it, so a cut response ends short of its length.
    }

    fn ranges(&self) -> Vec<Seen> {
        self.seen.lock().expect("lock").clone()
    }
}

struct Keys {
    pair: minisign::KeyPair,
}

impl Keys {
    fn new() -> Keys {
        Keys {
            pair: minisign::KeyPair::generate_unencrypted_keypair().expect("a key pair"),
        }
    }

    fn public(&self) -> minisign_verify::PublicKey {
        let text = self.pair.pk.to_box().expect("a box").into_string();
        minisign_verify::PublicKey::decode(&text).expect("a public key")
    }

    fn sign(&self, data: &[u8], version: &str) -> String {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let comment = format!("timestamp:1790757747\tfile:OpenNote_Windows64.exe\tversion:{version}");
        let signature = minisign::sign(
            Some(&self.pair.pk),
            &self.pair.sk,
            data,
            Some(&comment),
            Some("signature from tauri secret key"),
        )
        .expect("signs");
        STANDARD.encode(signature.to_string())
    }
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn config(root: &std::path::Path, keys: &Keys) -> Config {
    Config {
        current: Version::parse("0.4.0").expect("a version"),
        platform: PlatformKey::WindowsX86_64,
        channel: Channel::Stable,
        urls: ChannelUrls::production(),
        trusted_keys: vec![keys.public()],
        dirs: UpdaterDirs {
            updates: root.join("updates"),
            previous: root.join("previous"),
            exe_dir: root.join("app"),
        },
        limits: Limits::default(),
    }
}

fn offer(server: &Server, data: &[u8], keys: &Keys) -> Offer {
    Offer {
        version: Version::parse("0.5.0").expect("a version"),
        notes: String::new(),
        url: Url::parse(&server.url()).expect("test builds accept 127.0.0.1"),
        size: data.len() as u64,
        sha256: hex(data),
        signature: keys.sign(data, "0.5.0"),
    }
}

fn exe(len: usize) -> Vec<u8> {
    (0..len).map(|at| u8::try_from(at % 251).unwrap_or(0)).collect()
}

fn part_len(config: &Config) -> u64 {
    let version = Version::parse("0.5.0").expect("a version");
    let part = config.dirs.updates.join(stage::part_name(&version, config.platform));
    std::fs::metadata(part).map(|meta| meta.len()).unwrap_or(0)
}

#[test]
fn a_download_cut_off_mid_file_resumes_from_where_it_stopped() {
    let data = exe(300_000);
    let server = Server::start(data.clone());
    let keys = Keys::new();
    let dir = tempfile::tempdir().expect("a folder");
    let config = config(dir.path(), &keys);
    let offer = offer(&server, &data, &keys);

    server.change(|plan| plan.cut_after = Some(120_000));
    let first = stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {});
    assert!(
        matches!(first, Err(UpdateError::Fetch(FetchError::Unreachable(_)))),
        "{first:?}"
    );
    assert_eq!(part_len(&config), 120_000, "the part file keeps what arrived");

    let staged = stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {}).expect("resumes");
    assert_eq!(std::fs::read(&staged.path).expect("the staged file"), data);
    let ranges = server.ranges();
    assert_eq!(ranges[0], (None, None));
    assert_eq!(
        ranges[1],
        (Some("bytes=120000-".into()), Some("\"v1\"".into())),
        "the second request asks for the rest of the same file"
    );
    assert_eq!(part_len(&config), 0, "the part file became the staged file");
}

#[test]
fn a_server_that_ignores_the_range_sends_the_file_again() {
    let data = exe(200_000);
    let server = Server::start(data.clone());
    let keys = Keys::new();
    let dir = tempfile::tempdir().expect("a folder");
    let config = config(dir.path(), &keys);
    let offer = offer(&server, &data, &keys);

    server.change(|plan| plan.cut_after = Some(50_000));
    assert!(stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {}).is_err());
    server.change(|plan| plan.ignore_range = true);
    let staged = stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {}).expect("restarts");
    assert_eq!(std::fs::read(&staged.path).expect("the staged file"), data);
}

#[test]
fn a_file_that_changed_on_the_server_starts_again_and_must_still_verify() {
    let data = exe(200_000);
    let server = Server::start(data.clone());
    let keys = Keys::new();
    let dir = tempfile::tempdir().expect("a folder");
    let config = config(dir.path(), &keys);
    let offer = offer(&server, &data, &keys);

    server.change(|plan| plan.cut_after = Some(80_000));
    assert!(stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {}).is_err());

    // A new ETag: If-Range no longer matches, so the server sends the whole file, which here is different bytes.
    let mut other = data.clone();
    other[10] ^= 0xff;
    server.change(|plan| {
        plan.etag = "\"v2\"".into();
        plan.body = other;
    });
    let refused = stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {});
    assert!(matches!(refused, Err(UpdateError::Verify(_))), "{refused:?}");
    assert_eq!(part_len(&config), 0, "a file that failed its hash is deleted");

    server.change(|plan| plan.body = data.clone());
    let staged = stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {}).expect("downloads");
    assert_eq!(std::fs::read(&staged.path).expect("the staged file"), data);
}

#[test]
fn a_tampered_part_file_never_passes() {
    let data = exe(150_000);
    let server = Server::start(data.clone());
    let keys = Keys::new();
    let dir = tempfile::tempdir().expect("a folder");
    let config = config(dir.path(), &keys);
    let offer = offer(&server, &data, &keys);

    server.change(|plan| plan.cut_after = Some(60_000));
    assert!(stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {}).is_err());
    let version = Version::parse("0.5.0").expect("a version");
    let part = config.dirs.updates.join(stage::part_name(&version, config.platform));
    let mut bytes = std::fs::read(&part).expect("the part");
    bytes[5] ^= 1;
    std::fs::write(&part, bytes).expect("tampered");

    let refused = stage::download_resumable(&UreqFetch::default(), &config, &offer, &|_, _| {});
    assert!(matches!(refused, Err(UpdateError::Verify(_))), "{refused:?}");
    assert!(!part.exists());
}

/// A fetcher without range support still downloads correctly through the trait's default.
#[test]
fn the_default_range_request_fetches_the_whole_file() {
    struct Whole(Vec<u8>);
    impl Fetch for Whole {
        fn get(
            &self,
            _url: &Url,
            _max: u64,
            sink: &mut dyn Write,
        ) -> Result<opennote_updater::FetchOutcome, FetchError> {
            sink.write_all(&self.0)?;
            Ok(opennote_updater::FetchOutcome {
                bytes: self.0.len() as u64,
            })
        }
    }
    struct Collect(Vec<u8>, Option<bool>);
    impl Write for Collect {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.0.extend_from_slice(buffer);
            Ok(buffer.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl RangeSink for Collect {
        fn begin(&mut self, resumed: bool, _etag: Option<&str>) -> std::io::Result<()> {
            self.1 = Some(resumed);
            Ok(())
        }
    }
    let url = Url::parse("https://github.com/x").expect("https");
    let mut sink = Collect(Vec::new(), None);
    let start = RangeStart { from: 3, etag: None };
    let outcome = Whole(b"abcdef".to_vec())
        .get_range(&url, &start, 100, &mut sink)
        .expect("fetches");
    assert!(!outcome.resumed);
    assert_eq!((sink.0.as_slice(), sink.1), (&b"abcdef"[..], Some(false)));
}
