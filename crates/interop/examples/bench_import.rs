//! Times imports and exports of a large notebook, and prints the results as a Markdown table.
//!
//! Run it from an optimized build, because a debug build is many times slower and its times mean nothing:
//!
//! ```text
//! cargo run --profile perf -p opennote-interop --example bench_import -- --dir D:\bench --pages 1000
//! ```
//!
//! Every scenario runs three times and the table shows the middle time and the fastest. `--only <text>` runs just
//! the scenarios whose names contain the text. Memory is the most heap that the scenario
//! held at once above what it started with, counted by a wrapper around the system allocator.

use std::alloc::{GlobalAlloc, Layout, System};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use opennote_core::model::{DeviceRef, Page};
use opennote_core::{DeviceId, SystemClock};
use opennote_interop::{
    export_docx, export_files, export_html_single, export_pdf_bundle, import_docx, import_enex, import_html_folder,
    import_markdown_folder, preview, Control, DiskSink, DiskSource, Format, ImportEnv, ImportOptions, ImportSink,
    MemorySink, MemorySource, NoteSource, PageReport, PdfRenderer, Scope,
};

/// Counts the heap bytes in use and the most that were in use at once.
struct Counting;

static CURRENT: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

// SAFETY: every method calls the system allocator with the same arguments and only counts the sizes.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            let now = CURRENT.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
        CURRENT.fetch_sub(layout.size(), Ordering::Relaxed);
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let moved = unsafe { System.realloc(ptr, layout, new_size) };
        if !moved.is_null() {
            if new_size >= layout.size() {
                let now = CURRENT.fetch_add(new_size - layout.size(), Ordering::Relaxed) + (new_size - layout.size());
                PEAK.fetch_max(now, Ordering::Relaxed);
            } else {
                CURRENT.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
            }
        }
        moved
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// A tiny PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
    0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x84, 0x01, 0x80, 0x84, 0xa9, 0x8c,
    0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

struct Args {
    dir: PathBuf,
    pages: usize,
    /// Runs only the scenarios whose names contain this text, ignoring case.
    only: Option<String>,
}

fn args() -> Args {
    let mut dir = std::env::temp_dir().join("opennote-bench-import");
    let mut pages = 1000;
    let mut only = None;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--dir" => dir = it.next().map(PathBuf::from).unwrap_or(dir),
            "--pages" => pages = it.next().and_then(|n| n.parse().ok()).unwrap_or(pages),
            "--only" => only = it.next().map(|n| n.to_lowercase()),
            _ => {}
        }
    }
    Args { dir, pages, only }
}

/// The text a scenario's name must contain to run, set once from `--only`.
static ONLY: OnceLock<Option<String>> = OnceLock::new();

/// What one scenario measured.
struct Row {
    /// Whether `--only` left the scenario out.
    skipped: bool,
    name: String,
    pages: usize,
    /// The middle of three runs.
    time: Duration,
    /// The fastest of three runs, which is the least disturbed by other work on the machine.
    best: Duration,
    peak: usize,
    note: String,
}

/// Runs a scenario three times and keeps the middle time and the highest memory.
fn measure(name: &str, pages: usize, note: &str, mut run: impl FnMut() -> Result<(), String>) -> Row {
    let wanted = ONLY
        .get()
        .and_then(Option::as_ref)
        .is_none_or(|only| name.to_lowercase().contains(only.as_str()));
    if !wanted {
        return Row {
            skipped: true,
            name: name.to_owned(),
            pages,
            time: Duration::ZERO,
            best: Duration::ZERO,
            peak: 0,
            note: note.to_owned(),
        };
    }
    let mut times = Vec::new();
    let mut peak = 0;
    for _ in 0..3 {
        let start_bytes = CURRENT.load(Ordering::Relaxed);
        PEAK.store(start_bytes, Ordering::Relaxed);
        let start = Instant::now();
        if let Err(error) = run() {
            panic!("{name} failed: {error}");
        }
        times.push(start.elapsed());
        peak = peak.max(PEAK.load(Ordering::Relaxed).saturating_sub(start_bytes));
    }
    times.sort();
    Row {
        skipped: false,
        name: name.to_owned(),
        pages,
        time: times[1],
        best: times[0],
        peak,
        note: note.to_owned(),
    }
}

fn text_note(n: usize, total: usize) -> String {
    let mut body = format!(
        "---\ntags: [bench, topic-{}]\ncreated: 2025-0{}-1{} 09:30:00\nupdated: 2025-1{}-2{} 18:00:00\n---\n# Note {n}\n\n",
        n % 20,
        1 + n % 9,
        n % 10,
        n % 3,
        n % 10
    );
    body.push_str(&format!(
        "This is note {n} of {total}. It has **bold**, *italic*, and ==highlighted== text, a [[Note {}]] link, and a \
         [link to the web](https://example.org/{n}) that goes nowhere. #bench\n\n",
        (n + 1) % total
    ));
    body.push_str(
        "## Details\n\n- first point\n- second point\n  - nested point\n- [x] a done task\n- [ ] an open task\n\n",
    );
    body.push_str("1. step one\n2. step two\n\n> [!tip] Remember\n> Notes are for reading later.\n\n");
    body.push_str("| Column A | Column B |\n|---|---|\n| one | two |\n| three | four |\n\n");
    for line in 0..8 {
        body.push_str(&format!(
            "Line {line} of the body talks about topic {} at some length, so that the note has a realistic size.\n\n",
            n % 20
        ));
    }
    body.push_str("```rust\nfn main() {\n    println!(\"hello\");\n}\n```\n");
    if n.is_multiple_of(10) {
        body.push_str("\n![picture](pics/pixel.png)\n");
    }
    body
}

/// Writes `pages` Markdown notes in 20 folders, with a picture for every tenth.
fn make_markdown(root: &Path, pages: usize) {
    fs::create_dir_all(root.join("pics")).expect("creates");
    fs::write(root.join("pics/pixel.png"), PNG).expect("writes");
    for n in 0..pages {
        let folder = root.join(format!("Section {:02}", n % 20));
        fs::create_dir_all(&folder).expect("creates");
        fs::write(folder.join(format!("Note {n}.md")), text_note(n, pages)).expect("writes");
    }
}

/// Writes `pages` notes as one ENEX file.
fn make_enex(path: &Path, pages: usize) {
    let mut out =
        String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<en-export export-date=\"20250101T000000Z\">\n");
    for n in 0..pages {
        let mut content = format!("<en-note><div><b>Note {n}</b></div><div>Body of note {n} with <i>style</i>.</div>");
        for line in 0..10 {
            content.push_str(&format!(
                "<div>Line {line} talks about topic {} at some length.</div>",
                n % 20
            ));
        }
        content.push_str("<ul><li>first</li><li>second</li></ul><div><en-todo checked=\"true\"/>done</div></en-note>");
        out.push_str(&format!(
            "<note><title>Note {n}</title><created>2025010{}T120000Z</created><updated>20250201T120000Z</updated>\
             <tag>bench</tag><tag>topic-{}</tag><content><![CDATA[{content}]]></content></note>\n",
            1 + n % 9,
            n % 20
        ));
    }
    out.push_str("</en-export>\n");
    fs::write(path, out).expect("writes");
}

fn env_for<'a>(clock: &'a SystemClock, device: &DeviceRef) -> ImportEnv<'a> {
    ImportEnv::new(clock, device.clone())
}

/// A renderer that makes a 12 KB file for each page.
struct FakePdf;

impl PdfRenderer for FakePdf {
    fn render_page(
        &self,
        page: &Page,
        _source: &dyn NoteSource,
        _report: &mut PageReport,
    ) -> opennote_interop::Result<Vec<u8>> {
        let mut bytes = format!("%PDF-1.7 {}\n", page.title).into_bytes();
        bytes.resize(12 * 1024, b' ');
        Ok(bytes)
    }
}

fn clean(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).expect("creates");
}

fn dir_bytes(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => dir_bytes(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

/// What every scenario shares: the clock, the device, and the folders.
struct Bench {
    clock: SystemClock,
    device: DeviceRef,
    dir: PathBuf,
    pages: usize,
    rows: Vec<Row>,
}

impl Bench {
    fn env(&self) -> ImportEnv<'_> {
        env_for(&self.clock, &self.device)
    }

    fn time(&mut self, name: &str, note: &str, run: impl FnMut() -> Result<(), String>) {
        let row = measure(name, self.pages, note, run);
        self.rows.push(row);
    }
}

/// The imports that start from files made for the benchmark.
fn import_scenarios(bench: &mut Bench, markdown: &Path, enex: &Path) {
    let this = &*bench;
    let in_memory = measure("Import Markdown folder, in memory", this.pages, "convert only", || {
        let mut sink = MemorySink::default();
        import_markdown_folder(markdown, &this.env(), &mut sink).map_err(|e| e.to_string())?;
        Ok(())
    });
    let library = this.dir.join("library");
    let through_core = measure(
        "Import Markdown folder, through the core",
        this.pages,
        "writes a notebook folder",
        || {
            clean(&library);
            let mut sink = DiskSink::standard(&library);
            import_markdown_folder(markdown, &this.env(), &mut sink).map_err(|e| e.to_string())?;
            Ok(())
        },
    );
    let dry_run = measure(
        "Dry run of the Markdown folder",
        this.pages,
        "preview, writes nothing",
        || {
            preview(markdown, &ImportOptions::default(), &this.env()).map_err(|e| e.to_string())?;
            Ok(())
        },
    );
    let evernote = measure("Import ENEX file, in memory", this.pages, "one file", || {
        let mut sink = MemorySink::default();
        import_enex(enex, &this.env(), &mut sink).map_err(|e| e.to_string())?;
        Ok(())
    });
    bench.rows.extend([in_memory, through_core, dry_run, evernote]);
}

/// The exports of a notebook that lives on disk, and the imports of what they wrote.
fn export_scenarios(bench: &mut Bench, disk: &DiskSource) {
    let root = bench.dir.join("exports");
    let fresh = |out: &Path| -> PathBuf {
        clean(out);
        out.to_path_buf()
    };
    bench.time("Read every page of the notebook", "no conversion, no writes", || {
        for section in disk.sections() {
            for entry in &section.pages {
                disk.page(entry.id).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    });
    bench.time("Export Markdown folder", "from the notebook on disk", || {
        export_files(disk, Scope::Notebook, Format::Markdown, &fresh(&root))
            .map(|_| ())
            .map_err(|e| e.to_string())
    });
    bench.time("Export HTML bundle", "pages, assets, and an index", || {
        export_files(disk, Scope::Notebook, Format::Html, &fresh(&root))
            .map(|_| ())
            .map_err(|e| e.to_string())
    });
    bench.time("Export one Word file", "all pages in one .docx", || {
        export_docx(disk, Scope::Notebook, &fresh(&root))
            .map(|_| ())
            .map_err(|e| e.to_string())
    });
    bench.time("Export one web page file", "pictures embedded", || {
        export_html_single(disk, Scope::Notebook, &fresh(&root), &Control::none())
            .map(|_| ())
            .map_err(|e| e.to_string())
    });
    bench.time("Export PDF bundle", "12 KB per page, stand-in renderer", || {
        export_pdf_bundle(disk, Scope::Notebook, &FakePdf, &fresh(&root), &Control::none())
            .map(|_| ())
            .map_err(|e| e.to_string())
    });
}

/// Imports what the exports wrote, which is the round trip at this size.
fn reimport_scenarios(bench: &mut Bench, disk: &DiskSource) {
    let root = bench.dir.join("exports");
    clean(&root);
    let html = export_files(disk, Scope::Notebook, Format::Html, &root).expect("exports");
    let word_root = bench.dir.join("word");
    clean(&word_root);
    let word = export_docx(disk, Scope::Notebook, &word_root).expect("exports");
    let (html_root, word_file) = (html.root, word.files[0].clone());
    let this = &*bench;
    let from_html = measure(
        "Import HTML bundle, in memory",
        this.pages,
        "OpenNote's own export",
        || {
            let mut sink = MemorySink::default();
            import_html_folder(&html_root, &this.env(), &mut sink).map_err(|e| e.to_string())?;
            Ok(())
        },
    );
    let from_word = measure(
        "Import one Word file, in memory",
        this.pages,
        "pages cut at titles",
        || {
            let mut sink = MemorySink::default();
            import_docx(&word_file, &this.env(), &mut sink).map_err(|e| e.to_string())?;
            Ok(())
        },
    );
    bench.rows.extend([from_html, from_word]);
}

/// Writing a finished notebook to the core, with no conversion in the way.
fn write_scenario(bench: &mut Bench, markdown: &Path) {
    let mut memory = MemorySink::default();
    import_markdown_folder(markdown, &bench.env(), &mut memory).expect("imports");
    let copy = MemorySource::from_sink(memory).expect("a notebook");
    let library = bench.dir.join("copy-library");
    bench.time("Write an in-memory notebook through the core", "no conversion", || {
        clean(&library);
        let mut sink = DiskSink::standard(&library);
        copy.write_to(&mut sink).map_err(|e| e.to_string())?;
        sink.finish().map_err(|e| e.to_string())
    });
}

fn print_table(rows: &[Row], pages: usize, source_bytes: u64, notebook_bytes: u64) {
    let mib = 1_048_576.0;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Source: {pages} Markdown notes, {:.1} MiB. Notebook on disk: {:.1} MiB.\n",
        source_bytes as f64 / mib,
        notebook_bytes as f64 / mib
    );
    let _ = writeln!(
        out,
        "| Scenario | Pages | Time | Best of 3 | Pages per second | Peak memory | Note |"
    );
    let _ = writeln!(out, "|---|---|---|---|---|---|---|");
    for row in rows.iter().filter(|row| !row.skipped) {
        let seconds = row.time.as_secs_f64();
        let _ = writeln!(
            out,
            "| {} | {} | {:.2} s | {:.2} s | {:.0} | {:.1} MiB | {} |",
            row.name,
            row.pages,
            seconds,
            row.best.as_secs_f64(),
            row.pages as f64 / seconds,
            row.peak as f64 / mib,
            row.note
        );
    }
    println!("{out}");
}

fn main() {
    let Args { dir, pages, only } = args();
    let _ = ONLY.set(only);
    if cfg!(debug_assertions) {
        eprintln!("this is a debug build, so its times mean nothing. Run it with `--profile perf`.");
        std::process::exit(2);
    }
    clean(&dir);
    let clock = SystemClock::new();
    let device = DeviceRef {
        id: DeviceId::generate(&clock),
        label: "Windows device BENCH".to_owned(),
    };
    let (markdown, enex) = (dir.join("markdown"), dir.join("notes.enex"));
    make_markdown(&markdown, pages);
    make_enex(&enex, pages);
    let source_bytes = dir_bytes(&markdown);
    let mut bench = Bench {
        clock,
        device,
        dir: dir.clone(),
        pages,
        rows: Vec::new(),
    };
    import_scenarios(&mut bench, &markdown, &enex);

    // The notebook that the exports start from is written to disk through the core.
    let library = dir.join("notebook-library");
    clean(&library);
    let mut sink = DiskSink::standard(&library);
    import_markdown_folder(&markdown, &bench.env(), &mut sink).expect("imports the notebook");
    let notebook_dir = sink.notebook_dir().expect("finished").to_path_buf();
    let disk = DiskSource::open(&notebook_dir).expect("opens the notebook");
    let notebook_bytes = dir_bytes(&notebook_dir);

    export_scenarios(&mut bench, &disk);
    reimport_scenarios(&mut bench, &disk);
    write_scenario(&mut bench, &markdown);
    print_table(&bench.rows, pages, source_bytes, notebook_bytes);
}
