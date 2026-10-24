//! Background priority for the thread that transcribes, so typing and inking stay smooth.

/// Puts the calling thread in background mode for the rest of its life.
///
/// On Windows this lowers the thread's processor, disk, and memory priority (it also helps the
/// battery on machines that use efficiency cores). Other platforms do nothing for now. Returns
/// whether the mode was entered.
pub fn enter_background_mode() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN};
        // SAFETY: GetCurrentThread returns a pseudo handle that is always valid for the caller.
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN).is_ok() }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(all(test, windows))]
mod tests {
    use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority, THREAD_PRIORITY_NORMAL};

    use super::*;

    #[test]
    fn background_mode_lowers_the_thread_priority() {
        // A new thread, so the test runner's own threads keep their priority.
        std::thread::spawn(|| {
            // SAFETY: the pseudo handle is valid for the calling thread.
            let before = unsafe { GetThreadPriority(GetCurrentThread()) };
            assert_eq!(before, THREAD_PRIORITY_NORMAL.0);
            assert!(enter_background_mode());
            let after = unsafe { GetThreadPriority(GetCurrentThread()) };
            assert!(after < before, "priority {after} should be below {before}");
        })
        .join()
        .unwrap();
    }
}
