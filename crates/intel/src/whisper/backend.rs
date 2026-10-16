//! A faster speech backend that can stand in for the plain Rust Whisper in this module.
//!
//! The Rust reader in this module needs nothing but the model file, and it works everywhere. A build can also
//! carry whisper.cpp (the `opennote-intel-engines` crate): it reads the same files, runs much faster, and can
//! use the graphics card. That crate installs itself here once at start-up. This crate links no native library
//! and holds no network code either way. A backend that cannot take a request answers
//! [`IntelError::Unsupported`] before it reads any audio, and the Rust reader then does the work.

use std::path::Path;
use std::sync::{Arc, OnceLock};

use crate::error::IntelError;
use crate::geometry::Language;
use crate::transcribe::{AudioSource, Device, EngineSettings, JobControl, Segment, Transcript};

/// A speech engine other than the Rust reader.
pub trait SpeechBackend: Send + Sync {
    /// A short name for logs and settings, such as "whisper.cpp".
    fn name(&self) -> &'static str;

    /// The devices it can run on here, besides the processor, which every backend can use.
    fn devices(&self) -> Vec<Device>;

    /// Reads 16 kHz mono samples held in memory, with times from the start of `samples`.
    ///
    /// # Errors
    /// [`IntelError::Unsupported`] when the backend cannot load `model`, so the Rust reader takes over.
    fn transcribe_samples(
        &self,
        model: &Path,
        samples: &[f32],
        language: Option<&Language>,
        prompt: &str,
    ) -> Result<Vec<Segment>, IntelError>;

    /// Transcribes a whole recording.
    ///
    /// # Errors
    /// [`IntelError::Unsupported`] before any audio is read when the backend cannot load `model`.
    fn transcribe(
        &self,
        model: &Path,
        audio: &mut dyn AudioSource,
        settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError>;

    /// Lets go of the loaded model.
    fn unload(&self);
}

static BACKEND: OnceLock<Arc<dyn SpeechBackend>> = OnceLock::new();

/// Installs the backend. Only the first call counts, so a host that installs it twice changes nothing.
pub fn install_backend(backend: Arc<dyn SpeechBackend>) {
    let _ = BACKEND.set(backend);
}

/// The installed backend, if any.
pub fn backend() -> Option<&'static Arc<dyn SpeechBackend>> {
    BACKEND.get()
}
