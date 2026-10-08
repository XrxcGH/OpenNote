//! A hardware check for the cpal source, run by hand with `cargo test -p opennote-media -- --ignored`.
//!
//! It plays silence on the default output device so loopback keeps delivering, and captures that
//! loopback stream in memory. It never opens the microphone and never writes audio to disk. It checks
//! what ADR 0007 assumed: cpal's capture times are on the same clock as [`SystemClock`], so a
//! pause or a stroke timestamp lines up with the packets.

#![cfg(windows)]

use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream};
use opennote_media::audio::device::CpalSource;
use opennote_media::audio::ring::{packet_channel, PacketReader, SinkHandle, TrackStats};
use opennote_media::audio::{AudioSource, Clock, SystemClock};

/// An output stream of silence, which keeps loopback delivering.
fn play_silence(output: &Device) -> Stream {
    let config = output.default_output_config().unwrap();
    let stream = output
        .build_output_stream::<f32, _, _>(config.config(), |data, _| data.fill(0.0), |_| {}, None)
        .unwrap();
    stream.play().unwrap();
    stream
}

/// Takes every queued packet, and returns the capture times.
fn drain(reader: &mut PacketReader) -> Vec<u64> {
    let (mut samples, mut times) = (Vec::new(), Vec::new());
    while let Some(packet) = reader.next(&mut samples) {
        times.push(packet.capture_ns);
    }
    times
}

fn pause_for(source: &mut CpalSource, ms: u64) {
    source.set_paused(true).unwrap();
    std::thread::sleep(Duration::from_millis(ms));
}

#[test]
#[ignore = "needs an audio output device"]
fn loopback_capture_times_share_the_system_clock() {
    let Some(output) = cpal::default_host().default_output_device() else {
        eprintln!("There is no output device, so the loopback check is skipped.");
        return;
    };
    let _silence = play_silence(&output);
    let mut source = CpalSource::system_audio().unwrap();
    let format = source.format();
    let stats = Arc::new(TrackStats::default());
    let (sink, mut reader) = packet_channel(format, format.rate as usize * 5, Arc::clone(&stats));
    source.start(SinkHandle::new(sink)).unwrap();
    std::thread::sleep(Duration::from_millis(1_500));
    let now = SystemClock.now_ns();
    pause_for(&mut source, 600);
    let mut times = drain(&mut reader);
    let before_resume = times.len();

    // A paused source closes its stream, so nothing arrives, and resuming reopens it.
    std::thread::sleep(Duration::from_millis(300));
    assert!(drain(&mut reader).is_empty(), "a packet arrived while paused");
    source.set_paused(false).unwrap();
    std::thread::sleep(Duration::from_millis(800));
    source.stop();
    times.extend(drain(&mut reader));

    assert!(before_resume > 50, "{before_resume} packets before the pause");
    assert!(
        times.len() > before_resume + 30,
        "{} packets after resuming",
        times.len() - before_resume
    );
    assert!(
        times.windows(2).all(|pair| pair[0] <= pair[1]),
        "capture times went backward"
    );
    let age_ms = (now as i64 - times[before_resume - 1] as i64) / 1_000_000;
    assert!(
        (-500..1_500).contains(&age_ms),
        "the last packet is {age_ms} ms before now"
    );
    let dropped = TrackStats::load(&stats.dropped_packets);
    println!(
        "{} packets, {dropped} dropped, the last {age_ms} ms before now",
        times.len()
    );
}
