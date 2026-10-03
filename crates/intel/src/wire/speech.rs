//! The read-aloud and speech shapes. The interface pulls a session's notices one at a time with the
//! `intel_read_aloud_next` command. It fetches each chunk's sound by its clip ID before it pulls the next.
//! [`SpeechHub`](super::SpeechHub) keeps the sessions and the sounds in between.

use serde::{Deserialize, Serialize};

use crate::error::ErrorInfo;
use crate::speech::{ReadAloudEvent, ReadChunk, SpeakOptions, SpeechInfo};
use crate::text::Span;

/// A request to synthesize one short text, such as a phrase. Read a page with [`ReadAloudRequest`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeRequest {
    /// The text to speak.
    pub text: String,
    /// Voice, speed, pitch, and volume.
    #[serde(default)]
    pub speak: SpeakOptions,
}

/// A synthesized clip. Its sound waits under `clip_id` until the interface fetches it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechClip {
    /// Names the sound for the fetch command.
    pub clip_id: String,
    /// The clip's length and word times.
    pub info: SpeechInfo,
}

/// A request to read text aloud. The start command returns a session, and the interface pulls its chunks.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAloudRequest {
    /// The text to read, at most [`MAX_READ_ALOUD_CHARS`](crate::speech::MAX_READ_ALOUD_CHARS) characters.
    pub text: String,
    /// Voice, speed, pitch, and volume.
    #[serde(default)]
    pub speak: SpeakOptions,
    /// The longest chunk in characters. `None` uses the default.
    #[serde(default)]
    pub max_chunk_chars: Option<usize>,
}

/// The reply to starting a session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAloudStarted {
    /// Names the session for the next and cancel commands.
    pub session_id: String,
    /// How many chunks the text was cut into.
    pub total_chunks: usize,
}

/// What one pull of a read-aloud session returns.
///
/// A chunk's sound is not in the notice. The hub keeps it under `clip_id` and hands it over on request, as
/// raw bytes, because a sound file is far larger than the rest of the notice.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReadAloudNotice {
    /// The next chunk is ready to fetch and play.
    #[serde(rename_all = "camelCase")]
    Chunk {
        /// The chunk's position, counting from 0.
        index: usize,
        /// How many chunks the text has.
        total: usize,
        /// Where the chunk sits in the text, in UTF-16 units.
        span: Span,
        /// The chunk's length and word times, with positions inside the chunk.
        info: SpeechInfo,
        /// Names the sound for the fetch command.
        clip_id: String,
    },
    /// Every chunk was delivered, and the session is over.
    Finished,
    /// Synthesis failed, and the session is over.
    Failed {
        /// What went wrong.
        error: ErrorInfo,
    },
}

impl ReadAloudNotice {
    /// Turns a session event into a notice. The caller stores the chunk's sound under `clip_id` first.
    /// For a chunk, `clip_id` is called once to name the sound.
    pub fn from_event(event: &ReadAloudEvent, clip_id: impl FnOnce(&ReadChunk) -> String) -> ReadAloudNotice {
        match event {
            ReadAloudEvent::Chunk(chunk) => ReadAloudNotice::Chunk {
                index: chunk.index,
                total: chunk.total,
                span: chunk.span,
                info: chunk.audio.info.clone(),
                clip_id: clip_id(chunk),
            },
            ReadAloudEvent::Finished => ReadAloudNotice::Finished,
            ReadAloudEvent::Failed(error) => ReadAloudNotice::Failed { error: error.info() },
        }
    }
}
