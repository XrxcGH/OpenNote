//! On-device intelligence for the interface (Phase 12): text in images, handwriting, read aloud, and summaries.
//!
//! Every command goes through `Engines`, which refuses a feature the person has not turned on, so no command checks
//! a switch itself. Nothing here opens a connection, and the crate behind it holds no network code. The person's
//! choices live in `intel.json` beside this device's state, because which engines work depends on the language
//! packs and voices installed on this computer. Every feature starts off.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, PoisonError, RwLock, RwLockReadGuard},
};

use opennote_intel::{
    wire::{
        ActionItem, ActionItemsRequest, Chapter, ChaptersRequest, InkRecognition, InkRequest, Keyword, KeywordsRequest,
        OcrRequest, OcrResult, Offer, ReadAloudNotice, ReadAloudRequest, ReadAloudStarted, SpeechClip, SpeechHub,
        SummarizeRequest, Summary, SynthesizeRequest, TidyPlan, TidyRequest, VocabularyOfferRequest, Voice,
    },
    Engines, Feature, FeatureStatus, IntelError, IntelSettings,
};
use serde::Deserialize;
use tauri::{async_runtime::spawn_blocking, ipc::Response, State};

use crate::{
    ipc::{codes, IpcError, IpcResult},
    paths::Paths,
    settings::file::write_json,
};

mod ext;
mod models;
mod transcribe;

pub use transcribe::{intel_transcribe, intel_transcribe_cancel};

#[cfg(test)]
mod tests;

/// The file that holds the person's choices, in this device's folder.
const FILE_NAME: &str = "intel.json";

/// The features to change. A feature left out stays as it is.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IntelSettingsPatch {
    pub ocr: Option<bool>,
    pub handwriting: Option<bool>,
    pub read_aloud: Option<bool>,
    pub summaries: Option<bool>,
    pub transcription: Option<bool>,
}

impl IntelSettingsPatch {
    fn apply(&self, settings: &mut IntelSettings) {
        let choices = [
            (Feature::Ocr, self.ocr),
            (Feature::Handwriting, self.handwriting),
            (Feature::ReadAloud, self.read_aloud),
            (Feature::Summaries, self.summaries),
            (Feature::Transcription, self.transcription),
        ];
        for (feature, on) in choices {
            if let Some(on) = on {
                settings.set(feature, on);
            }
        }
    }
}

/// The error the interface receives: the crate's code, its message, and the feature to offer in `field`.
pub fn ipc_error(error: &IntelError) -> IpcError {
    let info = error.info();
    let field = info
        .feature
        .and_then(|feature| serde_json::to_value(feature).ok())
        .and_then(|value| value.as_str().map(str::to_owned));
    IpcError {
        code: info.code,
        message: info.message,
        field,
    }
}

/// Reads the saved choices. A missing or unreadable file means everything is off, which is the safe answer.
fn load(file: &Path) -> IntelSettings {
    match fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
            ::log::warn!(
                "Couldn't read {}: {error}. Every on-device feature stays off.",
                file.display()
            );
            IntelSettings::default()
        }),
        Err(_) => IntelSettings::default(),
    }
}

struct Inner {
    file: PathBuf,
    /// The choices, which are also the source for the engines once they exist.
    settings: Mutex<IntelSettings>,
    /// Made on first use, so start-up does not wait for Windows to list engines.
    engines: OnceLock<RwLock<Engines>>,
    hub: SpeechHub,
    ext: ext::Ext,
    /// This device's folder, which holds the downloaded models.
    device: PathBuf,
    /// The transcription jobs, made on the first one, when the app handle for their events is known.
    transcribe: OnceLock<opennote_intel::wire::TranscribeHub>,
}

/// The app's on-device intelligence: the person's choices, the engines behind them, and the read-aloud hub.
#[derive(Clone)]
pub struct IntelState(Arc<Inner>);

impl IntelState {
    pub fn new(paths: &Paths) -> IntelState {
        IntelState::at(paths.local.join(FILE_NAME))
    }

    fn at(file: PathBuf) -> IntelState {
        let settings = load(&file);
        let device = file.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
        let ext = ext::Ext::new(&device);
        IntelState(Arc::new(Inner {
            file,
            settings: Mutex::new(settings),
            engines: OnceLock::new(),
            hub: SpeechHub::new(),
            ext,
            device,
            transcribe: OnceLock::new(),
        }))
    }

    fn choices(&self) -> IntelSettings {
        // Safe mode turns the on-device models off (Phase 13), whatever the person chose.
        if crate::hardening::safe_mode() {
            return IntelSettings::default();
        }
        *self.0.settings.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn engines(&self) -> RwLockReadGuard<'_, Engines> {
        let engines = match self.0.engines.get() {
            Some(engines) => engines,
            None => {
                // Made while holding the choices, so a change that lands meanwhile waits and then updates them.
                let settings = self.0.settings.lock().unwrap_or_else(PoisonError::into_inner);
                self.0.engines.get_or_init(|| {
                    let mut engines = Engines::platform(*settings);
                    engines.set_speech_model(transcribe::installed_speech_model(&self.0.device).as_deref());
                    RwLock::new(engines)
                })
            }
        };
        engines.read().unwrap_or_else(PoisonError::into_inner)
    }

    /// This device's folder.
    fn device(&self) -> &Path {
        &self.0.device
    }

    /// Makes `model` the speech model the engines use, if it isn't already.
    fn use_speech_model(&self, model: &Path) {
        // Make the engines first, so the change below lands on them.
        drop(self.engines());
        let engines = self.0.engines.get();
        if let Some(engines) = engines {
            let mut engines = engines.write().unwrap_or_else(PoisonError::into_inner);
            if engines.speech_model().as_deref() != Some(model) {
                engines.set_speech_model(Some(model));
            }
        }
    }

    /// What the person has turned on.
    pub fn settings(&self) -> IntelSettings {
        self.choices()
    }

    /// Changes the choices, saves them, and tells the engines. The change takes effect at the next request.
    pub fn update(&self, patch: &IntelSettingsPatch) -> Result<IntelSettings, IpcError> {
        let mut settings = self.0.settings.lock().unwrap_or_else(PoisonError::into_inner);
        let mut next = *settings;
        patch.apply(&mut next);
        if next != *settings {
            let json = serde_json::to_value(next).map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
            write_json(&self.0.file, &json)?;
            *settings = next;
            if let Some(engines) = self.0.engines.get() {
                engines
                    .write()
                    .unwrap_or_else(PoisonError::into_inner)
                    .set_settings(next);
            }
        }
        Ok(next)
    }

    pub fn status(&self) -> Vec<FeatureStatus> {
        self.engines().status()
    }

    pub fn ocr_languages(&self) -> Result<Vec<String>, IntelError> {
        let languages = self.engines().ocr()?.available_languages()?;
        Ok(languages.iter().map(|language| language.to_string()).collect())
    }

    pub fn ocr_recognize(&self, request: OcrRequest) -> Result<OcrResult, IntelError> {
        let engine = self.engines().ocr()?;
        let (image, options) = request.into_parts()?;
        engine.recognize(&image, &options)
    }

    pub fn ink_recognize(&self, request: &InkRequest) -> Result<InkRecognition, IntelError> {
        let engine = self.engines().ink()?;
        engine.recognize(&request.strokes, &request.options())
    }

    pub fn ink_tidy(&self, request: &TidyRequest) -> Result<TidyPlan, IntelError> {
        self.engines()
            .tidy(&request.strokes, &request.recognition, &request.operation)
    }

    pub fn summarize(&self, request: &SummarizeRequest) -> Result<Summary, IntelError> {
        let engine = self.engines().summarizer()?;
        engine.summarize(&request.text, &request.options)
    }

    pub fn keywords(&self, request: &KeywordsRequest) -> Result<Vec<Keyword>, IntelError> {
        let engine = self.engines().summarizer()?;
        engine.keywords(&request.text, &request.options)
    }

    pub fn action_items(&self, request: &ActionItemsRequest) -> Result<Vec<ActionItem>, IntelError> {
        self.engines().action_items(&request.transcript)
    }

    pub fn chapters(&self, request: &ChaptersRequest) -> Result<Vec<Chapter>, IntelError> {
        self.engines().chapters(&request.transcript, &request.options)
    }

    pub fn vocabulary_offer(&self, request: &VocabularyOfferRequest) -> Result<Option<Offer>, IntelError> {
        request.offer(&self.engines())
    }

    pub fn voices(&self) -> Result<Vec<Voice>, IntelError> {
        self.engines().speech()?.voices()
    }

    pub fn synthesize(&self, request: SynthesizeRequest) -> Result<SpeechClip, IntelError> {
        self.0.hub.synthesize(&self.engines(), request)
    }

    pub fn read_aloud_start(&self, request: ReadAloudRequest) -> Result<ReadAloudStarted, IntelError> {
        self.0.hub.start(&self.engines(), request)
    }

    /// Waits for the session's next chunk, so it must not run on the interface thread.
    pub fn read_aloud_next(&self, session_id: &str) -> Result<ReadAloudNotice, IntelError> {
        self.0.hub.next(session_id)
    }

    /// Ends a session. It waits for the chunk being made, so it must not run on the interface thread.
    pub fn read_aloud_cancel(&self, session_id: &str) {
        self.0.hub.cancel(session_id);
    }

    pub fn clip_audio(&self, clip_id: &str) -> Result<Vec<u8>, IntelError> {
        self.0.hub.clip_audio(clip_id)
    }
}

/// Runs engine work off the interface thread, because recognition and speech take from milliseconds to seconds.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, IntelError> + Send + 'static) -> IpcResult<T> {
    match spawn_blocking(work).await {
        Ok(result) => result.map_err(|error| ipc_error(&error)),
        Err(error) => Err(IpcError::new(codes::INTERNAL, error.to_string())),
    }
}

#[tauri::command]
pub async fn intel_settings_get(state: State<'_, IntelState>) -> IpcResult<IntelSettings> {
    Ok(state.settings())
}

#[tauri::command]
pub async fn intel_settings_set(state: State<'_, IntelState>, patch: IntelSettingsPatch) -> IpcResult<IntelSettings> {
    let state = state.inner().clone();
    match spawn_blocking(move || state.update(&patch)).await {
        Ok(result) => result,
        Err(error) => Err(IpcError::new(codes::INTERNAL, error.to_string())),
    }
}

#[tauri::command]
pub async fn intel_status(state: State<'_, IntelState>) -> IpcResult<Vec<FeatureStatus>> {
    let state = state.inner().clone();
    blocking(move || Ok(state.status())).await
}

#[tauri::command]
pub async fn intel_ocr_languages(state: State<'_, IntelState>) -> IpcResult<Vec<String>> {
    let state = state.inner().clone();
    blocking(move || state.ocr_languages()).await
}

#[tauri::command]
pub async fn intel_ocr_recognize(state: State<'_, IntelState>, request: OcrRequest) -> IpcResult<OcrResult> {
    let state = state.inner().clone();
    blocking(move || state.ocr_recognize(request)).await
}

#[tauri::command]
pub async fn intel_ink_recognize(state: State<'_, IntelState>, request: InkRequest) -> IpcResult<InkRecognition> {
    let state = state.inner().clone();
    blocking(move || state.ink_recognize(&request)).await
}

#[tauri::command]
pub async fn intel_ink_tidy(state: State<'_, IntelState>, request: TidyRequest) -> IpcResult<TidyPlan> {
    let state = state.inner().clone();
    blocking(move || state.ink_tidy(&request)).await
}

#[tauri::command]
pub async fn intel_summarize(state: State<'_, IntelState>, request: SummarizeRequest) -> IpcResult<Summary> {
    let state = state.inner().clone();
    blocking(move || state.summarize(&request)).await
}

#[tauri::command]
pub async fn intel_keywords(state: State<'_, IntelState>, request: KeywordsRequest) -> IpcResult<Vec<Keyword>> {
    let state = state.inner().clone();
    blocking(move || state.keywords(&request)).await
}

#[tauri::command]
pub async fn intel_action_items(
    state: State<'_, IntelState>,
    request: ActionItemsRequest,
) -> IpcResult<Vec<ActionItem>> {
    let state = state.inner().clone();
    blocking(move || state.action_items(&request)).await
}

#[tauri::command]
pub async fn intel_chapters(state: State<'_, IntelState>, request: ChaptersRequest) -> IpcResult<Vec<Chapter>> {
    let state = state.inner().clone();
    blocking(move || state.chapters(&request)).await
}

#[tauri::command]
pub async fn intel_vocabulary_offer(
    state: State<'_, IntelState>,
    request: VocabularyOfferRequest,
) -> IpcResult<Option<Offer>> {
    let state = state.inner().clone();
    blocking(move || state.vocabulary_offer(&request)).await
}

#[tauri::command]
pub async fn intel_speech_voices(state: State<'_, IntelState>) -> IpcResult<Vec<Voice>> {
    let state = state.inner().clone();
    blocking(move || state.voices()).await
}

#[tauri::command]
pub async fn intel_speech_synthesize(
    state: State<'_, IntelState>,
    request: SynthesizeRequest,
) -> IpcResult<SpeechClip> {
    let state = state.inner().clone();
    blocking(move || state.synthesize(request)).await
}

#[tauri::command]
pub async fn intel_read_aloud_start(
    state: State<'_, IntelState>,
    request: ReadAloudRequest,
) -> IpcResult<ReadAloudStarted> {
    let state = state.inner().clone();
    blocking(move || state.read_aloud_start(request)).await
}

#[tauri::command]
pub async fn intel_read_aloud_next(state: State<'_, IntelState>, session_id: String) -> IpcResult<ReadAloudNotice> {
    let state = state.inner().clone();
    blocking(move || state.read_aloud_next(&session_id)).await
}

#[tauri::command]
pub async fn intel_read_aloud_cancel(state: State<'_, IntelState>, session_id: String) -> IpcResult<()> {
    let state = state.inner().clone();
    blocking(move || {
        state.read_aloud_cancel(&session_id);
        Ok(())
    })
    .await
}

/// The WAV bytes of a clip, raw and not as JSON numbers. The hub forgets the clip once it hands the bytes over.
#[tauri::command]
pub async fn intel_clip_audio(state: State<'_, IntelState>, clip_id: String) -> IpcResult<Response> {
    let state = state.inner().clone();
    blocking(move || state.clip_audio(&clip_id).map(Response::new)).await
}

/// Model downloads and the device store (see `ext.rs`). One command, so a new method adds no permission.
#[tauri::command]
pub async fn intel_ext_call(state: State<'_, IntelState>, request: ext::ExtRequest) -> IpcResult<serde_json::Value> {
    let ext = state.0.ext.clone();
    match spawn_blocking(move || ext.call(&request, crate::hardening::offline(), crate::hardening::safe_mode())).await {
        Ok(result) => result,
        Err(error) => Err(IpcError::new(codes::INTERNAL, error.to_string())),
    }
}
