//! The fuzz entry points (A4-36) run with stable Rust: on seed files from the corpus, on those seeds cut short or
//! with bytes flipped, and on random bytes. The nightly workflow runs the same entries under cargo-fuzz for
//! much longer. Every entry must return without a panic.

use std::fs;
use std::path::PathBuf;

use opennote_interop::fuzzing;
use opennote_interop::testing::zip_bytes;
use proptest::prelude::*;

#[path = "../fuzz/entries/search.rs"]
mod search_entry;

type Entry = fn(&[u8]);

const ENTRIES: [(&str, Entry); 14] = [
    ("zip", fuzzing::zip),
    ("enex", fuzzing::enex),
    ("docx", fuzzing::docx),
    ("odt", fuzzing::odt),
    ("xlsx", fuzzing::xlsx),
    ("pptx", fuzzing::pptx),
    ("html", fuzzing::html),
    ("mht", fuzzing::mht),
    ("markdown", fuzzing::markdown),
    ("csv", fuzzing::csv),
    ("sqlite", fuzzing::sqlite),
    ("onenote", fuzzing::onenote),
    ("notes_app", fuzzing::notes_app),
    ("search_index", search_entry::search_index),
];

/// A tiny deterministic generator, so a failure repeats.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as usize
    }
}

fn corpus(path: &str) -> Vec<u8> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests");
    fs::read(root.join(path)).expect("reads a corpus file")
}

/// Starting inputs for each entry, like the seeds a fuzzer begins from.
fn seeds(name: &str) -> Vec<Vec<u8>> {
    let para = b"<w:document xmlns:w=\"w\"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>";
    match name {
        "zip" => vec![zip_bytes(&[("a.txt", b"hello"), ("b/c.md", b"# Title")])],
        "enex" => vec![corpus("data/sample.enex")],
        "docx" => vec![para.to_vec()],
        "odt" => vec![concat!(
            "<office:document-content><office:body><office:text>",
            "<text:p>Hi</text:p></office:text></office:body></office:document-content>"
        )
        .as_bytes()
        .to_vec()],
        "xlsx" => vec![concat!(
            "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\">",
            "<is><t>1</t></is></c></row></sheetData></worksheet>"
        )
        .as_bytes()
        .to_vec()],
        "pptx" => vec![concat!(
            "<p:sld xmlns:p=\"p\" xmlns:a=\"a\"><p:cSld><p:spTree><p:sp><p:txBody>",
            "<a:p><a:r><a:t>Slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
        )
        .as_bytes()
        .to_vec()],
        "html" => vec![corpus("corpus/html/site/about.html")],
        "mht" => vec![corpus("corpus/onenote-mht/Lecture 3.mht")],
        "markdown" => vec![corpus("corpus/obsidian/Vault/Welcome.md")],
        "csv" => vec![corpus("corpus/csv/data/People.csv")],
        "sqlite" => vec![corpus("corpus/sticky/LocalState/plum.sqlite")],
        "onenote" => {
            let section = opennote_interop::onenote::write::sample_section();
            let package = opennote_interop::onenote::write::package(&[("a.one", &section)]);
            vec![section, package, corpus("data/onenote/Trip.onepkg")]
        }
        "notes_app" => {
            use opennote_interop::import::notes_apps_fuzzing::fixtures;
            vec![
                fixtures::notability_note(),
                fixtures::goodnotes_document(),
                fixtures::samsung_note(),
                fixtures::session_plist(),
            ]
        }
        _ => vec![b"title tag:one \"a phrase\" AND (b OR c) .*[x]".to_vec()],
    }
}

#[test]
fn every_entry_returns_on_its_seeds_cut_short_or_with_flipped_bytes() {
    let mut random = Lcg(11);
    for (name, entry) in ENTRIES {
        for seed in seeds(name) {
            entry(&seed);
            for round in 0..12 {
                let mut bytes = seed.clone();
                if round % 2 == 0 {
                    bytes.truncate(random.next() % (seed.len() + 1));
                } else {
                    for _ in 0..6 {
                        let at = random.next() % bytes.len().max(1);
                        if let Some(byte) = bytes.get_mut(at) {
                            *byte = (random.next() & 0xff) as u8;
                        }
                    }
                }
                entry(&bytes);
            }
        }
    }
}

/// Every crash the nightly fuzzer found and that was fixed, kept in `fuzz/regressions/<entry>/`. A crash fixed
/// once stays fixed.
#[test]
fn past_crashes_never_panic() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fuzz")
        .join("regressions");
    let mut replayed = 0;
    for (name, entry) in ENTRIES {
        let Ok(files) = fs::read_dir(root.join(name)) else {
            continue;
        };
        for file in files {
            let path = file.expect("lists a regression").path();
            entry(&fs::read(&path).expect("reads a regression"));
            replayed += 1;
        }
    }
    assert!(replayed > 0, "the regressions folder holds the fixed crashes");
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 16, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn every_entry_returns_on_random_bytes(bytes in proptest::collection::vec(any::<u8>(), 0..1024)) {
        for (_, entry) in ENTRIES {
            entry(&bytes);
        }
    }
}
