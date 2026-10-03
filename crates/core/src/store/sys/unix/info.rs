//! Unix fingerprints, volume details, folder identity, and the boot identifier.

use std::fs::{File, Metadata};
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use super::{classify, last_error};
use crate::error::FsError;
use crate::store::fs::{FileMeta, FileStamp, FolderIdentity, VolumeInfo, VolumeKind};
use crate::store::sys::FsOp;

/// A file's or folder's metadata.
pub(crate) fn metadata(path: &Path) -> Result<FileMeta, FsError> {
    let meta = std::fs::metadata(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    Ok(FileMeta {
        stamp: stamp_from(&meta),
        is_dir: meta.is_dir(),
        read_only: meta.permissions().readonly(),
        placeholder: false,
    })
}

/// The last-write time, in nanoseconds since 1970.
pub(crate) fn modified(meta: &Metadata) -> i64 {
    meta.mtime()
        .saturating_mul(1_000_000_000)
        .saturating_add(meta.mtime_nsec())
}

/// The fingerprint of an open file (step 6 of spec 17.4).
pub(crate) fn stamp(file: &File, path: &Path) -> Result<FileStamp, FsError> {
    let meta = file.metadata().map_err(|err| classify(&err, FsOp::Read, path))?;
    Ok(stamp_from(&meta))
}

fn stamp_from(meta: &Metadata) -> FileStamp {
    FileStamp {
        len: meta.len(),
        modified: modified(meta),
        file_id: u128::from(meta.dev()).checked_shl(64).unwrap_or(0) | u128::from(meta.ino()),
    }
}

/// The volume a path is on. `sync_root` is left for the caller.
pub(crate) fn volume(path: &Path) -> Result<VolumeInfo, FsError> {
    let meta = std::fs::metadata(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    let (kind, remote) = fs_facts(path)?;
    Ok(VolumeInfo {
        kind,
        remote,
        sync_root: None,
        serial: meta.dev(),
    })
}

/// Whether `path` is on a network file system. Unknown file systems count as local.
pub(crate) fn is_remote(path: &Path) -> bool {
    fs_facts(path).is_ok_and(|(_, remote)| remote)
}

/// `statfs` of a path.
#[cfg(any(target_os = "linux", target_os = "android", target_vendor = "apple"))]
fn statfs(path: &Path) -> Result<libc::statfs, FsError> {
    let path_c = super::c_path(path)?;
    // SAFETY: statfs is plain old data, for which all zero bytes are a valid value.
    let mut buf: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: the path is NUL-terminated, and `buf` is a writable statfs. Both live until the call returns.
    if unsafe { libc::statfs(path_c.as_ptr(), &mut buf) } != 0 {
        return Err(last_error(FsOp::Read, path));
    }
    Ok(buf)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn fs_facts(path: &Path) -> Result<(VolumeKind, bool), FsError> {
    let buf = statfs(path)?;
    Ok(linux_kind(i128::from(buf.f_type) & 0xffff_ffff))
}

/// The file system for a Linux `statfs` magic number, and whether it is remote.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn linux_kind(magic: i128) -> (VolumeKind, bool) {
    let other = |name: &str| VolumeKind::Other(name.into());
    match magic {
        0xef53 => (VolumeKind::Ext4, false),
        0x4d44 => (VolumeKind::Fat32, false),
        0x2011_bab0 => (VolumeKind::ExFat, false),
        0x5346_544e => (VolumeKind::Ntfs, false),
        0x6969 => (other("nfs"), true),
        0x517b | 0xff53_4d42 | 0xfe53_4d42 => (other("smb"), true),
        0x0102_1997 => (other("9p"), true),
        0x9123_683e => (other("btrfs"), false),
        0x5846_5342 => (other("xfs"), false),
        0x0102_1994 => (other("tmpfs"), false),
        0x6573_5546 => (other("fuse"), false),
        _ => (other(&format!("0x{magic:x}")), false),
    }
}

#[cfg(target_vendor = "apple")]
fn fs_facts(path: &Path) -> Result<(VolumeKind, bool), FsError> {
    let buf = statfs(path)?;
    // SAFETY: the kernel fills f_fstypename with a NUL-terminated name, inside `buf`, which outlives `name`.
    let name = unsafe { std::ffi::CStr::from_ptr(buf.f_fstypename.as_ptr()) };
    // MNT_LOCAL is 0x1000.
    let remote = buf.f_flags & 0x1000 == 0;
    Ok((crate::store::sys::kind_from_name(&name.to_string_lossy()), remote))
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
fn fs_facts(_path: &Path) -> Result<(VolumeKind, bool), FsError> {
    Ok((VolumeKind::Other("unknown".into()), false))
}

/// The device and inode numbers of a folder (spec 20.2).
pub(crate) fn folder_identity(path: &Path) -> Result<FolderIdentity, FsError> {
    let meta = std::fs::metadata(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    let mut bytes = [0u8; 24];
    let (dev, rest) = bytes.split_at_mut(8);
    let (ino, _) = rest.split_at_mut(8);
    dev.copy_from_slice(&meta.dev().to_le_bytes());
    ino.copy_from_slice(&meta.ino().to_le_bytes());
    Ok(FolderIdentity(bytes))
}

/// The boot identifier: Linux's random boot ID (spec 20.9).
#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) fn boot_id() -> Result<String, FsError> {
    let path = Path::new("/proc/sys/kernel/random/boot_id");
    let text = std::fs::read_to_string(path).map_err(|err| classify(&err, FsOp::Read, path))?;
    Ok(format!("linux-{}", text.trim()))
}

/// The boot identifier: the boot session UUID (spec 20.9).
#[cfg(target_vendor = "apple")]
pub(crate) fn boot_id() -> Result<String, FsError> {
    let mut buf = [0u8; 64];
    let mut len: libc::size_t = buf.len();
    // SAFETY: the name is NUL-terminated, `buf` is writable for `len` bytes, and no new value is set.
    let result = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            buf.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 {
        return Err(last_error(FsOp::Read, Path::new("kern.bootsessionuuid")));
    }
    let text = String::from_utf8_lossy(buf.get(..len).unwrap_or_default());
    Ok(format!("apple-{}", text.trim_end_matches('\0')))
}

/// Other platforms report one fixed identifier, so journals wait for a confirmed save (spec 20.9).
#[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
pub(crate) fn boot_id() -> Result<String, FsError> {
    Ok("unix-unknown".into())
}
