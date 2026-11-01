//! The native engines behind OpenNote's on-device intelligence.
//!
//! `opennote-intel` holds the interfaces, the person's opt-in gate, and engines written in plain Rust. This crate
//! holds the engines that bring native libraries along. They are separate so that crate stays free of C++ code and
//! of anything that could reach a network, and so a build without a C++ toolchain still works.
//!
//! - [`whisper_cpp`] (feature `whisper-cpp`): whisper.cpp through whisper-rs, for transcription, dictation, and
//!   live captions. It reads the model files the app downloads. It installs itself into
//!   `opennote_intel::whisper` as the speech backend.
//! - [`onnx`] (feature `onnx`): ONNX Runtime for on-device translation and the meaning index.
//! - [`protocol`]: the messages between the app and the language model program.
//! - [`tesseract`] (Linux): Tesseract for text in pictures and handwriting, opened at run time when it is installed.
//!
//! The language model engine for Ask and the writing tools is in its own program (`crates/llm-host`), because
//! llama.cpp and whisper.cpp both bundle ggml and cannot be linked into one program.
//!
//! Nothing here opens a network connection, and nothing here loads a model until the first call that needs it.
//! A model file reaches the disk only through the app's download code, after the person agreed to it.

#[cfg(feature = "onnx")]
pub mod onnx;
pub mod protocol;
#[cfg(any(test, target_os = "linux"))]
pub mod tesseract;
#[cfg(feature = "whisper-cpp")]
pub mod whisper_cpp;

/// Installs every engine this build carries. The app calls it once at start-up; it is safe to call twice.
/// Returns the names of the engines installed, for the log.
pub fn install() -> Vec<&'static str> {
    #[allow(unused_mut)]
    let mut installed = Vec::new();
    #[cfg(feature = "whisper-cpp")]
    {
        whisper_cpp::install();
        installed.push("whisper.cpp");
    }
    #[cfg(target_os = "linux")]
    {
        tesseract::install();
        installed.push("Tesseract");
    }
    installed
}

/// Whether this build carries whisper.cpp.
pub const HAS_WHISPER_CPP: bool = cfg!(feature = "whisper-cpp");
/// Whether this build lets whisper.cpp use the graphics card.
pub const HAS_WHISPER_GPU: bool = cfg!(feature = "whisper-vulkan");
/// Whether this build carries ONNX Runtime.
pub const HAS_ONNX: bool = cfg!(feature = "onnx");
