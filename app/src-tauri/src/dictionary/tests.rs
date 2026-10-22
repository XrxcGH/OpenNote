use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use flate2::{write::GzEncoder, Compression};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};

use super::*;
use crate::intel::models::Opened;

const WORDNET: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<LexicalResource>
  <Lexicon id="oewn" label="Open English Wordnet" language="en" version="2025">
    <LexicalEntry id="oewn-cause-n">
      <Lemma writtenForm="cause" partOfSpeech="n"/>
      <Sense id="oewn-cause__1" synset="oewn-1-n">
        <SenseRelation relType="derivation" target="oewn-x"/>
      </Sense>
    </LexicalEntry>
    <LexicalEntry id="oewn-reason-n">
      <Lemma writtenForm="reason" partOfSpeech="n">
        <Pronunciation variety="GB">riːzn</Pronunciation>
      </Lemma>
      <Sense id="oewn-reason__1" synset="oewn-1-n"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-cause-v">
      <Lemma writtenForm="cause" partOfSpeech="v"/>
      <Sense id="oewn-cause__2" synset="oewn-2-v"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-Turkey-n">
      <Lemma writtenForm="Turkey" partOfSpeech="n"/>
      <Sense id="oewn-Turkey__1" synset="oewn-3-n"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-turkey-n">
      <Lemma writtenForm="turkey" partOfSpeech="n"/>
      <Sense id="oewn-turkey__1" synset="oewn-4-n"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-ecole-n">
      <Lemma writtenForm="école" partOfSpeech="n"/>
      <Sense id="oewn-ecole__1" synset="oewn-5-n"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-ap-hood-n">
      <Lemma writtenForm="&apos;hood" partOfSpeech="n"/>
      <Sense id="oewn-hood__1" synset="oewn-6-n"/>
    </LexicalEntry>
    <Synset id="oewn-1-n" members="oewn-cause-n oewn-reason-n" partOfSpeech="n">
      <Definition>a person or thing that makes something happen</Definition>
      <Example>Poor drainage was the cause.</Example>
      <Example>A second example.</Example>
    </Synset>
    <Synset id="oewn-2-v" members="oewn-cause-v" partOfSpeech="v">
      <Definition>give rise to &amp; bring about</Definition>
    </Synset>
    <Synset id="oewn-3-n" members="oewn-Turkey-n" partOfSpeech="n">
      <Definition>a country in Asia Minor</Definition>
    </Synset>
    <Synset id="oewn-4-n" members="oewn-turkey-n" partOfSpeech="n">
      <Definition>large gallinaceous bird</Definition>
    </Synset>
    <Synset id="oewn-5-n" members="oewn-ecole-n" partOfSpeech="n">
      <Definition>a school</Definition>
    </Synset>
    <Synset id="oewn-6-n" members="oewn-ap-hood-n" partOfSpeech="n">
      <Definition>neighborhood</Definition>
    </Synset>
  </Lexicon>
</LexicalResource>
"#;

const MOBY_TEXT: &str = "cause,agent,basis,cause\r\nreason,cause,ground\r\n\r\nlonely,\r\n";

fn gzip(text: &str) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(text.as_bytes()).unwrap();
    encoder.finish().unwrap()
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

/// A small web server on this computer. It serves two files and honors a `Range` header, so a resumed download can
/// be tested. `hits` counts the requests.
struct Server {
    port: u16,
    hits: Arc<Mutex<Vec<String>>>,
}

fn serve(files: Vec<(&'static str, Vec<u8>)>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(Mutex::new(Vec::new()));
    let seen = hits.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let files = files.clone();
            let seen = seen.clone();
            thread::spawn(move || answer(stream, &files, &seen));
        }
    });
    Server { port, hits }
}

fn answer(mut stream: TcpStream, files: &[(&'static str, Vec<u8>)], seen: &Mutex<Vec<String>>) {
    let mut request = Vec::new();
    let mut byte = [0u8; 1];
    while !request.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).unwrap_or(0) == 0 {
            return;
        }
        request.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&request).to_string();
    let path = text.split_whitespace().nth(1).unwrap_or("").to_owned();
    seen.lock().unwrap().push(path.clone());
    let from: usize = text
        .lines()
        .find_map(|line| line.to_lowercase().strip_prefix("range: bytes=").map(str::to_owned))
        .and_then(|range| range.trim_end_matches('-').parse().ok())
        .unwrap_or(0);
    let Some((_, body)) = files.iter().find(|(name, _)| *name == path) else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    };
    let (status, slice) = if from > 0 {
        ("206 Partial Content", &body[from.min(body.len())..])
    } else {
        ("200 OK", &body[..])
    };
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        slice.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(slice);
}

/// Opens only the addresses of the local server, with plain HTTP.
struct Local;

impl Source for Local {
    fn open(&self, url: &str, from: u64) -> Result<Opened, String> {
        if !url.starts_with("http://127.0.0.1:") {
            return Err("That address is not one OpenNote downloads from.".to_owned());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        let mut request = agent.get(url);
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let response = request.call().map_err(|error| error.to_string())?;
        let resumed = match response.status().as_u16() {
            200 => false,
            206 => true,
            other => return Err(format!("The server answered with status {other}.")),
        };
        Ok(Opened {
            resumed,
            reader: Box::new(response.into_body().into_reader()),
        })
    }
}

fn spec_for(server: &Server, wordnet: &[u8], moby: &[u8]) -> &'static ModelSpec {
    let base = format!("http://127.0.0.1:{}", server.port);
    let parts: &'static [Part] = Box::leak(Box::new([
        Part {
            file: "wordnet.xml.gz",
            size: wordnet.len() as u64,
            digest: Digest::Sha256(leak(sha(wordnet))),
            url: leak(format!("{base}/wordnet")),
        },
        Part {
            file: "moby.txt",
            size: moby.len() as u64,
            digest: Digest::Sha256(leak(sha(moby))),
            url: leak(format!("{base}/moby")),
        },
    ]));
    Box::leak(Box::new(ModelSpec {
        id: "dictionary",
        kind: "dictionary",
        name: "Test",
        detail: "",
        parts,
    }))
}

struct Fixture {
    _folder: tempfile::TempDir,
    server: Server,
    dictionary: Dictionary,
}

fn fixture_with(moby: &[u8], served_moby: &[u8]) -> Fixture {
    let wordnet = gzip(WORDNET);
    let server = serve(vec![("/wordnet", wordnet.clone()), ("/moby", served_moby.to_vec())]);
    let spec = spec_for(&server, &wordnet, moby);
    let folder = tempfile::tempdir().unwrap();
    let dictionary = Dictionary::with(folder.path().join("dictionary"), Arc::new(Local), spec);
    Fixture {
        _folder: folder,
        server,
        dictionary,
    }
}

fn fixture() -> Fixture {
    fixture_with(MOBY_TEXT.as_bytes(), MOBY_TEXT.as_bytes())
}

fn wait_until_idle(dictionary: &Dictionary) -> Value {
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        let status = dictionary.status(false);
        if !matches!(status["state"].as_str(), Some("downloading" | "building")) {
            return status;
        }
        assert!(Instant::now() < end, "the download did not finish");
        thread::sleep(Duration::from_millis(10));
    }
}

fn chunk(dictionary: &Dictionary, set: &str, key: &str) -> Value {
    serde_json::from_str(&dictionary.chunk(set, key).unwrap().expect("a chunk")).unwrap()
}

#[test]
fn nothing_is_installed_at_first_and_no_chunk_is_served() {
    let f = fixture();
    let status = f.dictionary.status(false);
    assert_eq!(status["state"], "notInstalled");
    assert_eq!(f.dictionary.chunk("en", "c").unwrap(), None);
    assert!(f.server.hits.lock().unwrap().is_empty());
}

#[test]
fn a_download_is_checked_built_into_an_index_and_the_files_are_removed() {
    let f = fixture();
    f.dictionary.start(None).unwrap();
    let status = wait_until_idle(&f.dictionary);
    assert_eq!(status["state"], "installed", "{status}");
    assert_eq!(status["words"], 5);
    assert_eq!(status["related"], 2);
    assert!(
        !f.dictionary.downloads().exists(),
        "the downloads are deleted once the index is built"
    );

    let c = chunk(&f.dictionary, "en", "c");
    assert_eq!(
        c["cause"],
        json!([
            [
                "n",
                [[
                    "a person or thing that makes something happen",
                    ["reason"],
                    "Poor drainage was the cause."
                ]]
            ],
            ["v", [["give rise to & bring about", []]]],
        ])
    );
    // The lowercase bird leads the country, and an accented first letter is filed under its plain letter.
    assert_eq!(
        chunk(&f.dictionary, "en", "t")["turkey"][0][1][0][0],
        "large gallinaceous bird"
    );
    assert!(chunk(&f.dictionary, "en", "e")["école"].is_array());
    assert_eq!(chunk(&f.dictionary, "en", "_")["'hood"][0][1][0][0], "neighborhood");
    assert_eq!(
        chunk(&f.dictionary, "thesaurus", "c")["cause"],
        json!(["agent", "basis"])
    );
    assert_eq!(
        chunk(&f.dictionary, "thesaurus", "r")["reason"],
        json!(["cause", "ground"])
    );
    assert_eq!(f.dictionary.chunk("en", "q").unwrap(), None);
}

#[test]
fn a_chunk_name_cannot_leave_the_index() {
    let f = fixture();
    f.dictionary.start(None).unwrap();
    wait_until_idle(&f.dictionary);
    for (set, key) in [
        ("en", "../c"),
        ("en", "cc"),
        ("en", ""),
        ("../x", "c"),
        ("en", "C"),
        ("en", "/"),
    ] {
        assert_eq!(f.dictionary.chunk(set, key).unwrap(), None, "{set} {key}");
    }
}

#[test]
fn a_file_with_the_wrong_checksum_is_refused_and_nothing_is_built() {
    // The server serves bytes of the right length that are not the pinned ones.
    let tampered = MOBY_TEXT.replace("agent", "AGENT");
    let f = fixture_with(MOBY_TEXT.as_bytes(), tampered.as_bytes());
    f.dictionary.start(None).unwrap();
    let status = wait_until_idle(&f.dictionary);
    assert_eq!(status["state"], "failed");
    assert_eq!(status["error"], "checksum");
    assert_eq!(f.dictionary.chunk("en", "c").unwrap(), None);
    assert!(!f.dictionary.index_dir().exists());
}

#[test]
fn a_server_that_sends_more_than_the_pinned_size_is_cut_off() {
    let longer = format!("{MOBY_TEXT}extra,words,here\r\n");
    let f = fixture_with(MOBY_TEXT.as_bytes(), longer.as_bytes());
    f.dictionary.start(None).unwrap();
    let status = wait_until_idle(&f.dictionary);
    assert_eq!(status["state"], "failed");
    assert_eq!(status["error"], "checksum");
}

#[test]
fn a_failed_download_can_be_tried_again() {
    let tampered = MOBY_TEXT.replace("agent", "AGENT");
    let f = fixture_with(MOBY_TEXT.as_bytes(), tampered.as_bytes());
    f.dictionary.start(None).unwrap();
    assert_eq!(wait_until_idle(&f.dictionary)["state"], "failed");
    f.dictionary.start(None).unwrap();
    assert_eq!(wait_until_idle(&f.dictionary)["error"], "checksum");
}

#[test]
fn an_unreachable_server_is_a_calm_network_failure() {
    let f = fixture();
    let spec = spec_for(
        &Server {
            port: 1,
            hits: Arc::default(),
        },
        b"a",
        b"b",
    );
    let dictionary = Dictionary::with(f.dictionary.0.dir.join("other"), Arc::new(Local), spec);
    dictionary.start(None).unwrap();
    let status = wait_until_idle(&dictionary);
    assert_eq!(status["state"], "failed");
    assert_eq!(status["error"], "network");
}

#[test]
fn a_download_resumes_from_the_part_that_arrived() {
    let f = fixture();
    let spec = f.dictionary.0.spec;
    // Half of the first file is already on disk from an earlier try.
    let downloads = f.dictionary.downloads();
    fs::create_dir_all(&downloads).unwrap();
    let wordnet = gzip(WORDNET);
    fs::write(downloads.join("wordnet.xml.gz.part"), &wordnet[..wordnet.len() / 2]).unwrap();
    assert_eq!(f.dictionary.status(false)["state"], "partial");
    f.dictionary.start(None).unwrap();
    assert_eq!(wait_until_idle(&f.dictionary)["state"], "installed");
    assert_eq!(spec.parts.len(), 2);
}

#[test]
fn nothing_is_downloaded_offline_or_in_safe_mode() {
    let f = fixture();
    let ask = |offline, safe| {
        f.dictionary.call(
            &Request {
                method: "start".into(),
                params: Value::Null,
            },
            offline,
            safe,
        )
    };
    assert_eq!(ask(true, false).unwrap_err().code, "offline");
    assert_eq!(ask(false, true).unwrap_err().code, "safeMode");
    assert!(f.server.hits.lock().unwrap().is_empty());
    assert_eq!(f.dictionary.status(true)["offline"], true);
}

#[test]
fn removing_deletes_the_index_and_returns_to_not_installed() {
    let f = fixture();
    f.dictionary.start(None).unwrap();
    wait_until_idle(&f.dictionary);
    f.dictionary.remove().unwrap();
    assert_eq!(f.dictionary.status(false)["state"], "notInstalled");
    assert_eq!(f.dictionary.chunk("en", "c").unwrap(), None);
    assert!(!f.dictionary.0.dir.exists());
    // Removing again is harmless.
    f.dictionary.remove().unwrap();
}

#[test]
fn an_index_of_another_format_reads_as_not_installed() {
    let f = fixture();
    fs::create_dir_all(f.dictionary.index_dir()).unwrap();
    fs::write(
        f.dictionary.index_dir().join("ready.json"),
        r#"{"version":0,"words":1,"related":1}"#,
    )
    .unwrap();
    assert_eq!(f.dictionary.status(false)["state"], "notInstalled");
}

#[test]
fn damaged_word_data_that_matches_its_checksum_fails_as_unreadable() {
    let junk = b"this is not gzip data at all, but it has the pinned checksum".to_vec();
    let moby = MOBY_TEXT.as_bytes();
    let server = serve(vec![("/wordnet", junk.clone()), ("/moby", moby.to_vec())]);
    let spec = spec_for(&server, &junk, moby);
    let folder = tempfile::tempdir().unwrap();
    let dictionary = Dictionary::with(folder.path().join("dictionary"), Arc::new(Local), spec);
    dictionary.start(None).unwrap();
    let status = wait_until_idle(&dictionary);
    assert_eq!(status["error"], "unreadable");
    assert!(!dictionary.downloads().exists());
}

#[test]
fn the_pinned_files_name_only_the_official_hosts() {
    for part in SPEC.parts {
        assert!(
            ALLOWED.iter().any(|prefix| part.url.starts_with(prefix)),
            "{}",
            part.url
        );
        assert!(part.url.starts_with("https://"));
    }
    let source = HttpSource::allowing(ALLOWED);
    assert!(source.open("https://example.com/x", 0).is_err());
    assert!(source
        .open("http://www.gutenberg.org/files/3202/files/mthesaur.txt", 0)
        .is_err());
}

#[test]
fn the_chunk_key_folds_accents_and_sends_other_starts_to_an_underscore() {
    assert_eq!(index::chunk_key("école"), 'e');
    assert_eq!(index::chunk_key("zebra"), 'z');
    assert_eq!(index::chunk_key("'hood"), '_');
    assert_eq!(index::chunk_key("3d"), '_');
    assert_eq!(index::chunk_key(""), '_');
}

/// Builds the index from the real files, to check the converter against the published data. It runs only when
/// `OPENNOTE_DICT_REAL` names a folder that holds `oewn-2025.xml.gz` and `mthesaur.txt`.
#[test]
#[ignore = "needs the real downloads"]
fn the_real_data_builds_into_a_usable_index() {
    let Ok(folder) = std::env::var("OPENNOTE_DICT_REAL") else {
        return;
    };
    let folder = std::path::Path::new(&folder);
    let out = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let built = index::build(
        &folder.join("oewn-2025.xml.gz"),
        &folder.join("mthesaur.txt"),
        out.path(),
    )
    .unwrap();
    println!("built {built:?} in {:?}", started.elapsed());
    assert!(built.words > 100_000 && built.related > 25_000, "{built:?}");
    let size: u64 = ["en", "thesaurus"]
        .iter()
        .flat_map(|set| fs::read_dir(out.path().join(set)).unwrap())
        .map(|file| file.unwrap().metadata().unwrap().len())
        .sum();
    println!("index bytes: {size}");
    let c: Value = serde_json::from_str(&index::read_chunk(out.path(), "en", 'c').unwrap().unwrap()).unwrap();
    println!("{}", c["cause"]);
    assert!(c["cause"].is_array());
    let t: Value = serde_json::from_str(&index::read_chunk(out.path(), "thesaurus", 'c').unwrap().unwrap()).unwrap();
    assert!(t["cause"].as_array().unwrap().len() > 10);
}
