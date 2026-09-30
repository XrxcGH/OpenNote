//! Staged files in `updates\`. A download streams to a `.partial` file, and only a verified file is renamed to
//! its staged name. Only one staged update is kept (ARCHITECTURE.md section 18.5).

use semver::Version;

use crate::platform::PlatformKey;

/// The name of a copy of one version for one platform: `OpenNote-<version>-<platform>.exe`. Staged updates in
/// `updates\` and the previous copy in `previous\` both use it.
pub fn copy_name(version: &Version, platform: PlatformKey) -> String {
    format!("OpenNote-{version}-{}.exe", platform.key())
}

/// The name a download streams to before it's verified.
pub fn partial_name(version: &Version, platform: PlatformKey) -> String {
    format!("{}.partial", copy_name(version, platform))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_copies_by_version_and_platform() {
        let version = Version::parse("0.5.0-beta.1").expect("valid");
        assert_eq!(
            copy_name(&version, PlatformKey::WindowsX86_64),
            "OpenNote-0.5.0-beta.1-windows-x86_64.exe"
        );
        assert_eq!(
            partial_name(&version, PlatformKey::WindowsAarch64),
            "OpenNote-0.5.0-beta.1-windows-aarch64.exe.partial"
        );
    }
}
