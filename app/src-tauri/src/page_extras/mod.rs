//! Native help for the quality-of-life features of typed notes: the Windows text cursor settings, link titles on
//! paste, and attached files that open in their own app and save back. Each command names a page by its ID and
//! never a path, and nothing here reaches the network unless the person turned the feature on.

pub mod attach;
pub mod caret;
pub mod thumbnail;
pub mod title;
