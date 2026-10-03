//! The one place the app asks for an engine, and where the person's opt-in is enforced.
//!
//! Each accessor refuses with [`IntelError::Disabled`] unless the person turned the feature on, so a
//! feature that is off cannot run, however the interface is wired. The engines it hands out check the
//! switch again on every call, so turning a feature off also stops engines, read-aloud sessions, and
//! transcription queues handed out before. Nothing here reads, stores, or sends data. The engines run on
//! the device only.

mod gated;

use std::sync::{Arc, OnceLock};

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::ink::{self, InkRecognition, InkRecognizer, InkStroke};
use crate::mock::{MockSpeech, ReplayInk, ReplayOcr};
use crate::ocr::{self, OcrEngine};
use crate::settings::{Feature, IntelSettings};
use crate::speech::{self, ReadAloud, ReadAloudOptions, SpeechSynthesizer};
use crate::summarize::{
    default_summarizer, find_action_items, make_chapters, ActionItem, Chapter, ChapterOptions, Summarizer,
};
use crate::tidy::{self, TidyOperation, TidyPlan};
use crate::transcribe::{JobEvent, Transcript, TranscriptionEngine, TranscriptionQueue};
use crate::vocabulary::{Offer, Vocabulary};

use self::gated::{Gated, Switches};

/// What the settings screen needs to know about one feature.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureStatus {
    /// Which feature.
    pub feature: Feature,
    /// The person turned it on.
    pub enabled: bool,
    /// An engine exists on this computer. For a feature that is on, it also has what it needs to run. That is
    /// an OCR language pack for the person's languages, a handwriting recognizer, or a voice. A feature can be
    /// on and unavailable, and the screen then says why.
    pub available: bool,
    /// Why the feature is unavailable, in a sentence, when it is.
    pub unavailable_reason: Option<String>,
}

/// The engines of this crate, behind the person's choices.
pub struct Engines {
    settings: IntelSettings,
    /// The same choices, shared with every engine handed out.
    switches: Arc<Switches>,
    ocr: Result<Arc<dyn OcrEngine>, IntelError>,
    ink: Result<Arc<dyn InkRecognizer>, IntelError>,
    speech: Result<Arc<dyn SpeechSynthesizer>, IntelError>,
    summarizer: Arc<dyn Summarizer>,
    transcription: Option<Arc<dyn TranscriptionEngine>>,
    /// What the readiness checks found, by feature, so the settings screen does not ask Windows each time.
    /// New settings clear it, so turning a feature on again checks again.
    readiness: [OnceLock<Option<String>>; Feature::ALL.len()],
}

impl Engines {
    /// The engines of this platform. On Windows these are Windows.Media.Ocr, Windows Ink Analysis, and
    /// Windows.Media.SpeechSynthesis. Elsewhere, features without an engine are unavailable, and the
    /// extractive summarizer works everywhere.
    pub fn platform(settings: IntelSettings) -> Engines {
        Engines {
            settings,
            switches: Switches::new(settings),
            ocr: ocr::default_engine().map(Arc::from),
            ink: ink::default_recognizer().map(Arc::from),
            speech: speech::default_synthesizer().map(Arc::from),
            summarizer: Arc::from(default_summarizer()),
            transcription: None,
            readiness: Default::default(),
        }
    }

    /// Replay engines in place of the platform's, for tests and for builds without Windows.
    pub fn mock(settings: IntelSettings, ink: ReplayInk, ocr: ReplayOcr) -> Engines {
        Engines {
            settings,
            switches: Switches::new(settings),
            ocr: Ok(Arc::new(ocr)),
            ink: Ok(Arc::new(ink)),
            speech: Ok(Arc::new(MockSpeech::new())),
            summarizer: Arc::from(default_summarizer()),
            transcription: None,
            readiness: Default::default(),
        }
    }

    engine_api! {
        /// Puts `engine` in place of the speech synthesizer, so a test can stand in for a computer without voices.
        fn with_speech_engine(mut self, engine: Arc<dyn SpeechSynthesizer>) -> Engines {
            self.speech = Ok(engine);
            self
        }
    }

    /// Installs the transcription engine, such as whisper.cpp once it lands.
    pub fn with_transcription_engine(mut self, engine: Arc<dyn TranscriptionEngine>) -> Engines {
        self.transcription = Some(engine);
        self
    }

    /// The person's current choices.
    pub fn settings(&self) -> IntelSettings {
        self.settings
    }

    /// Records new choices. Turning a feature off takes effect at once, also for the engines handed out
    /// before: their next call fails with [`IntelError::Disabled`]. A page being read aloud stops at its
    /// next chunk, and a transcription queue fails the jobs waiting and cancels the one running.
    pub fn set_settings(&mut self, settings: IntelSettings) {
        self.settings = settings;
        self.switches.set(settings);
        self.readiness = Default::default();
    }

    /// Fails with [`IntelError::Disabled`] unless the person turned the feature on.
    pub fn require(&self, feature: Feature) -> Result<(), IntelError> {
        if self.settings.is_on(feature) {
            Ok(())
        } else {
            Err(IntelError::Disabled(feature))
        }
    }

    /// The engine behind the switch of `feature`, after checking that the feature is on.
    fn gated<T: ?Sized>(&self, feature: Feature, engine: &Result<Arc<T>, IntelError>) -> Result<Gated<T>, IntelError> {
        self.require(feature)?;
        let engine = engine.as_ref().map_err(Clone::clone)?;
        Ok(Gated::new(feature, &self.switches, engine))
    }

    /// The text recognition engine for images.
    pub fn ocr(&self) -> Result<Arc<dyn OcrEngine>, IntelError> {
        Ok(Arc::new(self.gated(Feature::Ocr, &self.ocr)?))
    }

    /// The handwriting recognizer.
    pub fn ink(&self) -> Result<Arc<dyn InkRecognizer>, IntelError> {
        Ok(Arc::new(self.gated(Feature::Handwriting, &self.ink)?))
    }

    /// The speech synthesizer.
    pub fn speech(&self) -> Result<Arc<dyn SpeechSynthesizer>, IntelError> {
        Ok(Arc::new(self.gated(Feature::ReadAloud, &self.speech)?))
    }

    /// The summarizer.
    pub fn summarizer(&self) -> Result<Arc<dyn Summarizer>, IntelError> {
        Ok(Arc::new(
            self.gated(Feature::Summaries, &Ok(Arc::clone(&self.summarizer)))?,
        ))
    }

    /// The transcription engine, once one is installed.
    pub fn transcription(&self) -> Result<Arc<dyn TranscriptionEngine>, IntelError> {
        let engine = self.transcription.clone().ok_or(IntelError::Unsupported {
            feature: Feature::Transcription.label(),
        });
        Ok(Arc::new(self.gated(Feature::Transcription, &engine)?))
    }

    /// A queue that transcribes recordings one at a time in the background, calling `observer` for every
    /// [`JobEvent`]. Turning transcription off fails the jobs still waiting and cancels the one running,
    /// each with [`IntelError::Disabled`].
    pub fn transcription_queue(
        &self,
        observer: impl Fn(&JobEvent) + Send + Sync + 'static,
    ) -> Result<TranscriptionQueue, IntelError> {
        Ok(TranscriptionQueue::with_observer(self.transcription()?, observer))
    }

    /// Plans a tidy of handwriting that was already recognized. Needs the `handwriting` feature.
    pub fn tidy(
        &self,
        strokes: &[InkStroke],
        recognition: &InkRecognition,
        operation: &TidyOperation,
    ) -> Result<TidyPlan, IntelError> {
        self.require(Feature::Handwriting)?;
        tidy::plan(strokes, recognition, operation)
    }

    /// Finds the tasks and decisions in a transcript. Needs the `summaries` feature.
    pub fn action_items(&self, transcript: &Transcript) -> Result<Vec<ActionItem>, IntelError> {
        self.require(Feature::Summaries)?;
        Ok(find_action_items(transcript))
    }

    /// Cuts a transcript into titled chapters. Needs the `summaries` feature.
    pub fn chapters(&self, transcript: &Transcript, options: &ChapterOptions) -> Result<Vec<Chapter>, IntelError> {
        self.require(Feature::Summaries)?;
        make_chapters(transcript, options)
    }

    /// The term to offer adding to the custom vocabulary after a fix. Needs the `transcription` feature.
    pub fn vocabulary_offer(
        &self,
        vocabulary: &Vocabulary,
        original: &str,
        fixed: &str,
    ) -> Result<Option<Offer>, IntelError> {
        self.require(Feature::Transcription)?;
        Ok(vocabulary.offer(original, fixed))
    }

    /// Starts reading `text` aloud. Turning read aloud off ends the session at its next chunk, with
    /// [`IntelError::Disabled`].
    pub fn read_aloud(&self, text: &str, options: ReadAloudOptions) -> Result<ReadAloud, IntelError> {
        ReadAloud::start(self.speech()?, text, options)
    }

    /// Why the engine of `feature` cannot run, if it cannot. A feature that is on is also asked whether it
    /// has what it needs, once until the settings change.
    fn problem<T: ?Sized>(
        &self,
        feature: Feature,
        engine: &Result<Arc<T>, IntelError>,
        check_ready: impl FnOnce(&T) -> Result<(), IntelError>,
    ) -> Option<String> {
        let engine = match engine {
            Ok(engine) => engine,
            Err(error) => return Some(error.to_string()),
        };
        if !self.settings.is_on(feature) {
            return None;
        }
        let index = Feature::ALL.iter().position(|&f| f == feature).unwrap_or_default();
        self.readiness[index]
            .get_or_init(|| check_ready(engine).err().map(|error| error.to_string()))
            .clone()
    }

    /// For each feature, whether it is on and whether it can run here, for the settings screen.
    pub fn status(&self) -> Vec<FeatureStatus> {
        Feature::ALL
            .iter()
            .map(|&feature| {
                let problem: Option<String> = match feature {
                    Feature::Ocr => self.problem(feature, &self.ocr, |e| e.check_ready()),
                    Feature::Handwriting => self.problem(feature, &self.ink, |e| e.check_ready()),
                    Feature::ReadAloud => self.problem(feature, &self.speech, |e| e.check_ready()),
                    Feature::Summaries => None,
                    Feature::Transcription => self
                        .transcription
                        .is_none()
                        .then(|| "no transcription engine is installed yet".to_owned()),
                };
                FeatureStatus {
                    feature,
                    enabled: self.settings.is_on(feature),
                    available: problem.is_none(),
                    unavailable_reason: problem,
                }
            })
            .collect()
    }
}
