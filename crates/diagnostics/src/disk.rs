//! Free disk space, behind a trait so tests and tools can answer without touching a real disk.

use std::io;
use std::path::{Path, PathBuf};

/// Answers how much room a volume has left.
pub trait DiskProbe {
    /// The bytes a program can still write on the volume that holds `path`, which may be a folder that does
    /// not exist yet: the nearest folder above it that does is asked.
    fn free_bytes(&self, path: &Path) -> io::Result<u64>;
}

/// The real disks of this computer.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemDisk;

/// A probe that always gives the same answer, for tests and for tools that check a rule without a disk.
#[derive(Clone, Copy, Debug)]
pub struct FixedDisk(pub u64);

impl DiskProbe for FixedDisk {
    fn free_bytes(&self, _path: &Path) -> io::Result<u64> {
        Ok(self.0)
    }
}

/// The path itself if it exists, else the nearest folder above it that does.
fn nearest_existing(path: &Path) -> io::Result<PathBuf> {
    let mut candidate = std::path::absolute(path)?;
    loop {
        if candidate.exists() {
            return Ok(candidate);
        }
        if !candidate.pop() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "no folder above the path exists",
            ));
        }
    }
}

#[cfg(windows)]
impl DiskProbe for SystemDisk {
    fn free_bytes(&self, path: &Path) -> io::Result<u64> {
        use std::os::windows::ffi::OsStrExt;

        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let existing = nearest_existing(path)?;
        let wide: Vec<u16> = existing.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut available = 0u64;
        // SAFETY: `wide` is a null-terminated string that outlives the call, and `available` is a valid place
        // for the one value asked for. The two other outputs are optional and left out.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(available)
    }
}

#[cfg(unix)]
impl DiskProbe for SystemDisk {
    fn free_bytes(&self, path: &Path) -> io::Result<u64> {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let existing = nearest_existing(path)?;
        let c_path = CString::new(existing.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "the path holds a null byte"))?;
        // SAFETY: an all-zero statvfs is valid, `c_path` is a null-terminated string, and the buffer is the
        // size the call writes.
        let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
        // SAFETY: as above.
        if unsafe { libc::statvfs(c_path.as_ptr(), &mut stats) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_folder_has_room_to_report() {
        let dir = tempfile::tempdir().unwrap();
        let free = SystemDisk.free_bytes(dir.path()).unwrap();
        assert!(free > 0);
    }

    #[test]
    fn a_folder_that_does_not_exist_asks_the_nearest_one_above() {
        let dir = tempfile::tempdir().unwrap();
        let deep = dir.path().join("a").join("b").join("c");
        assert_eq!(
            SystemDisk.free_bytes(&deep).unwrap() / (1 << 20),
            SystemDisk.free_bytes(dir.path()).unwrap() / (1 << 20)
        );
    }

    #[test]
    fn a_relative_path_is_resolved_against_the_current_folder() {
        let found = nearest_existing(Path::new("no-such-folder-for-opennote/x")).unwrap();
        assert!(found.is_absolute() && found.exists());
    }

    #[test]
    fn the_fixed_probe_answers_the_same_for_every_path() {
        let probe = FixedDisk(42);
        assert_eq!(probe.free_bytes(Path::new("anything")).unwrap(), 42);
    }
}
