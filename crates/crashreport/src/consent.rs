//! The person's decision about crash reports, and the wording they decided on.
//!
//! Crash reports are opt-in. Nothing is saved until the person has said yes on the consent screen, and nothing
//! is sent until they have also read a report and agreed to send that one. The decision is stored with the
//! version of the wording they saw. When a later version of OpenNote changes what a report holds, or what it is
//! for, [`WORDING_VERSION`] goes up, an old yes stops counting, and the screen asks again. A no is remembered
//! too, so the screen does not nag: it comes back only through Settings, or when the wording changes.
//!
//! The screen itself is specified in `docs/design/SCREENS.md` (Crash reports) and its text and states are in
//! `app/src/features/diagnostics`. This module holds the rules that do not depend on the screen.

use serde::{Deserialize, Serialize};

/// The version of the consent wording. Raise it whenever a report starts to hold anything new, or the screen's
/// promises change, so that nobody stays opted in to something they were never shown.
pub const WORDING_VERSION: u32 = 1;

/// What the person chose.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    /// They chose to keep crash reports off.
    Declined,
    /// They chose to save crash reports on this computer.
    Accepted,
    /// The screen has not been shown yet. A decision this version does not know is read as this, so a damaged
    /// or newer file is never taken for a yes.
    #[default]
    #[serde(other)]
    Unasked,
}

/// Whether the consent screen should be shown now, and why.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Prompt {
    /// The decision stands. Do not ask.
    None,
    /// The person has never been asked.
    First,
    /// They decided under older wording, so the screen says what changed.
    Reworded,
}

/// The stored decision.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Consent {
    /// What they chose.
    pub decision: Decision,
    /// The wording they chose under, or 0 before they chose.
    pub wording_version: u32,
    /// When they chose, in seconds since 1970 (UTC).
    pub decided_unix: Option<u64>,
}

impl Consent {
    /// A yes to the current wording, given at `now`.
    pub fn accepted(now: u64) -> Consent {
        Consent {
            decision: Decision::Accepted,
            wording_version: WORDING_VERSION,
            decided_unix: Some(now),
        }
    }

    /// A no to the current wording, given at `now`. Turning crash reports off again later is also a no.
    pub fn declined(now: u64) -> Consent {
        Consent {
            decision: Decision::Declined,
            wording_version: WORDING_VERSION,
            decided_unix: Some(now),
        }
    }

    /// Whether the person said yes to the wording this version of OpenNote has. A yes to older wording is not
    /// enough.
    pub fn saving_allowed(&self) -> bool {
        self.decision == Decision::Accepted && self.wording_version == WORDING_VERSION
    }

    /// Whether to show the consent screen. A never-asked person is asked once. A person who decided under
    /// older wording is asked again, with the changes pointed out. Everyone else is left alone.
    pub fn prompt(&self) -> Prompt {
        match self.decision {
            Decision::Unasked => Prompt::First,
            _ if self.wording_version < WORDING_VERSION => Prompt::Reworded,
            _ => Prompt::None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_allowed_before_the_person_decides() {
        let consent = Consent::default();
        assert_eq!(consent.decision, Decision::Unasked);
        assert!(!consent.saving_allowed());
        assert_eq!(consent.prompt(), Prompt::First);
    }

    #[test]
    fn a_yes_allows_saving_and_is_not_asked_again() {
        let consent = Consent::accepted(100);
        assert!(consent.saving_allowed());
        assert_eq!(consent.prompt(), Prompt::None);
        assert_eq!(consent.decided_unix, Some(100));
    }

    #[test]
    fn a_no_is_remembered_and_does_not_nag() {
        let consent = Consent::declined(100);
        assert!(!consent.saving_allowed());
        assert_eq!(consent.prompt(), Prompt::None);
    }

    #[test]
    fn a_yes_to_older_wording_stops_counting_and_asks_again() {
        let old = Consent {
            decision: Decision::Accepted,
            wording_version: WORDING_VERSION - 1,
            decided_unix: Some(1),
        };
        assert!(!old.saving_allowed());
        assert_eq!(old.prompt(), Prompt::Reworded);
        let declined_long_ago = Consent {
            decision: Decision::Declined,
            ..old.clone()
        };
        assert_eq!(declined_long_ago.prompt(), Prompt::Reworded);
    }

    #[test]
    fn a_yes_from_a_newer_version_is_not_trusted_either() {
        // A settings file written by a newer OpenNote and read by this one: the wording is not known here.
        let newer = Consent {
            decision: Decision::Accepted,
            wording_version: WORDING_VERSION + 1,
            decided_unix: Some(1),
        };
        assert!(!newer.saving_allowed());
        assert_eq!(newer.prompt(), Prompt::None);
    }

    #[test]
    fn reads_what_it_writes_and_tolerates_missing_fields() {
        let json = serde_json::to_string(&Consent::accepted(5)).unwrap();
        assert_eq!(
            json,
            format!("{{\"decision\":\"accepted\",\"wordingVersion\":{WORDING_VERSION},\"decidedUnix\":5}}")
        );
        assert_eq!(serde_json::from_str::<Consent>(&json).unwrap(), Consent::accepted(5));
        assert_eq!(serde_json::from_str::<Consent>("{}").unwrap(), Consent::default());
        // An unknown decision is read as not asked, so a damaged file is never taken for a yes.
        let unknown = serde_json::from_str::<Consent>("{\"decision\":\"yes\",\"wordingVersion\":1}").unwrap();
        assert!(!unknown.saving_allowed());
        assert_eq!(unknown.prompt(), Prompt::First);
    }
}
