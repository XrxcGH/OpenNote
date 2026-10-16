//! The listeners: TCP on `127.0.0.1` only, and on Windows a named pipe that refuses remote clients. Each
//! connection carries one request and gets its own thread, up to [`MAX_CONNECTIONS`] at once; past that a request
//! gets 503 at once. Each read must make progress within [`READ_TIMEOUT`], and the whole request must arrive within
//! [`REQUEST_DEADLINE`], so neither an idle connection nor one that trickles a byte at a time can hold a thread.
//! Stopping the server closes both listeners; requests already running finish.

use std::{
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use crate::{
    guard::Transport,
    http::{read_request, write_response, HttpError, Limits, Response},
    routes::Api,
};

/// The most requests served at once.
pub const MAX_CONNECTIONS: usize = 16;

/// How long a client has to send its request.
pub const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a client has to send its whole request, however slowly it sends.
pub const REQUEST_DEADLINE: Duration = Duration::from_secs(30);

const POLL: Duration = Duration::from_millis(50);

/// A reader that fails once its deadline has passed.
struct Deadline<'s, S> {
    inner: &'s mut S,
    until: Instant,
}

impl<S: Read> Read for Deadline<'_, S> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if Instant::now() > self.until {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "the request took too long to arrive",
            ));
        }
        self.inner.read(buf)
    }
}

/// A running server.
pub struct Server {
    port: u16,
    pipe: Option<String>,
    stop: Arc<AtomicBool>,
    threads: Vec<thread::JoinHandle<()>>,
}

impl Server {
    /// Listens on `127.0.0.1:<port>`, or on a free port when that one is taken or `port` is 0, and on the named
    /// pipe `pipe` when one is given (Windows only).
    pub fn start(api: Arc<Api>, port: u16, pipe: Option<&str>) -> io::Result<Server> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
            .or_else(|_| TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let stop = Arc::new(AtomicBool::new(false));
        let active = Arc::new(AtomicUsize::new(0));
        let mut threads = Vec::new();
        {
            let (api, stop, active) = (api.clone(), stop.clone(), active.clone());
            threads.push(
                thread::Builder::new()
                    .name("opennote-api-tcp".into())
                    .spawn(move || accept_tcp(&listener, &api, &stop, &active, port))?,
            );
        }
        let pipe = match pipe {
            Some(name) => match pipe::start(name, api, stop.clone(), active) {
                Ok(handle) => {
                    threads.push(handle);
                    Some(name.to_owned())
                }
                Err(error) => {
                    log::warn!("The local API runs without its named pipe: {error}");
                    None
                }
            },
            None => None,
        };
        Ok(Server {
            port,
            pipe,
            stop,
            threads,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// The pipe's name, when the pipe is listening.
    pub fn pipe(&self) -> Option<&str> {
        self.pipe.as_deref()
    }

    /// Closes the listeners and waits for them to stop.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(name) = &self.pipe {
            pipe::wake(name);
        }
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn accept_tcp(listener: &TcpListener, api: &Arc<Api>, stop: &AtomicBool, active: &Arc<AtomicUsize>, port: u16) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, peer)) => {
                // Only this PC: the socket is bound to 127.0.0.1, and this checks it again.
                if !peer.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
                let _ = stream.set_write_timeout(Some(READ_TIMEOUT));
                serve(api, active, stream, Transport::Tcp { port });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL),
            Err(error) => {
                log::warn!("The local API couldn't accept a connection: {error}");
                thread::sleep(POLL);
            }
        }
    }
}

/// Answers one connection on its own thread, or with 503 when too many are open.
fn serve<S: Read + Write + Send + 'static>(
    api: &Arc<Api>,
    active: &Arc<AtomicUsize>,
    mut stream: S,
    transport: Transport,
) {
    if active.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
        active.fetch_sub(1, Ordering::SeqCst);
        let _ = write_response(
            &mut stream,
            &Response::error(503, "busy", "OpenNote is busy. Try again."),
        );
        return;
    }
    let api = api.clone();
    let job = move || answer(&api, &mut stream, transport);
    run_counted(active, job, |work| {
        thread::Builder::new()
            .name("opennote-api-request".into())
            .spawn(work)
            .map(drop)
    });
}

/// Gives back one connection slot when dropped, whether the work ran or never started.
struct Slot(Arc<AtomicUsize>);

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Runs `job` through `spawn` holding the slot already counted in `active`. A failed spawn drops the job, and the
/// slot with it, so the count never leaks.
fn run_counted(
    active: &Arc<AtomicUsize>,
    job: impl FnOnce() + Send + 'static,
    spawn: impl FnOnce(Box<dyn FnOnce() + Send>) -> io::Result<()>,
) {
    let slot = Slot(active.clone());
    if spawn(Box::new(move || {
        let _slot = slot;
        job();
    }))
    .is_err()
    {
        log::warn!("The local API couldn't start a thread for a request.");
    }
}

/// Reads one request and writes its answer.
pub fn answer(api: &Api, stream: &mut (impl Read + Write), transport: Transport) {
    let mut timed = Deadline {
        inner: stream,
        until: Instant::now() + REQUEST_DEADLINE,
    };
    let read = read_request(&mut timed, &Limits::default());
    let response = match read {
        Ok(request) => api.handle(&request, transport),
        Err(HttpError::Io(_)) => return,
        Err(HttpError::TooLarge) => Response::error(413, "tooLarge", "The request is too large."),
        Err(HttpError::Unsupported) => Response::error(411, "length", "Send the body with Content-Length."),
        Err(HttpError::Malformed(_)) => Response::error(400, "malformed", "The request isn't valid HTTP."),
    };
    let _ = write_response(stream, &response);
}

#[cfg(windows)]
mod pipe {
    //! The named pipe. `PIPE_REJECT_REMOTE_CLIENTS` keeps other PCs out, and `FILE_FLAG_FIRST_PIPE_INSTANCE`
    //! makes the first instance fail when another process already owns the name, so OpenNote never shares a pipe
    //! with an impostor. Clients check the listener anyway, with `GET /v1/hello`, before they send a token.

    use std::{
        io::{self, Read, Write},
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        thread,
    };

    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::{CloseHandle, ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE, HANDLE},
            Storage::FileSystem::{
                CreateFileW, FlushFileBuffers, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_SHARE_NONE,
                OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
            },
            System::Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
                PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
            },
        },
    };

    use super::{serve, Api};
    use crate::guard::Transport;

    /// One connected instance of the pipe.
    pub struct Connection(pub(super) HANDLE);

    // SAFETY: a pipe handle may be used from any thread; each connection is used by one thread at a time.
    unsafe impl Send for Connection {}

    impl Read for Connection {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let mut read = 0u32;
            // SAFETY: the handle is open, and the buffer outlives the call.
            match unsafe { ReadFile(self.0, Some(buffer), Some(&mut read), None) } {
                Ok(()) => Ok(read as usize),
                // A client that closed its end reads as the end of the request.
                Err(_) if read == 0 => Ok(0),
                Err(error) => Err(io::Error::other(error)),
            }
        }
    }

    impl Write for Connection {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            let mut written = 0u32;
            // SAFETY: the handle is open, and the buffer outlives the call.
            unsafe { WriteFile(self.0, Some(buffer), Some(&mut written), None) }.map_err(io::Error::other)?;
            Ok(written as usize)
        }

        fn flush(&mut self) -> io::Result<()> {
            // SAFETY: the handle is open.
            unsafe { FlushFileBuffers(self.0) }.map_err(io::Error::other)
        }
    }

    impl Drop for Connection {
        fn drop(&mut self) {
            // SAFETY: the handle is open and closed once, here.
            unsafe {
                let _ = FlushFileBuffers(self.0);
                let _ = DisconnectNamedPipe(self.0);
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub fn full_name(name: &str) -> String {
        format!(r"\\.\pipe\{name}")
    }

    fn create(name: &str, first: bool) -> io::Result<HANDLE> {
        let mode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
        let flags = if first {
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            PIPE_ACCESS_DUPLEX
        };
        // SAFETY: the name is NUL-terminated and outlives the call. No security attributes: the default DACL lets
        // only this user, administrators, and the system write to the pipe.
        let handle = unsafe {
            CreateNamedPipeW(
                &HSTRING::from(full_name(name)),
                flags,
                mode,
                PIPE_UNLIMITED_INSTANCES,
                64 * 1024,
                64 * 1024,
                0,
                None,
            )
        };
        if handle.is_invalid() {
            return Err(io::Error::last_os_error());
        }
        Ok(handle)
    }

    pub fn start(
        name: &str,
        api: Arc<Api>,
        stop: Arc<AtomicBool>,
        active: Arc<AtomicUsize>,
    ) -> io::Result<thread::JoinHandle<()>> {
        let first = create(name, true)?;
        let name = name.to_owned();
        let first = Connection(first);
        thread::Builder::new().name("opennote-api-pipe".into()).spawn(move || {
            let mut next = Some(first);
            while !stop.load(Ordering::SeqCst) {
                let instance = match next.take() {
                    Some(instance) => instance,
                    None => match create(&name, false) {
                        Ok(handle) => Connection(handle),
                        Err(error) => {
                            log::warn!("The local API's pipe stopped: {error}");
                            return;
                        }
                    },
                };
                // SAFETY: the handle is a pipe instance this thread created.
                let connected = unsafe { ConnectNamedPipe(instance.0, None) };
                let ok = connected.is_ok()
                    || connected
                        .as_ref()
                        .is_err_and(|error| error.code() == ERROR_PIPE_CONNECTED.to_hresult());
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                if ok {
                    serve(&api, &active, instance, Transport::Pipe);
                }
            }
        })
    }

    /// Opens the pipe once, so a listener waiting in `ConnectNamedPipe` sees the stop flag.
    pub fn wake(name: &str) {
        // SAFETY: the name is NUL-terminated; the handle, if any, is closed at once.
        unsafe {
            if let Ok(handle) = CreateFileW(
                &HSTRING::from(full_name(name)),
                (GENERIC_READ | GENERIC_WRITE).0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                Default::default(),
                None,
            ) {
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[cfg(not(windows))]
mod pipe {
    use std::{
        io,
        sync::{
            atomic::{AtomicBool, AtomicUsize},
            Arc,
        },
        thread,
    };

    use super::Api;

    pub fn start(
        _name: &str,
        _api: Arc<Api>,
        _stop: Arc<AtomicBool>,
        _active: Arc<AtomicUsize>,
    ) -> io::Result<thread::JoinHandle<()>> {
        Err(io::Error::other("named pipes are Windows only"))
    }

    pub fn wake(_name: &str) {}
}

#[cfg(windows)]
pub use pipe::full_name as pipe_path;

/// Opens the named pipe as a client, for the `opennote` tool and the tests.
#[cfg(windows)]
pub fn connect_pipe(name: &str) -> io::Result<impl Read + Write> {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::{GENERIC_READ, GENERIC_WRITE},
            Storage::FileSystem::{CreateFileW, FILE_SHARE_NONE, OPEN_EXISTING},
        },
    };
    // SAFETY: the name is NUL-terminated; the handle is owned by the returned connection.
    let handle = unsafe {
        CreateFileW(
            &HSTRING::from(pipe::full_name(name)),
            (GENERIC_READ | GENERIC_WRITE).0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            Default::default(),
            None,
        )
    }
    .map_err(io::Error::other)?;
    Ok(pipe::Connection(handle))
}

/// Opens a TCP connection to the listener.
pub fn connect_tcp(port: u16) -> io::Result<TcpStream> {
    let stream = TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_secs(5),
    )?;
    stream.set_read_timeout(Some(Duration::from_secs(180)))?;
    stream.set_write_timeout(Some(READ_TIMEOUT))?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_spawn_gives_its_slot_back() {
        let active = Arc::new(AtomicUsize::new(1));
        run_counted(&active, || {}, |_work| Err(io::Error::other("no threads")));
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_finished_job_gives_its_slot_back() {
        let active = Arc::new(AtomicUsize::new(1));
        run_counted(&active, || {}, |work| {
            work();
            Ok(())
        });
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }
}
