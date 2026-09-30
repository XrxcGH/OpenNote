//! This build's platform key and the release file it updates to. A build only updates to its own architecture:
//! under emulation on an ARM64 PC, the x64 build keeps updating to x64 (ARCHITECTURE.md section 18.3).
//!
//! The table matches `RELEASE_FILES` in app/scripts/write-manifest.ts, and a test checks that. The updater work
//! package moves both to one shared file, app/release-files.json.

/// A platform key in the update manifest's `platforms` map.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlatformKey {
    WindowsX86_64,
    WindowsI686,
    WindowsAarch64,
}

/// One file a release ships: its platform key, the Rust target it's built for, and its file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReleaseFile {
    pub platform: PlatformKey,
    pub key: &'static str,
    pub target: &'static str,
    pub file: &'static str,
}

pub const RELEASE_FILES: [ReleaseFile; 3] = [
    ReleaseFile {
        platform: PlatformKey::WindowsX86_64,
        key: "windows-x86_64",
        target: "x86_64-pc-windows-msvc",
        file: "OpenNote_Windows64.exe",
    },
    ReleaseFile {
        platform: PlatformKey::WindowsI686,
        key: "windows-i686",
        target: "i686-pc-windows-msvc",
        file: "OpenNote_Windows32.exe",
    },
    ReleaseFile {
        platform: PlatformKey::WindowsAarch64,
        key: "windows-aarch64",
        target: "aarch64-pc-windows-msvc",
        file: "OpenNote_WindowsARM64.exe",
    },
];

impl PlatformKey {
    /// The platform this build was compiled for, or `None` where OpenNote doesn't update itself yet.
    pub const fn current() -> Option<PlatformKey> {
        if !cfg!(windows) {
            None
        } else if cfg!(target_arch = "x86_64") {
            Some(Self::WindowsX86_64)
        } else if cfg!(target_arch = "x86") {
            Some(Self::WindowsI686)
        } else if cfg!(target_arch = "aarch64") {
            Some(Self::WindowsAarch64)
        } else {
            None
        }
    }

    /// Finds a platform by its manifest key, such as `windows-x86_64`.
    pub fn from_key(key: &str) -> Option<PlatformKey> {
        RELEASE_FILES.iter().find(|f| f.key == key).map(|f| f.platform)
    }

    /// The manifest key, such as `windows-x86_64`.
    pub fn key(self) -> &'static str {
        self.release_file().key
    }

    /// The release file name the signed trusted comment must name, such as `OpenNote_Windows64.exe`.
    pub fn file(self) -> &'static str {
        self.release_file().file
    }

    fn release_file(self) -> &'static ReleaseFile {
        // Every variant has exactly one row; the tests below check it.
        let index = match self {
            Self::WindowsX86_64 => 0,
            Self::WindowsI686 => 1,
            Self::WindowsAarch64 => 2,
        };
        &RELEASE_FILES[index]
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn each_platform_has_exactly_one_file() {
        for row in &RELEASE_FILES {
            assert_eq!(row.platform.release_file(), row);
            assert_eq!(PlatformKey::from_key(row.key), Some(row.platform));
        }
        let unique = |field: fn(&ReleaseFile) -> &str| RELEASE_FILES.iter().map(field).collect::<HashSet<_>>().len();
        assert_eq!(unique(|f| f.key), 3);
        assert_eq!(unique(|f| f.target), 3);
        assert_eq!(unique(|f| f.file), 3);
        assert_eq!(PlatformKey::from_key("windows-x86"), None);
    }

    #[test]
    fn matches_the_release_manifest_script() {
        let script = include_str!("../../../app/scripts/write-manifest.ts");
        for row in &RELEASE_FILES {
            let line = format!(
                "target: '{}', platform: '{}', file: '{}'",
                row.target, row.key, row.file
            );
            assert!(script.contains(&line), "write-manifest.ts has no row for {}", row.key);
        }
    }

    #[test]
    fn knows_the_platform_it_was_built_for() {
        let expected = match (cfg!(windows), std::env::consts::ARCH) {
            (true, "x86_64") => Some(PlatformKey::WindowsX86_64),
            (true, "x86") => Some(PlatformKey::WindowsI686),
            (true, "aarch64") => Some(PlatformKey::WindowsAarch64),
            _ => None,
        };
        assert_eq!(PlatformKey::current(), expected);
    }
}
