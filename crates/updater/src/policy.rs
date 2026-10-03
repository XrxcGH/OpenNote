//! Which versions may be offered: newer than the running one, not skipped, and not blocked on this device
//! (ARCHITECTURE.md section 18.5). Downgrades are never offered; only rollback and "Go back" install an older
//! version, and only from the local previous copy.

use semver::Version;

/// Why a version isn't offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The same as the running version, or older. Prerelease versions sort before their release.
    NotNewer,
    /// The person chose "Skip this version".
    Skipped,
    /// This version rolled back on this device before.
    Blocked,
}

/// Decides whether `candidate` may be offered to a copy running `current`.
pub fn check(
    candidate: &Version,
    current: &Version,
    skipped: Option<&Version>,
    blocked: &[Version],
) -> Result<(), Refusal> {
    if candidate <= current {
        Err(Refusal::NotNewer)
    } else if skipped == Some(candidate) {
        Err(Refusal::Skipped)
    } else if blocked.contains(candidate) {
        Err(Refusal::Blocked)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(text: &str) -> Version {
        Version::parse(text).expect("test versions are valid")
    }

    #[test]
    fn offers_only_newer_versions() {
        assert_eq!(check(&v("0.5.0"), &v("0.4.0"), None, &[]), Ok(()));
        assert_eq!(check(&v("0.4.0"), &v("0.4.0"), None, &[]), Err(Refusal::NotNewer));
        assert_eq!(check(&v("0.3.9"), &v("0.4.0"), None, &[]), Err(Refusal::NotNewer));
    }

    #[test]
    fn orders_prereleases_before_their_release() {
        assert_eq!(check(&v("0.5.0"), &v("0.5.0-beta.2"), None, &[]), Ok(()));
        assert_eq!(
            check(&v("0.5.0-beta.2"), &v("0.5.0-beta.10"), None, &[]),
            Err(Refusal::NotNewer)
        );
        assert_eq!(
            check(&v("0.5.0-beta.2"), &v("0.5.0"), None, &[]),
            Err(Refusal::NotNewer)
        );
    }

    #[test]
    fn skips_the_skipped_and_blocked_versions_only() {
        let skipped = v("0.5.0");
        assert_eq!(
            check(&v("0.5.0"), &v("0.4.0"), Some(&skipped), &[]),
            Err(Refusal::Skipped)
        );
        assert_eq!(check(&v("0.5.1"), &v("0.4.0"), Some(&skipped), &[]), Ok(()));
        assert_eq!(
            check(&v("0.5.0"), &v("0.4.0"), None, &[v("0.5.0")]),
            Err(Refusal::Blocked)
        );
        assert_eq!(check(&v("0.5.1"), &v("0.4.0"), None, &[v("0.5.0")]), Ok(()));
    }
}
