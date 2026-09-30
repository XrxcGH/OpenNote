//! Crash safety: how long it takes to append about one second of Opus audio to a file and flush it
//! to the disk. The bytes are zeros, never recorded audio, and the file is deleted afterwards.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::Duration;

use serde_json::{json, Value};

use crate::common::{clock, stats, Result};

/// About one second of 32 kbps Opus in an Ogg page.
const CHUNK_BYTES: usize = 4_096;

/// Appends and flushes `count` chunks, 100 ms apart, and reports the time each step takes.
pub fn measure(count: usize) -> Result<Value> {
    let path = std::env::temp_dir().join(format!("opennote-audio-spike-{}.tmp", std::process::id()));
    let mut file = OpenOptions::new().create_new(true).append(true).open(&path)?;
    let chunk = vec![0u8; CHUNK_BYTES];
    let (mut write_ms, mut flush_ms) = (Vec::with_capacity(count), Vec::with_capacity(count));
    let outcome = (|| -> Result<()> {
        for _ in 0..count {
            let start = clock::now();
            file.write_all(&chunk)?;
            let written = clock::now();
            file.sync_data()?;
            let flushed = clock::now();
            write_ms.push(clock::elapsed_ms(start, written));
            flush_ms.push(clock::elapsed_ms(written, flushed));
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    })();
    drop(file);
    let _ = fs::remove_file(&path);
    outcome?;
    Ok(json!({
        "chunk_bytes": CHUNK_BYTES,
        "chunks": count,
        "folder": "the user's temporary folder",
        "write_ms": stats::summarize(&write_ms),
        "flush_ms": stats::summarize(&flush_ms),
    }))
}
