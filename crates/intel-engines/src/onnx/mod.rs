//! ONNX Runtime for the two jobs that need a small neural model: translating text, and turning text into a vector
//! that sits near the vectors of text about the same thing.
//!
//! Both read model files the app downloaded with the person's consent, run on the processor, and keep nothing but
//! the loaded model between calls. The files are opened by path and nothing is fetched.
//!
//! - [`Translator`]: a Marian model (the Helsinki-NLP opus-mt family) for one pair of languages, in ONNX form with
//!   an encoder, a decoder, and a tokenizer.
//! - [`Embedder`]: a MiniLM sentence model that gives a vector of 384 numbers of length one for a text.

mod decode;
mod embed;
mod translate;

use std::fmt;
use std::path::Path;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;

pub use decode::{greedy, Step};
pub use embed::{pool, Embedder, EMBED_DIM};
pub use translate::{Translator, MAX_SOURCE_TOKENS};

/// Why a model could not be opened or run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OnnxError {
    /// A file of the model is missing or is not what it should be.
    Model(String),
    /// The runtime failed.
    Runtime(String),
    /// The input is not something the model can take.
    Input(String),
}

impl fmt::Display for OnnxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OnnxError::Model(message) => write!(f, "the model could not be opened: {message}"),
            OnnxError::Runtime(message) => write!(f, "the model failed: {message}"),
            OnnxError::Input(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for OnnxError {}

pub(crate) fn runtime<E: fmt::Display>(error: E) -> OnnxError {
    OnnxError::Runtime(error.to_string())
}

static ACCELERATE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Lets sessions opened from now on try DirectML first (the default in a build with `onnx-directml`) or keeps them on the
/// processor. Without the feature this changes nothing.
pub fn set_acceleration(on: bool) {
    ACCELERATE.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// Whether this build carries DirectML.
pub fn has_directml() -> bool {
    cfg!(feature = "onnx-directml")
}

/// A session over the model file at `path`: DirectML when the build has it and it is on, the processor otherwise (a
/// DirectML that cannot start leaves the session on the processor), with a thread for each core but one.
pub(crate) fn open(path: &Path) -> Result<Session, OnnxError> {
    if !path.is_file() {
        return Err(OnnxError::Model(format!("{} is not there", path.display())));
    }
    let threads = std::thread::available_parallelism().map_or(2, std::num::NonZero::get);
    let model = |error: &dyn fmt::Display| OnnxError::Model(error.to_string());
    let mut builder = Session::builder().map_err(|error| model(&error))?;
    builder = builder
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|error| model(&error))?;
    builder = builder
        .with_intra_threads(threads.saturating_sub(1).clamp(1, 4))
        .map_err(|error| model(&error))?;
    #[cfg(feature = "onnx-directml")]
    if ACCELERATE.load(std::sync::atomic::Ordering::Relaxed) {
        // DirectML needs sequential execution and no memory pattern. If it will not start, the processor runs the model.
        builder = builder
            .with_memory_pattern(false)
            .map_err(|error| model(&error))?
            .with_parallel_execution(false)
            .map_err(|error| model(&error))?
            .with_execution_providers([ort::ep::DirectML::default().build()])
            .map_err(|error| model(&error))?;
    }
    builder.commit_from_file(path).map_err(|error| model(&error))
}

pub(crate) fn tokenizer(path: &Path) -> Result<tokenizers::Tokenizer, OnnxError> {
    tokenizers::Tokenizer::from_file(path).map_err(|error| OnnxError::Model(error.to_string()))
}
