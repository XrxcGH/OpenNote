//! Transcribing a recording on this device (Phase 12, A1-3): the interface names the page's recording and a
//! downloaded speech model, and the job runs in the background, one at a time. Each step of a job reaches the
//! interface as an `intel-transcribe` event with the job's ID: started, progress, each line heard, then done with
//! the whole transcript, failed, or canceled. The audio is read from the page's own files and never copied.

use std::path::{Path, PathBuf};

use opennote_intel::{
    wire::{Pcm48k, TranscribeChoices, TranscribeHub, TranscribeUpdate},
    IntelError,
};
use opennote_media::{
    layout::RecordingEntry,
    playback::open_recording,
    transcribe::{MixedPcm, PcmSource},
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{models, IntelState};
use crate::{
    audio::{checked_dir, AudioState},
    core_bridge::CoreBridge,
    ipc::{codes, IpcError, IpcResult},
};

/// The event every job update arrives as.
pub const EVENT: &str = "intel-transcribe";

/// A job's update, as the interface receives it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobUpdate<'a> {
    pub job: &'a str,
    pub update: &'a TranscribeUpdate,
}

/// What to transcribe.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// The page's `assets` folder, which holds the recording's files.
    pub assets_dir: String,
    /// The recording, with the tracks to read: the original's, or the enhanced copy's.
    pub entry: RecordingEntry,
    /// The catalog ID of the downloaded speech model to use.
    pub model: String,
    #[serde(default)]
    pub choices: TranscribeChoices,
}

/// The most vocabulary text a request may carry, as the crate's list limit allows.
const MAX_VOCABULARY_BYTES: usize = 512 * 1024;

/// The file of an installed speech model by catalog ID, or why it can't be used.
pub fn speech_model_path(device: &Path, id: &str) -> Result<PathBuf, IntelError> {
    let spec = models::CATALOG
        .iter()
        .find(|spec| spec.id == id && spec.kind == "speech")
        .ok_or_else(|| IntelError::InvalidInput("that isn't a speech model OpenNote offers".to_owned()))?;
    let path = device.join("models").join(spec.file);
    let complete = std::fs::metadata(&path).is_ok_and(|meta| meta.len() == spec.size);
    if complete {
        Ok(path)
    } else {
        Err(IntelError::ModelMissing {
            model: spec.name.to_owned(),
        })
    }
}

/// The first installed speech model, in the order of preference: the balanced English model, then the others.
pub fn installed_speech_model(device: &Path) -> Option<PathBuf> {
    const PREFERENCE: [&str; 5] = [
        "speech-base-en",
        "speech-small-en",
        "speech-tiny-en",
        "speech-base",
        "speech-small",
    ];
    PREFERENCE.iter().find_map(|id| speech_model_path(device, id).ok())
}

fn hub(state: &IntelState, app: &AppHandle) -> &TranscribeHub {
    state.0.transcribe.get_or_init(|| {
        let app = app.clone();
        TranscribeHub::new(move |job, update| {
            // A closed window can't receive it; the job's end is in the interface's own state then.
            let _ = app.emit(EVENT, JobUpdate { job, update });
        })
    })
}

fn open_audio(app: &AppHandle, dir: &Path, entry: &RecordingEntry) -> IpcResult<Pcm48k> {
    let audio = app.state::<AudioState>();
    let summary = entry.summary().map_err(crate::audio::audio_error)?;
    let decoder = audio.services().decoder.clone();
    let player = open_recording(dir, &summary, &decoder).map_err(crate::audio::audio_error)?;
    let pcm = MixedPcm::new(player);
    let total = pcm.total();
    let (dir, summary) = (dir.to_path_buf(), summary.clone());
    let shared = std::sync::Arc::new(std::sync::Mutex::new(pcm));
    let reader = std::sync::Arc::clone(&shared);
    Ok(Pcm48k::new(total, move |out| {
        reader
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .read(out)
            .map_err(|error| error.to_string())
    })
    .with_rewind(move || {
        let player = open_recording(&dir, &summary, &decoder).map_err(|error| error.to_string())?;
        *shared.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = MixedPcm::new(player);
        Ok(())
    }))
}

/// Starts transcribing a recording and returns the job's ID. Updates follow as `intel-transcribe` events.
#[tauri::command]
pub async fn intel_transcribe(
    app: AppHandle,
    state: State<'_, IntelState>,
    bridge: State<'_, CoreBridge>,
    request: TranscribeRequest,
) -> IpcResult<String> {
    if request.choices.vocabulary.len() > MAX_VOCABULARY_BYTES {
        return Err(IpcError::invalid("choices", "The vocabulary list is too long."));
    }
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &request.assets_dir))?;
    let state = state.inner().clone();
    let work = move || -> IpcResult<String> {
        let model = speech_model_path(state.device(), &request.model).map_err(|error| super::ipc_error(&error))?;
        state.use_speech_model(&model);
        let audio = open_audio(&app, &dir, &request.entry)?;
        let engines = state.engines();
        hub(&state, &app)
            .submit(&engines, &model, &request.choices, audio, None)
            .map_err(|error| super::ipc_error(&error))
    };
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(result) => result,
        Err(error) => Err(IpcError::new(codes::INTERNAL, error.to_string())),
    }
}

/// Cancels a transcription job, queued or running. Its `canceled` update follows.
#[tauri::command]
pub async fn intel_transcribe_cancel(app: AppHandle, state: State<'_, IntelState>, job: String) -> IpcResult<bool> {
    Ok(hub(state.inner(), &app).cancel(&job))
}
