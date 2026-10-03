use std::sync::atomic::AtomicI32;
use std::time::Instant;

use super::*;
use crate::transcribe::{AudioSource, MemoryAudio, StubEngine, TranscribeOptions};

const PATIENCE: Duration = Duration::from_secs(10);

fn request(samples: usize, device: DevicePreference) -> JobRequest {
    JobRequest {
        audio: Box::new(MemoryAudio::new(vec![0.0; samples])),
        options: TranscribeOptions { language: None, device },
    }
}

/// Four chunks of 1,000 samples, each taking `delay`.
fn engine(delay_ms: u64) -> StubEngine {
    StubEngine::new()
        .with_chunk_samples(1000)
        .with_chunk_delay(Duration::from_millis(delay_ms))
}

fn recording_queue(engine: StubEngine) -> (TranscriptionQueue, Arc<Mutex<Vec<JobEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&events);
    let queue = TranscriptionQueue::with_observer(Arc::new(engine), move |event| lock(&log).push(event.clone()));
    (queue, events)
}

fn wait_until(what: &str, condition: impl Fn() -> bool) {
    let start = Instant::now();
    while !condition() {
        assert!(start.elapsed() < PATIENCE, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn a_job_runs_and_reports_its_work() {
    let (queue, events) = recording_queue(engine(0));
    let job = queue.submit(request(4000, DevicePreference::Auto));
    let transcript = job.wait().unwrap();
    assert_eq!(transcript.device, Device::Cpu);
    assert_eq!(transcript.segments.len(), 4);
    assert_eq!(transcript.segments[1].start_ms, 62);
    assert_eq!(
        transcript.text(),
        "Stub segment 1. Stub segment 2. Stub segment 3. Stub segment 4."
    );
    assert_eq!(job.status(), JobStatus::Completed);

    // The result is published before the observer hears of it, so a waiter can get here first.
    wait_until("the completed event", || {
        lock(&events).last().map(|e| e.kind.clone()) == Some(JobEventKind::Completed)
    });
    let kinds: Vec<JobEventKind> = lock(&events).iter().map(|e| e.kind.clone()).collect();
    assert_eq!(kinds[0], JobEventKind::Queued);
    assert_eq!(kinds[1], JobEventKind::Started { device: Device::Cpu });
    assert_eq!(
        kinds.iter().filter(|k| matches!(k, JobEventKind::Segment(_))).count(),
        4
    );
    assert!(kinds.contains(&JobEventKind::Progress(1.0)));
    assert_eq!(kinds.last(), Some(&JobEventKind::Completed));
}

#[test]
fn a_running_job_can_be_canceled() {
    let (queue, _) = recording_queue(engine(20));
    let job = queue.submit(request(100_000, DevicePreference::Auto));
    wait_until("the job to start", || matches!(job.status(), JobStatus::Running { .. }));
    let start = Instant::now();
    job.cancel();
    assert_eq!(job.wait(), Err(IntelError::Canceled));
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "cancel took {:?}",
        start.elapsed()
    );
    assert_eq!(job.status(), JobStatus::Canceled);
}

#[test]
fn jobs_run_one_at_a_time_in_order_and_a_queued_job_cancels_at_once() {
    let (queue, events) = recording_queue(engine(10));
    let first = queue.submit(request(30_000, DevicePreference::Auto));
    let second = queue.submit(request(2000, DevicePreference::Auto));
    let third = queue.submit(request(2000, DevicePreference::Auto));
    wait_until("the first job to start", || {
        matches!(first.status(), JobStatus::Running { .. })
    });
    assert_eq!(second.status(), JobStatus::Queued { position: 0 });
    assert_eq!(third.status(), JobStatus::Queued { position: 1 });
    third.cancel();
    assert_eq!(third.status(), JobStatus::Canceled);
    assert!(first.wait().is_ok() && second.wait().is_ok());

    let started: Vec<JobId> = lock(&events)
        .iter()
        .filter(|e| matches!(e.kind, JobEventKind::Started { .. }))
        .map(|e| e.job)
        .collect();
    assert_eq!(started, vec![first.id(), second.id()]);
}

#[test]
fn the_npu_is_preferred_and_the_processor_takes_over_when_it_fails() {
    let flaky = StubEngine::new()
        .with_devices(&[Device::Npu, Device::Cpu])
        .with_chunk_samples(1000)
        .failing_on(Device::Npu);
    let (queue, events) = recording_queue(flaky);
    let transcript = queue.submit(request(2000, DevicePreference::Auto)).wait().unwrap();
    assert_eq!(transcript.device, Device::Cpu);
    let started: Vec<JobEventKind> = lock(&events)
        .iter()
        .map(|e| e.kind.clone())
        .filter(|k| matches!(k, JobEventKind::Started { .. }))
        .collect();
    assert_eq!(
        started,
        vec![
            JobEventKind::Started { device: Device::Npu },
            JobEventKind::Started { device: Device::Cpu }
        ]
    );

    // A person who insists on the NPU gets the failure instead of a silent switch.
    let insisted = queue.submit(request(2000, DevicePreference::Npu)).wait();
    assert!(matches!(insisted, Err(IntelError::Engine(_))));
}

#[test]
fn a_device_that_is_missing_fails_the_job() {
    let (queue, _) = recording_queue(engine(0));
    let result = queue.submit(request(1000, DevicePreference::Npu)).wait();
    assert_eq!(result, Err(IntelError::DeviceUnavailable(Device::Npu)));
}

struct Panicking;

impl TranscriptionEngine for Panicking {
    fn name(&self) -> String {
        "panicking".to_owned()
    }
    fn devices(&self) -> Vec<Device> {
        vec![Device::Cpu]
    }
    fn transcribe(
        &self,
        _: &mut dyn AudioSource,
        _: &EngineSettings,
        _: &JobControl,
    ) -> Result<Transcript, IntelError> {
        panic!("the model file is corrupt");
    }
}

#[test]
fn a_panicking_engine_fails_the_job_and_the_queue_keeps_working() {
    let queue = TranscriptionQueue::new(Arc::new(Panicking));
    let job = queue.submit(request(1000, DevicePreference::Auto));
    assert!(matches!(job.wait(), Err(IntelError::Engine(_))));
    assert!(matches!(job.status(), JobStatus::Failed(_)));
    assert!(matches!(
        queue.submit(request(1000, DevicePreference::Auto)).wait(),
        Err(IntelError::Engine(_))
    ));
}

#[test]
fn dropping_the_queue_cancels_every_job() {
    let (queue, _) = recording_queue(engine(20));
    let running = queue.submit(request(100_000, DevicePreference::Auto));
    let waiting = queue.submit(request(1000, DevicePreference::Auto));
    wait_until("the job to start", || {
        matches!(running.status(), JobStatus::Running { .. })
    });
    drop(queue);
    assert_eq!(running.wait_timeout(PATIENCE), Some(Err(IntelError::Canceled)));
    assert_eq!(waiting.wait_timeout(PATIENCE), Some(Err(IntelError::Canceled)));
}

/// Records the priority of the thread that runs the job.
struct PriorityProbe(Arc<AtomicI32>);

impl TranscriptionEngine for PriorityProbe {
    fn name(&self) -> String {
        "probe".to_owned()
    }
    fn devices(&self) -> Vec<Device> {
        vec![Device::Cpu]
    }
    fn transcribe(
        &self,
        _: &mut dyn AudioSource,
        settings: &EngineSettings,
        _: &JobControl,
    ) -> Result<Transcript, IntelError> {
        #[cfg(windows)]
        // SAFETY: the pseudo handle is valid for the calling thread.
        let priority = unsafe {
            windows::Win32::System::Threading::GetThreadPriority(windows::Win32::System::Threading::GetCurrentThread())
        };
        #[cfg(not(windows))]
        let priority = 0;
        self.0.store(priority, Ordering::Relaxed);
        Ok(Transcript {
            language: None,
            device: settings.device,
            segments: Vec::new(),
        })
    }
}

#[cfg(windows)]
#[test]
fn jobs_run_below_normal_priority() {
    let seen = Arc::new(AtomicI32::new(i32::MAX));
    let queue = TranscriptionQueue::new(Arc::new(PriorityProbe(Arc::clone(&seen))));
    queue.submit(request(1000, DevicePreference::Auto)).wait().unwrap();
    assert!(
        seen.load(Ordering::Relaxed) < 0,
        "worker priority was {}",
        seen.load(Ordering::Relaxed)
    );
}
