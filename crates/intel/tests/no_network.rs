//! Proves that the crate cannot reach the network. It uses allow-lists rather than deny-lists. The crates it
//! links are exactly the known set. The features of the Windows API it turns on are exactly the ones it
//! needs. Every Windows namespace its source names is one that works on the device. On top of that, the
//! source holds no networking words, process launches, foreign links, or URLs, in any letter case.
//!
//! This is the static half of the "no data leaves the device" promise. `tests/no_sockets.rs` is the
//! runtime half: it watches this process for sockets while the Windows engines run.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde_json::Value;

/// Every crate the build links, separated by spaces. A new one fails the test until someone checks that it
/// cannot reach the network and adds it here.
const LINKED_CRATES: &str = concat!(
    "itoa memchr opennote-intel proc-macro2 quote serde serde_core serde_derive serde_json syn thiserror ",
    "thiserror-impl unicode-ident windows windows-collections windows-core windows-future windows-implement ",
    "windows-interface windows-link windows-numerics windows-result windows-strings windows-threading zmij"
);

/// The features of the `windows` crate that this crate turns on, exactly.
const WINDOWS_FEATURES: &str = concat!(
    "Foundation Foundation_Collections Globalization Graphics_Imaging Media_Core Media_Ocr ",
    "Media_SpeechSynthesis Storage_Streams UI_Input_Inking UI_Input_Inking_Analysis Win32_System_Threading"
);

/// The Windows namespaces the source may name after `windows::`. Other crates of the workspace turn on more
/// features of the same `windows` build, Networking among them, so this list is what keeps those out.
const WINDOWS_NAMESPACES: &str = concat!(
    "core Foundation Foundation::Collections Globalization Graphics::Imaging Media::Core Media::Ocr ",
    "Media::SpeechSynthesis Storage::Streams UI::Input::Inking UI::Input::Inking::Analysis Win32::System::Threading"
);

/// Words that have no place in the source, matched as whole words in any letter case. `uri` covers
/// `Foundation::Uri`, which the `CreateFromUri` family of the Windows API fetches from the network.
const BANNED_WORDS: &str = concat!(
    "uri uris createfromuri createuri networking sockets socket streamsocket datagramsocket tcpstream ",
    "tcplistener udpsocket websocket winhttp wininet httpclient backgroundtransfer reqwest ureq hyper curl ",
    "ws2_32 wsastartup getaddrinfo winapi windows_sys libc extern"
);

/// Text that has no place in the source, matched anywhere in any letter case: networking modules, process
/// launches such as curl.exe, foreign links, and URLs.
const BANNED_TEXT: &str = "std::net process:: command:: #[link http:// https:// ftp:// ws:// wss://";

fn manifest_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

/// The output of `cargo metadata`, which takes seconds, so the tests share one run.
fn cargo_metadata() -> &'static Value {
    static METADATA: OnceLock<Value> = OnceLock::new();
    METADATA.get_or_init(run_cargo_metadata)
}

fn run_cargo_metadata() -> Value {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
    let output = Command::new(cargo)
        .args(["metadata", "--format-version", "1", "--offline"])
        .current_dir(manifest_dir())
        .output()
        .expect("cargo metadata runs");
    assert!(
        output.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("cargo metadata prints JSON")
}

fn this_package(metadata: &Value) -> &Value {
    metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "opennote-intel")
        .expect("the crate is in the workspace")
}

/// The names of every crate that ends up in the crate's build, on every platform. Crates that
/// only its tests use are left out.
fn linked_crates(metadata: &Value) -> BTreeSet<String> {
    let names: HashMap<&str, &str> = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["id"].as_str().unwrap(), p["name"].as_str().unwrap()))
        .collect();
    let nodes: HashMap<&str, &Value> = metadata["resolve"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| (n["id"].as_str().unwrap(), n))
        .collect();
    let start = this_package(metadata)["id"].as_str().unwrap();
    let mut seen = BTreeSet::new();
    let mut queue = VecDeque::from([start]);
    while let Some(id) = queue.pop_front() {
        if !seen.insert(names[id].to_owned()) {
            continue;
        }
        for dep in nodes[id]["deps"].as_array().unwrap() {
            let linked = dep["dep_kinds"].as_array().unwrap().iter().any(|k| k["kind"] != "dev");
            if linked {
                queue.push_back(dep["pkg"].as_str().unwrap());
            }
        }
    }
    seen
}

fn words(list: &str) -> BTreeSet<String> {
    list.split_whitespace().map(str::to_owned).collect()
}

#[test]
fn the_linked_crates_are_exactly_the_known_set() {
    let crates = linked_crates(cargo_metadata());
    let known = words(LINKED_CRATES);
    let new: Vec<&String> = crates.difference(&known).collect();
    let gone: Vec<&String> = known.difference(&crates).collect();
    assert!(
        new.is_empty() && gone.is_empty(),
        "the linked crates changed. New: {new:?}. Gone: {gone:?}. Check that each new one cannot reach \
         the network before adding it to LINKED_CRATES."
    );
}

#[test]
fn the_windows_features_are_exactly_the_needed_set() {
    let metadata = cargo_metadata();
    let windows: Vec<&Value> = this_package(metadata)["dependencies"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| d["name"] == "windows" && d["kind"].is_null())
        .collect();
    assert_eq!(windows.len(), 1, "the crate has one normal dependency on windows");
    let features: BTreeSet<String> = windows[0]["features"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    assert_eq!(features, words(WINDOWS_FEATURES), "the windows features changed");
    let others: Vec<&str> = this_package(metadata)["dependencies"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|d| d["name"].as_str())
        .filter(|name| ["windows-sys", "winapi", "libc"].contains(name))
        .collect();
    assert!(
        others.is_empty(),
        "the crate depends on raw system bindings: {others:?}"
    );
}

/// Every `.rs` file under `src`, with its text.
fn source_files() -> Vec<(PathBuf, String)> {
    let mut found = Vec::new();
    let mut paths = vec![manifest_dir().join("src")];
    while let Some(path) = paths.pop() {
        if path.is_dir() {
            paths.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path).unwrap();
            found.push((path, text));
        }
    }
    assert!(found.len() >= 10, "the scan found only {} source files", found.len());
    found
}

/// What is wrong with one source file, if anything.
fn source_problem(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    if let Some(needle) = BANNED_TEXT.split_whitespace().find(|n| lower.contains(*n)) {
        return Some(format!("it contains {needle:?}"));
    }
    let banned = words(BANNED_WORDS);
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    if let Some(word) = lower.split(|c: char| !is_word(c)).find(|w| banned.contains(*w)) {
        return Some(format!("it contains the word {word:?}"));
    }
    windows_path_problem(text)
}

/// Checks every use of the `windows` crate against [`WINDOWS_NAMESPACES`]. The path must name the namespace
/// in full, so `windows::{Networking, ..}` and `use windows as w` are refused along with unknown namespaces.
fn windows_path_problem(text: &str) -> Option<String> {
    let allowed = words(WINDOWS_NAMESPACES);
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let mut rest = text;
    while let Some(at) = rest.find("windows") {
        let before = rest[..at].chars().next_back();
        let after = &rest[at + "windows".len()..];
        rest = after;
        if before.is_some_and(is_word) || after.starts_with(is_word) {
            continue;
        }
        // `cfg(windows)` and the word in prose are fine. Only a path or an alias reaches the crate.
        let Some(path) = after.strip_prefix("::") else {
            if after.trim_start().starts_with("as ") {
                return Some("it renames the windows crate".to_owned());
            }
            continue;
        };
        let end = path.find(|c: char| !(is_word(c) || c == ':')).unwrap_or(path.len());
        let segments: Vec<&str> = path[..end].split("::").collect();
        let namespace = segments[..segments.len().saturating_sub(1)].join("::");
        let names_a_namespace = path[end..].starts_with('{') && allowed.contains(path[..end].trim_end_matches(':'));
        if !allowed.contains(&namespace) && !names_a_namespace {
            return Some(format!(
                "it uses windows::{}, outside the allowed namespaces",
                &path[..end]
            ));
        }
    }
    None
}

#[test]
fn the_source_names_only_device_apis_and_holds_no_urls() {
    for (path, text) in source_files() {
        let problem = source_problem(&text);
        assert!(problem.is_none(), "{}: {}", path.display(), problem.unwrap());
    }
}

#[test]
fn the_source_check_catches_the_ways_around_it() {
    let refused = [
        "let uri = Uri::CreateUri(&HSTRING::from(text))?;",
        "RandomAccessStreamReference::CreateFromUri(&uri)?;",
        "use windows::Networking::Sockets::StreamSocket;",
        "use windows::{Networking::Sockets::StreamSocket, Foundation::Point};",
        "use windows::Web::Http::HttpClient;",
        "use windows::Foundation::Uri;",
        "use windows as w;",
        "std::process::Command::new(\"curl.exe\")",
        "let _ = Command::new(\"powershell\");",
        "extern \"system\" { fn connect(); }",
        "#[link(name = \"ws2_32\")]",
        "let page = \"HTTPS://example.org\";",
        "use std::net::TcpStream;",
        "use windows_sys::Win32::Networking::WinSock;",
        "use windows::Win32::System::Com::CoCreateInstance;",
    ];
    for code in refused {
        assert!(source_problem(code).is_some(), "the check let through: {code}");
    }
    let accepted = [
        "use windows::Media::Ocr::{OcrEngine as WinEngine, OcrResult as WinResult};",
        "use windows::UI::Input::Inking::Analysis::{InkAnalyzer, InkAnalysisNodeKind};",
        "let point = windows::Foundation::Point { X: 1.0, Y: 2.0 };",
        "#[cfg(all(windows, feature = \"winrt\"))]",
        "// Windows needs no network for this, and during the call nothing is secured.",
    ];
    for code in accepted {
        assert_eq!(source_problem(code), None, "the check refused: {code}");
    }
}

#[test]
fn the_walk_sees_a_network_client_hidden_deep_in_the_tree() {
    let package = |name: &str| serde_json::json!({"id": name, "name": name});
    let node = |id: &str, deps: &[(&str, Value)]| {
        let deps: Vec<Value> = deps
            .iter()
            .map(|(pkg, kind)| serde_json::json!({"pkg": pkg, "dep_kinds": [{"kind": kind}]}))
            .collect();
        serde_json::json!({"id": id, "deps": deps})
    };
    let metadata = serde_json::json!({
        "packages": [package("opennote-intel"), package("helper"), package("reqwest"), package("proptest")],
        "resolve": {"nodes": [
            node("opennote-intel", &[("helper", Value::Null), ("proptest", "dev".into())]),
            node("helper", &[("reqwest", "build".into())]),
            node("reqwest", &[]),
            node("proptest", &[]),
        ]},
    });
    let crates = linked_crates(&metadata);
    assert!(
        crates.contains("reqwest"),
        "a build dependency two levels down is found"
    );
    assert!(
        !crates.contains("proptest"),
        "a test-only dependency is not part of the build"
    );
}
