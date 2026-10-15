use std::{
    fs::{self, File},
    io::{self},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use super::*;

const DATA: &[u8] = b"hello world";
const HELLO_SHA: &str = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
/// `printf 'blob 11\0hello world' | sha1sum`
const HELLO_BLOB: &str = "95d09f2b10159347eece71399a7e2e907ea3df4f";

const SPEC: ModelSpec = ModelSpec {
    id: "test",
    kind: "speech",
    name: "Test",
    detail: "",
    parts: &[Part {
        file: "test.bin",
        size: DATA.len() as u64,
        digest: Digest::Sha256(HELLO_SHA),
        url: "https://example.invalid/test.bin",
    }],
};

const PACK: ModelSpec = ModelSpec {
    id: "pack",
    kind: "translate",
    name: "Pack",
    detail: "",
    parts: &[
        Part {
            file: "pack/one.bin",
            size: DATA.len() as u64,
            digest: Digest::Sha256(HELLO_SHA),
            url: "https://example.invalid/one",
        },
        Part {
            file: "pack/two.json",
            size: DATA.len() as u64,
            digest: Digest::GitBlob(HELLO_BLOB),
            url: "https://example.invalid/two",
        },
    ],
};

/// Serves `data`, honoring a start offset unless `ignore_range` is set, and asks `after` to run first.
struct Memory {
    data: Vec<u8>,
    ignore_range: bool,
    asked: Mutex<Vec<u64>>,
}

impl Source for Memory {
    fn open(&self, _url: &str, from: u64) -> Result<Opened, String> {
        self.asked.lock().unwrap().push(from);
        let start = if self.ignore_range { 0 } else { from as usize };
        Ok(Opened {
            resumed: !self.ignore_range && from > 0,
            reader: Box::new(io::Cursor::new(self.data[start..].to_vec())),
        })
    }
}

fn memory(data: &[u8], ignore_range: bool) -> Memory {
    Memory {
        data: data.to_vec(),
        ignore_range,
        asked: Mutex::new(Vec::new()),
    }
}

#[test]
fn the_catalog_lists_checksums_sizes_and_pinned_https_addresses() {
    for spec in catalog() {
        assert!(!spec.parts.is_empty(), "{}", spec.id);
        assert!(spec.size() <= MAX_MODEL_BYTES, "{}", spec.id);
        for part in spec.parts {
            let expected = match part.digest {
                Digest::Sha256(_) => 64,
                Digest::GitBlob(_) => 40,
            };
            assert_eq!(part.digest.hex().len(), expected, "{}", part.file);
            assert!(
                part.digest.hex().bytes().all(|b| b.is_ascii_hexdigit()),
                "{}",
                part.file
            );
            assert!(part.url.starts_with("https://huggingface.co/"), "{}", part.file);
            assert!(part.url.ends_with(part.file.rsplit('/').next().unwrap()) || spec.kind != "speech");
            assert!(part.size > 0 && part.size <= MAX_MODEL_BYTES, "{}", part.file);
            assert!(
                !part.file.contains("..") && !part.file.starts_with('/'),
                "{}",
                part.file
            );
            if spec.kind == "speech" {
                assert!(part.url.starts_with(SPEECH_HOST), "{}", spec.id);
            } else {
                // Everything else is pinned to a commit, not to a branch that can change under the checksum.
                let revision = part
                    .url
                    .split("/resolve/")
                    .nth(1)
                    .and_then(|rest| rest.split('/').next());
                let revision = revision.expect("a resolve address");
                assert_eq!(revision.len(), 40, "{}", part.url);
                assert!(revision.bytes().all(|b| b.is_ascii_hexdigit()), "{}", part.url);
            }
        }
    }
    let mut ids: Vec<_> = catalog().map(|spec| spec.id).collect();
    ids.sort_unstable();
    let total = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), total);
    for kind in ["speech", "language", "meaning", "translate"] {
        assert!(catalog().any(|spec| spec.kind == kind), "{kind}");
    }
    // No two models write the same file.
    let mut files: Vec<_> = catalog()
        .flat_map(|spec| spec.parts.iter().map(|part| part.file))
        .collect();
    files.sort_unstable();
    let total = files.len();
    files.dedup();
    assert_eq!(files.len(), total);
}

#[test]
fn the_web_previews_pack_list_matches_the_catalog() {
    // Each row of the preview's list reads `['en', 'es', 119006287],`.
    let listed = include_str!("../../../../src/services/intel/packs.ts");
    let mut in_preview: Vec<(String, u64)> = listed
        .lines()
        .filter_map(|line| {
            let row = line.trim().strip_prefix('[')?.strip_suffix("],")?;
            let mut cells = row.split(',').map(|cell| cell.trim().trim_matches('\''));
            let (from, to, size) = (cells.next()?, cells.next()?, cells.next()?);
            Some((format!("translate-{from}-{to}"), size.parse().ok()?))
        })
        .collect();
    let mut in_catalog: Vec<(String, u64)> = catalog()
        .filter(|spec| spec.kind == "translate")
        .map(|spec| (spec.id.to_owned(), spec.size()))
        .collect();
    in_preview.sort();
    in_catalog.sort();
    assert_eq!(in_preview, in_catalog);
}

#[test]
fn a_download_is_kept_after_its_checksum_matches() {
    let dir = tempfile::tempdir().unwrap();
    let progress = AtomicU64::new(0);
    download(
        &memory(DATA, false),
        &SPEC,
        dir.path(),
        &AtomicBool::new(false),
        &progress,
    )
    .unwrap();
    assert_eq!(fs::read(dir.path().join("test.bin")).unwrap(), DATA);
    assert!(!dir.path().join("test.bin.part").exists());
    assert_eq!(progress.load(Ordering::Relaxed), DATA.len() as u64);
}

#[test]
fn a_pack_downloads_every_file_and_checks_each_kind_of_checksum() {
    let dir = tempfile::tempdir().unwrap();
    let progress = AtomicU64::new(0);
    download(
        &memory(DATA, false),
        &PACK,
        dir.path(),
        &AtomicBool::new(false),
        &progress,
    )
    .unwrap();
    assert_eq!(fs::read(dir.path().join("pack/one.bin")).unwrap(), DATA);
    assert_eq!(fs::read(dir.path().join("pack/two.json")).unwrap(), DATA);
    assert_eq!(progress.load(Ordering::Relaxed), PACK.size());
    assert!(is_installed(dir.path(), &PACK));
}

#[test]
fn a_wrong_git_hash_deletes_the_file() {
    const BAD: ModelSpec = ModelSpec {
        id: "bad",
        kind: "translate",
        name: "Bad",
        detail: "",
        parts: &[Part {
            file: "bad/two.json",
            size: DATA.len() as u64,
            digest: Digest::GitBlob("0000000000000000000000000000000000000000"),
            url: "https://example.invalid/two",
        }],
    };
    let dir = tempfile::tempdir().unwrap();
    let result = download(
        &memory(DATA, false),
        &BAD,
        dir.path(),
        &AtomicBool::new(false),
        &AtomicU64::new(0),
    );
    assert_eq!(result, Err(DownloadError::Checksum));
    assert!(!dir.path().join("bad/two.json").exists());
    assert!(!dir.path().join("bad/two.json.part").exists());
}

#[test]
fn a_server_that_sends_more_than_the_published_size_is_cut_off() {
    let dir = tempfile::tempdir().unwrap();
    let mut long = DATA.to_vec();
    long.extend(std::iter::repeat_n(b'x', 1000));
    let result = download(
        &memory(&long, false),
        &SPEC,
        dir.path(),
        &AtomicBool::new(false),
        &AtomicU64::new(0),
    );
    assert_eq!(result, Err(DownloadError::Checksum));
    assert!(!dir.path().join("test.bin").exists());
    assert!(!dir.path().join("test.bin.part").exists());
}

#[test]
fn a_stopped_download_resumes_from_its_part() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("test.bin.part"), &DATA[..5]).unwrap();
    let source = memory(DATA, false);
    download(&source, &SPEC, dir.path(), &AtomicBool::new(false), &AtomicU64::new(0)).unwrap();
    assert_eq!(*source.asked.lock().unwrap(), vec![5]);
    assert_eq!(fs::read(dir.path().join("test.bin")).unwrap(), DATA);
}

#[test]
fn a_server_that_ignores_the_range_restarts_the_file() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("test.bin.part"), &DATA[..5]).unwrap();
    download(
        &memory(DATA, true),
        &SPEC,
        dir.path(),
        &AtomicBool::new(false),
        &AtomicU64::new(0),
    )
    .unwrap();
    assert_eq!(fs::read(dir.path().join("test.bin")).unwrap(), DATA);
}

#[test]
fn a_wrong_checksum_deletes_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let result = download(
        &memory(b"HELLO WORLD", false),
        &SPEC,
        dir.path(),
        &AtomicBool::new(false),
        &AtomicU64::new(0),
    );
    assert_eq!(result, Err(DownloadError::Checksum));
    assert!(!dir.path().join("test.bin").exists());
    assert!(!dir.path().join("test.bin.part").exists());
}

#[test]
fn cancel_keeps_the_part_for_the_next_try() {
    let dir = tempfile::tempdir().unwrap();
    let result = download(
        &memory(DATA, false),
        &SPEC,
        dir.path(),
        &AtomicBool::new(true),
        &AtomicU64::new(0),
    );
    assert_eq!(result, Err(DownloadError::Canceled));
    assert!(dir.path().join("test.bin.part").exists());
    assert!(!dir.path().join("test.bin").exists());
}

#[test]
fn a_short_answer_is_an_error_that_can_resume() {
    let dir = tempfile::tempdir().unwrap();
    let result = download(
        &memory(&DATA[..4], false),
        &SPEC,
        dir.path(),
        &AtomicBool::new(false),
        &AtomicU64::new(0),
    );
    assert!(matches!(result, Err(DownloadError::Network(_))));
    assert_eq!(size_of(&dir.path().join("test.bin.part")), Some(4));
}

#[test]
fn a_blocked_start_does_not_run_and_the_list_shows_what_is_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let models = Models::with_source(dir.path().to_path_buf(), Arc::new(memory(DATA, false)));
    assert_eq!(
        models.start("speech-base-en", Some(DownloadError::Offline)),
        Err(DownloadError::Offline)
    );
    let first = &models.list().models[0];
    assert_eq!((first.state, first.bytes), ("notInstalled", 0));
    let spec = catalog().next().unwrap();
    fs::write(dir.path().join(format!("{}.part", spec.main().file)), b"abc").unwrap();
    let listed = models.list();
    assert_eq!((listed.models[0].state, listed.models[0].bytes), ("partial", 3));
    models.remove(spec.id).unwrap();
    assert_eq!(models.list().models[0].state, "notInstalled");
}

#[test]
fn a_pack_is_installed_only_when_every_file_is_there_and_remove_takes_its_folder() {
    let dir = tempfile::tempdir().unwrap();
    let models = Models::with_source(dir.path().to_path_buf(), Arc::new(memory(DATA, false)));
    let spec = spec_of("translate-en-es").unwrap();
    assert!(models.installed_path(spec.id).is_none());
    for part in spec.parts {
        let path = dir.path().join(part.file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        File::create(&path).unwrap().set_len(part.size).unwrap();
    }
    assert!(models.installed_path(spec.id).is_some());
    let one = dir.path().join(spec.parts[1].file);
    fs::remove_file(&one).unwrap();
    assert!(models.installed_path(spec.id).is_none());
    models.remove(spec.id).unwrap();
    assert!(!dir.path().join("translate-en-es").exists());
}
