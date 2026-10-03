//! Measures what recording and playback cost, for docs/perf/phase-9-core.md.
//!
//! Run it in release mode, with the machine otherwise quiet:
//!
//! ```sh
//! cargo run --release -p opennote-media --features opus --example cpu_bench -- 60
//! ```
//!
//! The argument is how many seconds each real-time recording lasts, or zero to skip them. The benchmark never opens a
//! microphone. A generated signal stands in for the device and is delivered in 10 ms packets, the way
//! a callback would. The cost of the callback itself is measured on its own.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opennote_media::audio::catalog::DeviceCatalog;
use opennote_media::audio::encoder::{opus_tags, parse_pre_skip};
use opennote_media::audio::ogg::OggWriter;
use opennote_media::audio::ring::{packet_channel, SinkHandle, TrackStats};
use opennote_media::audio::synthetic::{synthetic, Signal, SyntheticHandle, SyntheticSource};
use opennote_media::audio::{
    AudioSource, Clock, Options, Recorder, RecordingSummary, SourceFormat, SystemClock, TrackKind, TrackStart,
};
use opennote_media::playback::{open_recording, opus_decoder_factory};

const MONO: SourceFormat = SourceFormat {
    rate: 48_000,
    channels: 1,
};

/// CPU time of this process, in seconds.
#[cfg(windows)]
fn cpu_seconds() -> f64 {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: the pointers are valid, and the pseudo handle of the current process always works.
    unsafe { GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user) };
    let ticks = |t: FILETIME| ((u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)) as f64;
    (ticks(kernel) + ticks(user)) / 1e7
}

#[cfg(not(windows))]
fn cpu_seconds() -> f64 {
    0.0
}

/// A signal like speech: a voiced tone with a syllable rhythm, a little breath noise, and pauses.
/// Six seconds of it are computed once and repeated, so that making the signal costs almost nothing.
fn speech() -> Signal {
    let table: Vec<f32> = (0..6 * 48_000u64)
        .map(|frame| {
            let t = frame as f32 / 48_000.0;
            let syllable = (0.5 + 0.5 * (std::f32::consts::TAU * 3.5 * t).sin()).powi(2);
            let phrase = if t < 4.5 { 1.0 } else { 0.05 };
            let voice: f32 = (1..=12)
                .map(|k| (std::f32::consts::TAU * 130.0 * k as f32 * t).sin() / k as f32)
                .sum();
            let breath = ((frame.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 40) as f32 / 16_777_216.0 - 0.5) * 0.02;
            0.15 * voice * syllable * phrase + breath
        })
        .collect();
    Arc::new(move |frame| table[(frame % table.len() as u64) as usize])
}

fn source(start_ns: u64) -> (SyntheticSource, SyntheticHandle) {
    synthetic(MONO, speech(), start_ns)
}

/// Delivers audio at the pace of the real clock until `seconds` have passed.
fn pace(handles: &[&SyntheticHandle], seconds: u64, mut each_pass: impl FnMut()) {
    let begun = Instant::now();
    let mut delivered = 0;
    while begun.elapsed() < Duration::from_secs(seconds) {
        each_pass();
        let due = begun.elapsed().as_millis() as u64 / 10 * 10;
        if due > delivered {
            for handle in handles {
                handle.produce_ms(due - delivered);
            }
            delivered = due;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// Prints one row of the results table.
fn row(what: impl std::fmt::Display, cost: impl std::fmt::Display) {
    println!("| {what} | {cost} |");
}

fn percent(cpu: f64, wall: f64) -> f64 {
    cpu / wall * 100.0
}

/// How long the audio callback takes to hand over a packet of 10 ms of stereo audio.
fn callback_cost() {
    let format = SourceFormat {
        rate: 48_000,
        channels: 2,
    };
    let stats = Arc::new(TrackStats::default());
    let (sink, mut reader) = packet_channel(format, 48_000, stats);
    let handle = SinkHandle::new(sink);
    let packet = vec![0.1f32; 960];
    let mut scratch = Vec::new();
    let runs = 200_000;
    let mut worst = Duration::ZERO;
    let begun = Instant::now();
    for index in 0..runs {
        let started = Instant::now();
        handle.push(index, &packet);
        worst = worst.max(started.elapsed());
        reader.next(&mut scratch);
    }
    let each = begun.elapsed().as_nanos() as f64 / f64::from(runs as u32);
    println!(
        "| Audio callback, a 10 ms stereo packet | {:.2} µs on average, {:.0} µs at worst |",
        each / 1e3,
        worst.as_nanos() as f64 / 1e3
    );
}

/// Encodes and decodes 120 s of speech with libopus alone, to show what the rest of the pipeline adds.
fn codec_alone() {
    let signal = speech();
    let frames: Vec<Vec<f32>> = (0..6_000u64)
        .map(|index| (0..960).map(|i| signal(index * 960 + i)).collect())
        .collect();
    let mut encoder = opus::Encoder::new(48_000, opus::Channels::Mono, opus::Application::Voip).unwrap();
    encoder.set_bitrate(opus::Bitrate::Bits(32_000)).unwrap();
    let mut decoder = opus::Decoder::new(48_000, opus::Channels::Mono).unwrap();
    let mut buffer = vec![0u8; 1_275];

    let before = cpu_seconds();
    let packets: Vec<Vec<u8>> = frames
        .iter()
        .map(|pcm| {
            let size = encoder.encode_float(pcm, &mut buffer).unwrap();
            buffer[..size].to_vec()
        })
        .collect();
    let encode_cpu = cpu_seconds() - before;

    let mut frame = vec![0f32; 960];
    let before = cpu_seconds();
    for packet in &packets {
        decoder.decode_float(packet, &mut frame, false).unwrap();
    }
    let decode_cpu = cpu_seconds() - before;
    let kbps = packets.iter().map(Vec::len).sum::<usize>() as f64 * 8.0 / 120.0 / 1e3;
    row(
        "libopus alone, 120 s of speech",
        format!(
            "encoding {:.1} ms of CPU for each second, decoding {:.1} ms, {kbps:.1} kbps",
            encode_cpu / 120.0 * 1e3,
            decode_cpu / 120.0 * 1e3
        ),
    );
}

/// What the benchmark's own delivery loop costs, as CPU seconds for each second. It feeds a ring that a loop
/// empties, so the recorder's work is the only thing missing. The recording rows can be read against it.
fn harness_cost() -> f64 {
    let (mut source, handle) = source(SystemClock.now_ns());
    let stats = Arc::new(TrackStats::default());
    let (sink, mut reader) = packet_channel(MONO, 480_000, stats);
    source.start(SinkHandle::new(sink)).unwrap();
    let mut scratch = Vec::new();
    let before = cpu_seconds();
    pace(&[&handle], 10, || while reader.next(&mut scratch).is_some() {});
    (cpu_seconds() - before) / 10.0
}

/// Records in real time and reports the CPU use of the whole process, which includes the thread that
/// stands in for the device.
fn record_realtime(dir: &Path, seconds: u64, with_system: bool) -> f64 {
    let wall = seconds as f64;
    let (mic, mic_handle) = source(SystemClock.now_ns());
    let (system, system_handle) = source(SystemClock.now_ns());
    let mut handles = vec![&mic_handle];
    let mut tracks = vec![TrackStart::new(TrackKind::Microphone, "m", Box::new(mic))];
    if with_system {
        handles.push(&system_handle);
        tracks.push(TrackStart::new(TrackKind::SystemAudio, "s", Box::new(system)));
    }

    let before = cpu_seconds();
    let recording = Recorder::new(dir).start("bench", tracks).unwrap();
    pace(&handles, seconds, || {});
    let health = recording.health();
    let summary = recording.stop().unwrap();
    let cpu = cpu_seconds() - before;

    let dropped: u64 = health.iter().map(|track| track.dropped_packets).sum();
    let tracks = summary.tracks.len();
    let harness = harness_cost() * tracks as f64;
    row(
        format!("Recording {tracks} track(s) in real time, {seconds} s"),
        format!(
            "{:.2}% of one core ({:.1} ms of CPU for each second), {:.1} ms of it the benchmark's own loop, {dropped} packets dropped",
            percent(cpu, wall),
            cpu / wall * 1e3,
            harness * 1e3
        ),
    );
    percent(cpu, wall)
}

/// Records `seconds` of audio as fast as the encoder allows, and returns the summary.
fn record_offline(dir: &Path, seconds: u64) -> (RecordingSummary, f64) {
    let (mic, handle) = source(SystemClock.now_ns());
    let options = Options {
        sync: false,
        ring_seconds: 130,
        ..Options::default()
    };
    let track = TrackStart::new(TrackKind::Microphone, "m", Box::new(mic));
    let before = cpu_seconds();
    let recorder = Recorder::new(dir).with_options(options);
    let recording = recorder.start("offline", vec![track]).unwrap();
    for done in (0..seconds).step_by(60) {
        let step = 60.min(seconds - done);
        handle.produce_ms(step * 1_000);
        while recording.health()[0].frames + 48_000 * 10 < (done + step) * 48_000 {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    let summary = recording.stop().unwrap();
    (summary, cpu_seconds() - before)
}

/// Plays a recording from start to end as fast as possible, and reports the CPU use of each second
/// of audio, which is also the share of one core that real-time playback takes.
fn play_through(dir: &Path, summary: &RecordingSummary, speed: f32, skip_silence: bool) {
    let mut player = open_recording(dir, summary, &opus_decoder_factory()).unwrap();
    player.set_speed(speed);
    player.set_skip_silence(skip_silence);
    let duration = player.duration_ns() as f64 / 1e9;
    let (mut buffer, mut rendered) = (vec![0f32; 4_800], 0u64);
    let before = cpu_seconds();
    let started = Instant::now();
    loop {
        let count = player.render(&mut buffer).unwrap();
        rendered += count as u64;
        if count < buffer.len() {
            break;
        }
    }
    let (cpu, wall) = (cpu_seconds() - before, started.elapsed().as_secs_f64());
    let heard = rendered as f64 / 48_000.0;
    let label = format!("{speed}x{}", if skip_silence { " with silence skipped" } else { "" });
    row(
        format!("Playing {duration:.0} s at {label}"),
        format!(
            "{:.2}% of one core in real time (CPU time {cpu:.2} s, wall time {wall:.2} s, {heard:.0} s heard)",
            percent(cpu / heard.max(1.0), 1.0),
        ),
    );
}

/// The summary of a recording that `lengthen` made by repeating a shorter one.
fn summary_for(summary: &RecordingSummary, copies: u64) -> RecordingSummary {
    let mut long = summary.clone();
    long.tracks[0].timeline.frames *= copies;
    long
}

/// Makes a recording `copies` times as long by repeating the packets of a short one, which takes a second
/// where encoding three hours takes minutes. The audio is real Opus and the pages are like those of a long
/// recording, so opening and seeking cost what they would.
fn lengthen(dir: &Path, summary: &RecordingSummary, copies: u64) -> tempfile::TempDir {
    let name = &summary.tracks[0].audio_file;
    let mut reader = ogg::PacketReader::new(std::io::BufReader::new(std::fs::File::open(dir.join(name)).unwrap()));
    let head = reader.read_packet().unwrap().unwrap().data;
    reader.read_packet().unwrap().unwrap();
    let pre_skip = u64::from(parse_pre_skip(&head).unwrap());
    let packets: Vec<Vec<u8>> =
        std::iter::from_fn(|| reader.read_packet().unwrap().map(|packet| packet.data)).collect();

    let long = tempfile::tempdir().unwrap();
    let mut ogg = OggWriter::new(std::fs::File::create(long.path().join(name)).unwrap(), 7);
    ogg.push_packet(&head, 0).unwrap();
    ogg.finish_page(false).unwrap();
    ogg.push_packet(&opus_tags(), 0).unwrap();
    ogg.finish_page(false).unwrap();
    let total = packets.len() as u64 * copies;
    for (index, packet) in packets.iter().cycle().take(total as usize).enumerate() {
        ogg.push_packet(packet, pre_skip + (index as u64 + 1) * 960).unwrap();
        if index % 25 == 24 {
            ogg.finish_page(false).unwrap();
        }
    }
    ogg.finish_page(true).unwrap();
    long
}

/// How long a long recording takes to open, and to seek in.
fn open_and_seek(dir: &Path, summary: &RecordingSummary) {
    let started = Instant::now();
    let mut player = open_recording(dir, summary, &opus_decoder_factory()).unwrap();
    let opened = started.elapsed();
    let duration_ms = player.duration_ns() / 1_000_000;
    let mut buffer = vec![0f32; 4_800];
    let mut times = Vec::new();
    for step in 1..=50u64 {
        let target = duration_ms * (step * 7 % 50) / 50 * 1_000_000;
        let started = Instant::now();
        player.seek_ns(target);
        player.render(&mut buffer).unwrap();
        times.push(started.elapsed());
    }
    times.sort();
    let bytes = std::fs::metadata(dir.join(&summary.tracks[0].audio_file))
        .unwrap()
        .len();
    row(
        format!(
            "Opening a {:.1} h recording ({:.1} MB)",
            duration_ms as f64 / 3.6e6,
            bytes as f64 / 1e6
        ),
        format!(
            "{:.1} ms to open, {:.2} ms to seek and play 100 ms (median), {:.2} ms (worst of 50)",
            opened.as_secs_f64() * 1e3,
            times[25].as_secs_f64() * 1e3,
            times[49].as_secs_f64() * 1e3
        ),
    );
}

fn main() {
    let seconds: u64 = std::env::args().nth(1).and_then(|arg| arg.parse().ok()).unwrap_or(60);
    let cores = std::thread::available_parallelism().map_or(1, usize::from);
    println!("Logical processors: {cores}. Opus 32 kbps, 48 kHz mono, 20 ms frames.");
    match opennote_media::audio::device_catalog::CpalCatalog.list() {
        Ok(devices) => println!("Audio devices found: {} (none were opened).", devices.len()),
        Err(error) => println!("Audio devices could not be listed: {error}"),
    }
    println!("\n| What | Cost |\n|---|---|");
    callback_cost();
    codec_alone();
    // With zero seconds, the real-time recordings are skipped.
    for with_system in [false, true].into_iter().filter(|_| seconds > 0) {
        let dir = tempfile::tempdir().unwrap();
        record_realtime(dir.path(), seconds, with_system);
    }

    let dir = tempfile::tempdir().unwrap();
    let (summary, cpu) = record_offline(dir.path(), 300);
    println!(
        "| Encoding 300 s of speech with no waiting | {:.1} ms of CPU for each second of audio |",
        cpu / 300.0 * 1e3
    );
    for (speed, skip) in [
        (1.0, false),
        (1.0, true),
        (1.5, false),
        (2.0, false),
        (3.0, false),
        (0.5, false),
    ] {
        play_through(dir.path(), &summary, speed, skip);
    }

    let long = lengthen(dir.path(), &summary, 36);
    open_and_seek(long.path(), &summary_for(&summary, 36));
}
