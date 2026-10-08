//! Import and export for the interface (Phase 11). The interop crate reads and writes the formats.
//! This module is the app's side of it. It holds the file pickers, the commands behind the dialogs with their
//! progress and Cancel, and the link between the notebooks an import writes and the pages the interface shows.
//!
//! An import writes a real notebook folder (spec 3) into the notes folder that setup chose, and the core opens it
//! like any notebook there, so the notebook, its sections, and its pages are in the tree at once with the core's
//! IDs. The notes events tell the interface.
//!
//! An export goes the other way. The interface sends the tree it shows, and `TreeSource` reads each page's files
//! from the core's notebooks.

pub mod commands;
mod export;
mod jobs;
pub mod more;
pub mod pick;
mod restore;
#[cfg(test)]
mod tests;
