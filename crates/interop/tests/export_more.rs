//! The other exports: one self-contained web page, a bundle of PDF files, and canceling any of them.

use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use opennote_core::model::{BlockData, Page};
use opennote_interop::run::EventLog;
use opennote_interop::testing::{png_bytes, sample_notebook, TestEnv};
use opennote_interop::{
    export_docx_with, export_files_with, export_html_single, export_pdf_bundle, import_html_folder, CancelToken,
    Control, Event, Format, InteropError, MemorySink, NoPdfRenderer, NoteSource, PageReport, PdfRenderer,
    PreparedPdfRenderer, Result, Scope,
};

/// A renderer that writes a few bytes of fake PDF for each page.
struct FakePdf;

impl PdfRenderer for FakePdf {
    fn render_page(&self, page: &Page, source: &dyn NoteSource, report: &mut PageReport) -> Result<Vec<u8>> {
        if page.title == "Lab report" {
            return Err(InteropError::Missing("the font".to_owned()));
        }
        let pictures = page.assets.values().filter(|a| a.mime.starts_with("image/")).count();
        for asset in page.assets.values() {
            source.asset_bytes(page, asset)?;
        }
        report.came_over_count(pictures, "picture", "pictures");
        Ok(format!("%PDF-1.7 fake for {}", page.title).into_bytes())
    }
}

fn text_of(page: &Page) -> String {
    page.blocks
        .iter()
        .filter_map(|b| match &b.data {
            BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[test]
fn a_page_becomes_one_html_file_with_its_picture_inside() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported =
        export_html_single(&sample.source, Scope::Page(sample.photo), out.path(), &Control::none()).expect("exports");
    assert_eq!(exported.files.len(), 1);
    assert_eq!(
        exported.files[0].file_name().and_then(|n| n.to_str()),
        Some("Photosynthesis.html")
    );
    let html = fs::read_to_string(&exported.files[0]).expect("reads");
    assert!(
        html.contains("<img src=\"data:image/png;base64,"),
        "the picture is inside"
    );
    assert!(!html.contains("assets/"), "nothing refers to another file");
    let report = exported.report.to_markdown();
    assert!(
        report.contains("names of attachments"),
        "the attachment is reported: {report}"
    );

    // The file imports again as one page, picture included.
    let mut sink = MemorySink::default();
    import_html_folder(&exported.files[0], &world.env(), &mut sink).expect("imports");
    assert_eq!(sink.pages.len(), 1);
    let imported = &sink.pages[0].1;
    assert_eq!(imported.page.title, "Photosynthesis");
    assert!(imported.asset_bytes.values().any(|b| b == &png_bytes()));
    assert_eq!(imported.page.tags, ["biology", "exam/unit-3"]);
    assert!(text_of(&imported.page).contains("**thylakoid**"));
}

#[test]
fn a_notebook_becomes_one_html_file_with_contents_and_jump_links() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_html_single(&sample.source, Scope::Notebook, out.path(), &Control::none()).expect("exports");
    let html = fs::read_to_string(&exported.files[0]).expect("reads");
    assert!(html.contains("<nav>") && html.contains(&format!("href=\"#page-{}\"", sample.cells)));
    assert!(html.contains(&format!("<section id=\"page-{}\">", sample.photo)));
    assert_eq!(html.matches("<section id=").count(), 3);
}

#[test]
fn a_pdf_bundle_follows_the_notebook_and_reports_each_page() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported =
        export_pdf_bundle(&sample.source, Scope::Notebook, &FakePdf, out.path(), &Control::none()).expect("exports");
    let names: Vec<String> = exported
        .files
        .iter()
        .map(|p| {
            p.strip_prefix(&exported.root)
                .expect("inside")
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    assert!(names.contains(&"Semester 1/Photosynthesis.pdf".to_owned()), "{names:?}");
    assert!(
        names.contains(&"Semester 1/Cells- the basics.pdf".to_owned())
            || names.iter().any(|n| n.ends_with("basics.pdf")),
        "{names:?}"
    );
    assert!(
        !names.iter().any(|n| n.contains("Lab report")),
        "the page that failed has no file"
    );
    assert!(names.contains(&"index.html".to_owned()));
    let index = fs::read_to_string(exported.root.join("index.html")).expect("reads");
    assert!(index.contains("Photosynthesis.pdf") && !index.contains("Lab"));
    let report = exported.report.to_markdown();
    assert!(
        report.contains("page \"Lab report\"") && report.contains("the font"),
        "{report}"
    );
    assert!(report.contains("1 picture"), "{report}");
    let pdf = fs::read(exported.root.join("Semester 1/Photosynthesis.pdf")).expect("reads");
    assert!(pdf.starts_with(b"%PDF"));
}

#[test]
fn without_a_pdf_writer_the_export_says_so_and_makes_nothing() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let outcome = export_pdf_bundle(
        &sample.source,
        Scope::Notebook,
        &NoPdfRenderer,
        out.path(),
        &Control::none(),
    );
    let Err(InteropError::Unsupported { why, .. }) = outcome else {
        panic!("PDF export is not available yet");
    };
    assert!(why.contains("can't draw pages as PDF"), "{why}");
    assert_eq!(fs::read_dir(out.path()).expect("lists").count(), 0);
}

#[test]
fn pages_the_app_printed_become_a_bundle_and_the_rest_are_reported() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let photo = sample.source.page(sample.photo).expect("the page");
    let mut drawn = std::collections::HashMap::new();
    drawn.insert(
        photo.id,
        b"%PDF-1.7
1 0 obj<<>>endobj
trailer<<>>
%%EOF
"
        .to_vec(),
    );
    let exported = export_pdf_bundle(
        &sample.source,
        Scope::Notebook,
        &PreparedPdfRenderer::new(drawn),
        out.path(),
        &Control::none(),
    )
    .expect("exports");
    let pdfs: Vec<_> = exported
        .files
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "pdf"))
        .collect();
    assert_eq!(pdfs.len(), 1, "only the drawn page: {pdfs:?}");
    assert!(fs::read(pdfs[0]).expect("reads").starts_with(b"%PDF-"));
    let index = fs::read_to_string(exported.root.join("index.html")).expect("an index");
    assert!(index.contains("Photosynthesis.pdf"), "{index}");
    let report = exported.report.to_markdown();
    assert!(report.contains("could not be printed"), "{report}");
}

#[test]
fn bytes_that_are_not_a_whole_pdf_file_are_refused() {
    assert!(PreparedPdfRenderer::looks_like_pdf(b"%PDF-1.4 x %%EOF"));
    assert!(!PreparedPdfRenderer::looks_like_pdf(b"%PDF-1.4 cut off"));
    assert!(!PreparedPdfRenderer::looks_like_pdf(b"<html>%%EOF"));
    assert!(!PreparedPdfRenderer::looks_like_pdf(b""));
}

struct CancelOnSecondStep {
    token: CancelToken,
    steps: AtomicUsize,
}

impl opennote_interop::ProgressSink for CancelOnSecondStep {
    fn event(&self, event: &Event) {
        if matches!(event, Event::Progress(p) if p.done >= 1) && self.steps.fetch_add(1, Ordering::SeqCst) == 0 {
            self.token.cancel();
        }
    }
}

fn canceling() -> Control {
    let token = CancelToken::new();
    Control::new(
        token.clone(),
        Arc::new(CancelOnSecondStep {
            token,
            steps: AtomicUsize::new(0),
        }),
    )
}

#[test]
fn a_canceled_export_deletes_the_folder_it_made() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    for run in 0..3 {
        let out = tempfile::tempdir().expect("a temp folder");
        let outcome = match run {
            0 => export_files_with(
                &sample.source,
                Scope::Notebook,
                Format::Markdown,
                out.path(),
                &canceling(),
            )
            .map(|_| ()),
            1 => export_pdf_bundle(&sample.source, Scope::Notebook, &FakePdf, out.path(), &canceling()).map(|_| ()),
            _ => export_docx_with(&sample.source, Scope::Notebook, out.path(), &canceling()).map(|_| ()),
        };
        assert!(matches!(outcome, Err(InteropError::Canceled)), "run {run}: {outcome:?}");
        assert_eq!(
            fs::read_dir(out.path()).expect("lists").count(),
            0,
            "run {run} left files behind"
        );
    }
}

#[test]
fn an_export_reports_a_step_for_each_page() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let log = Arc::new(EventLog::default());
    let control = Control::new(CancelToken::new(), log.clone());
    export_files_with(&sample.source, Scope::Notebook, Format::Html, out.path(), &control).expect("exports");
    let steps: Vec<(u64, Option<u64>)> = log
        .events()
        .into_iter()
        .filter_map(|e| match e {
            Event::Progress(p) => Some((p.done, p.total)),
            _ => None,
        })
        .collect();
    assert_eq!(steps, [(0, Some(3)), (1, Some(3)), (2, Some(3)), (3, Some(3))]);
}
