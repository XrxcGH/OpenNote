//! The path from the audio callback to the writer thread.
//!
//! The callback must never wait, allocate, or take a lock. It copies its samples into a lock-free ring
//! buffer and adds a small note with the packet's capture time to a second one. The writer thread
//! reads both. When the ring is full, the callback drops the whole packet and counts it. The track
//! clock then sees a gap in the capture times and fills it with silence.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, TryLockError};

use rtrb::{Consumer, Producer, RingBuffer};

use super::source::SourceFormat;

/// A sample type that devices deliver.
pub trait Sample: Copy {
    fn to_f32(self) -> f32;
}

impl Sample for f32 {
    fn to_f32(self) -> f32 {
        self
    }
}

impl Sample for i16 {
    fn to_f32(self) -> f32 {
        f32::from(self) / 32_768.0
    }
}

impl Sample for i32 {
    fn to_f32(self) -> f32 {
        (f64::from(self) / 2_147_483_648.0) as f32
    }
}

/// Counters that the callback and the writer share, so a screen can show that recording is healthy.
#[derive(Debug, Default)]
pub struct TrackStats {
    /// Packets the callback delivered to the ring.
    pub packets: AtomicU64,
    /// Packets the callback dropped because the ring was full.
    pub dropped_packets: AtomicU64,
    /// Frames the writer has handed to the encoder, including silence.
    pub frames: AtomicU64,
    /// Frames of silence added for gaps.
    pub silence_frames: AtomicU64,
}

impl TrackStats {
    pub fn load(counter: &AtomicU64) -> u64 {
        counter.load(Ordering::Relaxed)
    }
}

/// What the callback tells the writer about a packet.
#[derive(Clone, Copy, Debug)]
struct PacketMeta {
    capture_ns: u64,
    frames: u32,
    rate: u32,
}

/// What the writer learns about a packet it took from the ring.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PacketInfo {
    /// The capture time of the packet's first frame.
    pub capture_ns: u64,
    /// The sample rate the packet was captured at. It changes when the recording switches devices.
    pub rate: u32,
}

/// The callback's end of the ring: it turns packets into mono and queues them.
pub struct PacketSink {
    samples: Producer<f32>,
    metas: Producer<PacketMeta>,
    channels: usize,
    rate: u32,
    stats: Arc<TrackStats>,
}

/// The writer's end of the ring.
pub struct PacketReader {
    samples: Consumer<f32>,
    metas: Consumer<PacketMeta>,
}

/// Makes a ring that holds `capacity_frames` frames of mono samples.
pub fn packet_channel(
    format: SourceFormat,
    capacity_frames: usize,
    stats: Arc<TrackStats>,
) -> (PacketSink, PacketReader) {
    let (samples_in, samples_out) = RingBuffer::new(capacity_frames.max(1));
    // Packets are at least a couple of milliseconds long, so this is more notes than can ever wait.
    let (metas_in, metas_out) = RingBuffer::new((capacity_frames / 96).max(64));
    let sink = PacketSink {
        samples: samples_in,
        metas: metas_in,
        channels: usize::from(format.channels).max(1),
        rate: format.rate,
        stats,
    };
    (
        sink,
        PacketReader {
            samples: samples_out,
            metas: metas_out,
        },
    )
}

impl PacketSink {
    /// Queues one packet. `capture_ns` is the capture time of its first frame, and `data` holds
    /// interleaved samples. This is safe to call from a real-time audio callback.
    pub fn push<T: Sample>(&mut self, capture_ns: u64, data: &[T]) {
        let frames = data.len() / self.channels;
        if frames == 0 {
            return;
        }
        let chunk = match self.samples.write_chunk_uninit(frames) {
            Ok(chunk) if !self.metas.is_full() => chunk,
            _ => {
                self.stats.dropped_packets.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };
        let scale = 1.0 / self.channels as f32;
        chunk.fill_from_iter(
            data.chunks_exact(self.channels)
                .map(|frame| frame.iter().map(|sample| sample.to_f32()).sum::<f32>() * scale),
        );
        // The slot was checked above, and only this thread pushes.
        let _ = self.metas.push(PacketMeta {
            capture_ns,
            frames: frames as u32,
            rate: self.rate,
        });
        self.stats.packets.fetch_add(1, Ordering::Relaxed);
    }
}

/// A [`PacketSink`] that several threads can hold, so a recording can hand the same ring to a new
/// source when the person switches microphones. Sources push through it from their callbacks, which
/// never wait for it.
#[derive(Clone)]
pub struct SinkHandle {
    sink: Arc<Mutex<PacketSink>>,
    stats: Arc<TrackStats>,
}

impl SinkHandle {
    pub fn new(sink: PacketSink) -> Self {
        let stats = Arc::clone(&sink.stats);
        SinkHandle {
            sink: Arc::new(Mutex::new(sink)),
            stats,
        }
    }

    /// Queues one packet like [`PacketSink::push`]. If the handle is busy, which happens only while
    /// the format changes, the packet counts as dropped.
    pub fn push<T: Sample>(&self, capture_ns: u64, data: &[T]) {
        match self.sink.try_lock() {
            Ok(mut sink) => sink.push(capture_ns, data),
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner().push(capture_ns, data),
            Err(TryLockError::WouldBlock) => {
                self.stats.dropped_packets.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Sets the format of the packets that come next. Call it while no source is pushing.
    pub fn set_format(&self, format: SourceFormat) {
        let mut sink = self.sink.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        sink.channels = usize::from(format.channels).max(1);
        sink.rate = format.rate;
    }
}

impl PacketReader {
    /// Takes the next packet. It replaces the contents of `out` with the packet's mono samples and
    /// returns when and how it was captured.
    pub fn next(&mut self, out: &mut Vec<f32>) -> Option<PacketInfo> {
        let meta = self.metas.pop().ok()?;
        // The callback commits the samples before the note, so they are always there.
        let chunk = self.samples.read_chunk(meta.frames as usize).ok()?;
        let (first, second) = chunk.as_slices();
        out.clear();
        out.extend_from_slice(first);
        out.extend_from_slice(second);
        chunk.commit_all();
        Some(PacketInfo {
            capture_ns: meta.capture_ns,
            rate: meta.rate,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channel(channels: u16, frames: usize) -> (PacketSink, PacketReader, Arc<TrackStats>) {
        let stats = Arc::new(TrackStats::default());
        let format = SourceFormat { rate: 48_000, channels };
        let (sink, reader) = packet_channel(format, frames, Arc::clone(&stats));
        (sink, reader, stats)
    }

    fn capture(reader: &mut PacketReader, out: &mut Vec<f32>) -> Option<u64> {
        reader.next(out).map(|info| info.capture_ns)
    }

    #[test]
    fn stereo_packets_come_out_as_mono_averages() {
        let (mut sink, mut reader, _) = channel(2, 1_000);
        sink.push(5, &[0.5f32, -0.5, 1.0, 0.0]);
        let mut out = Vec::new();
        assert_eq!(capture(&mut reader, &mut out), Some(5));
        assert_eq!(out, vec![0.0, 0.5]);
        assert_eq!(capture(&mut reader, &mut out), None);
    }

    #[test]
    fn integer_samples_scale_to_floats() {
        let (mut sink, mut reader, _) = channel(1, 100);
        sink.push(1, &[16_384i16, -32_768]);
        sink.push(2, &[1_073_741_824i32]);
        let mut out = Vec::new();
        reader.next(&mut out);
        assert_eq!(out, vec![0.5, -1.0]);
        reader.next(&mut out);
        assert_eq!(out, vec![0.5]);
    }

    #[test]
    fn a_shared_handle_carries_a_new_format_to_the_writer() {
        let (sink, mut reader, _) = channel(2, 1_000);
        let handle = SinkHandle::new(sink);
        handle.push(1, &[0.2f32, 0.4]);
        handle.set_format(SourceFormat {
            rate: 16_000,
            channels: 1,
        });
        handle.push(2, &[0.5f32]);
        let mut out = Vec::new();
        let first = reader.next(&mut out).unwrap();
        assert_eq!((first.capture_ns, first.rate), (1, 48_000));
        assert!((out[0] - 0.3).abs() < 1e-6);
        let second = reader.next(&mut out).unwrap();
        assert_eq!((second.capture_ns, second.rate), (2, 16_000));
        assert_eq!(out, vec![0.5]);
    }

    #[test]
    fn a_full_ring_drops_whole_packets_and_counts_them() {
        let (mut sink, mut reader, stats) = channel(1, 10);
        sink.push(1, &[0.1f32; 6]);
        sink.push(2, &[0.2f32; 6]);
        sink.push(3, &[0.3f32; 4]);
        assert_eq!(TrackStats::load(&stats.packets), 2);
        assert_eq!(TrackStats::load(&stats.dropped_packets), 1);
        let mut out = Vec::new();
        assert_eq!(capture(&mut reader, &mut out), Some(1));
        assert_eq!(capture(&mut reader, &mut out), Some(3));
        assert_eq!(out, vec![0.3; 4]);
    }

    #[test]
    fn packets_stay_in_order_across_the_wrap_around() {
        let (mut sink, mut reader, _) = channel(1, 10);
        let mut out = Vec::new();
        for round in 0..20u64 {
            let value = round as f32;
            sink.push(round, &[value; 7]);
            assert_eq!(capture(&mut reader, &mut out), Some(round));
            assert_eq!(out, vec![value; 7]);
        }
    }
}
