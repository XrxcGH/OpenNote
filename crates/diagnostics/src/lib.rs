//! What OpenNote can tell a person about its own health, and what a person can share when something is wrong.
//!
//! Three things live here, and all keep private text out:
//!
//! - [`selfcheck`] answers "is everything in order?" It checks free disk space, whether the notebook folder can
//!   be written and where it lives, the notebook itself, the updater's state, and the crash reports waiting for
//!   review. It returns data. The screen that shows it is the interface's.
//! - [`bundle`] builds the beta feedback bundle. It is one text document with a redacted summary of the system, the
//!   recent log lines, the self-check, and, if the person chooses, their saved crash reports. The person reads it
//!   in full before they save it. Nothing here sends anything. The person attaches the saved file to a report or
//!   an email themselves.
//! - [`sessions`] records how each session ended, so the app can offer "Start in safe mode" after two crashes in a
//!   row. It holds counts and times only.
//!
//! Everything that leaves the program as text passes through the crash report [`Scrubber`], which removes
//! paths, quoted text, links, addresses, identifiers, and the names of the person and the computer. A count of
//! what was removed travels with each part, so the person can see that the scrub worked without seeing what it
//! took out.

pub mod bundle;
pub mod disk;
pub mod logs;
pub mod selfcheck;
pub mod sessions;
pub mod summary;

pub use bundle::{Bundle, BundleError, BundleInputs, BundleOptions, Review, Section, SectionId};
pub use disk::{DiskProbe, FixedDisk, SystemDisk};
pub use logs::{LogExcerpt, LogFile};
pub use selfcheck::{CheckId, CheckItem, Detail, Inputs, NotebookProbe, SelfCheck, Status};
pub use sessions::{PreviousEnd, SessionLog, SessionStats, StartReport};
pub use summary::{NotebookCounts, SystemFacts, SystemSummary};

use std::time::{Duration, UNIX_EPOCH};

/// A time in seconds since 1970 as `YYYY-MM-DDTHH:MM:SSZ`, the form the updater writes in its own files.
pub(crate) fn utc(unix: u64) -> String {
    opennote_updater::time::format(UNIX_EPOCH + Duration::from_secs(unix))
}
