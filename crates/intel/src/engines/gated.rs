//! Engines that stop working the moment the person turns their feature off, even when they were handed
//! out before. Every engine [`Engines`](super::Engines) hands out is wrapped in [`Gated`], which checks the
//! switch on each call. A page being read aloud fails at its next chunk, and a transcription job sees its
//! control canceled.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::error::IntelError;
use crate::geometry::Language;
use crate::ink::{InkOptions, InkRecognition, InkRecognizer, InkStroke};
use crate::ocr::{OcrEngine, OcrImage, OcrOptions, OcrResult};
use crate::settings::{Feature, IntelSettings};
use crate::speech::{SpeakOptions, SpeechAudio, SpeechSynthesizer, Voice};
use crate::summarize::{Keyword, KeywordOptions, Summarizer, Summary, SummaryOptions};
use crate::transcribe::{AudioSource, Device, EngineSettings, JobControl, Transcript, TranscriptionEngine};

/// Whether each feature is on right now. `Engines` owns it, and every engine it hands out shares it.
#[derive(Debug, Default)]
pub(super) struct Switches([AtomicBool; Feature::ALL.len()]);

impl Switches {
    pub(super) fn new(settings: IntelSettings) -> Arc<Switches> {
        let switches = Arc::new(Switches::default());
        switches.set(settings);
        switches
    }

    pub(super) fn set(&self, settings: IntelSettings) {
        for (switch, feature) in self.0.iter().zip(Feature::ALL) {
            switch.store(settings.is_on(feature), Ordering::SeqCst);
        }
    }

    pub(super) fn is_on(&self, feature: Feature) -> bool {
        let index = Feature::ALL.iter().position(|&f| f == feature).unwrap_or_default();
        self.0[index].load(Ordering::SeqCst)
    }
}

/// An engine behind its feature's switch.
pub(super) struct Gated<T: ?Sized> {
    feature: Feature,
    switches: Arc<Switches>,
    inner: Arc<T>,
}

impl<T: ?Sized> Gated<T> {
    pub(super) fn new(feature: Feature, switches: &Arc<Switches>, inner: &Arc<T>) -> Gated<T> {
        Gated {
            feature,
            switches: Arc::clone(switches),
            inner: Arc::clone(inner),
        }
    }

    fn check(&self) -> Result<(), IntelError> {
        if self.switches.is_on(self.feature) {
            Ok(())
        } else {
            Err(IntelError::Disabled(self.feature))
        }
    }
}

impl OcrEngine for Gated<dyn OcrEngine> {
    fn available_languages(&self) -> Result<Vec<Language>, IntelError> {
        self.check()?;
        self.inner.available_languages()
    }

    fn check_ready(&self) -> Result<(), IntelError> {
        self.check()?;
        self.inner.check_ready()
    }

    fn recognize(&self, image: &OcrImage, options: &OcrOptions) -> Result<OcrResult, IntelError> {
        self.check()?;
        self.inner.recognize(image, options)
    }
}

impl InkRecognizer for Gated<dyn InkRecognizer> {
    fn recognize(&self, strokes: &[InkStroke], options: &InkOptions) -> Result<InkRecognition, IntelError> {
        self.check()?;
        self.inner.recognize(strokes, options)
    }

    fn check_ready(&self) -> Result<(), IntelError> {
        self.check()?;
        self.inner.check_ready()
    }
}

impl SpeechSynthesizer for Gated<dyn SpeechSynthesizer> {
    fn voices(&self) -> Result<Vec<Voice>, IntelError> {
        self.check()?;
        self.inner.voices()
    }

    fn check_ready(&self) -> Result<(), IntelError> {
        self.check()?;
        self.inner.check_ready()
    }

    fn synthesize(&self, text: &str, options: &SpeakOptions) -> Result<SpeechAudio, IntelError> {
        self.check()?;
        self.inner.synthesize(text, options)
    }
}

impl Summarizer for Gated<dyn Summarizer> {
    fn summarize(&self, text: &str, options: &SummaryOptions) -> Result<Summary, IntelError> {
        self.check()?;
        self.inner.summarize(text, options)
    }

    fn keywords(&self, text: &str, options: &KeywordOptions) -> Result<Vec<Keyword>, IntelError> {
        self.check()?;
        self.inner.keywords(text, options)
    }
}

impl TranscriptionEngine for Gated<dyn TranscriptionEngine> {
    fn name(&self) -> String {
        self.inner.name()
    }

    fn model_file(&self) -> Option<std::path::PathBuf> {
        self.inner.model_file()
    }

    fn devices(&self) -> Vec<Device> {
        self.inner.devices()
    }

    /// A job that starts while the feature is off fails at once, and a running job sees its control
    /// canceled when the feature turns off. Either way it reports [`IntelError::Disabled`].
    fn transcribe(
        &self,
        audio: &mut dyn AudioSource,
        settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError> {
        self.check()?;
        let (switches, feature) = (Arc::clone(&self.switches), self.feature);
        let control = control.stopped_when(move || !switches.is_on(feature));
        match self.inner.transcribe(audio, settings, &control) {
            Err(IntelError::Canceled) => self.check().and(Err(IntelError::Canceled)),
            result => result,
        }
    }
}
