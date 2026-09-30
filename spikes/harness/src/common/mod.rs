//! Shared tools for the spikes: a high-resolution clock, summary statistics, the results file, and a
//! window with a WebView2 page that a measurement thread can drive.

pub mod capture;
pub mod clock;
pub mod results;
pub mod screen;
pub mod stats;
pub mod webview;

/// The error type every spike returns. Messages are written for the person running the spike.
pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;
