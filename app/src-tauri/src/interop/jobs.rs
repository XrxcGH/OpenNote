//! Running jobs: each import, dry run, and export has a name from the interface, a cancel token, and a stream of
//! progress events named `interop://progress`.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, PoisonError},
    time::{Duration, Instant},
};

use opennote_interop::{CancelToken, Control, Event, ProgressSink};
use serde_json::Value;

/// The event the interface listens for: the job's name and one event of the interop crate (`started`,
/// `progress`, `finished`, `canceled`, or `failed`).
pub const PROGRESS_EVENT: &str = "interop://progress";

/// At most one progress event goes out in this time, so a thousand small pages don't flood the interface.
const PROGRESS_EVERY: Duration = Duration::from_millis(60);

/// Sends one payload to the interface.
pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

fn registry() -> &'static Mutex<HashMap<String, CancelToken>> {
    static JOBS: OnceLock<Mutex<HashMap<String, CancelToken>>> = OnceLock::new();
    JOBS.get_or_init(Mutex::default)
}

/// A job that is running. It leaves the registry when it is dropped.
pub struct Job {
    id: String,
}

impl Job {
    /// Registers the job and makes the control that its work reports through.
    pub fn start(id: &str, emit: Emit) -> (Job, Control) {
        let token = CancelToken::new();
        registry()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.to_owned(), token.clone());
        let relay = Relay {
            job: id.to_owned(),
            emit,
            last: Mutex::new(None),
        };
        (Job { id: id.to_owned() }, Control::new(token, Arc::new(relay)))
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        registry()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.id);
    }
}

/// Asks the job to stop at its next checkpoint. False when no such job is running.
pub fn cancel(id: &str) -> bool {
    match registry().lock().unwrap_or_else(PoisonError::into_inner).get(id) {
        Some(token) => {
            token.cancel();
            true
        }
        None => false,
    }
}

struct Relay {
    job: String,
    emit: Emit,
    last: Mutex<Option<Instant>>,
}

impl ProgressSink for Relay {
    fn event(&self, event: &Event) {
        if matches!(event, Event::Progress(_)) {
            let mut last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
            let now = Instant::now();
            if last.is_some_and(|before| now.duration_since(before) < PROGRESS_EVERY) {
                return;
            }
            *last = Some(now);
        }
        let Ok(mut payload) = serde_json::to_value(event) else {
            return;
        };
        payload["job"] = Value::String(self.job.clone());
        (self.emit)(payload);
    }
}
