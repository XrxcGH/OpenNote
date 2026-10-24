//! Round trips through Word: what goes out as a `.docx` comes back in with the same structure.
//!
//! Word cannot hold everything a page does, so these tests name what survives: titles, sections, headings,
//! formatting, lists, tasks, links between pages, pictures, tables, and dates. They also name what does not:
//! the callout's type, code languages, per-page tags, and the file names of pictures.

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{sample_notebook, TestEnv};
use opennote_interop::{export_docx, import_docx, MemorySink, MemorySource, Scope};

fn pages(sink: &MemorySink) -> Vec<&Page> {
    sink.pages.iter().map(|(_, imported)| &imported.page).collect()
}

fn text(page: &Page) -> String {
    page.blocks
        .iter()
        .filter_map(|b| match &b.data {
            BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn round_trip(source: &MemorySource, world: &TestEnv) -> MemorySink {
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_docx(source, Scope::Notebook, out.path()).expect("exports");
    let mut sink = MemorySink::default();
    import_docx(&exported.files[0], &world.env(), &mut sink).expect("imports");
    sink
}

#[test]
fn a_notebook_exported_to_word_comes_back_with_its_pages_and_sections() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let sink = round_trip(&sample.source, &world);
    let mut sections: Vec<(&str, usize)> = sink
        .sections
        .iter()
        .map(|s| (s.title.as_str(), s.pages.len()))
        .collect();
    sections.sort_unstable();
    assert_eq!(sections, vec![("Lab", 1), ("Semester 1", 2)]);
    let mut titles: Vec<&str> = pages(&sink).iter().map(|p| p.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, ["Cells: the basics", "Lab report", "Photosynthesis"]);
}

#[test]
fn formatting_lists_tasks_links_pictures_and_tables_survive() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let sink = round_trip(&sample.source, &world);
    let by_title = |title: &str| *pages(&sink).iter().find(|p| p.title == title).expect("a page");
    let photo = by_title("Photosynthesis");
    let cells = by_title("Cells: the basics");
    let body = text(photo);
    assert!(body.contains("# Light reactions"), "{body}");
    assert!(body.contains("**thylakoid**") && body.contains("*water*"), "{body}");
    assert!(body.contains("==key terms=="), "{body}");
    assert!(body.contains("[the web](https://example.org/a_b)"), "{body}");
    assert!(
        body.contains("- [x] Read chapter 8") && body.contains("- [ ] Lab write-up"),
        "{body}"
    );
    assert!(
        body.contains("> [!note] Exam hint"),
        "the callout keeps its title: {body}"
    );
    assert!(body.contains("let x = 1;"), "{body}");
    assert!(
        body.contains(&format!("opennote:page/{}", cells.id)),
        "links between pages: {body}"
    );
    assert!(text(cells).contains(&format!("opennote:page/{}", photo.id)));
    assert!(text(cells).contains("1. First") && text(cells).contains("2. Second"));
    assert!(photo.blocks.iter().any(|b| matches!(b.data, BlockData::Image(_))));
    let table = photo
        .blocks
        .iter()
        .find_map(|b| match &b.data {
            BlockData::Table(t) => Some(t),
            _ => None,
        })
        .expect("the table");
    assert!(table.header);
    assert_eq!(table.rows[0].cells[&table.columns[0].id].markdown, "Stage");
    assert_eq!(
        photo.created,
        sample
            .source
            .pages()
            .iter()
            .find(|p| p.title == "Photosynthesis")
            .expect("page")
            .created
    );
}

#[test]
fn a_second_word_round_trip_keeps_the_same_text() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let first = round_trip(&sample.source, &world);
    let again = round_trip(&MemorySource::from_sink(first).expect("a notebook"), &world);
    let plain = |sink: &MemorySink, title: &str| text(pages(sink).iter().find(|p| p.title == title).expect("a page"));
    let first_text = plain(&round_trip(&sample.source, &world), "Photosynthesis");
    let strip_ids = |s: String| {
        let mut out = s;
        for prefix in ["opennote:page/", "asset:"] {
            out = out
                .split(prefix)
                .enumerate()
                .map(|(n, part)| if n == 0 { part } else { part.get(26..).unwrap_or(part) }.to_owned())
                .collect::<Vec<_>>()
                .join(prefix);
        }
        out
    };
    assert_eq!(strip_ids(plain(&again, "Photosynthesis")), strip_ids(first_text));
}
