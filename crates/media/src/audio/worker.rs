//! The writer thread of a track. It reads packets from the ring, drops those captured during a
//! pause, converts the rest to the track rate, and hands them to the [`TrackWriter`].
//!
//! Pauses are times, not flags. A pause records the capture-clock time it began, and the thread drops
//! every packet captured from then until the resume time. Packets queued before the pause are still
//! recorded, however late the thread gets to them.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::level::Meter;
use super::resample::Resampler;
use super::ring::{PacketInfo, PacketReader};
use super::tap::PcmTap;
use super::timeline::Timeline;
use super::writer::TrackWriter;
use super::{AudioError, Options, Result};

/// How long the thread sleeps when the ring is empty.
const POLL: Duration = Duration::from_millis(5);
/// The end of a pause that hasn't ended.
const OPEN: u64 = u64::MAX;

/// A stretch of capture time that a pause leaves out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PauseSpan {
    pub start_ns: u64,
    /// When recording resumed, or `u64::MAX` while paused.
    pub end_ns: u64,
}

/// What the recording and its writer thread share.
#[derive(Debug, Default)]
pub struct Control {
    stop: AtomicBool,
    spans: Mutex<Vec<PauseSpan>>,
    failure: Mutex<Option<String>>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Control {
    /// Starts a pause at `now_ns`. Pausing twice does nothing.
    pub fn pause(&self, now_ns: u64) {
        let mut spans = locked(&self.spans);
        if spans.last().is_none_or(|span| span.end_ns != OPEN) {
            spans.push(PauseSpan {
                start_ns: now_ns,
                end_ns: OPEN,
            });
        }
    }

    /// Ends the pause at `now_ns`.
    pub fn resume(&self, now_ns: u64) {
        if let Some(span) = locked(&self.spans).last_mut().filter(|span| span.end_ns == OPEN) {
            span.end_ns = now_ns.max(span.start_ns);
        }
    }

    pub fn spans(&self) -> Vec<PauseSpan> {
        locked(&self.spans).clone()
    }

    /// Why the writer stopped early, if it did.
    pub fn failure(&self) -> Option<String> {
        locked(&self.failure).clone()
    }
}

/// What a writer thread works with.
pub struct Parts {
    pub reader: PacketReader,
    pub writer: TrackWriter,
    pub control: Arc<Control>,
    pub meter: Arc<Meter>,
    pub tap: Option<Box<dyn PcmTap>>,
    /// The sample rate of the first packets.
    pub rate: u32,
}

/// A running writer thread.
pub struct Worker {
    handle: Option<JoinHandle<Result<Timeline>>>,
    control: Arc<Control>,
}

/// Starts the writer thread for a track.
pub fn spawn(parts: Parts, options: &Options) -> Result<Worker> {
    let control = Arc::clone(&parts.control);
    let state = State {
        resampler: Resampler::new(parts.rate),
        rate: parts.rate,
        reader: parts.reader,
        writer: parts.writer,
        control: parts.control,
        meter: parts.meter,
        tap: parts.tap,
        raw: Vec::new(),
        converted: Vec::new(),
        pauses_seen: 0,
        idle_flush: Duration::from_millis(u64::from(options.idle_flush_ms)),
    };
    let thread_control = Arc::clone(&control);
    let handle = thread::Builder::new()
        .name("opennote-audio-writer".into())
        .spawn(move || {
            let result = state.run();
            if let Err(error) = &result {
                *locked(&thread_control.failure) = Some(error.to_string());
            }
            result
        })?;
    Ok(Worker {
        handle: Some(handle),
        control,
    })
}

impl Worker {
    pub fn control(&self) -> &Arc<Control> {
        &self.control
    }

    /// Whether the thread has ended, which it does early only after an error.
    pub fn is_finished(&self) -> bool {
        self.handle.as_ref().is_none_or(JoinHandle::is_finished)
    }

    /// Drains what is queued, finishes the file, and returns the track's timeline. The source must
    /// be stopped first, so nothing more arrives.
    pub fn finish(mut self) -> Result<Timeline> {
        let handle = self.handle.take().expect("the thread is joined only once");
        self.control.stop.store(true, Ordering::Release);
        handle.thread().unpark();
        handle
            .join()
            .map_err(|_| AudioError::Writer("The writer thread panicked.".into()))?
    }
}

/// A worker that is dropped without `finish` still closes its file, on its own thread.
impl Drop for Worker {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            self.control.stop.store(true, Ordering::Release);
            handle.thread().unpark();
        }
    }
}

struct State {
    reader: PacketReader,
    writer: TrackWriter,
    resampler: Resampler,
    rate: u32,
    control: Arc<Control>,
    meter: Arc<Meter>,
    tap: Option<Box<dyn PcmTap>>,
    raw: Vec<f32>,
    converted: Vec<f32>,
    pauses_seen: usize,
    idle_flush: Duration,
}

impl State {
    fn run(mut self) -> Result<Timeline> {
        let mut last_data = Instant::now();
        loop {
            // Read the stop flag first, so the pass after it sees everything queued before it.
            let stopping = self.control.stop.load(Ordering::Acquire);
            let any = self.drain()?;
            if stopping {
                break;
            }
            if any {
                last_data = Instant::now();
            } else {
                if self.writer.has_unflushed() && last_data.elapsed() >= self.idle_flush {
                    self.writer.flush_page()?;
                }
                thread::park_timeout(POLL);
            }
        }
        let timeline = self.writer.finish()?;
        if let Some(tap) = &mut self.tap {
            tap.finish(timeline.frames);
        }
        Ok(timeline)
    }

    /// Handles every queued packet, and says whether there were any.
    fn drain(&mut self) -> Result<bool> {
        let mut any = false;
        while let Some(packet) = self.reader.next(&mut self.raw) {
            any = true;
            self.handle(packet)?;
        }
        Ok(any)
    }

    /// Handles one packet. The pauses are read again for each packet, since a resume can come in
    /// while the thread works through a full ring.
    fn handle(&mut self, packet: PacketInfo) -> Result<()> {
        let capture_ns = packet.capture_ns;
        let spans = self.control.spans();
        if spans
            .iter()
            .any(|span| (span.start_ns..span.end_ns).contains(&capture_ns))
        {
            return Ok(());
        }
        let ended = spans.iter().filter(|span| span.end_ns <= capture_ns).count();
        if ended > self.pauses_seen {
            self.pauses_seen = ended;
            self.resampler.reset();
            self.writer.note_pause()?;
        }
        if packet.rate != self.rate {
            // The recording switched to a device with another rate.
            self.rate = packet.rate;
            self.resampler = Resampler::new(packet.rate);
        }
        self.meter.observe(capture_ns, &self.raw);
        self.resampler.process(&self.raw, &mut self.converted);
        let first_frame = self.writer.write_packet(capture_ns, &self.converted)?;
        if let Some(tap) = &mut self.tap {
            tap.pcm(first_frame, capture_ns, &self.converted);
        }
        Ok(())
    }
}
