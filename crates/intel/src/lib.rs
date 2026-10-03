//! OpenNote's on-device intelligence: text in images, handwriting, read aloud, summaries, and
//! transcription.
//!
//! # Privacy
//!
//! Everything here runs on the device, and nothing is sent anywhere. The crate links no network
//! client, enables no network part of the Windows API, and holds no URL. `tests/no_network.rs`
//! fails the build if that changes. No input is stored, logged, or kept after a call returns. Nothing downloads
//! on its own either: a speech model is fetched only after the person agrees, by code outside this crate.
//!
//! **Every feature is opt-in.** [`Engines`] hands out an engine only when the person turned that feature
//! on in [`IntelSettings`], and every setting starts off. A feature that is off fails with
//! [`IntelError::Disabled`] before any engine is touched. [`Engines`] is the only public way to an engine.
//! The platform constructors and the free functions are private to the crate unless the `unstable-engines`
//! feature is on, which only the crate's own tests do. Turning a feature off also stops the engines handed
//! out earlier, a page being read aloud, and the transcription jobs waiting or running.
//!
//! # Features
//!
//! Each feature is a small trait with a Windows engine behind it, a replay engine for tests, and, for
//! summaries, a pure Rust implementation that works everywhere.
//!
//! - [`ocr`]: text in images.
//! - [`ink`]: handwriting to words.
//! - [`speech`]: text to sound.
//! - [`summarize`]: summaries and tasks.
//! - [`tidy`]: moves for handwriting.
//! - [`transcribe`]: speech to text.
//! - [`vocabulary`]: terms to spell.
//! - [`mock`]: replay engines.
//!
//! The Windows OCR engine, Windows Ink Analysis, and the voices installed in Windows do the work on
//! that platform. [`speech::ReadAloud`] reads a whole page chunk by chunk. Transcription has a stub
//! engine until the whisper.cpp engine lands.
//!
//! The `winrt` feature (on by default) compiles the Windows engines. Without it, or on another
//! platform, those features report [`IntelError::Unsupported`] and the replay engines stand in.
//!
//! The crate takes plain data in and gives plain data out. It does not depend on the note model,
//! so the app's wiring layer converts between the two. Offsets into text are UTF-16 units, the
//! indexes of a JavaScript string.

/// Declares a function that the rest of the app reaches only through [`Engines`]. With the
/// `unstable-engines` feature, which only this crate's own tests turn on, it is public so they can drive an
/// engine directly. Without it, it is private to the crate, so the person's opt-in cannot be skipped.
macro_rules! engine_api {
    ($(#[$meta:meta])* fn $($rest:tt)*) => {
        $(#[$meta])*
        #[cfg(feature = "unstable-engines")]
        pub fn $($rest)*

        $(#[$meta])*
        #[cfg(not(feature = "unstable-engines"))]
        #[allow(dead_code)]
        pub(crate) fn $($rest)*
    };
}

mod base64;
pub mod engines;
pub mod error;
pub mod geometry;
pub mod ink;
pub mod mock;
pub mod ocr;
pub mod settings;
pub mod speech;
pub mod summarize;
pub mod text;
pub mod tidy;
pub mod transcribe;
pub mod vocabulary;
pub mod wire;

pub use engines::{Engines, FeatureStatus};
pub use error::{ErrorInfo, IntelError};
pub use geometry::{Language, Rect};
pub use settings::{Feature, IntelSettings};
