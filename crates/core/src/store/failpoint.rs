//! Named crash points for the kill harness (plan 13.6). Owned by WP2.
//!
//! `fail_point!("save.page.renamed")` marks a step of a multi-step change. Without the `failpoints` feature it
//! compiles to nothing. With it, `OPENNOTE_FAILPOINT=<name>:<n>` aborts the process the n-th time the point is
//! reached. Until WP2 lands, both the macro and the configuration are no-ops, so code that uses them runs.

/// Marks a named crash point. A no-op without the `failpoints` feature.
#[macro_export]
macro_rules! fail_point {
    ($name:literal) => {
        #[cfg(feature = "failpoints")]
        $crate::store::failpoint::hit($name);
    };
}

/// Reads `OPENNOTE_FAILPOINT` once at start-up. A no-op until WP2 implements it.
pub fn configure_from_env() {}

/// Counts a hit of a crash point, and aborts on the configured one. A no-op until WP2 implements it.
#[cfg(feature = "failpoints")]
pub fn hit(_name: &'static str) {}
