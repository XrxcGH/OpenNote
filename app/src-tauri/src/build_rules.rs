// The build script's rule for update keys, in a file of its own so the app's unit tests can check it: build.rs
// includes this file, and lib.rs compiles it for its tests only.
//
// A build with Cargo's `release` profile is what `tauri build` makes and what the release workflow ships. Without
// an update public key in `keys/*.pub` it would ship an updater that can never install anything, so the build stops
// and says what to do. CI's own builds use the `ci` profile with test endpoints, and a dry run of the release
// workflow sets `OPENNOTE_DRY_RUN=1`, because nothing it builds is published.

/// The Cargo profile of a build, read from its `OUT_DIR`: `target/<profile>/build/<crate>/out`, or
/// `target/<target triple>/<profile>/build/<crate>/out` for a cross build.
pub fn profile_from_out_dir(out_dir: &std::path::Path) -> Option<String> {
    let parts: Vec<String> = out_dir
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    let build = parts.iter().rposition(|part| part == "build")?;
    parts.get(build.checked_sub(1)?).cloned()
}

/// Why this build must stop, or `None` when it may go on.
pub fn release_key_problem(profile: &str, key_count: usize, test_endpoints: bool, dry_run: bool) -> Option<String> {
    if profile != "release" || key_count > 0 || test_endpoints || dry_run {
        return None;
    }
    Some(
        "A release build needs an update public key in app/src-tauri/keys/*.pub, or its updater could never install \
         an update. Commit the public key as docs/RELEASING.md says (Create the update signing key). A dry run of \
         the release workflow sets OPENNOTE_DRY_RUN=1 instead."
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn reads_the_profile_from_the_out_dir() {
        let plain = Path::new(r"C:\repo\target\release\build\opennote-123\out");
        assert_eq!(profile_from_out_dir(plain).as_deref(), Some("release"));
        let cross = Path::new("/repo/target/aarch64-pc-windows-msvc/ci/build/opennote-1/out");
        assert_eq!(profile_from_out_dir(cross).as_deref(), Some("ci"));
        assert_eq!(profile_from_out_dir(Path::new("/nowhere")), None);
    }

    #[test]
    fn only_a_release_build_without_keys_stops() {
        assert!(release_key_problem("release", 0, false, false).is_some_and(|why| why.contains("keys/*.pub")));
        assert_eq!(release_key_problem("release", 1, false, false), None);
        assert_eq!(
            release_key_problem("release", 0, true, false),
            None,
            "CI's test-endpoints build"
        );
        assert_eq!(release_key_problem("release", 0, false, true), None, "a dry run");
        assert_eq!(release_key_problem("debug", 0, false, false), None);
        assert_eq!(release_key_problem("ci", 0, false, false), None);
    }
}
