//! Progress and cancel: imports report their steps, stop at a checkpoint, and leave nothing behind.

use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use opennote_interop::run::EventLog;
use opennote_interop::testing::TestEnv;
use opennote_interop::{
    import_enex_reader, import_markdown_folder, CancelToken, Control, Event, InteropError, MemorySink, Phase,
    ProgressSink, Unit,
};

/// Cancels a token once it has seen a number of progress events.
struct CancelAfter {
    token: CancelToken,
    after: usize,
    seen: AtomicUsize,
}

impl ProgressSink for CancelAfter {
    fn event(&self, event: &Event) {
        if matches!(event, Event::Progress(_)) && self.seen.fetch_add(1, Ordering::SeqCst) + 1 >= self.after {
            self.token.cancel();
        }
    }
}

fn vault(notes: usize) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temp folder");
    for n in 0..notes {
        fs::write(
            dir.path().join(format!("Note {n:02}.md")),
            format!("Text of note {n}.\n"),
        )
        .expect("writes");
    }
    dir
}

#[test]
fn a_markdown_import_reports_one_step_for_each_note() {
    let world = TestEnv::new();
    let log = Arc::new(EventLog::default());
    let control = Control::new(CancelToken::new(), log.clone());
    let dir = vault(5);
    let mut sink = MemorySink::default();
    let env = world.env().with_control(control);
    import_markdown_folder(dir.path(), &env, &mut sink).expect("imports");
    assert!(sink.finished && !sink.aborted);
    let steps: Vec<_> = log
        .events()
        .into_iter()
        .filter_map(|e| match e {
            Event::Progress(p) if p.phase == Phase::Converting && p.unit == Unit::Items => Some((p.done, p.total)),
            _ => None,
        })
        .collect();
    assert_eq!(
        steps,
        vec![
            (0, Some(5)),
            (1, Some(5)),
            (2, Some(5)),
            (3, Some(5)),
            (4, Some(5)),
            (5, Some(5))
        ]
    );
}

#[test]
fn canceling_halfway_stops_the_import_and_aborts_the_sink() {
    let world = TestEnv::new();
    let token = CancelToken::new();
    let trigger = Arc::new(CancelAfter {
        token: token.clone(),
        after: 3,
        seen: AtomicUsize::new(0),
    });
    let env = world.env().with_control(Control::new(token, trigger));
    let dir = vault(10);
    let mut sink = MemorySink::default();
    let outcome = import_markdown_folder(dir.path(), &env, &mut sink);
    assert!(matches!(outcome, Err(InteropError::Canceled)));
    assert!(sink.aborted && !sink.finished);
    assert!(
        sink.notebook.is_none() && sink.pages.is_empty(),
        "nothing is left behind"
    );
}

#[test]
fn an_enex_import_follows_the_bytes_and_can_be_canceled() {
    let world = TestEnv::new();
    let mut enex = String::from("<?xml version=\"1.0\"?><en-export>");
    for n in 0..6 {
        enex.push_str(&format!(
            "<note><title>Note {n}</title><content><![CDATA[<en-note><div>Body {n}</div></en-note>]]></content>\
             <created>20240105T143000Z</created></note>"
        ));
    }
    enex.push_str("</en-export>");
    let log = Arc::new(EventLog::default());
    let env = world.env().with_control(Control::new(CancelToken::new(), log.clone()));
    let mut sink = MemorySink::default();
    import_enex_reader(enex.as_bytes(), "Notes", &env, &mut sink).expect("imports");
    let byte_steps = log
        .events()
        .iter()
        .filter(|e| matches!(e, Event::Progress(p) if p.unit == Unit::Bytes))
        .count();
    assert!(byte_steps >= 6, "one progress event for each note: {byte_steps}");

    let token = CancelToken::new();
    token.cancel();
    let env = world.env().with_control(Control::with_cancel(token));
    let mut sink = MemorySink::default();
    let outcome = import_enex_reader(enex.as_bytes(), "Notes", &env, &mut sink);
    assert!(matches!(outcome, Err(InteropError::Canceled)));
    assert!(sink.aborted);
}
