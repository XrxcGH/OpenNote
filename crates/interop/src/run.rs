//! Progress and cancel for imports and exports.
//!
//! Every long job takes a [`Control`]. The job calls [`Control::checkpoint`] between units of work, such as
//! pages, and stops with [`crate::InteropError::Canceled`] when the person pressed Cancel. It calls
//! [`Control::step`] after each unit, and the app's [`ProgressSink`] turns those calls into progress events for
//! the interface. A [`Control`] is cheap to clone, and the [`CancelToken`] inside it can be canceled from any
//! thread.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;

use crate::error::{InteropError, Result};

/// What a job is doing now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Looking through the source to count what is there.
    Scanning,
    /// Reading the source and converting it.
    Converting,
    /// Writing the result.
    Writing,
}

/// What the numbers of a [`Progress`] count.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    /// Pages, notes, or files.
    Items,
    /// Bytes of the source that were read.
    Bytes,
}

/// A snapshot of a job, for a progress bar.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Progress {
    /// What the job is doing.
    pub phase: Phase,
    /// What `done` and `total` count.
    pub unit: Unit,
    /// How much is finished.
    pub done: u64,
    /// How much there is, when the job knows. An ENEX file, for one, is measured in bytes.
    pub total: Option<u64>,
    /// The page or file being worked on, or an empty string.
    pub current: String,
}

/// The events of a job, in order: one `Started`, any number of `Progress`, then exactly one of the rest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum Event {
    /// The job began. `what` names it, such as `Import from Evernote`.
    Started {
        /// The name of the job.
        what: String,
    },
    /// The job moved on.
    Progress(Progress),
    /// The job finished. Pages that lost something are counted in the report, not here.
    Finished {
        /// How many pages the job handled.
        pages: u64,
    },
    /// The person canceled, and the job stopped. Whatever it had written is gone.
    Canceled,
    /// The job failed.
    Failed {
        /// A message that says what went wrong.
        message: String,
    },
}

/// Receives the events of a job. The app implements it to send events to the interface.
pub trait ProgressSink: Send + Sync {
    /// Called for each event, on the thread that runs the job.
    fn event(&self, event: &Event);
}

/// A flag that a job checks between units of work. Clones share the flag.
#[derive(Clone, Debug, Default)]
pub struct CancelToken {
    flag: Arc<AtomicBool>,
}

impl CancelToken {
    /// A token that nobody has canceled.
    pub fn new() -> CancelToken {
        CancelToken::default()
    }

    /// Asks the job to stop at its next checkpoint. Safe to call from any thread, and more than once.
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    /// Whether Cancel was pressed.
    pub fn is_canceled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// A cancel flag and a place to send progress, handed to a job.
#[derive(Clone)]
pub struct Control {
    cancel: CancelToken,
    sink: Option<Arc<dyn ProgressSink>>,
    counters: Arc<Counters>,
}

#[derive(Default)]
struct Counters {
    done: AtomicU64,
    total: AtomicU64,
    has_total: AtomicBool,
    bytes: AtomicBool,
}

impl std::fmt::Debug for Control {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Control")
            .field("canceled", &self.cancel.is_canceled())
            .field("reports_progress", &self.sink.is_some())
            .finish()
    }
}

impl Default for Control {
    fn default() -> Control {
        Control::none()
    }
}

impl Control {
    /// A control that never cancels and reports nothing, for tests and tools.
    pub fn none() -> Control {
        Control {
            cancel: CancelToken::new(),
            sink: None,
            counters: Arc::new(Counters::default()),
        }
    }

    /// A control with a cancel token and a progress sink.
    pub fn new(cancel: CancelToken, sink: Arc<dyn ProgressSink>) -> Control {
        Control {
            cancel,
            sink: Some(sink),
            counters: Arc::new(Counters::default()),
        }
    }

    /// A control that only watches a cancel token.
    pub fn with_cancel(cancel: CancelToken) -> Control {
        Control {
            cancel,
            sink: None,
            counters: Arc::new(Counters::default()),
        }
    }

    /// The token that cancels this control's job.
    pub fn token(&self) -> &CancelToken {
        &self.cancel
    }

    /// Fails with [`InteropError::Canceled`] after Cancel was pressed. Jobs call this between units of work.
    pub fn checkpoint(&self) -> Result<()> {
        if self.cancel.is_canceled() {
            Err(InteropError::Canceled)
        } else {
            Ok(())
        }
    }

    /// Sends an event, if anyone listens.
    pub fn emit(&self, event: &Event) {
        if let Some(sink) = &self.sink {
            sink.event(event);
        }
    }

    /// Starts counting `total` items, or an unknown number of them, in a phase.
    pub fn begin(&self, phase: Phase, unit: Unit, total: Option<u64>) {
        self.counters.done.store(0, Ordering::SeqCst);
        self.counters.total.store(total.unwrap_or(0), Ordering::SeqCst);
        self.counters.has_total.store(total.is_some(), Ordering::SeqCst);
        self.counters.bytes.store(unit == Unit::Bytes, Ordering::SeqCst);
        self.emit_progress(phase, String::new());
    }

    /// Counts `amount` more finished, and tells the sink. `current` names the page or file just handled.
    pub fn step(&self, phase: Phase, amount: u64, current: &str) {
        self.counters.done.fetch_add(amount, Ordering::SeqCst);
        self.emit_progress(phase, current.to_owned());
    }

    /// Sets the finished count to `done`, for jobs that read a stream and know how far they are.
    pub fn set_done(&self, phase: Phase, done: u64, current: &str) {
        self.counters.done.store(done, Ordering::SeqCst);
        self.emit_progress(phase, current.to_owned());
    }

    /// How much is finished so far.
    pub fn done(&self) -> u64 {
        self.counters.done.load(Ordering::SeqCst)
    }

    fn emit_progress(&self, phase: Phase, current: String) {
        if self.sink.is_none() {
            return;
        }
        let unit = if self.counters.bytes.load(Ordering::SeqCst) {
            Unit::Bytes
        } else {
            Unit::Items
        };
        let total = self
            .counters
            .has_total
            .load(Ordering::SeqCst)
            .then(|| self.counters.total.load(Ordering::SeqCst));
        self.emit(&Event::Progress(Progress {
            phase,
            unit,
            done: self.counters.done.load(Ordering::SeqCst),
            total,
            current,
        }));
    }

    /// Runs a job under the protocol: `Started`, the job's own progress, then `Finished`, `Canceled`, or
    /// `Failed`. The result is returned as it is.
    pub fn run<T>(&self, what: &str, pages: impl Fn(&T) -> u64, job: impl FnOnce(&Control) -> Result<T>) -> Result<T> {
        self.emit(&Event::Started { what: what.to_owned() });
        let result = job(self);
        match &result {
            Ok(value) => self.emit(&Event::Finished { pages: pages(value) }),
            Err(InteropError::Canceled) => self.emit(&Event::Canceled),
            Err(error) => self.emit(&Event::Failed {
                message: error.to_string(),
            }),
        }
        result
    }
}

/// A progress sink that keeps every event, for tests.
#[derive(Debug, Default)]
pub struct EventLog {
    events: std::sync::Mutex<Vec<Event>>,
}

impl EventLog {
    /// The events so far.
    pub fn events(&self) -> Vec<Event> {
        self.events.lock().map(|events| events.clone()).unwrap_or_default()
    }
}

impl ProgressSink for EventLog {
    fn event(&self, event: &Event) {
        if let Ok(mut events) = self.events.lock() {
            events.push(event.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_control_never_cancels() {
        let control = Control::none();
        assert!(control.checkpoint().is_ok());
        control.step(Phase::Converting, 1, "page");
        assert_eq!(control.done(), 1);
    }

    #[test]
    fn canceling_a_token_stops_every_clone() {
        let token = CancelToken::new();
        let control = Control::with_cancel(token.clone());
        let clone = control.clone();
        assert!(clone.checkpoint().is_ok());
        token.cancel();
        assert!(matches!(control.checkpoint(), Err(InteropError::Canceled)));
        assert!(matches!(clone.checkpoint(), Err(InteropError::Canceled)));
    }

    #[test]
    fn progress_carries_the_phase_unit_and_total() {
        let log = Arc::new(EventLog::default());
        let control = Control::new(CancelToken::new(), log.clone());
        control.begin(Phase::Converting, Unit::Items, Some(3));
        control.step(Phase::Converting, 1, "Cells");
        control.begin(Phase::Writing, Unit::Bytes, None);
        let events = log.events();
        assert_eq!(events.len(), 3);
        let Event::Progress(second) = &events[1] else {
            panic!("a progress event");
        };
        assert_eq!((second.done, second.total, second.unit), (1, Some(3), Unit::Items));
        assert_eq!(second.current, "Cells");
        let Event::Progress(third) = &events[2] else {
            panic!("a progress event");
        };
        assert_eq!((third.done, third.total, third.unit), (0, None, Unit::Bytes));
    }

    #[test]
    fn run_reports_how_a_job_ended() {
        let log = Arc::new(EventLog::default());
        let control = Control::new(CancelToken::new(), log.clone());
        let ok: Result<u64> = control.run("Import", |n| *n, |_| Ok(7));
        assert!(ok.is_ok());
        let canceled: Result<u64> = control.run("Import", |n| *n, |_| Err(InteropError::Canceled));
        assert!(canceled.is_err());
        let failed: Result<u64> = control.run("Import", |n| *n, |_| Err(InteropError::Missing("page".to_owned())));
        assert!(failed.is_err());
        let kinds: Vec<&str> = log
            .events()
            .iter()
            .map(|e| match e {
                Event::Started { .. } => "started",
                Event::Finished { .. } => "finished",
                Event::Canceled => "canceled",
                Event::Failed { .. } => "failed",
                Event::Progress(_) => "progress",
            })
            .collect();
        assert_eq!(
            kinds,
            ["started", "finished", "started", "canceled", "started", "failed"]
        );
    }

    #[test]
    fn events_serialize_with_a_tag_for_the_interface() {
        let json = serde_json::to_string(&Event::Finished { pages: 4 }).expect("serializes");
        assert_eq!(json, r#"{"event":"finished","pages":4}"#);
        let json = serde_json::to_string(&Event::Canceled).expect("serializes");
        assert_eq!(json, r#"{"event":"canceled"}"#);
    }
}
