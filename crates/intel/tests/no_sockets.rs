//! The runtime half of the "no data leaves the device" promise: while the Windows engines read an image,
//! read handwriting, list voices, and speak, this process holds no socket. Windows only.
//!
//! `netstat -ano` lists every TCP and UDP endpoint with the ID of the process that owns it. The test samples
//! it while the engines run on another thread, then opens a socket of its own to prove the watch sees one.
//! A socket opened and closed between two samples can slip by, so this complements `tests/no_network.rs`,
//! which proves the code has no way to open one.
#![cfg(all(windows, feature = "winrt"))]

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use opennote_intel::ink::{InkOptions, InkPoint, InkStroke, StrokeKey};
use opennote_intel::ocr::{OcrImage, OcrOptions, PixelFormat};
use opennote_intel::speech::SpeakOptions;
use opennote_intel::{Engines, IntelSettings};

/// The TCP and UDP endpoints that this process owns, as netstat prints them.
fn sockets_of_this_process() -> Vec<String> {
    let output = Command::new("netstat").arg("-ano").output().expect("netstat runs");
    assert!(output.status.success(), "netstat failed");
    let pid = std::process::id().to_string();
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("TCP") || line.starts_with("UDP"))
        .filter(|line| line.split_whitespace().last() == Some(pid.as_str()))
        .map(str::to_owned)
        .collect()
}

/// Runs every Windows engine once. Failures, such as a missing language, do not matter here: only sockets do.
fn run_every_engine(engines: &Engines) {
    let image = OcrImage::new(64, 32, PixelFormat::Gray8, vec![255; 64 * 32]).unwrap();
    let ocr = engines.ocr().unwrap();
    let _ = ocr.available_languages();
    let _ = ocr.recognize(&image, &OcrOptions::default());
    let stroke = InkStroke {
        key: StrokeKey([7; 16]),
        points: (0..20)
            .map(|i| InkPoint {
                x: i as f32 * 3.0,
                y: 20.0 + (i % 5) as f32,
            })
            .collect(),
    };
    let _ = engines.ink().unwrap().recognize(&[stroke], &InkOptions::default());
    let speech = engines.speech().unwrap();
    let _ = speech.voices();
    let _ = speech.synthesize("Nothing leaves the device.", &SpeakOptions::default());
}

#[test]
fn the_engines_open_no_socket_and_the_watch_would_see_one() {
    let engines = Arc::new(Engines::platform(IntelSettings::recommended()));
    let done = Arc::new(AtomicBool::new(false));
    let worker = {
        let (engines, done) = (Arc::clone(&engines), Arc::clone(&done));
        std::thread::spawn(move || {
            let mut runs = 0;
            while !done.load(Ordering::SeqCst) || runs == 0 {
                run_every_engine(&engines);
                runs += 1;
            }
        })
    };
    let mut seen = Vec::new();
    for _ in 0..2 {
        seen.extend(sockets_of_this_process());
    }
    done.store(true, Ordering::SeqCst);
    worker.join().expect("the engines ran without a panic");
    seen.extend(sockets_of_this_process());
    assert!(seen.is_empty(), "the engines opened sockets: {seen:?}");

    // The control: a socket this process opens shows up, so an empty list above means something.
    let socket = std::net::UdpSocket::bind("127.0.0.1:0").expect("a local socket opens");
    let port = format!(":{}", socket.local_addr().unwrap().port());
    let after = sockets_of_this_process();
    assert!(
        after.iter().any(|line| line.contains(&port)),
        "the watch missed this process's own socket on {port}: {after:?}"
    );
}
