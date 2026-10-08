//! Engines that replay recorded answers, so tests and builds without Windows run the same code paths.
//!
//! Each Windows engine has a stand-in here. The stand-ins make no network request and read nothing
//! from the device. They answer from data the caller hands them. Use them in three places.
//!
//! - Tests on Linux and macOS CI.
//! - Interface tests that want fixed text.
//! - A Windows build with `--no-default-features`.
//!
//! The first has no Windows recognizers, the second has no need of real ones, and the third proves the
//! app works without the Windows engines.
//!
//! The replay engines answer from *recordings*. A recording holds an input's fingerprint and the answer
//! the real engine gave. `tests/fixtures/` holds recordings made on Windows. The Windows tests check
//! that the live engine still gives the same answers, so a recording cannot drift unnoticed. An input
//! with no recording is an error, never a guess.

mod fingerprint;
mod ink;
mod ocr;
mod speech;

pub use fingerprint::Fingerprint;
pub use ink::{ink_fingerprint, InkRecording, RecordedInk, ReplayInk};
pub use ocr::{ocr_fingerprint, OcrRecording, RecordedOcr, ReplayOcr, MAX_IMAGE_SIDE};
pub use speech::{MockSpeech, MOCK_VOICE_ID};
