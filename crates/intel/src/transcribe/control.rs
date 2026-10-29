//! The channel between a running engine and its queue.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::Segment;
use crate::error::IntelError;

/// Something an engine reports while it works.
#[derive(Clone, Debug, PartialEq)]
pub enum EngineEvent {
    /// How much of the recording is done, from 0 to 1.
    Progress(f32),
    /// A finished segment, in time order, before the whole transcript is ready.
    Segment(Segment),
}

type Sink = Arc<dyn Fn(EngineEvent) + Send + Sync>;
type Stop = Arc<dyn Fn() -> bool + Send + Sync>;

/// Given to an engine for one job. It carries the cancel flag and reports progress.
#[derive(Clone)]
pub struct JobControl {
    cancel: Arc<AtomicBool>,
    sink: Sink,
    /// Also cancels the job when it returns true, as when the person turns transcription off.
    stop: Option<Stop>,
}

impl JobControl {
    pub(crate) fn new(cancel: Arc<AtomicBool>, sink: Sink) -> JobControl {
        JobControl {
            cancel,
            sink,
            stop: None,
        }
    }

    /// The same control, also canceled once `stopped` returns true.
    pub(crate) fn stopped_when(&self, stopped: impl Fn() -> bool + Send + Sync + 'static) -> JobControl {
        let earlier = self.stop.clone();
        let stop: Stop = Arc::new(move || stopped() || earlier.as_ref().is_some_and(|f| f()));
        JobControl {
            cancel: Arc::clone(&self.cancel),
            sink: Arc::clone(&self.sink),
            stop: Some(stop),
        }
    }

    /// A control with nothing listening and nothing to cancel, for calling an engine directly.
    pub fn detached() -> JobControl {
        JobControl::new(Arc::new(AtomicBool::new(false)), Arc::new(|_| {}))
    }

    /// Whether the person canceled the job. Engines check this between chunks of audio.
    pub fn is_canceled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed) || self.stop.as_ref().is_some_and(|stopped| stopped())
    }

    /// `Err(Canceled)` once the job is canceled, so an engine can end a loop with `?`.
    pub fn check_canceled(&self) -> Result<(), IntelError> {
        if self.is_canceled() {
            Err(IntelError::Canceled)
        } else {
            Ok(())
        }
    }

    /// Reports the fraction of the recording that is done. Values are clamped to 0 through 1.
    pub fn report_progress(&self, fraction: f32) {
        (self.sink)(EngineEvent::Progress(fraction.clamp(0.0, 1.0)));
    }

    /// Reports a finished segment.
    pub fn emit_segment(&self, segment: Segment) {
        (self.sink)(EngineEvent::Segment(segment));
    }
}

impl std::fmt::Debug for JobControl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JobControl")
            .field("canceled", &self.is_canceled())
            .finish_non_exhaustive()
    }
}
