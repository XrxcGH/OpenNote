//! The state the read-aloud and speech commands share: the live sessions and the sound of each clip until
//! the interface fetches it.
//!
//! The protocol is pull, not push. The interface asks for each notice with [`SpeechHub::next`], and the
//! hub takes exactly one event from the session for it. The session synthesizes at most a few chunks ahead
//! of the ones taken, so that bound now holds from the engine to the speaker. A person who stops after a
//! paragraph costs a paragraph of work, and the hub never holds a page of sound.
//!
//! Clips belong to their session. A session's clips go when it is canceled, finishes, or fails. A session
//! keeps at most [`CLIPS_PER_SESSION`] clips. The hub keeps at most [`MAX_CLIPS`] and [`MAX_SESSIONS`], and
//! drops the oldest first. Clips that are never fetched cannot pile up for the life of the app.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::speech::{ReadAloudNotice, ReadAloudRequest, ReadAloudStarted, SpeechClip, SynthesizeRequest};
use crate::engines::Engines;
use crate::error::IntelError;
use crate::speech::{ReadAloud, ReadAloudEvent, ReadAloudOptions, Waited, DEFAULT_CHUNK_CHARS};

/// The most sessions alive at once. Starting another ends the oldest.
pub const MAX_SESSIONS: usize = 4;
/// The most clips the hub holds, from sessions and single phrases together. A new one drops the oldest.
pub const MAX_CLIPS: usize = 16;
/// The most clips one session holds. The interface fetches each chunk's sound before it pulls the next, so
/// an older clip of the session was skipped.
const CLIPS_PER_SESSION: usize = 2;
/// How long one wait for a session holds its lock, so a cancel never waits long.
const POLL: Duration = Duration::from_millis(100);
/// A session that makes no chunk for this long has stopped working.
const STALLED: Duration = Duration::from_secs(60);

type Session = Arc<Mutex<ReadAloud>>;

/// One clip's sound, and the session it belongs to.
struct Clip {
    id: String,
    session: Option<String>,
    wav: Vec<u8>,
}

#[derive(Default)]
struct State {
    /// Oldest first.
    sessions: VecDeque<(String, Session)>,
    /// Oldest first.
    clips: VecDeque<Clip>,
}

impl State {
    fn session(&self, id: &str) -> Option<Session> {
        self.sessions
            .iter()
            .find(|(found, _)| found == id)
            .map(|(_, s)| Arc::clone(s))
    }

    /// Takes the session and its clips out. The caller drops the session outside the lock, because ending
    /// one waits for the chunk being made.
    fn remove_session(&mut self, id: &str) -> Option<Session> {
        self.clips.retain(|clip| clip.session.as_deref() != Some(id));
        let at = self.sessions.iter().position(|(found, _)| found == id)?;
        self.sessions.remove(at).map(|(_, session)| session)
    }

    fn store(&mut self, clip: Clip) {
        if let Some(session) = &clip.session {
            let mine: Vec<usize> = (0..self.clips.len())
                .filter(|&i| self.clips[i].session.as_ref() == Some(session))
                .collect();
            for &i in mine.iter().rev().skip(CLIPS_PER_SESSION - 1) {
                self.clips.remove(i);
            }
        }
        while self.clips.len() >= MAX_CLIPS {
            self.clips.pop_front();
        }
        self.clips.push_back(clip);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The sessions and clips behind the speech commands. One per app, shared by every command.
#[derive(Default)]
pub struct SpeechHub {
    state: Mutex<State>,
    next_id: AtomicU64,
}

impl SpeechHub {
    /// An empty hub.
    pub fn new() -> SpeechHub {
        SpeechHub::default()
    }

    fn new_id(&self, kind: &str) -> String {
        format!("{kind}-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1)
    }

    /// Synthesizes one short text and keeps its sound for [`SpeechHub::clip_audio`].
    pub fn synthesize(&self, engines: &Engines, request: SynthesizeRequest) -> Result<SpeechClip, IntelError> {
        let audio = engines.speech()?.synthesize(&request.text, &request.speak)?;
        let clip_id = self.new_id("clip");
        lock(&self.state).store(Clip {
            id: clip_id.clone(),
            session: None,
            wav: audio.wav,
        });
        Ok(SpeechClip {
            clip_id,
            info: audio.info,
        })
    }

    /// Starts reading a page. Nothing is synthesized beyond the first few chunks until the interface pulls.
    pub fn start(&self, engines: &Engines, request: ReadAloudRequest) -> Result<ReadAloudStarted, IntelError> {
        let options = ReadAloudOptions {
            speak: request.speak,
            max_chunk_chars: request.max_chunk_chars.unwrap_or(DEFAULT_CHUNK_CHARS),
            ..ReadAloudOptions::default()
        };
        let session = engines.read_aloud(&request.text, options)?;
        let total_chunks = session.total_chunks();
        let session_id = self.new_id("session");
        let ended = {
            let mut state = lock(&self.state);
            let oldest = (state.sessions.len() >= MAX_SESSIONS).then(|| state.sessions[0].0.clone());
            let ended = oldest.and_then(|id| state.remove_session(&id));
            state
                .sessions
                .push_back((session_id.clone(), Arc::new(Mutex::new(session))));
            ended
        };
        drop(ended);
        Ok(ReadAloudStarted {
            session_id,
            total_chunks,
        })
    }

    /// Takes the session's next notice, waiting for the chunk if it is not made yet. A chunk's sound waits
    /// under its clip ID. After `finished` or `failed` the session and its clips are gone. A session that was
    /// canceled or never existed fails with [`IntelError::Canceled`].
    pub fn next(&self, session_id: &str) -> Result<ReadAloudNotice, IntelError> {
        let started = Instant::now();
        loop {
            let session = lock(&self.state).session(session_id).ok_or(IntelError::Canceled)?;
            let waited = lock(&session).wait(POLL);
            match waited {
                Waited::Event(ReadAloudEvent::Chunk(chunk)) => {
                    let clip_id = self.new_id("clip");
                    let notice = ReadAloudNotice::Chunk {
                        index: chunk.index,
                        total: chunk.total,
                        span: chunk.span,
                        info: chunk.audio.info,
                        clip_id: clip_id.clone(),
                    };
                    let mut state = lock(&self.state);
                    // A cancel between the wait and here leaves the chunk with no one to fetch it.
                    if state.session(session_id).is_none() {
                        return Err(IntelError::Canceled);
                    }
                    state.store(Clip {
                        id: clip_id,
                        session: Some(session_id.to_owned()),
                        wav: chunk.audio.wav,
                    });
                    return Ok(notice);
                }
                Waited::Event(last) => {
                    let ended = lock(&self.state).remove_session(session_id);
                    drop(ended);
                    return Ok(ReadAloudNotice::from_event(&last, |_| String::new()));
                }
                Waited::TimedOut if started.elapsed() < STALLED => {}
                Waited::TimedOut | Waited::Ended => {
                    self.cancel(session_id);
                    return Err(IntelError::Engine(
                        "the read-aloud session stopped making sound".to_owned(),
                    ));
                }
            }
        }
    }

    /// Hands over a clip's sound and forgets it.
    pub fn clip_audio(&self, clip_id: &str) -> Result<Vec<u8>, IntelError> {
        let mut state = lock(&self.state);
        let at = state.clips.iter().position(|clip| clip.id == clip_id).ok_or_else(|| {
            IntelError::InvalidInput(format!(
                "there is no clip {clip_id}: it was fetched already, or its session ended"
            ))
        })?;
        Ok(state.clips.remove(at).map(|clip| clip.wav).unwrap_or_default())
    }

    /// Ends a session and drops its clips. Ending one that is already over does nothing.
    pub fn cancel(&self, session_id: &str) {
        let ended = lock(&self.state).remove_session(session_id);
        drop(ended);
    }

    /// How many sessions and clips the hub holds, for tests and diagnostics.
    pub fn held(&self) -> (usize, usize) {
        let state = lock(&self.state);
        (state.sessions.len(), state.clips.len())
    }
}
