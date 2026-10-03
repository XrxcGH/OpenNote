//! The names, requests, statuses, and events of transcription jobs.

use serde::Serialize;

use super::{AudioSource, Device, Segment, TranscribeOptions};
use crate::error::IntelError;

/// The name of a job in a queue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct JobId(pub u64);

/// A recording to transcribe and how.
pub struct JobRequest {
    /// The audio, read from the start.
    pub audio: Box<dyn AudioSource>,
    /// The language and device preference.
    pub options: TranscribeOptions,
}

/// Where a job stands.
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    /// Waiting for earlier jobs. Position 0 is next.
    Queued {
        /// Jobs ahead of this one.
        position: usize,
    },
    /// Running now.
    Running {
        /// The fraction done, from 0 to 1.
        progress: f32,
        /// The device it runs on.
        device: Device,
    },
    /// Finished with a transcript. Read it with [`JobHandle::wait`](super::JobHandle::wait).
    Completed,
    /// Stopped by an error.
    Failed(IntelError),
    /// Canceled before it finished.
    Canceled,
}

/// What happened to a job, for the interface to show.
#[derive(Clone, Debug, PartialEq)]
pub struct JobEvent {
    /// The job.
    pub job: JobId,
    /// What happened.
    pub kind: JobEventKind,
}

/// The kinds of [`JobEvent`].
#[derive(Clone, Debug, PartialEq)]
pub enum JobEventKind {
    /// The job joined the queue.
    Queued,
    /// The job started on a device. It repeats if the NPU failed and the processor took over, so
    /// clear any partial segments when it arrives again.
    Started {
        /// The device.
        device: Device,
    },
    /// The fraction done, sent when it moves by about 1 percent.
    Progress(f32),
    /// A finished segment, before the whole transcript is ready.
    Segment(Segment),
    /// The job finished. Read the transcript with [`JobHandle::wait`](super::JobHandle::wait).
    Completed,
    /// The job failed.
    Failed(IntelError),
    /// The job was canceled.
    Canceled,
}
