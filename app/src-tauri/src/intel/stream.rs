//! Speech to text while the person talks (A2-24 dictation and A2-25 live captions). The interface asks to start a
//! session, the shell opens the default microphone, and the Whisper model on this device reads each stretch of
//! speech. Words reach the interface as `intel-stream` events with the session's ID. The audio is read in memory,
//! never written to disk, and never leaves this device; a session ends when the interface stops it, when
//! transcription is turned off, or when the window closes.
//!
//! The microphone opens only after the interface asks, and the interface asks only after the person pressed
//! Dictate or turned on live captions. Windows shows its own microphone indicator while the stream is open.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};

#[cfg_attr(not(windows), allow(unused_imports))]
use opennote_intel::wire::{StreamEvent, StreamOptions};
use opennote_intel::{Feature, IntelError};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::transcribe::speech_model_path;
use super::IntelState;
use crate::ipc::{codes, IpcError, IpcResult};

/// The event every session update arrives as.
pub const EVENT: &str = "intel-stream";

/// The most sessions open at once: one of dictation and one of captions.
const MAX_SESSIONS: usize = 2;
/// The most vocabulary text a request may carry.
const MAX_VOCABULARY_BYTES: usize = 64 * 1024;

/// What the session is for, which sets how it finds the ends of phrases.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Purpose {
    Dictation,
    Captions,
}

/// What to listen for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamRequest {
    pub purpose: Purpose,
    /// The catalog ID of the downloaded speech model.
    pub model: String,
    /// A BCP 47 tag, or none to let the model detect it.
    #[serde(default)]
    pub language: Option<String>,
    /// The notebook's vocabulary list, as plain text.
    #[serde(default)]
    pub vocabulary: String,
}

/// A session's news, for the interface.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamUpdate {
    /// The microphone is open and the model is ready.
    Listening,
    /// Speech was noticed.
    Speaking,
    /// A rough reading of the phrase so far.
    Partial { text: String, behind_ms: u64 },
    /// The finished words of a phrase.
    Final {
        text: String,
        start_ms: u64,
        end_ms: u64,
        behind_ms: u64,
    },
    /// The session ended on its own, with why.
    Ended { error: Option<String> },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Message<'a> {
    session: &'a str,
    update: &'a StreamUpdate,
}

struct Session {
    purpose: Purpose,
    stop: Arc<AtomicBool>,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> = LazyLock::new(Default::default);
static NEXT: AtomicU64 = AtomicU64::new(1);

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, Session>> {
    SESSIONS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Starts listening and returns the session's ID. Needs transcription turned on and a downloaded speech model.
#[tauri::command]
pub async fn intel_stream_start(
    app: AppHandle,
    state: State<'_, IntelState>,
    request: StreamRequest,
) -> IpcResult<String> {
    if request.vocabulary.len() > MAX_VOCABULARY_BYTES {
        return Err(IpcError::invalid("vocabulary", "The vocabulary list is too long."));
    }
    let language = request.language.clone().filter(|tag| !tag.is_empty());
    if let Some(tag) = language.as_deref() {
        opennote_intel::wire::check_language(tag).map_err(|error| super::ipc_error(&error))?;
    }
    state
        .engines()
        .require(Feature::Transcription)
        .map_err(|error| super::ipc_error(&error))?;
    let model = speech_model_path(state.device(), &request.model).map_err(|error| super::ipc_error(&error))?;
    state.use_speech_model(&model);
    let id = {
        let mut sessions = lock();
        if sessions.values().any(|s| s.purpose == request.purpose) {
            return Err(IpcError::new(codes::INVALID, "That is already listening."));
        }
        if sessions.len() >= MAX_SESSIONS {
            return Err(IpcError::new(codes::INVALID, "Too many things are listening."));
        }
        let id = format!("s{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let stop = Arc::new(AtomicBool::new(false));
        sessions.insert(
            id.clone(),
            Session {
                purpose: request.purpose,
                stop: Arc::clone(&stop),
            },
        );
        (id, stop)
    };
    let (id, stop) = id;
    let (state, key) = (state.inner().clone(), id.clone());
    let prompt = opennote_intel::wire::vocabulary_prompt(&request.vocabulary);
    let purpose = request.purpose;
    let spawned = std::thread::Builder::new()
        .name("opennote-stream".to_owned())
        .spawn(move || {
            let send = |update: &StreamUpdate| {
                let _ = app.emit(EVENT, Message { session: &key, update });
            };
            let outcome = run(&state, language, prompt, purpose, &stop, &send);
            lock().remove(&key);
            send(&StreamUpdate::Ended {
                error: outcome.err().map(|error| error.to_string()),
            });
        });
    if let Err(error) = spawned {
        lock().remove(&id);
        return Err(IpcError::new(codes::INTERNAL, error.to_string()));
    }
    Ok(id)
}

/// Stops a session and closes the microphone. Resolves false when the session was already over.
#[tauri::command]
pub async fn intel_stream_stop(session: String) -> IpcResult<bool> {
    match lock().get(&session) {
        Some(found) => {
            found.stop.store(true, Ordering::Relaxed);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(windows)]
fn run(
    state: &IntelState,
    language: Option<String>,
    prompt: String,
    purpose: Purpose,
    stop: &AtomicBool,
    send: &dyn Fn(&StreamUpdate),
) -> Result<(), IntelError> {
    use opennote_media::audio::{
        device::CpalSource,
        resample::Resampler,
        ring::{packet_channel, SinkHandle},
        AudioSource,
    };
    use std::time::{Duration, Instant};

    let options = match purpose {
        Purpose::Dictation => StreamOptions::DICTATION,
        Purpose::Captions => StreamOptions::CAPTIONS,
    };
    // Load the model before the microphone opens, so a missing or broken model never listens.
    let mut streamer = state.engines().live_stream(language.as_deref(), prompt, options)?;
    let mut source = CpalSource::microphone().map_err(|error| IntelError::Audio(error.to_string()))?;
    let format = source.format();
    let (sink, mut reader) = packet_channel(
        format,
        usize::try_from(format.rate).unwrap_or(48_000) * 2,
        Arc::default(),
    );
    source
        .start(SinkHandle::new(sink))
        .map_err(|error| IntelError::Audio(error.to_string()))?;
    send(&StreamUpdate::Listening);
    let (mut resampler, mut rate) = (Resampler::new(format.rate), format.rate);
    let (mut packet, mut converted) = (Vec::new(), Vec::new());
    let started = Instant::now();
    let mut first_capture: Option<u64> = None;
    let result = (|| -> Result<(), IntelError> {
        while !stop.load(Ordering::Relaxed) {
            // Turning transcription off, or safe mode, ends the session at once.
            if !state.choices().transcription {
                return Ok(());
            }
            let Some(info) = reader.next(&mut packet) else {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            };
            if info.rate != rate {
                resampler = Resampler::new(info.rate);
                rate = info.rate;
            }
            let base = *first_capture.get_or_insert(info.capture_ns);
            resampler.process(&packet, &mut converted);
            // How far the words trail the sound: the time since this packet was heard, less the time since it began.
            let behind = || {
                let heard_at = Duration::from_nanos(info.capture_ns.saturating_sub(base));
                u64::try_from(started.elapsed().saturating_sub(heard_at).as_millis()).unwrap_or(u64::MAX)
            };
            streamer.push_48k(&converted, &mut |event| {
                send(&match event {
                    StreamEvent::Speaking => StreamUpdate::Speaking,
                    StreamEvent::Partial { text } => StreamUpdate::Partial {
                        text,
                        behind_ms: behind(),
                    },
                    StreamEvent::Final { text, start_ms, end_ms } => StreamUpdate::Final {
                        text,
                        start_ms,
                        end_ms,
                        behind_ms: behind(),
                    },
                });
            })?;
        }
        streamer.finish(&mut |event| {
            if let StreamEvent::Final { text, start_ms, end_ms } = event {
                send(&StreamUpdate::Final {
                    text,
                    start_ms,
                    end_ms,
                    behind_ms: 0,
                });
            }
        })
    })();
    source.stop();
    result
}

#[cfg(not(windows))]
fn run(
    _state: &IntelState,
    _language: Option<String>,
    _prompt: String,
    _purpose: Purpose,
    _stop: &AtomicBool,
    _send: &dyn Fn(&StreamUpdate),
) -> Result<(), IntelError> {
    Err(IntelError::Unsupported { feature: "listening" })
}
