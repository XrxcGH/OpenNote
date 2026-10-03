//! The single import entry point: detection, ZIP archives, events, the report page, and the dry run.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use opennote_interop::run::EventLog;
use opennote_interop::testing::{zip_dir, TestEnv};
use opennote_interop::{
    import, preview, CancelToken, Control, Event, ImportOptions, InteropError, MemorySink, Outcome, ProgressSink,
    SourceKind,
};

fn notion_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/notion/Export")
}

fn titles(sink: &MemorySink) -> Vec<String> {
    let mut titles: Vec<String> = sink.pages.iter().map(|(_, p)| p.page.title.clone()).collect();
    titles.sort();
    titles
}

#[test]
fn a_folder_is_detected_imported_and_announced_with_events() {
    let world = TestEnv::new();
    let log = Arc::new(EventLog::default());
    let env = world.env().with_control(Control::new(CancelToken::new(), log.clone()));
    let mut sink = MemorySink::default();
    let report = import(&notion_dir(), &ImportOptions::default(), &env, &mut sink).expect("imports");
    assert_eq!(titles(&sink), ["Biology", "Cell notes", "Dune", "Reading list"]);
    assert_eq!(report.pages.len(), 4);
    assert!(sink.finished);
    let events = log.events();
    assert!(matches!(events.first(), Some(Event::Started { what }) if what == "Import from Export"));
    assert!(matches!(events.last(), Some(Event::Finished { pages: 4 })));
    assert!(events.iter().any(|e| matches!(e, Event::Progress(_))));
}

#[test]
fn a_zip_archive_is_unpacked_to_a_temporary_folder_and_imported() {
    let world = TestEnv::new();
    let dir = tempfile::tempdir().expect("a temp folder");
    let zip = dir.path().join("Workspace export.zip");
    fs::write(&zip, zip_dir(&notion_dir())).expect("writes");
    let mut sink = MemorySink::default();
    import(&zip, &ImportOptions::default(), &world.env(), &mut sink).expect("imports");
    assert_eq!(titles(&sink), ["Biology", "Cell notes", "Dune", "Reading list"]);
    assert_eq!(
        sink.notebook.as_ref().map(|n| n.title.as_str()),
        Some("Workspace export")
    );
    let biology = sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Biology")
        .expect("page");
    assert_eq!(biology.1.asset_bytes.len(), 1, "the picture came out of the archive");
}

#[test]
fn onenote_files_are_refused_with_advice_and_the_job_fails_cleanly() {
    let world = TestEnv::new();
    let log = Arc::new(EventLog::default());
    let env = world.env().with_control(Control::new(CancelToken::new(), log.clone()));
    let dir = tempfile::tempdir().expect("a temp folder");
    let file = dir.path().join("Biology.one");
    fs::write(&file, b"\xe4\x52\x5c\x7b\x8c\xd8\xa7\x4d").expect("writes");
    let mut sink = MemorySink::default();
    let outcome = import(&file, &ImportOptions::default(), &env, &mut sink);
    let Err(InteropError::Unsupported { why, .. }) = outcome else {
        panic!("OneNote files are not supported yet");
    };
    assert!(why.contains(".docx") && why.contains(".mht"), "{why}");
    assert!(matches!(log.events().last(), Some(Event::Failed { .. })));
    assert!(sink.notebook.is_none(), "nothing was started");
}

#[test]
fn the_report_page_is_the_last_section_and_names_what_was_lost() {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let options = ImportOptions {
        report_page: true,
        ..ImportOptions::default()
    };
    import(&notion_dir(), &options, &world.env(), &mut sink).expect("imports");
    let last = sink
        .sections
        .iter()
        .max_by(|a, b| a.order.cmp(&b.order))
        .expect("a section");
    assert_eq!(last.title, "Import report");
    let (_, report_page) = sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Import report")
        .expect("page");
    let text: String = report_page
        .page
        .blocks
        .iter()
        .filter_map(|b| match &b.data {
            opennote_core::model::BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        })
        .collect();
    assert!(text.contains("What changed"), "{text}");
    assert_eq!(sink.pages.len(), 5, "four pages and the report");
}

#[test]
fn a_preview_counts_and_groups_the_losses_and_writes_nothing() {
    let world = TestEnv::new();
    let result = preview(&notion_dir(), &ImportOptions::default(), &world.env()).expect("previews");
    assert_eq!(result.detected.kind, SourceKind::Notion);
    assert_eq!(result.notebook_title, "Export");
    assert_eq!(result.pages, 4);
    assert_eq!(result.sections.len(), 1);
    assert_eq!(result.sections[0].pages, 4);
    assert_eq!(result.assets, 1);
    assert!(result.blocks > 4);
    let skipped: Vec<_> = result.losses.iter().filter(|g| g.outcome == Outcome::Skipped).collect();
    assert!(!skipped.is_empty(), "the repeated database file is a loss");
    assert!(result
        .losses
        .windows(2)
        .all(|w| w[0].outcome == Outcome::Skipped || w[1].outcome != Outcome::Skipped));
    let json = serde_json::to_string(&result).expect("serializes for the interface");
    assert!(json.contains("\"notebookTitle\"") || json.contains("notebook_title"));
}

struct CancelAt {
    token: CancelToken,
    seen: AtomicUsize,
}

impl ProgressSink for CancelAt {
    fn event(&self, event: &Event) {
        if matches!(event, Event::Progress(p) if p.done >= 2) && self.seen.fetch_add(1, Ordering::SeqCst) == 0 {
            self.token.cancel();
        }
    }
}

#[test]
fn canceling_a_preview_stops_it() {
    let world = TestEnv::new();
    let token = CancelToken::new();
    let env = world.env().with_control(Control::new(
        token.clone(),
        Arc::new(CancelAt {
            token,
            seen: AtomicUsize::new(0),
        }),
    ));
    let outcome = preview(&notion_dir(), &ImportOptions::default(), &env);
    assert!(matches!(outcome, Err(InteropError::Canceled)));
}
