//! Small generated notebooks and checks for this crate's tests. Only built for tests, or with the `testing`
//! feature.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use std::collections::HashMap;

use opennote_core::model::{BlockData, DeviceRef, NotebookFile, Page};
use opennote_core::{DeviceId, NotebookId, PageId, SectionId, TestClock, Timestamp};

use crate::doc::parse::{parse, SoftBreaks};
use crate::doc::{Block, Inline};
use crate::page_builder::PageBuilder;
use crate::sink::{ImportEnv, ImportedPage};
use crate::source::MemorySource;
use crate::tree::{section_orders, SectionBuilder};

/// A red pixel, as a PNG file.
const PNG_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/// The bytes of a tiny PNG.
pub fn png_bytes() -> Vec<u8> {
    STANDARD.decode(PNG_BASE64).expect("the PNG constant is valid base64")
}

/// A time on a fixed day, for predictable dates.
pub fn at(text: &str) -> Timestamp {
    Timestamp::parse(text).expect("test times are valid")
}

/// A clock and a device for imports in tests.
pub struct TestEnv {
    /// The clock.
    pub clock: TestClock,
    /// The device.
    pub device: DeviceRef,
}

impl TestEnv {
    /// A clock set to 2026-09-30 and a device named for tests.
    pub fn new() -> TestEnv {
        let clock = TestClock::new(at("2026-09-30T14:00:00.000Z"));
        let device = DeviceRef {
            id: DeviceId::generate(&clock),
            label: "Windows device TEST".to_owned(),
        };
        TestEnv { clock, device }
    }

    /// The environment that imports take.
    pub fn env(&self) -> ImportEnv<'_> {
        ImportEnv::new(&self.clock, self.device.clone())
    }
}

impl Default for TestEnv {
    fn default() -> TestEnv {
        TestEnv::new()
    }
}

/// A notebook with two sections and three pages, and the IDs of what it holds.
pub struct Sample {
    /// The notebook in memory.
    pub source: MemorySource,
    /// The first page, `Photosynthesis`, with every kind of content.
    pub photo: PageId,
    /// The second page, `Cells: the basics`, which links to the first.
    pub cells: PageId,
    /// The section that holds the first two pages.
    pub section: SectionId,
}

/// The pages and their asset bytes, before they go into sections.
fn sample_pages(env: &ImportEnv<'_>) -> (ImportedPage, ImportedPage, ImportedPage) {
    let (created, modified) = (at("2026-01-05T09:30:00Z"), at("2026-02-10T18:45:00Z"));
    let mut photo = PageBuilder::new(env, "Photosynthesis", created, modified);
    let mut cells = PageBuilder::new(env, "Cells: the basics", created, modified);
    let mut lab = PageBuilder::new(env, "Lab report", created, modified);
    let leaf = photo.add_asset("Leaf section.png", None, png_bytes());
    let notes = photo.add_asset("notes.txt", None, b"attached notes".to_vec());
    photo.set_tags(["biology".to_owned(), "exam/unit-3".to_owned()]);
    let markdown = format!(
        "# Light reactions\n\nThe **thylakoid** membrane holds *water*, and ==key terms== stand out. \
         See [Cells](opennote:page/{}) and [the web](https://example.org/a_b).\n\n\
         - [x] Read chapter 8\n- [ ] Lab write-up\n\n> [!tip] Exam hint\n> Learn the Z-scheme diagram.\n\n\
         ```rust\nlet x = 1;\n```\n\nText with ![leaf](asset:{leaf}) inline and 5 \\* 3 = 15.",
        cells.id()
    );
    photo.push_blocks(parse(&markdown, SoftBreaks::Space).blocks);
    photo.push_image(leaf, "Leaf section".to_owned());
    photo.push_file(notes);
    photo.push_blocks(vec![Block::Table {
        header: true,
        rows: vec![
            vec![vec![Inline::text("Stage")], vec![Inline::text("Where it happens")]],
            vec![vec![Inline::text("Light reactions")], vec![Inline::text("Thylakoid")]],
        ],
    }]);
    let back = format!(
        "Back to [Photosynthesis](opennote:page/{}).\n\n1. First\n2. Second",
        photo.id()
    );
    cells.push_blocks(parse(&back, SoftBreaks::Space).blocks);
    lab.push_blocks(parse("Results go here.", SoftBreaks::Space).blocks);
    let finish = |builder: PageBuilder<'_>| builder.finish().expect("the sample page builds");
    (finish(photo), finish(cells), finish(lab))
}

/// Builds the sample notebook.
pub fn sample_notebook(env: &ImportEnv<'_>) -> Sample {
    let (photo, cells, lab) = sample_pages(env);
    let created = at("2026-01-05T09:30:00Z");
    let notebook = NotebookFile::new(NotebookId::generate(env.clock), "Biology", created);
    let mut source = MemorySource::new(notebook);
    let orders = section_orders(2).expect("two keys");
    let mut first = SectionBuilder::new(env, "Semester 1", created);
    let mut second = SectionBuilder::new(env, "Lab", created);
    first.add_page(&photo.page, None);
    first.add_page(&cells.page, None);
    second.add_page(&lab.page, None);
    let (photo_id, cells_id, section) = (photo.page.id, cells.page.id, first.id());
    source.add_page(photo);
    source.add_page(cells);
    source.add_page(lab);
    let mut orders = orders.into_iter();
    source.add_section(first.finish(orders.next().expect("a key")).expect("the section builds"));
    source.add_section(
        second
            .finish(orders.next().expect("a key"))
            .expect("the section builds"),
    );
    Sample {
        source,
        photo: photo_id,
        cells: cells_id,
        section,
    }
}

/// Describes pages in plain text, so pages that were exported and imported again can be compared.
///
/// IDs in links and images are replaced by the titles and file names they stand for. The descriptions come back
/// in title order.
pub fn describe_pages(pages: &[&Page]) -> Vec<String> {
    let titles: HashMap<String, String> = pages.iter().map(|p| (p.id.to_string(), p.title.clone())).collect();
    let mut described: Vec<(String, String)> = pages
        .iter()
        .map(|page| (page.title.clone(), describe(page, &titles)))
        .collect();
    described.sort();
    described.into_iter().map(|(_, text)| text).collect()
}

fn describe(page: &Page, titles: &HashMap<String, String>) -> String {
    let names: HashMap<String, String> = page
        .assets
        .values()
        .map(|a| (a.id.to_string(), a.name.clone()))
        .collect();
    let (created, modified) = (page.created.to_rfc3339(), page.modified.to_rfc3339());
    let mut out = format!(
        "page {:?}\ncreated {created} modified {modified}\ntags {:?}\n",
        page.title, page.tags
    );
    for block in page.blocks.iter() {
        let line = match &block.data {
            BlockData::Text(text) => format!("text: {}", replace_ids(&text.markdown, titles, &names)),
            BlockData::Image(image) => format!(
                "image {:?} of {}",
                image.alt,
                names.get(&image.asset.to_string()).map_or("?", String::as_str)
            ),
            BlockData::File(file) => format!(
                "file {}",
                names.get(&file.asset.to_string()).map_or("?", String::as_str)
            ),
            BlockData::Table(table) => {
                let rows: Vec<Vec<&str>> = table
                    .rows
                    .iter()
                    .map(|row| {
                        table
                            .columns
                            .iter()
                            .map(|c| row.cells.get(&c.id).map_or("", |cell| cell.markdown.as_str()))
                            .collect()
                    })
                    .collect();
                format!("table header {} {rows:?}", table.header)
            }
            other => format!("other {:?}", other),
        };
        out.push_str(&line);
        out.push('\n');
    }
    out
}

/// Replaces `opennote:page/<ID>` and `asset:<ID>` with the page title and the file name.
fn replace_ids(text: &str, titles: &HashMap<String, String>, names: &HashMap<String, String>) -> String {
    let mut out = text.to_owned();
    for (prefix, map) in [("opennote:page/", titles), ("asset:", names)] {
        let mut from = 0;
        while let Some(at) = out[from..].find(prefix).map(|i| i + from) {
            let start = at + prefix.len();
            let id: String = out[start..].chars().take(26).collect();
            let replacement = map.get(&id).cloned().unwrap_or_else(|| "?".to_owned());
            out.replace_range(start..start + id.len(), &replacement);
            from = start + replacement.len();
        }
    }
    out
}

/// Reads the files of a ZIP archive that this crate wrote.
pub fn unzip(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    crate::docx::read_parts(bytes)
}

/// Panics unless the text is well-formed XML.
pub fn assert_well_formed_xml(xml: &str) {
    let mut reader = quick_xml::Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Eof) => return,
            Ok(_) => {}
            Err(error) => panic!("the XML is not well formed: {error}\n{xml}"),
        }
    }
}

/// Packs files into a ZIP archive, for tests that need a Word file or an export archive.
pub fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = crate::docx::zip::ZipWriter::new();
    for (name, data) in files {
        zip.add(name, data).expect("adds a file");
    }
    zip.finish().expect("finishes the archive")
}

/// Packs a folder and everything below it into a ZIP archive, with paths relative to the folder.
pub fn zip_dir(dir: &std::path::Path) -> Vec<u8> {
    fn walk(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<(String, Vec<u8>)>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir).expect("lists").flatten().collect();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                let name = path
                    .strip_prefix(base)
                    .expect("below the base")
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((name, std::fs::read(&path).expect("reads")));
            }
        }
    }
    let mut files = Vec::new();
    walk(dir, dir, &mut files);
    let borrowed: Vec<(&str, &[u8])> = files.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();
    zip_bytes(&borrowed)
}
