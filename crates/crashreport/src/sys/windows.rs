//! Windows: the OS build, module offsets, and the filter for exceptions that nothing handled.

use std::ffi::c_void;
use std::sync::atomic::{AtomicUsize, Ordering};

use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
use windows_sys::Win32::Foundation::HMODULE;
use windows_sys::Win32::System::Diagnostics::Debug::{
    RtlCaptureStackBackTrace, SetUnhandledExceptionFilter, EXCEPTION_CONTINUE_SEARCH, EXCEPTION_POINTERS,
};
use windows_sys::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows_sys::Win32::System::Memory::{
    VirtualQuery, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_GUARD, PAGE_NOACCESS,
};
use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

use crate::report::RawFrame;

/// The most stack positions a report holds.
const MAX_STACK: usize = 62;

/// The Windows version and build, and the processor, such as `Windows 10.0.26200 x86_64`.
pub fn os_description() -> String {
    // SAFETY: an all-zero OSVERSIONINFOW is valid, and its size field is set before the call.
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    // SAFETY: `info` is a valid, writable OSVERSIONINFOW.
    let status = unsafe { RtlGetVersion(&mut info) };
    let arch = std::env::consts::ARCH;
    if status == 0 {
        format!(
            "Windows {}.{}.{} {arch}",
            info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
        )
    } else {
        format!("Windows {arch}")
    }
}

/// A module that is mapped into this program, read through `VirtualQuery` so a read never touches memory
/// that is not committed and readable.
struct MappedImage {
    base: usize,
}

impl crate::pe::ImageReader for MappedImage {
    fn read(&self, offset: usize, length: usize) -> Option<Vec<u8>> {
        let start = self.base.checked_add(offset)?;
        let end = start.checked_add(length)?;
        // SAFETY: an all-zero MEMORY_BASIC_INFORMATION is valid.
        let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
        let mut at = start;
        // The bytes may span several regions of the image, such as the headers and a section.
        while at < end {
            // SAFETY: `info` is a writable MEMORY_BASIC_INFORMATION of the size passed, and the address may
            // be any value.
            let written = unsafe { VirtualQuery(at as *const c_void, &mut info, std::mem::size_of_val(&info)) };
            let readable = info.State == MEM_COMMIT && info.Protect & (PAGE_NOACCESS | PAGE_GUARD) == 0;
            if written == 0 || !readable {
                return None;
            }
            let region_end = (info.BaseAddress as usize).checked_add(info.RegionSize)?;
            if region_end <= at {
                return None;
            }
            at = region_end;
        }
        let mut bytes = vec![0u8; length];
        // SAFETY: every byte from `start` to `end` was just found committed and readable, and `bytes` holds
        // `length` bytes. Another thread could unmap the module meanwhile, which a loaded module that holds
        // a crashing stack frame does not do.
        unsafe { std::ptr::copy_nonoverlapping(start as *const u8, bytes.as_mut_ptr(), length) };
        Some(bytes)
    }
}

/// The module that holds `address`: its file name, the offset of the address from its start, and the debug id of
/// its build.
fn locate(address: usize) -> Option<(String, u64, Option<String>)> {
    let mut module: HMODULE = std::ptr::null_mut();
    let flags = GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT;
    // SAFETY: with the FROM_ADDRESS flag the second argument is an address, which may be any value.
    if unsafe { GetModuleHandleExW(flags, address as *const u16, &mut module) } == 0 {
        return None;
    }
    let mut buffer = [0u16; 512];
    // SAFETY: the buffer is writable and its length is passed.
    let len = unsafe { GetModuleFileNameW(module, buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if len == 0 || len >= buffer.len() {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..len]);
    let name = path.rsplit('\\').next()?.to_owned();
    let base = module as usize;
    let debug_id = crate::pe::debug_id(&MappedImage { base });
    Some((name, (address - base) as u64, debug_id))
}

/// The module, offset, and build of a code address.
pub fn frame_for(address: usize) -> RawFrame {
    match locate(address) {
        Some((module, offset, debug_id)) => RawFrame {
            module: Some(module),
            offset: Some(offset),
            debug_id,
        },
        None => RawFrame::default(),
    }
}

/// The current stack as code offsets, the top first. The first positions belong to this crate.
pub fn capture_frames() -> Vec<RawFrame> {
    let mut addresses = [std::ptr::null_mut::<c_void>(); MAX_STACK];
    // SAFETY: the array holds `MAX_STACK` pointers, and the hash output is not wanted.
    let count = unsafe { RtlCaptureStackBackTrace(0, MAX_STACK as u32, addresses.as_mut_ptr(), std::ptr::null_mut()) };
    addresses[..usize::from(count)]
        .iter()
        .map(|&address| frame_for(address as usize))
        .collect()
}

/// The function called for an exception: its code and the address it happened at.
static CALLBACK: AtomicUsize = AtomicUsize::new(0);
/// The filter that was set before ours, called after ours.
static PREVIOUS: AtomicUsize = AtomicUsize::new(0);

type Filter = unsafe extern "system" fn(*const EXCEPTION_POINTERS) -> i32;

/// Calls `callback(code, address)` for an exception that nothing handled, then lets the next filter and
/// Windows itself go on. Returns `true` the first time. It can't run for a stack overflow, which leaves no
/// room to run it.
pub fn install_exception_filter(callback: fn(u32, usize)) -> bool {
    if CALLBACK.swap(callback as usize, Ordering::SeqCst) != 0 {
        return false;
    }
    // SAFETY: `filter` has the signature Windows expects of an unhandled exception filter.
    let previous = unsafe { SetUnhandledExceptionFilter(Some(filter)) };
    PREVIOUS.store(previous.map_or(0, |f| f as usize), Ordering::SeqCst);
    true
}

/// The unhandled exception filter.
unsafe extern "system" fn filter(info: *const EXCEPTION_POINTERS) -> i32 {
    let callback = CALLBACK.load(Ordering::SeqCst);
    // SAFETY: Windows passes a valid pointer, or null, and the record inside it may also be null.
    let record = unsafe { info.as_ref() }.and_then(|info| unsafe { info.ExceptionRecord.as_ref() });
    if let (true, Some(record)) = (callback != 0, record) {
        // SAFETY: only `install_exception_filter` stores a value, and it stores a `fn(u32, usize)`.
        let callback: fn(u32, usize) = unsafe { std::mem::transmute(callback) };
        let (code, address) = (record.ExceptionCode as u32, record.ExceptionAddress as usize);
        // A panic here would unwind into Windows, so it stops here.
        let _ = std::panic::catch_unwind(|| callback(code, address));
    }
    let previous = PREVIOUS.load(Ordering::SeqCst);
    if previous == 0 {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    // SAFETY: the value is the filter that `SetUnhandledExceptionFilter` returned.
    let previous: Filter = unsafe { std::mem::transmute(previous) };
    // SAFETY: the pointer is the one Windows gave to this filter.
    unsafe { previous(info) }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicU64;

    use windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_RECORD;

    use super::*;

    static SEEN: AtomicU64 = AtomicU64::new(0);

    fn remember(code: u32, address: usize) {
        SEEN.store(
            (u64::from(code) << 32) | (address as u64 & 0xffff_ffff),
            Ordering::SeqCst,
        );
    }

    #[test]
    fn describes_this_windows() {
        let os = os_description();
        assert!(os.starts_with("Windows 10.0.") || os.starts_with("Windows 6."), "{os}");
        assert!(os.ends_with(std::env::consts::ARCH));
    }

    #[test]
    fn finds_the_module_and_offset_of_code() {
        let frame = frame_for(finds_the_module_and_offset_of_code as *const () as usize);
        let module = frame.module.expect("the test program is a module");
        assert!(module.ends_with(".exe") && !module.contains('\\'), "{module}");
        assert!(frame.offset.is_some_and(|offset| offset > 0 && offset < 1 << 32));
        assert_eq!(frame_for(0), RawFrame::default());
    }

    #[test]
    fn reads_the_debug_id_of_the_test_program() {
        let frame = frame_for(finds_the_module_and_offset_of_code as *const () as usize);
        // A program linked by MSVC has a debug record. One linked another way may not, which is not an error.
        if let Some(id) = frame.debug_id {
            assert!(crate::pe::is_debug_id(&id), "{id}");
        }
        // Ntdll always has one, and reading it must not fault.
        let ntdll = frame_for(RtlGetVersion as *const () as usize);
        assert!(
            ntdll.debug_id.as_deref().is_some_and(crate::pe::is_debug_id),
            "{ntdll:?}"
        );
    }

    #[test]
    fn a_mapped_image_refuses_unmapped_memory() {
        let reader = MappedImage { base: 0x10 };
        assert_eq!(crate::pe::ImageReader::read(&reader, 0, 64), None);
        let reader = MappedImage { base: usize::MAX - 8 };
        assert_eq!(crate::pe::ImageReader::read(&reader, 0, 64), None);
    }

    #[test]
    fn captures_a_stack_inside_the_program() {
        let frames = capture_frames();
        assert!(!frames.is_empty());
        assert!(frames
            .iter()
            .any(|f| f.module.as_deref().is_some_and(|m| m.ends_with(".exe"))));
    }

    #[test]
    fn the_filter_passes_the_code_and_address_and_lets_windows_go_on() {
        CALLBACK.store(remember as *const () as usize, Ordering::SeqCst);
        PREVIOUS.store(0, Ordering::SeqCst);
        // SAFETY: an all-zero exception record is valid.
        let mut record: EXCEPTION_RECORD = unsafe { std::mem::zeroed() };
        record.ExceptionCode = 0xC000_0005_u32 as i32;
        record.ExceptionAddress = 0x1234 as *mut c_void;
        let info = EXCEPTION_POINTERS {
            ExceptionRecord: &mut record,
            ContextRecord: std::ptr::null_mut(),
        };
        // SAFETY: `info` points at a valid record.
        assert_eq!(unsafe { filter(&info) }, EXCEPTION_CONTINUE_SEARCH);
        assert_eq!(SEEN.load(Ordering::SeqCst), (0xC000_0005_u64 << 32) | 0x1234);
        // A null pointer, or a record that is missing, is ignored.
        SEEN.store(0, Ordering::SeqCst);
        // SAFETY: the filter accepts a null pointer.
        assert_eq!(unsafe { filter(std::ptr::null()) }, EXCEPTION_CONTINUE_SEARCH);
        let empty = EXCEPTION_POINTERS {
            ExceptionRecord: std::ptr::null_mut(),
            ContextRecord: std::ptr::null_mut(),
        };
        // SAFETY: the filter accepts a missing record.
        assert_eq!(unsafe { filter(&empty) }, EXCEPTION_CONTINUE_SEARCH);
        assert_eq!(SEEN.load(Ordering::SeqCst), 0);
        CALLBACK.store(0, Ordering::SeqCst);
    }
}
