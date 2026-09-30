//! A background writer that coalesces changes. The first change after a quiet period starts a delay, every
//! change within it is folded in, and then the latest document is written atomically. Settings use 250 ms and
//! the device state 500 ms. `flush` writes any pending change at once, as the theme and the exit handshake need.

use std::{
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError},
    thread::{self, JoinHandle},
    time::Duration,
};

use serde_json::Value;

use super::file;

struct Shared {
    path: PathBuf,
    delay: Duration,
    pending: Mutex<Pending>,
    wake: Condvar,
    /// Held for each write, so the thread and `flush` never write out of order.
    writing: Mutex<()>,
}

#[derive(Default)]
struct Pending {
    document: Option<Value>,
    stopping: bool,
}

pub struct Writer {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl Writer {
    /// Starts a writer thread for `path`.
    pub fn spawn(path: PathBuf, delay: Duration, name: &str) -> Writer {
        let shared = Arc::new(Shared {
            path,
            delay,
            pending: Mutex::new(Pending::default()),
            wake: Condvar::new(),
            writing: Mutex::new(()),
        });
        let worker = Arc::clone(&shared);
        let thread = thread::Builder::new()
            .name(format!("opennote-{name}-writer"))
            .spawn(move || run(&worker))
            .map_err(|error| log::error!("Couldn't start the {name} writer, so changes save only on exit: {error}"))
            .ok();
        Writer { shared, thread }
    }

    /// Queues `document` to be written after the delay, replacing any document still waiting.
    pub fn schedule(&self, document: Value) {
        lock(&self.shared.pending).document = Some(document);
        self.shared.wake.notify_all();
    }

    /// Writes the waiting document now, if there is one.
    pub fn flush(&self) -> std::io::Result<()> {
        write_pending(&self.shared)
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        lock(&self.shared.pending).stopping = true;
        self.shared.wake.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        if let Err(error) = write_pending(&self.shared) {
            log::error!("Couldn't save {}: {error}", self.shared.path.display());
        }
    }
}

fn run(shared: &Shared) {
    loop {
        {
            let mut pending = lock(&shared.pending);
            while pending.document.is_none() && !pending.stopping {
                pending = shared.wake.wait(pending).unwrap_or_else(PoisonError::into_inner);
            }
            if pending.stopping {
                return;
            }
            // Fold in every change that arrives during the delay. Only stopping ends it early.
            let (after, _) = shared
                .wake
                .wait_timeout_while(pending, shared.delay, |pending| !pending.stopping)
                .unwrap_or_else(PoisonError::into_inner);
            if after.stopping {
                return;
            }
        }
        if let Err(error) = write_pending(shared) {
            log::error!("Couldn't save {}: {error}", shared.path.display());
        }
    }
}

fn write_pending(shared: &Shared) -> std::io::Result<()> {
    let _writing = lock(&shared.writing);
    let Some(document) = lock(&shared.pending).document.take() else {
        return Ok(());
    };
    file::write_json(&shared.path, &document)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn read(path: &std::path::Path) -> Option<Value> {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    }

    #[test]
    fn coalesces_changes_within_the_delay() {
        let folder = tempfile::tempdir().expect("a folder");
        let path = folder.path().join("state.json");
        let writer = Writer::spawn(path.clone(), Duration::from_millis(150), "test");
        writer.schedule(json!({ "n": 1 }));
        writer.schedule(json!({ "n": 2 }));
        assert_eq!(read(&path), None, "nothing is written before the delay");
        thread::sleep(Duration::from_millis(600));
        assert_eq!(read(&path), Some(json!({ "n": 2 })));
    }

    #[test]
    fn flush_writes_at_once_and_drop_writes_the_rest() {
        let folder = tempfile::tempdir().expect("a folder");
        let path = folder.path().join("settings.json");
        let writer = Writer::spawn(path.clone(), Duration::from_secs(60), "test");
        writer.schedule(json!({ "theme": "dark" }));
        writer.flush().expect("flushes");
        assert_eq!(read(&path), Some(json!({ "theme": "dark" })));
        writer.schedule(json!({ "theme": "light" }));
        drop(writer);
        assert_eq!(read(&path), Some(json!({ "theme": "light" })));
    }
}
