//! Named crash points for the kill harness (plan 13.6). Owned by WP2.
//!
//! `fail_point!("save.page.renamed")` marks a step of a multi-step change. Without the `failpoints` feature it
//! compiles to nothing. With it, `OPENNOTE_FAILPOINT=<name>:<n>` aborts the process the n-th time the point is
//! reached, counting from 1. The process aborts at once, without unwinding or flushing buffers, as a crash
//! would. When the variable is unset, a hit costs one atomic load.
//!
//! The file system layer has its own points inside each durable write: `fs.tmp_flushed` after the temporary
//! file is flushed, and `fs.renamed` after the rename, before its flush. When the target is a `page.json`,
//! `save.page.tmp_flushed` and `save.page.renamed` are hit at the same steps.

use std::sync::OnceLock;

/// The environment variable that arms a crash point.
pub const ENV_VAR: &str = "OPENNOTE_FAILPOINT";

/// A crash point armed to abort on its n-th hit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Armed {
    /// The point's name, such as `journal.flushed`.
    pub name: String,
    /// Which hit aborts, from 1.
    pub nth: u64,
}

/// Parses `<name>:<n>`, where `n` is at least 1. `None` for anything else.
pub fn parse(text: &str) -> Option<Armed> {
    let (name, nth) = text.trim().rsplit_once(':')?;
    let nth: u64 = nth.parse().ok()?;
    let valid_name = !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-');
    (valid_name && nth >= 1).then(|| Armed {
        name: name.to_owned(),
        nth,
    })
}

/// The armed point, read from the environment once.
fn armed() -> Option<&'static Armed> {
    static ARMED: OnceLock<Option<Armed>> = OnceLock::new();
    ARMED
        .get_or_init(|| std::env::var(ENV_VAR).ok().as_deref().and_then(parse))
        .as_ref()
}

/// Reads `OPENNOTE_FAILPOINT` now, rather than at the first hit. Later changes to the variable are ignored.
pub fn configure_from_env() {
    let _ = armed();
}

/// Counts a hit of a crash point, and aborts on the configured one.
#[cfg(feature = "failpoints")]
pub fn hit(name: &'static str) {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    static HITS: AtomicU64 = AtomicU64::new(0);
    let Some(armed) = armed() else { return };
    if armed.name != name {
        return;
    }
    let count = HITS.fetch_add(1, Ordering::SeqCst).saturating_add(1);
    if count == armed.nth {
        // Standard error is unbuffered, so the harness sees the line even though the process aborts.
        let _ = writeln!(std::io::stderr(), "FAILPOINT {name} {count}");
        std::process::abort();
    }
}

/// Marks a named crash point. A no-op without the `failpoints` feature.
#[macro_export]
macro_rules! fail_point {
    ($name:literal) => {
        #[cfg(feature = "failpoints")]
        $crate::store::failpoint::hit($name);
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_names_and_counts() {
        assert_eq!(
            parse("journal.flushed:3"),
            Some(Armed {
                name: "journal.flushed".into(),
                nth: 3
            })
        );
        assert_eq!(parse(" save.page.renamed:1\n").map(|a| a.nth), Some(1));
        assert_eq!(
            parse("fs.tmp_flushed:12").map(|a| a.name),
            Some("fs.tmp_flushed".into())
        );
        for bad in [
            "",
            "journal",
            "journal:",
            ":3",
            "journal:0",
            "journal:-1",
            "journal:x",
            "a b:1",
            "a/b:2",
        ] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn configuring_without_the_variable_is_harmless() {
        configure_from_env();
        #[cfg(feature = "failpoints")]
        hit("tests.never.armed");
    }
}
