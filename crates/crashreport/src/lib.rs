//! Opt-in crash reports that never include note content.
//!
//! Note content never enters this crate. A panic message is kept only when it is a string literal in the
//! program. The backtrace holds function names and code offsets. Everything that is kept passes through the
//! [`Scrubber`], which removes paths, quoted text, and the names of the person and the computer.
//!
//! How the pieces fit:
//!
//! - [`install`] sets a panic hook and, on Windows, an unhandled exception handler. They save a [`Report`]
//!   in [`CrashStore::standard`], `%LOCALAPPDATA%\OpenNote\crashes`, but only while [`Settings::enabled`]
//!   is on. It is off until the person turns it on.
//! - The interface lists, shows, and deletes reports with [`CrashStore`].
//! - Sending goes through [`prepare`], the person's review, [`PendingSend::agree`], and [`send`]. The
//!   address is [`Settings::endpoint`], which is empty by default, so nothing is sent until one is set.

pub mod consent;
pub mod hook;
pub mod pe;
pub mod redactions;
pub mod report;
pub mod scrub;
mod scrub_ids;
mod scrub_quotes;
pub mod send;
pub mod store;
pub mod symbols;
mod sys;

pub use consent::{Consent, Decision, Prompt, WORDING_VERSION};
pub use hook::{add_private, apply, install, is_enabled, set_enabled, Config};
pub use redactions::Redactions;
pub use report::{Frame, Kind, Report, FORMAT};
pub use scrub::{redact_secrets, Scrubber};
pub use send::{prepare, send, Agreement, PendingSend, SendError, Settings, Transport};
pub use store::{CrashStore, StoreError, Summary, MAX_REPORTS};
pub use symbols::{SymbolError, SymbolSet, SymbolTable, Symbolicated};
pub use sys::os_description;
