//! Counting what a scrub removed.

use serde::{Deserialize, Serialize};

use crate::scrub::{EMAIL, PATH, PRIVATE, TEXT, URL, USER};
use crate::scrub_ids::{ID, TOKEN};

/// How many things of each kind a scrub removed, counted from the placeholders it left in its output. The
/// feedback bundle shows these to the person, so they can see what was taken out without seeing it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Redactions {
    /// Paths of files and folders.
    pub paths: usize,
    /// Quoted text.
    pub quoted: usize,
    /// Web links.
    pub links: usize,
    /// Email addresses.
    pub emails: usize,
    /// Device, account, and network identifiers.
    pub ids: usize,
    /// Keys and tokens.
    pub tokens: usize,
    /// Names of the person and the computer.
    pub names: usize,
    /// Names the app registered as private.
    pub private: usize,
}

impl Redactions {
    /// Counts the placeholders in text that [`Scrubber::text`] produced.
    pub fn count(scrubbed: &str) -> Redactions {
        Redactions {
            paths: scrubbed.matches(PATH).count(),
            quoted: scrubbed.matches(TEXT).count(),
            links: scrubbed.matches(URL).count(),
            emails: scrubbed.matches(EMAIL).count(),
            ids: scrubbed.matches(ID).count(),
            tokens: scrubbed.matches(TOKEN).count(),
            names: scrubbed.matches(USER).count(),
            private: scrubbed.matches(PRIVATE).count(),
        }
    }

    /// The sum of every kind.
    pub fn total(&self) -> usize {
        self.paths + self.quoted + self.links + self.emails + self.ids + self.tokens + self.names + self.private
    }

    /// Adds another count to this one.
    pub fn add(&mut self, other: Redactions) {
        self.paths += other.paths;
        self.quoted += other.quoted;
        self.links += other.links;
        self.emails += other.emails;
        self.ids += other.ids;
        self.tokens += other.tokens;
        self.names += other.names;
        self.private += other.private;
    }
}
