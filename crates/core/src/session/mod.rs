//! Sessions: the running core, open notebooks and pages, autosave, and the events the app receives.

pub mod autosave;
pub mod backend;
pub mod budget;
pub mod core;
pub mod events;
pub mod journal_thread;
#[cfg(any(test, feature = "testing"))]
pub mod kit;
pub mod library;
pub mod maintenance;
pub mod notebook;
pub mod notes;
pub mod page;
pub mod tree_events;
