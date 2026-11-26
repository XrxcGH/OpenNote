use std::{
    fs, io,
    sync::{atomic::AtomicBool, Arc, Mutex},
    thread,
    time::Duration,
};

use tauri::http::{Method, StatusCode};

use super::catalog::Pack;
use super::*;
use crate::intel::models::{Digest, ModelSpec, Opened, Part};

const DATA: &[u8] = b"hello world";
/// `printf 'hello world' | sha256sum`
const HELLO_SHA: &str = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

const DEMO: ModelSpec = ModelSpec {
    id: "demo",
    kind: "runtime",
    name: "Demo",
    detail: "",
    parts: &[Part {
        file: "demo/demo.wasm",
        size: DATA.len() as u64,
        digest: Digest::Sha256(HELLO_SHA),
        url: "https://example.invalid/demo.wasm",
    }],
};

const DEMO_PACKAGE: ModelSpec = ModelSpec {
    id: "demo:package",
    kind: "runtime",
    name: "package",
    detail: "",
    parts: &[Part {
        file: "demo/package.whl",
        size: DATA.len() as u64,
        digest: Digest::Sha256(HELLO_SHA),
        url: "https://example.invalid/package.whl",
    }],
};

static DEMO_PACKS: [Pack; 2] = [
    Pack {
        spec: &DEMO,
        version: "1.0.0",
        license: "MIT",
        depends: &[],
        always_listed: true,
    },
    Pack {
        spec: &DEMO_PACKAGE,
        version: "1.0.0",
        license: "",
        depends: &["demo"],
        always_listed: false,
    },
];

fn demo_catalog() -> Box<dyn Iterator<Item = &'static Pack>> {
    Box::new(DEMO_PACKS.iter())
}

/// Serves `data` from a start offset, and notes each offset asked for.
struct Memory {
    data: Vec<u8>,
    asked: Mutex<Vec<u64>>,
}

impl Source for Memory {
    fn open(&self, _url: &str, from: u64, _size: u64) -> Result<Opened, String> {
        self.asked.lock().unwrap().push(from);
        Ok(Opened {
            resumed: from > 0,
            reader: Box::new(io::Cursor::new(self.data[from as usize..].to_vec())),
        })
    }
}

fn demo(data: &[u8]) -> (tempfile::TempDir, Packs, Arc<Memory>) {
    let dir = tempfile::tempdir().unwrap();
    let source = Arc::new(Memory {
        data: data.to_vec(),
        asked: Mutex::new(Vec::new()),
    });
    let packs = Packs::with_catalog(dir.path().join("packs"), source.clone(), demo_catalog);
    (dir, packs, source)
}

/// Waits for the download thread to finish.
fn settle(packs: &Packs, id: &str) -> PackState {
    for _ in 0..500 {
        let list = packs.list(false, false);
        let state = list.packs.into_iter().find(|pack| pack.id == id).map(|pack| pack.state);
        if !matches!(state, Some(PackState::Downloading { .. })) {
            return state.unwrap_or(PackState::Absent);
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("the download did not finish");
}

#[test]
fn a_pack_downloads_is_verified_and_served_with_the_wasm_type() {
    let (_dir, packs, _source) = demo(DATA);
    packs.download("demo", false, false).unwrap();
    assert_eq!(settle(&packs, "demo"), PackState::Ready { bytes: 11 });
    let response = packs.serve(&Method::GET, "/demo/demo.wasm");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body().as_slice(), DATA);
    assert_eq!(response.headers()["content-type"], "application/wasm");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
}

#[test]
fn a_pack_file_with_one_changed_byte_is_refused() {
    // At download: the checksum fails, and nothing is kept.
    let (_dir, packs, _source) = demo(b"hello_world");
    packs.download("demo", false, false).unwrap();
    assert_eq!(settle(&packs, "demo"), PackState::Failed { reason: "checksum" });
    assert!(!packs.dir().join("demo/demo.wasm").exists());

    // On disk after a good download: the scheme checks the bytes again and refuses them.
    let (_dir, packs, _source) = demo(DATA);
    packs.download("demo", false, false).unwrap();
    assert_eq!(settle(&packs, "demo"), PackState::Ready { bytes: 11 });
    fs::write(packs.dir().join("demo/demo.wasm"), b"hello World").unwrap();
    assert_eq!(
        packs.serve(&Method::GET, "/demo/demo.wasm").status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn a_truncated_download_resumes() {
    let (_dir, packs, source) = demo(DATA);
    // An earlier try stopped after five bytes.
    fs::create_dir_all(packs.dir().join("demo")).unwrap();
    fs::write(packs.dir().join("demo/demo.wasm.part"), &DATA[..5]).unwrap();
    let list = packs.list(false, false);
    assert_eq!(
        list.packs[0].state,
        PackState::Partial {
            received_bytes: 5,
            total_bytes: 11
        }
    );
    packs.download("demo", false, false).unwrap();
    assert_eq!(settle(&packs, "demo"), PackState::Ready { bytes: 11 });
    assert_eq!(*source.asked.lock().unwrap(), vec![5]);
    assert_eq!(fs::read(packs.dir().join("demo/demo.wasm")).unwrap(), DATA);
}

#[test]
fn the_scheme_refuses_paths_outside_the_pack_folder_and_unverified_files() {
    let (dir, packs, _source) = demo(DATA);
    packs.download("demo", false, false).unwrap();
    assert_eq!(settle(&packs, "demo"), PackState::Ready { bytes: 11 });
    // A file beside the packs folder, with the right bytes, is still out of reach.
    fs::write(dir.path().join("secret.wasm"), DATA).unwrap();
    // A file inside the folder that the catalog does not name, and a part file, are not verified.
    fs::write(packs.dir().join("demo/other.wasm"), DATA).unwrap();
    fs::write(packs.dir().join("demo/package.whl.part"), DATA).unwrap();
    for path in [
        "/../secret.wasm",
        "/demo/../../secret.wasm",
        "/demo/%2e%2e/%2e%2e/secret.wasm",
        "/demo\\..\\..\\secret.wasm",
        "//demo/demo.wasm",
        "/demo//demo.wasm",
        "/./demo/demo.wasm",
        "/C:/Windows/win.ini",
        "demo/demo.wasm",
        "/",
        "",
        "/demo/other.wasm",
        "/demo/package.whl.part",
        // In the catalog but not downloaded.
        "/demo/package.whl",
    ] {
        assert_eq!(
            packs.serve(&Method::GET, path).status(),
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    // Read-only.
    for method in [Method::PUT, Method::POST, Method::DELETE] {
        assert_eq!(
            packs.serve(&method, "/demo/demo.wasm").status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }
    assert_eq!(packs.serve(&Method::GET, "/demo/demo.wasm").status(), StatusCode::OK);
}

#[test]
fn work_offline_blocks_a_pack_download_with_the_documented_message() {
    let (_dir, packs, source) = demo(DATA);
    let error = packs.download("demo", true, false).unwrap_err();
    assert_eq!(error.code, "offline");
    assert_eq!(error.message, "Work offline is on. Turn it off to download this pack.");
    let error = packs.download("demo", false, true).unwrap_err();
    assert_eq!(error.code, "safeMode");
    assert_eq!(
        error.message,
        "Safe mode is on. Restart OpenNote normally to download this pack."
    );
    // Nothing was asked of the network, and the list says why.
    assert!(source.asked.lock().unwrap().is_empty());
    let list = packs.list(true, false);
    assert_eq!(list.blocked, Some("offline"));
    assert_eq!(list.packs[0].state, PackState::Blocked { reason: "offline" });
    assert_eq!(packs.list(false, true).blocked, Some("safe-mode"));
}

#[test]
fn the_list_shows_core_packs_and_packages_with_bytes_on_disk_and_remove_takes_them() {
    let (_dir, packs, _source) = demo(DATA);
    let ids = |packs: &Packs| -> Vec<&str> { packs.list(false, false).packs.iter().map(|p| p.id).collect() };
    assert_eq!(ids(&packs), ["demo"]);
    packs.download("demo:package", false, false).unwrap();
    assert_eq!(settle(&packs, "demo:package"), PackState::Ready { bytes: 11 });
    assert_eq!(ids(&packs), ["demo", "demo:package"]);
    let json = serde_json::to_value(packs.list(false, false)).unwrap();
    assert_eq!(
        json["packs"][1]["state"],
        serde_json::json!({ "kind": "ready", "bytes": 11 })
    );
    assert_eq!(json["packs"][1]["depends"], serde_json::json!(["demo"]));
    packs.remove("demo:package").unwrap();
    assert_eq!(ids(&packs), ["demo"]);
    assert_eq!(packs.download("nope", false, false).unwrap_err().code, "invalid");
    assert_eq!(packs.remove("nope").unwrap_err().code, "invalid");
}

#[test]
fn a_stopped_download_keeps_its_part() {
    let (_dir, packs, _source) = demo(DATA);
    packs.cancel("demo");
    let stop = AtomicBool::new(true);
    let progress = std::sync::atomic::AtomicU64::new(0);
    let memory = Memory {
        data: DATA.to_vec(),
        asked: Mutex::new(Vec::new()),
    };
    let result = crate::intel::models::download(&memory, &DEMO, packs.dir(), &stop, &progress);
    assert_eq!(result, Err(DownloadError::Canceled));
    assert!(packs.dir().join("demo/demo.wasm.part").exists());
}

#[test]
fn head_and_get_carry_the_exact_length_and_a_changed_file_is_checked_again() {
    let (_dir, packs, _source) = demo(DATA);
    packs.download("demo", false, false).unwrap();
    assert_eq!(settle(&packs, "demo"), PackState::Ready { bytes: 11 });
    let head = packs.serve(&Method::HEAD, "/demo/demo.wasm");
    assert_eq!(head.status(), StatusCode::OK);
    assert!(head.body().is_empty());
    assert_eq!(head.headers()["content-length"], "11");
    let get = packs.serve(&Method::GET, "/demo/demo.wasm");
    assert_eq!(get.headers()["content-length"], "11");
    assert_eq!(get.body().as_slice(), DATA);
    // The file passed once. A later change of one byte, at the same size, is still refused.
    thread::sleep(Duration::from_millis(20));
    fs::write(packs.dir().join("demo/demo.wasm"), b"hello World").unwrap();
    assert_eq!(
        packs.serve(&Method::HEAD, "/demo/demo.wasm").status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        packs.serve(&Method::GET, "/demo/demo.wasm").status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn a_partial_pack_stays_partial_while_work_offline_is_on() {
    let (_dir, packs, _source) = demo(DATA);
    fs::create_dir_all(packs.dir().join("demo")).unwrap();
    fs::write(packs.dir().join("demo/demo.wasm.part"), &DATA[..5]).unwrap();
    for (offline, safe_mode) in [(true, false), (false, true)] {
        let list = packs.list(offline, safe_mode);
        assert!(list.blocked.is_some());
        // Still partial, so Remove stays. The list-level `blocked` turns Resume off.
        assert_eq!(
            list.packs[0].state,
            PackState::Partial {
                received_bytes: 5,
                total_bytes: 11
            }
        );
    }
    packs.remove("demo").unwrap();
    assert_eq!(
        packs.list(true, false).packs[0].state,
        PackState::Blocked { reason: "offline" }
    );
}
