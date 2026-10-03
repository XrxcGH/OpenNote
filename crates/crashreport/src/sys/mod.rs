//! The parts that depend on the operating system: the OS build, the stack as code offsets, and on Windows
//! the handler for exceptions that nothing else handled. Other systems get empty answers, so the crate builds
//! and its tests run everywhere.

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(not(windows))]
mod other;
#[cfg(not(windows))]
pub use other::*;
