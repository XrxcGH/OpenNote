//! Platform code behind `StdFs` (spec 17.3 and 17.4). Owned by WP2.
//!
//! The only modules allowed to use `unsafe`, and every `unsafe` block has a `// SAFETY:` comment.

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;
