//! The Windows instance lock: the named mutex, the owner's message-only window on its own thread, and
//! forwarding with `WM_COPYDATA`.

use std::{
    sync::{mpsc, Arc},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::{
            CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, HWND, LPARAM, LRESULT, WAIT_ABANDONED,
            WAIT_OBJECT_0, WPARAM,
        },
        System::{
            DataExchange::COPYDATASTRUCT,
            LibraryLoader::GetModuleHandleW,
            Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
        },
        UI::WindowsAndMessaging::{
            AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, DispatchMessageW, FindWindowExW, GetMessageW,
            GetWindowLongPtrW, GetWindowThreadProcessId, PostMessageW, PostQuitMessage, RegisterClassW,
            SendMessageTimeoutW, SetWindowLongPtrW, GWLP_USERDATA, HWND_MESSAGE, MSG, SMTO_ABORTIFHUNG, SMTO_BLOCK,
            WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE, WM_COPYDATA, WM_DESTROY, WM_NCDESTROY, WNDCLASSW,
        },
    },
};

use super::{Forwarded, InstanceGuard, InstanceOutcome, Sink};

/// Marks OpenNote's `WM_COPYDATA` messages: "ONFW" in ASCII.
const MAGIC: usize = 0x4F4E_4657;

/// How long a second launch waits for the owner to take its arguments.
const SEND_TIMEOUT_MS: u32 = 2_000;

/// The owner's lock and message window.
pub(super) struct Owner {
    mutex: isize,
    window: Option<isize>,
    thread: Option<JoinHandle<()>>,
    pub(super) sink: Arc<Sink>,
}

impl Drop for Owner {
    fn drop(&mut self) {
        if let Some(window) = self.window {
            // SAFETY: the window belongs to this owner's thread; posting WM_CLOSE to a destroyed window just fails.
            let _ = unsafe { PostMessageW(Some(hwnd(window)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        // SAFETY: the handle came from CreateMutexW and is closed exactly once. ReleaseMutex fails harmlessly when
        // another thread owns the mutex; the process exit releases it then.
        unsafe {
            let _ = ReleaseMutex(handle(self.mutex));
            let _ = CloseHandle(handle(self.mutex));
        }
    }
}

fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut _)
}

fn handle(raw: isize) -> HANDLE {
    HANDLE(raw as *mut _)
}

/// The mutex name and the owner's window class name for a profile key.
fn names(key: &str) -> (HSTRING, HSTRING) {
    let (mutex, window) = names_for_tests(key);
    (HSTRING::from(mutex), HSTRING::from(window))
}

pub(super) fn names_for_tests(key: &str) -> (String, String) {
    (format!("Local\\OpenNote.{key}"), format!("OpenNote.Instance.{key}"))
}

pub(super) fn acquire(key: &str, payload: &Forwarded, find: Duration, wait: Duration) -> InstanceOutcome {
    let (mutex_name, window_name) = names(key);
    // SAFETY: the name is a valid NUL-terminated string that outlives the call.
    let created = unsafe { CreateMutexW(None, true, &mutex_name) };
    // SAFETY: GetLastError has no preconditions; it's read right after CreateMutexW.
    let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    let mutex = match created {
        Ok(mutex) => mutex.0 as isize,
        Err(error) => {
            log::error!("Couldn't create the instance lock, so this process runs without it: {error}");
            return InstanceOutcome::Owner(InstanceGuard { owner: None });
        }
    };
    if !existed {
        return InstanceOutcome::Owner(InstanceGuard {
            owner: Some(own(mutex, &window_name)),
        });
    }
    if forward(&window_name, payload, find) {
        // SAFETY: the handle is ours and isn't used again.
        let _ = unsafe { CloseHandle(handle(mutex)) };
        return InstanceOutcome::Forwarded;
    }
    log::warn!("The process that holds this profile didn't answer; waiting for it to exit.");
    let millis = u32::try_from(wait.as_millis()).unwrap_or(u32::MAX);
    // SAFETY: `mutex` is a valid mutex handle.
    let waited = unsafe { WaitForSingleObject(handle(mutex), millis) };
    if waited == WAIT_OBJECT_0 || waited == WAIT_ABANDONED {
        return InstanceOutcome::Owner(InstanceGuard {
            owner: Some(own(mutex, &window_name)),
        });
    }
    log::error!("The process that holds this profile never let go of it, so this launch exits.");
    // SAFETY: as above.
    let _ = unsafe { CloseHandle(handle(mutex)) };
    InstanceOutcome::Unavailable
}

/// Looks for the owner's window until `timeout`, then sends it the payload. True when the owner took it.
fn forward(window_name: &HSTRING, payload: &Forwarded, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        // SAFETY: the class name is a valid NUL-terminated string.
        if let Ok(window) = unsafe { FindWindowExW(Some(HWND_MESSAGE), None, window_name, PCWSTR::null()) } {
            if send(window, payload) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn send(window: HWND, payload: &Forwarded) -> bool {
    let Ok(mut bytes) = serde_json::to_vec(payload) else {
        return false;
    };
    let mut process = 0u32;
    // SAFETY: `window` came from FindWindowExW; a stale handle only makes these calls fail. Letting the owner take
    // the foreground is best effort.
    unsafe {
        GetWindowThreadProcessId(window, Some(&mut process));
        let _ = AllowSetForegroundWindow(process);
    }
    let data = COPYDATASTRUCT {
        dwData: MAGIC,
        cbData: u32::try_from(bytes.len()).unwrap_or(0),
        lpData: bytes.as_mut_ptr().cast(),
    };
    let mut result = 0usize;
    // SAFETY: `data` and the bytes it points to live until SendMessageTimeoutW returns; Windows copies them into
    // the receiving process.
    let sent = unsafe {
        SendMessageTimeoutW(
            window,
            WM_COPYDATA,
            WPARAM(0),
            LPARAM((&raw const data) as isize),
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            SEND_TIMEOUT_MS,
            Some(&mut result),
        )
    };
    sent.0 != 0 && result == 1
}

/// Starts the owner's message window on its own thread, so it answers even while the main thread is busy.
fn own(mutex: isize, window_name: &HSTRING) -> Owner {
    let sink = Arc::new(Sink::default());
    let (created, window) = mpsc::channel();
    let name = window_name.clone();
    let thread_sink = Arc::clone(&sink);
    let thread = thread::Builder::new()
        .name("opennote-instance".into())
        .spawn(move || run_window(&name, thread_sink, &created));
    let window = match &thread {
        Ok(_) => window.recv_timeout(Duration::from_secs(5)).ok().flatten(),
        Err(_) => None,
    };
    if window.is_none() {
        log::error!("Couldn't create the instance window, so later launches can't hand over their arguments.");
    }
    Owner {
        mutex,
        window,
        thread: thread.ok(),
        sink,
    }
}

fn run_window(name: &HSTRING, sink: Arc<Sink>, created: &mpsc::Sender<Option<isize>>) {
    let Some(window) = create_window(name, sink) else {
        let _ = created.send(None);
        return;
    };
    let _ = created.send(Some(window.0 as isize));
    let mut message = MSG::default();
    // SAFETY: a standard message loop for this thread's windows; it ends when WM_DESTROY posts WM_QUIT.
    unsafe {
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
    }
}

fn create_window(name: &HSTRING, sink: Arc<Sink>) -> Option<HWND> {
    // SAFETY: registering a class and creating a message-only window with a valid class name. The class name
    // outlives both calls. A class already registered by an earlier owner in this process is reused.
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: PCWSTR(name.as_ptr()),
            ..Default::default()
        };
        RegisterClassW(&class);
        let window = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            name,
            name,
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        )
        .ok()?;
        // The window keeps one reference to the sink, released in WM_NCDESTROY.
        SetWindowLongPtrW(window, GWLP_USERDATA, Arc::into_raw(sink) as isize);
        Some(window)
    }
}

unsafe extern "system" fn window_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_COPYDATA => LRESULT(isize::from(receive(window, lparam))),
        WM_DESTROY => {
            // SAFETY: called on the window's own thread, ending its message loop.
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        WM_NCDESTROY => {
            // SAFETY: the pointer was stored by create_window from Arc::into_raw and is reclaimed exactly once.
            unsafe {
                let sink = SetWindowLongPtrW(window, GWLP_USERDATA, 0) as *const Sink;
                if !sink.is_null() {
                    drop(Arc::from_raw(sink));
                }
                DefWindowProcW(window, message, wparam, lparam)
            }
        }
        // SAFETY: default handling for every other message.
        _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
    }
}

/// Reads a `WM_COPYDATA` message from a second launch and hands it to the sink.
fn receive(window: HWND, lparam: LPARAM) -> bool {
    // SAFETY: for WM_COPYDATA, lparam points to a COPYDATASTRUCT that stays valid while the message is handled,
    // and lpData points to cbData readable bytes. The user data is the sink create_window stored.
    unsafe {
        let Some(data) = (lparam.0 as *const COPYDATASTRUCT).as_ref() else {
            return false;
        };
        if data.dwData != MAGIC || data.lpData.is_null() {
            return false;
        }
        let bytes = std::slice::from_raw_parts(data.lpData.cast::<u8>(), data.cbData as usize);
        let Ok(forwarded) = serde_json::from_slice::<Forwarded>(bytes) else {
            return false;
        };
        let Some(sink) = (GetWindowLongPtrW(window, GWLP_USERDATA) as *const Sink).as_ref() else {
            return false;
        };
        sink.deliver(forwarded);
    }
    true
}
