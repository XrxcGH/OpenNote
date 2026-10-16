//! Reading a whole page aloud: chunks are synthesized ahead of the one being played.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use super::{plan_chunks, SpeakOptions, SpeechAudio, SpeechSynthesizer, DEFAULT_CHUNK_CHARS};
use crate::error::IntelError;
use crate::text::Span;

/// The most characters one session reads, about a 400-page book. Longer text fails at once rather than
/// holding its chunks in memory.
pub const MAX_READ_ALOUD_CHARS: usize = 1_000_000;

/// What waiting for a session's next event found.
pub(crate) enum Waited {
    /// The next event.
    Event(ReadAloudEvent),
    /// Nothing yet.
    TimedOut,
    /// The session ended without a last event, as after a cancel.
    Ended,
}

/// How a read-aloud session works.
#[derive(Clone, Debug)]
pub struct ReadAloudOptions {
    /// Voice, speed, pitch, and volume.
    pub speak: SpeakOptions,
    /// The longest chunk, in characters.
    pub max_chunk_chars: usize,
    /// How many chunks to synthesize ahead of the one being delivered. At least 1.
    pub prefetch: usize,
}

impl Default for ReadAloudOptions {
    fn default() -> Self {
        ReadAloudOptions {
            speak: SpeakOptions::default(),
            max_chunk_chars: DEFAULT_CHUNK_CHARS,
            prefetch: 2,
        }
    }
}

/// One chunk, ready to play.
#[derive(Clone, Debug)]
pub struct ReadChunk {
    /// The chunk's position, counting from 0.
    pub index: usize,
    /// How many chunks the text has.
    pub total: usize,
    /// Where the chunk sits in the text that was given, in UTF-16 units. Add `span.start` to the offsets in
    /// `audio.info` to find a word in the page.
    pub span: Span,
    /// The sound and the word times.
    pub audio: SpeechAudio,
}

/// What a session reports, in order.
#[derive(Clone, Debug)]
pub enum ReadAloudEvent {
    /// The next chunk is ready.
    Chunk(ReadChunk),
    /// Every chunk was delivered.
    Finished,
    /// Synthesis failed, and the session stopped.
    Failed(IntelError),
}

/// A page being read aloud. Chunks arrive through [`ReadAloud::next_event`]. Dropping the session stops it.
/// The drop waits for the chunk being made, which takes about a second, so drop it off the interface thread.
///
/// The worker synthesizes at most `prefetch` chunks beyond the ones taken, so a person who stops
/// listening after a paragraph costs a paragraph of work, not a page.
pub struct ReadAloud {
    events: Option<Receiver<ReadAloudEvent>>,
    canceled: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    total: usize,
}

impl ReadAloud {
    engine_api! {
        /// Starts reading `text`. Fails at once when the options are out of range, or when there is nothing
        /// to read or more than [`MAX_READ_ALOUD_CHARS`].
        fn start(
            synthesizer: Arc<dyn SpeechSynthesizer>,
            text: &str,
            options: ReadAloudOptions,
        ) -> Result<ReadAloud, IntelError> {
            options.speak.validate()?;
            // A character is at least one byte, so short text skips the count.
            if text.len() > MAX_READ_ALOUD_CHARS && text.chars().count() > MAX_READ_ALOUD_CHARS {
                return Err(IntelError::InvalidInput(format!(
                    "a page to read aloud may have {MAX_READ_ALOUD_CHARS} characters at most"
                )));
            }
            let chunks = plan_chunks(text, options.max_chunk_chars);
            if chunks.is_empty() {
                return Err(IntelError::InvalidInput("there is no text to read".to_owned()));
            }
            let total = chunks.len();
            let (sender, receiver) = sync_channel(options.prefetch.max(1) - 1);
            let canceled = Arc::new(AtomicBool::new(false));
            let flag = Arc::clone(&canceled);
            let worker = std::thread::Builder::new()
                .name("opennote-read-aloud".to_owned())
                .spawn(move || {
                    for (index, chunk) in chunks.into_iter().enumerate() {
                        if flag.load(Ordering::Relaxed) {
                            return;
                        }
                        let event = match synthesizer.synthesize(&chunk.text, &options.speak) {
                            Ok(audio) => ReadAloudEvent::Chunk(ReadChunk {
                                index,
                                total,
                                span: chunk.span,
                                audio,
                            }),
                            Err(error) => {
                                let _ = sender.send(ReadAloudEvent::Failed(error));
                                return;
                            }
                        };
                        // A closed channel means the session was dropped.
                        if sender.send(event).is_err() {
                            return;
                        }
                    }
                    let _ = sender.send(ReadAloudEvent::Finished);
                })
                .map_err(|e| IntelError::Engine(format!("could not start the read-aloud thread: {e}")))?;
            Ok(ReadAloud {
                events: Some(receiver),
                canceled,
                worker: Some(worker),
                total,
            })
        }
    }

    /// How many chunks the text was cut into.
    pub fn total_chunks(&self) -> usize {
        self.total
    }

    /// Waits for the next event, up to `timeout`. `None` means nothing arrived in time, or the session ended.
    pub fn next_event(&self, timeout: Duration) -> Option<ReadAloudEvent> {
        self.events.as_ref()?.recv_timeout(timeout).ok()
    }

    /// Waits for the next event, up to `timeout`, and tells a slow chunk from a session that has ended.
    pub(crate) fn wait(&self, timeout: Duration) -> Waited {
        let Some(events) = self.events.as_ref() else {
            return Waited::Ended;
        };
        match events.recv_timeout(timeout) {
            Ok(event) => Waited::Event(event),
            Err(RecvTimeoutError::Timeout) => Waited::TimedOut,
            Err(RecvTimeoutError::Disconnected) => Waited::Ended,
        }
    }

    /// The next event if one is ready.
    pub fn try_next_event(&self) -> Option<ReadAloudEvent> {
        self.events.as_ref()?.try_recv().ok()
    }

    /// Stops the session. Chunks already waiting are discarded, and no more are made.
    pub fn cancel(&mut self) {
        self.canceled.store(true, Ordering::Relaxed);
        // Closing the channel releases a worker that is waiting to hand over a chunk.
        self.events = None;
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for ReadAloud {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;
    use crate::mock::MockSpeech;

    fn options(prefetch: usize) -> ReadAloudOptions {
        ReadAloudOptions {
            prefetch,
            max_chunk_chars: 60,
            ..Default::default()
        }
    }

    const TEXT: &str = "First sentence here. Second sentence follows. Third one comes next. Fourth is last. Fifth too.";

    fn drain(session: &ReadAloud) -> Vec<ReadAloudEvent> {
        let mut events = Vec::new();
        while let Some(event) = session.next_event(Duration::from_secs(5)) {
            let done = !matches!(event, ReadAloudEvent::Chunk(_));
            events.push(event);
            if done {
                break;
            }
        }
        events
    }

    #[test]
    fn chunks_arrive_in_order_and_cover_the_text() {
        let session = ReadAloud::start(Arc::new(MockSpeech::new()), TEXT, options(2)).unwrap();
        let events = drain(&session);
        assert!(matches!(events.last(), Some(ReadAloudEvent::Finished)));
        let chunks: Vec<&ReadChunk> = events
            .iter()
            .filter_map(|e| {
                if let ReadAloudEvent::Chunk(c) = e {
                    Some(c)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(chunks.len(), session.total_chunks());
        assert!(chunks.len() >= 3);
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!((chunk.index, chunk.total), (i, chunks.len()));
            assert!(chunk.audio.info.duration_ms > 0 && !chunk.audio.wav.is_empty());
        }
        assert_eq!(chunks[0].span.start, 0);
        assert!(chunks.windows(2).all(|w| w[0].span.end <= w[1].span.start));
        assert_eq!(chunks.last().unwrap().span.end, TEXT.encode_utf16().count());
    }

    #[test]
    fn a_synthesis_failure_stops_the_session_with_the_error() {
        let engine = MockSpeech::new().failing_on("Third");
        let session = ReadAloud::start(Arc::new(engine), TEXT, options(1)).unwrap();
        let events = drain(&session);
        assert!(
            matches!(events.last(), Some(ReadAloudEvent::Failed(IntelError::Engine(_)))),
            "{events:?}"
        );
        assert!(events.len() >= 2, "chunks before the failure still arrive");
    }

    /// Counts how many chunks the worker has been asked to make.
    struct Counting(MockSpeech, Arc<AtomicUsize>);

    impl SpeechSynthesizer for Counting {
        fn voices(&self) -> Result<Vec<super::super::Voice>, IntelError> {
            self.0.voices()
        }

        fn synthesize(&self, text: &str, options: &SpeakOptions) -> Result<SpeechAudio, IntelError> {
            self.1.fetch_add(1, Ordering::SeqCst);
            self.0.synthesize(text, options)
        }
    }

    #[test]
    fn the_worker_stays_a_bounded_distance_ahead_and_stops_when_dropped() {
        let made = Arc::new(AtomicUsize::new(0));
        let engine = Counting(MockSpeech::new(), Arc::clone(&made));
        let long = "A short sentence of words. ".repeat(100);
        let session = ReadAloud::start(Arc::new(engine), &long, options(2)).unwrap();
        assert!(session.total_chunks() > 20);
        // Take one chunk, then give the worker time to run as far as it is allowed.
        assert!(matches!(
            session.next_event(Duration::from_secs(5)),
            Some(ReadAloudEvent::Chunk(_))
        ));
        std::thread::sleep(Duration::from_millis(200));
        let ahead = made.load(Ordering::SeqCst);
        assert!(
            ahead <= 4,
            "the worker made {ahead} chunks for one taken with a prefetch of 2"
        );
        drop(session);
        let at_drop = made.load(Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(made.load(Ordering::SeqCst), at_drop, "no work continues after the drop");
    }

    #[test]
    fn nothing_to_read_or_bad_options_fail_at_once() {
        let engine: Arc<dyn SpeechSynthesizer> = Arc::new(MockSpeech::new());
        assert!(ReadAloud::start(Arc::clone(&engine), "  ", options(1)).is_err());
        let book = "Word. ".repeat(MAX_READ_ALOUD_CHARS / 6 + 1);
        assert!(ReadAloud::start(Arc::clone(&engine), &book, options(1)).is_err());
        let mut bad = options(1);
        bad.speak.rate = 9.0;
        assert!(ReadAloud::start(engine, TEXT, bad).is_err());
    }

    #[test]
    fn cancel_ends_the_session() {
        let mut session = ReadAloud::start(Arc::new(MockSpeech::new()), TEXT, options(1)).unwrap();
        session.cancel();
        assert!(session.next_event(Duration::from_millis(10)).is_none());
        assert!(session.try_next_event().is_none());
    }
}
