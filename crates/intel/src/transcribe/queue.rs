//! The transcription job queue: one worker thread at background priority, one job at a time.

use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

use super::job::{JobEvent, JobEventKind, JobId, JobRequest, JobStatus};
use super::{enter_background_mode, resolve_device, Device, DevicePreference, EngineEvent, EngineSettings};
use super::{JobControl, Transcript, TranscriptionEngine};
use crate::error::IntelError;

#[cfg(test)]
mod tests;

/// Progress events are sent when the fraction moves by at least this much.
const PROGRESS_STEP: f32 = 0.01;

type Observer = Arc<dyn Fn(&JobEvent) + Send + Sync>;

enum EntryState {
    Queued,
    Running { progress: f32, device: Device },
    Done(Result<Transcript, IntelError>),
}

struct Entry {
    id: JobId,
    cancel: Arc<AtomicBool>,
    state: Mutex<EntryState>,
    finished: Condvar,
}

struct Job {
    entry: Arc<Entry>,
    request: JobRequest,
}

#[derive(Default)]
struct Pending {
    jobs: VecDeque<Job>,
    running: Option<Arc<Entry>>,
    next_id: u64,
    shutdown: bool,
}

struct Shared {
    engine: Arc<dyn TranscriptionEngine>,
    observer: Option<Observer>,
    pending: Mutex<Pending>,
    wake: Condvar,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Shared {
    fn emit(&self, job: JobId, kind: JobEventKind) {
        if let Some(observer) = &self.observer {
            observer(&JobEvent { job, kind });
        }
    }
}

/// Runs transcription jobs one at a time on a background thread.
///
/// Dropping the queue cancels the running job and every queued one, and waits for the worker.
pub struct TranscriptionQueue {
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
}

impl TranscriptionQueue {
    engine_api! {
        /// Starts a queue that runs jobs on `engine`.
        fn new(engine: Arc<dyn TranscriptionEngine>) -> TranscriptionQueue {
            TranscriptionQueue::start(engine, None)
        }
    }

    engine_api! {
        /// Starts a queue that also calls `observer` for every [`JobEvent`], on the worker thread or
        /// the thread that submits or cancels. The observer must not block for long.
        fn with_observer(
            engine: Arc<dyn TranscriptionEngine>,
            observer: impl Fn(&JobEvent) + Send + Sync + 'static,
        ) -> TranscriptionQueue {
            TranscriptionQueue::start(engine, Some(Arc::new(observer)))
        }
    }

    fn start(engine: Arc<dyn TranscriptionEngine>, observer: Option<Observer>) -> TranscriptionQueue {
        let shared = Arc::new(Shared {
            engine,
            observer,
            pending: Mutex::default(),
            wake: Condvar::new(),
        });
        let worker_shared = Arc::clone(&shared);
        let worker = std::thread::Builder::new()
            .name("opennote-transcribe".to_owned())
            .spawn(move || worker_loop(&worker_shared))
            .expect("the operating system could not start a thread");
        TranscriptionQueue {
            shared,
            worker: Some(worker),
        }
    }

    /// Adds a job at the end of the queue.
    pub fn submit(&self, request: JobRequest) -> JobHandle {
        let entry = {
            let mut pending = lock(&self.shared.pending);
            pending.next_id += 1;
            let entry = Arc::new(Entry {
                id: JobId(pending.next_id),
                cancel: Arc::new(AtomicBool::new(false)),
                state: Mutex::new(EntryState::Queued),
                finished: Condvar::new(),
            });
            pending.jobs.push_back(Job {
                entry: Arc::clone(&entry),
                request,
            });
            entry
        };
        self.shared.wake.notify_one();
        self.shared.emit(entry.id, JobEventKind::Queued);
        JobHandle {
            entry,
            shared: Arc::clone(&self.shared),
        }
    }
}

impl Drop for TranscriptionQueue {
    fn drop(&mut self) {
        let waiting: Vec<Job> = {
            let mut pending = lock(&self.shared.pending);
            pending.shutdown = true;
            if let Some(running) = &pending.running {
                running.cancel.store(true, Ordering::Relaxed);
            }
            pending.jobs.drain(..).collect()
        };
        for job in waiting {
            finish(&self.shared, &job.entry, Err(IntelError::Canceled));
        }
        self.shared.wake.notify_all();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// A submitted job. Clone it freely; every clone sees the same job.
#[derive(Clone)]
pub struct JobHandle {
    entry: Arc<Entry>,
    shared: Arc<Shared>,
}

impl JobHandle {
    /// The job's name.
    pub fn id(&self) -> JobId {
        self.entry.id
    }

    /// Where the job stands now.
    pub fn status(&self) -> JobStatus {
        let snapshot = match &*lock(&self.entry.state) {
            EntryState::Queued => None,
            EntryState::Running { progress, device } => Some(JobStatus::Running {
                progress: *progress,
                device: *device,
            }),
            EntryState::Done(Ok(_)) => Some(JobStatus::Completed),
            EntryState::Done(Err(IntelError::Canceled)) => Some(JobStatus::Canceled),
            EntryState::Done(Err(error)) => Some(JobStatus::Failed(error.clone())),
        };
        snapshot.unwrap_or_else(|| {
            let pending = lock(&self.shared.pending);
            JobStatus::Queued {
                position: pending
                    .jobs
                    .iter()
                    .position(|j| j.entry.id == self.entry.id)
                    .unwrap_or(0),
            }
        })
    }

    /// Asks the job to stop. A queued job leaves the queue at once, and a running job stops at its
    /// next check. Does nothing once the job has finished.
    pub fn cancel(&self) {
        self.entry.cancel.store(true, Ordering::Relaxed);
        let removed = {
            let mut pending = lock(&self.shared.pending);
            let index = pending.jobs.iter().position(|j| j.entry.id == self.entry.id);
            index.and_then(|i| pending.jobs.remove(i))
        };
        if removed.is_some() {
            finish(&self.shared, &self.entry, Err(IntelError::Canceled));
        }
    }

    /// Blocks until the job finishes, then returns its transcript or its error.
    pub fn wait(&self) -> Result<Transcript, IntelError> {
        let mut state = lock(&self.entry.state);
        loop {
            if let EntryState::Done(result) = &*state {
                return result.clone();
            }
            state = self.entry.finished.wait(state).unwrap_or_else(PoisonError::into_inner);
        }
    }

    /// Like [`JobHandle::wait`], but gives up after `timeout` and returns `None`.
    pub fn wait_timeout(&self, timeout: Duration) -> Option<Result<Transcript, IntelError>> {
        let state = lock(&self.entry.state);
        let (state, _) = self
            .entry
            .finished
            .wait_timeout_while(state, timeout, |s| !matches!(s, EntryState::Done(_)))
            .unwrap_or_else(PoisonError::into_inner);
        match &*state {
            EntryState::Done(result) => Some(result.clone()),
            _ => None,
        }
    }
}

fn worker_loop(shared: &Arc<Shared>) {
    enter_background_mode();
    while let Some(job) = next_job(shared) {
        let Job { entry, mut request } = job;
        let result = if entry.cancel.load(Ordering::Relaxed) {
            Err(IntelError::Canceled)
        } else {
            run_with_fallback(shared, &entry, &mut request)
        };
        lock(&shared.pending).running = None;
        finish(shared, &entry, result);
    }
}

fn next_job(shared: &Shared) -> Option<Job> {
    let mut pending = lock(&shared.pending);
    loop {
        if pending.shutdown {
            return None;
        }
        if let Some(job) = pending.jobs.pop_front() {
            pending.running = Some(Arc::clone(&job.entry));
            return Some(job);
        }
        pending = shared.wake.wait(pending).unwrap_or_else(PoisonError::into_inner);
    }
}

/// Runs on the chosen device. With `Auto`, a failure on the NPU runs again on the processor.
fn run_with_fallback(
    shared: &Arc<Shared>,
    entry: &Arc<Entry>,
    request: &mut JobRequest,
) -> Result<Transcript, IntelError> {
    let available = shared.engine.devices();
    let mut device = resolve_device(request.options.device, &available)?;
    loop {
        *lock(&entry.state) = EntryState::Running { progress: 0.0, device };
        shared.emit(entry.id, JobEventKind::Started { device });
        let outcome = run_engine(shared, entry, request, device);
        let can_retry = device == Device::Npu
            && request.options.device == DevicePreference::Auto
            && available.contains(&Device::Cpu)
            && !entry.cancel.load(Ordering::Relaxed);
        match outcome {
            Err(error) if can_retry && error != IntelError::Canceled => {
                request.audio.rewind()?;
                device = Device::Cpu;
            }
            other => return other,
        }
    }
}

fn run_engine(
    shared: &Arc<Shared>,
    entry: &Arc<Entry>,
    request: &mut JobRequest,
    device: Device,
) -> Result<Transcript, IntelError> {
    let control = JobControl::new(Arc::clone(&entry.cancel), progress_sink(shared, entry));
    let settings = EngineSettings {
        language: request.options.language.clone(),
        device,
    };
    let engine = &shared.engine;
    let audio = &mut *request.audio;
    catch_unwind(AssertUnwindSafe(|| engine.transcribe(audio, &settings, &control)))
        .unwrap_or_else(|_| Err(IntelError::Engine("the engine stopped unexpectedly".to_owned())))
}

/// Records progress on the job, and forwards events to the observer.
fn progress_sink(shared: &Arc<Shared>, entry: &Arc<Entry>) -> Arc<dyn Fn(EngineEvent) + Send + Sync> {
    let (shared, entry) = (Arc::clone(shared), Arc::clone(entry));
    let last_sent = Mutex::new(0.0_f32);
    Arc::new(move |event| match event {
        EngineEvent::Segment(segment) => shared.emit(entry.id, JobEventKind::Segment(segment)),
        EngineEvent::Progress(fraction) => {
            if let EntryState::Running { progress, .. } = &mut *lock(&entry.state) {
                *progress = fraction;
            }
            let mut last = lock(&last_sent);
            if fraction - *last >= PROGRESS_STEP || (fraction >= 1.0 && *last < 1.0) {
                *last = fraction;
                shared.emit(entry.id, JobEventKind::Progress(fraction));
            }
        }
    })
}

fn finish(shared: &Shared, entry: &Entry, result: Result<Transcript, IntelError>) {
    let kind = match &result {
        Ok(_) => JobEventKind::Completed,
        Err(IntelError::Canceled) => JobEventKind::Canceled,
        Err(error) => JobEventKind::Failed(error.clone()),
    };
    *lock(&entry.state) = EntryState::Done(result);
    entry.finished.notify_all();
    shared.emit(entry.id, kind);
}
