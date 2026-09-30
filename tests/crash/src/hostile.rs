//! A hostile reader (plan 13.6): while the writer runs, the parent opens random notebook files for 0 to 50 ms,
//! as an antivirus scanner does. On Windows it opens them without delete sharing, which makes replacing or
//! deleting them fail until it lets go. Elsewhere it only reads them.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use crate::rng::Rng;

/// The reader thread. Dropping it stops the thread.
pub struct Hostile {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<u64>>,
}

impl Hostile {
    /// Starts reading files under `root`.
    pub fn start(root: &Path, seed: u64) -> Hostile {
        let stop = Arc::new(AtomicBool::new(false));
        let (root, flag) = (root.to_path_buf(), stop.clone());
        let thread = std::thread::spawn(move || run(&root, &flag, Rng::new(seed)));
        Hostile {
            stop,
            thread: Some(thread),
        }
    }

    /// Stops the thread, and returns how many files it held.
    pub fn stop(mut self) -> u64 {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().and_then(|t| t.join().ok()).unwrap_or(0)
    }
}

impl Drop for Hostile {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(root: &Path, stop: &AtomicBool, mut rng: Rng) -> u64 {
    let mut held = 0;
    let mut files = Vec::new();
    while !stop.load(Ordering::SeqCst) {
        if files.is_empty() || rng.below(20) == 0 {
            files = list_files(root);
        }
        if let Some(path) = files.get(rng.below(files.len().max(1))) {
            if let Ok(file) = open_like_a_scanner(path) {
                held += 1;
                std::thread::sleep(Duration::from_millis(rng.range(0..51)));
                drop(file);
            }
        }
        std::thread::sleep(Duration::from_millis(rng.range(1..20)));
    }
    held
}

#[cfg(windows)]
fn open_like_a_scanner(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_SHARE_READ | FILE_SHARE_WRITE, without FILE_SHARE_DELETE.
    OpenOptions::new().read(true).share_mode(1 | 2).open(path)
}

#[cfg(not(windows))]
fn open_like_a_scanner(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().read(true).open(path)
}

/// Every file under `root`.
pub fn list_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => pending.push(path),
                Ok(_) => files.push(path),
                Err(_) => {}
            }
        }
    }
    files
}
