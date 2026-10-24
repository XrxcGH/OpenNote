//! Hostile and damaged input: importers return an error or a report, and never panic or hang.
//!
//! Exports from other apps are untrusted files. These tests feed the importers random bytes, random markup,
//! and every corpus file cut short or with bytes flipped.

use std::fs;
use std::path::{Path, PathBuf};

use opennote_interop::testing::{zip_bytes, zip_dir, TestEnv};
use opennote_interop::{
    detect, import, import_csv, import_docx, import_enex, import_html_folder, import_keep_folder,
    import_markdown_folder, import_mht, import_text_folder, ImportEnv, ImportOptions, ImportSink, MemorySink, Report,
    Result,
};
use proptest::prelude::*;

type Importer = fn(&Path, &ImportEnv<'_>, &mut dyn ImportSink) -> Result<Report>;

/// Runs an importer on one file and drops the outcome. It may fail, but it must return.
fn run_on(importer: Importer, dir: &Path, name: &str, bytes: &[u8]) {
    let file = dir.join(name);
    fs::write(&file, bytes).expect("writes");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let _ = importer(&file, &world.env(), &mut sink);
}

fn word_with(document_xml: &[u8]) -> Vec<u8> {
    zip_bytes(&[
        ("[Content_Types].xml", b"<Types/>"),
        ("word/document.xml", document_xml),
    ])
}

proptest! {
    // Failures are not saved beside the source, because the saved seeds would land in the repository.
    #![proptest_config(ProptestConfig { cases: 48, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn random_bytes_never_panic_any_importer(bytes in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let dir = tempfile::tempdir().expect("a temp folder");
        let importers: [(Importer, &str); 8] = [
            (import_markdown_folder, "a.md"),
            (import_html_folder, "a.html"),
            (import_text_folder, "a.txt"),
            (import_csv, "a.csv"),
            (import_enex, "a.enex"),
            (import_mht, "a.mht"),
            (import_docx, "a.docx"),
            (import_keep_folder, "a.json"),
        ];
        for (importer, name) in importers {
            run_on(importer, dir.path(), name, &bytes);
        }
        let _ = detect(&dir.path().join("a.docx"));
    }

    #[test]
    fn random_markup_never_panics_the_html_and_xml_readers(
        parts in proptest::collection::vec(
            prop_oneof![
                Just("<".to_owned()), Just(">".to_owned()), Just("</".to_owned()), Just("/>".to_owned()),
                Just("<p>".to_owned()), Just("<div>".to_owned()), Just("<table>".to_owned()), Just("<td>".to_owned()),
                Just("<img src=\"data:image/png;base64,AAAA\">".to_owned()), Just("<a href=\"#x\">".to_owned()),
                Just("<!--".to_owned()), Just("-->".to_owned()), Just("<script>".to_owned()), Just("&amp;".to_owned()),
                Just("&#x110000;".to_owned()), Just("<![CDATA[".to_owned()), Just("]]>".to_owned()),
                "[a-z =\"'&;#]{0,12}",
            ],
            0..80,
        )
    ) {
        let markup = parts.concat();
        let dir = tempfile::tempdir().expect("a temp folder");
        run_on(import_html_folder, dir.path(), "page.html", markup.as_bytes());
        run_on(import_docx, dir.path(), "doc.docx", &word_with(markup.as_bytes()));
        let enex = format!("<en-export><note><title>t</title><content><![CDATA[{markup}]]></content></note></en-export>");
        run_on(import_enex, dir.path(), "n.enex", enex.as_bytes());
        let mht = format!("Content-Type: text/html\r\n\r\n{markup}");
        run_on(import_mht, dir.path(), "p.mht", mht.as_bytes());
    }
}

/// A tiny deterministic generator, so a failure repeats.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

fn corpus_files() -> Vec<(PathBuf, Importer)> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests");
    vec![
        (root.join("data/sample.enex"), import_enex as Importer),
        (root.join("corpus/onenote-mht/Lecture 3.mht"), import_mht as Importer),
        (
            root.join("corpus/obsidian/Vault/Welcome.md"),
            import_markdown_folder as Importer,
        ),
        (root.join("corpus/html/site/about.html"), import_html_folder as Importer),
        (root.join("corpus/csv/data/People.csv"), import_csv as Importer),
        (
            root.join("corpus/keep/Takeout/Keep/Idea.json"),
            import_keep_folder as Importer,
        ),
    ]
}

#[test]
fn corpus_files_cut_short_or_with_flipped_bytes_still_return() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let mut random = Lcg(7);
    for (path, importer) in corpus_files() {
        let original = fs::read(&path).expect("reads a corpus file");
        let name = path.file_name().expect("a name").to_string_lossy().into_owned();
        for round in 0..24 {
            let mut bytes = original.clone();
            if round % 2 == 0 {
                bytes.truncate((random.next() as usize) % (original.len() + 1));
            } else {
                for _ in 0..8 {
                    let at = (random.next() as usize) % bytes.len().max(1);
                    if let Some(byte) = bytes.get_mut(at) {
                        *byte = (random.next() & 0xff) as u8;
                    }
                }
            }
            run_on(importer, dir.path(), &name, &bytes);
        }
    }
}

#[test]
fn a_damaged_word_file_and_a_damaged_archive_still_return() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let packed = zip_dir(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/word/onenote-section"));
    let mut random = Lcg(11);
    for round in 0..60 {
        let mut bytes = packed.clone();
        match round % 3 {
            0 => bytes.truncate((random.next() as usize) % (packed.len() + 1)),
            1 => {
                for _ in 0..6 {
                    let at = (random.next() as usize) % bytes.len();
                    bytes[at] = (random.next() & 0xff) as u8;
                }
            }
            _ => {
                bytes.drain(..(random.next() as usize) % 64);
            }
        }
        run_on(import_docx, dir.path(), "damaged.docx", &bytes);
        fs::write(dir.path().join("damaged.zip"), &bytes).expect("writes");
        let world = TestEnv::new();
        let _ = import(
            &dir.path().join("damaged.zip"),
            &ImportOptions::default(),
            &world.env(),
            &mut MemorySink::default(),
        );
    }
}

#[test]
fn a_zip_that_claims_to_expand_without_end_is_stopped() {
    // A stored entry whose size field is far larger than its data: the reader must not allocate for it.
    let mut bytes = zip_bytes(&[("word/document.xml", b"<w:document/>")]);
    // The uncompressed size sits at offset 24 of the central directory entry, which follows the file data.
    if let Some(at) = bytes.windows(4).position(|w| w == [0x50, 0x4b, 0x01, 0x02]) {
        bytes[at + 24..at + 28].copy_from_slice(&u32::MAX.to_le_bytes());
    }
    let dir = tempfile::tempdir().expect("a temp folder");
    run_on(import_docx, dir.path(), "bomb.docx", &bytes);
    let world = TestEnv::new();
    let _ = import_text_folder(dir.path(), &world.env(), &mut MemorySink::default());
}
