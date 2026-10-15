//! Translation and meaning vectors, from the app's side (A3-25, A3-23). Both run in this process on the model files
//! the person downloaded: `opennote-intel-engines` holds the engines, and builds without its `onnx` feature answer
//! `unavailable`. One translation pack and the meaning model stay loaded after use, and a different pack replaces
//! the one before it.

use std::path::Path;

#[cfg(feature = "native-engines")]
use std::sync::{Arc, Mutex, PoisonError};

#[cfg(feature = "native-engines")]
use opennote_intel_engines::onnx::{Embedder, OnnxError, Translator};

/// The most lines one translation request may carry, and the most characters in all.
pub const MAX_LINES: usize = 400;
pub const MAX_CHARS: usize = 400_000;
/// The most texts one request for vectors may carry.
pub const MAX_TEXTS: usize = 64;

/// Why a call to an engine failed.
#[derive(Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum NativeError {
    /// This build does not carry the engine.
    Unavailable,
    /// The model is not on this computer.
    Model(String),
    /// The engine failed.
    Engine(String),
    /// The request is over a limit.
    Invalid(String),
}

impl NativeError {
    pub fn code(&self) -> &'static str {
        match self {
            NativeError::Unavailable => "unavailable",
            NativeError::Model(_) => "model",
            NativeError::Engine(_) => "engine",
            NativeError::Invalid(_) => "invalid",
        }
    }

    pub fn message(&self) -> String {
        match self {
            NativeError::Unavailable => "This build does not carry that engine.".to_owned(),
            NativeError::Model(message) | NativeError::Engine(message) | NativeError::Invalid(message) => {
                message.clone()
            }
        }
    }
}

#[cfg(feature = "native-engines")]
impl From<OnnxError> for NativeError {
    fn from(error: OnnxError) -> Self {
        match error {
            OnnxError::Model(message) => NativeError::Model(message),
            OnnxError::Runtime(message) => NativeError::Engine(message),
            OnnxError::Input(message) => NativeError::Invalid(message),
        }
    }
}

/// Checks the size of a translation request.
pub fn check_lines(lines: &[String]) -> Result<(), NativeError> {
    if lines.len() > MAX_LINES {
        return Err(NativeError::Invalid(
            "There are too many lines to translate at once.".to_owned(),
        ));
    }
    if lines.iter().map(String::len).sum::<usize>() > MAX_CHARS {
        return Err(NativeError::Invalid(
            "The text is too long to translate at once.".to_owned(),
        ));
    }
    Ok(())
}

/// Checks the size of a request for vectors.
pub fn check_texts(texts: &[String]) -> Result<(), NativeError> {
    if texts.len() > MAX_TEXTS {
        return Err(NativeError::Invalid("There are too many texts at once.".to_owned()));
    }
    Ok(())
}

/// The engines of this process.
#[derive(Default)]
pub struct Native {
    #[cfg(feature = "native-engines")]
    translator: Mutex<Option<(String, Arc<Translator>)>>,
    #[cfg(feature = "native-engines")]
    embedder: Mutex<Option<Arc<Embedder>>>,
}

#[cfg(feature = "native-engines")]
impl Native {
    /// Translates `lines` with the pack in `dir` (its id is `id`).
    pub fn translate(&self, id: &str, dir: &Path, lines: &[String]) -> Result<Vec<String>, NativeError> {
        check_lines(lines)?;
        let translator = {
            let mut held = self.translator.lock().unwrap_or_else(PoisonError::into_inner);
            match held.as_ref() {
                Some((have, translator)) if have == id => Arc::clone(translator),
                _ => {
                    // Let the old pack go before the new one is read.
                    *held = None;
                    let translator = Arc::new(Translator::open(dir)?);
                    *held = Some((id.to_owned(), Arc::clone(&translator)));
                    translator
                }
            }
        };
        Ok(translator.translate(lines)?)
    }

    /// The vector of each text, using the meaning model in `dir`.
    pub fn embed(&self, dir: &Path, texts: &[String]) -> Result<Vec<Vec<f32>>, NativeError> {
        check_texts(texts)?;
        let embedder = {
            let mut held = self.embedder.lock().unwrap_or_else(PoisonError::into_inner);
            match held.as_ref() {
                Some(embedder) => Arc::clone(embedder),
                None => {
                    let embedder = Arc::new(Embedder::open(dir)?);
                    *held = Some(Arc::clone(&embedder));
                    embedder
                }
            }
        };
        Ok(embedder.embed(texts)?)
    }

    /// Lets go of the loaded models, such as when the person removes one.
    pub fn unload(&self) {
        *self.translator.lock().unwrap_or_else(PoisonError::into_inner) = None;
        *self.embedder.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

#[cfg(not(feature = "native-engines"))]
impl Native {
    pub fn translate(&self, _id: &str, _dir: &Path, lines: &[String]) -> Result<Vec<String>, NativeError> {
        check_lines(lines)?;
        Err(NativeError::Unavailable)
    }

    pub fn embed(&self, _dir: &Path, texts: &[String]) -> Result<Vec<Vec<f32>>, NativeError> {
        check_texts(texts)?;
        Err(NativeError::Unavailable)
    }

    pub fn unload(&self) {}
}

/// What this build carries, for the interface.
pub fn capabilities() -> serde_json::Value {
    serde_json::json!({
        "whisperCpp": opennote_intel_engines::HAS_WHISPER_CPP,
        "whisperGpu": opennote_intel_engines::HAS_WHISPER_GPU,
        "onnx": opennote_intel_engines::HAS_ONNX,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_over_a_limit_are_refused_before_any_engine_is_touched() {
        let many = vec!["a".to_owned(); MAX_LINES + 1];
        let native = Native::default();
        let dir = Path::new("nowhere");
        assert_eq!(native.translate("x", dir, &many).unwrap_err().code(), "invalid");
        let long = vec!["x".repeat(MAX_CHARS + 1)];
        assert_eq!(native.translate("x", dir, &long).unwrap_err().code(), "invalid");
        let texts = vec![String::new(); MAX_TEXTS + 1];
        assert_eq!(native.embed(dir, &texts).unwrap_err().code(), "invalid");
    }

    #[cfg(not(feature = "native-engines"))]
    #[test]
    fn a_build_without_the_engines_says_so() {
        let native = Native::default();
        let error = native
            .translate("x", Path::new("nowhere"), &["hi".to_owned()])
            .unwrap_err();
        assert_eq!(error, NativeError::Unavailable);
        assert_eq!(capabilities()["onnx"], false);
    }

    #[cfg(feature = "native-engines")]
    #[test]
    fn a_pack_that_is_not_there_is_a_model_error() {
        let native = Native::default();
        let error = native
            .translate("x", Path::new("nowhere"), &["hi".to_owned()])
            .unwrap_err();
        assert_eq!(error.code(), "model");
    }
}
