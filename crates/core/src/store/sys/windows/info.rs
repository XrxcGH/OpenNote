//! Windows file identity, fingerprints, volume details, and the boot identifier.

use std::fs::{File, Metadata};
use std::os::windows::fs::MetadataExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Wdk::System::SystemInformation::{NtQuerySystemInformation, SystemTimeOfDayInformation};
use windows_sys::Win32::Storage::FileSystem::{
    FileIdInfo, FileRemoteProtocolInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
    GetVolumeInformationByHandleW, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_READONLY,
    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ID_INFO, FILE_REMOTE_PROTOCOL_INFO,
};

use super::{classify, open_attributes};
use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{FileMeta, FileStamp, FolderIdentity, VolumeInfo, VolumeKind};
use crate::store::sys::{kind_from_name, FsOp};

/// Attributes of a cloud file whose data isn't on this computer.
const PLACEHOLDER: u32 = FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_OFFLINE;
const ID_INFO_SIZE: u32 = size_of::<FILE_ID_INFO>() as u32;
const REMOTE_INFO_SIZE: u32 = size_of::<FILE_REMOTE_PROTOCOL_INFO>() as u32;

/// What a durable write needs to know about the volume a handle is on.
pub(crate) struct Facts {
    /// The file system.
    pub(crate) kind: VolumeKind,
    /// Whether it is a network share.
    pub(crate) remote: bool,
}

/// A file's or folder's metadata, from one handle.
pub(crate) fn metadata(path: &Path) -> Result<FileMeta, FsError> {
    let file = open_attributes(path)?;
    let meta = file.metadata().map_err(|err| classify(&err, FsOp::Read, path))?;
    let attributes = meta.file_attributes();
    Ok(FileMeta {
        stamp: stamp_from(&file, &meta),
        is_dir: meta.is_dir(),
        read_only: attributes & FILE_ATTRIBUTE_READONLY != 0,
        placeholder: attributes & PLACEHOLDER != 0,
    })
}

/// The last-write time, in 100-nanosecond intervals since 1601.
pub(crate) fn modified(meta: &Metadata) -> i64 {
    i64::try_from(meta.last_write_time()).unwrap_or(i64::MAX)
}

/// The fingerprint of an open file (step 7 of spec 17.3).
pub(crate) fn stamp(file: &File, path: &Path) -> Result<FileStamp, FsError> {
    let meta = file.metadata().map_err(|err| classify(&err, FsOp::Read, path))?;
    Ok(stamp_from(file, &meta))
}

fn stamp_from(file: &File, meta: &Metadata) -> FileStamp {
    FileStamp {
        len: meta.file_size(),
        modified: modified(meta),
        file_id: identity(file).1,
    }
}

/// The volume serial number and the file ID: the 128-bit one where the file system has it, else the 64-bit one.
fn identity(file: &File) -> (u64, u128) {
    let mut info = FILE_ID_INFO::default();
    // SAFETY: the handle is open for the call, and `info` is a FILE_ID_INFO of the size passed.
    let ok =
        unsafe { GetFileInformationByHandleEx(file.as_raw_handle(), FileIdInfo, (&raw mut info).cast(), ID_INFO_SIZE) };
    if ok != 0 {
        return (info.VolumeSerialNumber, u128::from_le_bytes(info.FileId.Identifier));
    }
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the handle is open for the call, and `info` is a writable BY_HANDLE_FILE_INFORMATION.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if ok == 0 {
        return (0, 0);
    }
    let high = u128::from(info.nFileIndexHigh).checked_shl(32).unwrap_or(0);
    (
        u64::from(info.dwVolumeSerialNumber),
        high | u128::from(info.nFileIndexLow),
    )
}

/// The file system and whether it is remote. Unknown file systems count as local.
pub(crate) fn facts(file: &File) -> Facts {
    let mut name = [0u16; 64];
    let mut serial = 0u32;
    let mut max_component = 0u32;
    let mut flags = 0u32;
    // SAFETY: the handle is open for the call, every out pointer is to a live local, and the name buffer's
    // length is passed in characters.
    let ok = unsafe {
        GetVolumeInformationByHandleW(
            file.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            &mut serial,
            &mut max_component,
            &mut flags,
            name.as_mut_ptr(),
            64,
        )
    };
    let kind = if ok == 0 {
        VolumeKind::Other("unknown".into())
    } else {
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        kind_from_name(&String::from_utf16_lossy(name.get(..len).unwrap_or_default()))
    };
    Facts {
        kind,
        remote: is_remote(file),
    }
}

/// Whether a handle is to a file on a network share: only those have remote protocol information.
fn is_remote(file: &File) -> bool {
    let mut info = FILE_REMOTE_PROTOCOL_INFO::default();
    // SAFETY: the handle is open for the call, and `info` is a FILE_REMOTE_PROTOCOL_INFO of the size passed.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileRemoteProtocolInfo,
            (&raw mut info).cast(),
            REMOTE_INFO_SIZE,
        )
    };
    ok != 0
}

/// The volume a path is on. `sync_root` is left for the caller, which knows the path as the person gave it.
pub(crate) fn volume(path: &Path) -> Result<VolumeInfo, FsError> {
    let file = open_attributes(path)?;
    let facts = facts(&file);
    Ok(VolumeInfo {
        kind: facts.kind,
        remote: facts.remote,
        sync_root: None,
        serial: identity(&file).0,
    })
}

/// The volume serial number and the folder's file ID (spec 20.2).
pub(crate) fn folder_identity(path: &Path) -> Result<FolderIdentity, FsError> {
    let file = open_attributes(path)?;
    let (serial, id) = identity(&file);
    let mut bytes = [0u8; 24];
    let (serial_part, id_part) = bytes.split_at_mut(8);
    serial_part.copy_from_slice(&serial.to_le_bytes());
    id_part.copy_from_slice(&id.to_le_bytes());
    Ok(FolderIdentity(bytes))
}

/// `SYSTEM_TIMEOFDAY_INFORMATION`, which the Windows headers leave undocumented.
#[repr(C)]
#[derive(Default)]
#[allow(dead_code)] // The system fills in every field, and only two are read.
struct TimeOfDay {
    boot_time: i64,
    current_time: i64,
    time_zone_bias: i64,
    time_zone_id: u32,
    reserved: u32,
    boot_time_bias: u64,
    sleep_time_bias: u64,
}

/// The system's boot time, in seconds since 1601, as `win-<seconds>` (spec 20.9). Setting the clock moves the
/// recorded boot time. Windows keeps the total of those moves in `boot_time_bias`, and subtracting it
/// gives a value that changes only when the system starts.
pub(crate) fn boot_id() -> Result<String, FsError> {
    let mut info = TimeOfDay::default();
    let size = size_of::<TimeOfDay>() as u32;
    let mut returned = 0u32;
    // SAFETY: `info` is a writable buffer of `size` bytes laid out as SYSTEM_TIMEOFDAY_INFORMATION, and
    // `returned` is a live local.
    let status =
        unsafe { NtQuerySystemInformation(SystemTimeOfDayInformation, (&raw mut info).cast(), size, &mut returned) };
    if status < 0 {
        return Err(FsError {
            kind: FsErrorKind::Io,
            path: Path::new("boot").to_path_buf(),
            os_code: Some(status),
        });
    }
    let boot = info.boot_time.wrapping_sub_unsigned(info.boot_time_bias);
    Ok(format!("win-{}", boot.div_euclid(10_000_000)))
}
