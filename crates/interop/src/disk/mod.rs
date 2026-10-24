//! Writing imports to disk and reading exports from disk, through the core's own storage code.
//!
//! [`DiskSink`] is an [`crate::ImportSink`] that lays a notebook out as spec 3 describes. It uses the core's
//! `write_page_dir`, so every page gets its `page.json`, readable copies, and first revision from the same code
//! that saves a page the person edits. [`DiskSource`] is a [`crate::NoteSource`] over a notebook folder, and it
//! reads pages with the core's `read_page_dir`. Neither needs a running core session, and neither touches the
//! library: the app opens the finished folder with `Core::open_notebook`.

mod sink;
mod source;

pub use sink::DiskSink;
pub use source::DiskSource;

use std::fmt::Display;

use crate::error::InteropError;

/// Turns a core error into the error an import or export reports.
pub(crate) fn core_error(error: impl Display) -> InteropError {
    InteropError::Sink(error.to_string())
}
