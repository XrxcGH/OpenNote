//! Opus feasibility. This encodes generated signals, never the microphone, with libopus at 48 kHz mono
//! and 32 kbps in voice mode. It measures speed and size. libopus builds with CMake, so the encoder
//! sits behind the optional `opus` feature, and CI never builds it.

#[cfg(feature = "opus")]
pub use libopus::measure;

/// Without the `opus` feature, says how to turn the measurement on.
#[cfg(not(feature = "opus"))]
pub fn measure(_seconds: f64) -> serde_json::Value {
    serde_json::json!({
        "built": false,
        "reason": "This build left out the opus feature. To measure the encoder, run with --features opus \
                   (it needs CMake).",
    })
}

#[cfg(feature = "opus")]
mod libopus {
    use serde_json::{json, Value};

    use crate::common::{clock, stats, Result};

    const RATE: u32 = 48_000;
    /// 20 ms frames, the usual choice for voice.
    const FRAME: usize = 960;
    const BITRATE: i32 = 32_000;

    /// A generated test signal: the sample at an index.
    type Signal = fn(usize) -> f32;

    /// Encodes `seconds` of each test signal and reports the results.
    pub fn measure(seconds: f64) -> Value {
        let signals: [(&str, Signal); 2] = [("sine", sine), ("noise", noise)];
        let results: Vec<Value> = signals
            .iter()
            .map(|(name, signal)| {
                encode(name, seconds, *signal)
                    .unwrap_or_else(|error| json!({ "signal": name, "error": error.to_string() }))
            })
            .collect();
        json!({
            "built": true,
            "crate": "opus 0.4 (opusic-sys, bundled libopus built with CMake)",
            "libopus": opus::version(),
            "sample_rate": RATE,
            "channels": 1,
            "frame_ms": 20,
            "application": "voip",
            "target_bitrate": BITRATE,
            "signals": results,
        })
    }

    /// A 440 Hz sine at -20 dBFS.
    fn sine(index: usize) -> f32 {
        let angle = std::f64::consts::TAU * 440.0 * (index % RATE as usize) as f64 / f64::from(RATE);
        0.1 * angle.sin() as f32
    }

    /// White noise at about -25 dBFS, the hardest case for the encoder's bitrate.
    fn noise(index: usize) -> f32 {
        let mut state = (index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03;
        state ^= state >> 33;
        state = state.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
        state ^= state >> 33;
        ((state >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 0.2
    }

    fn encode(name: &str, seconds: f64, signal: Signal) -> Result<Value> {
        let mut encoder = opus::Encoder::new(RATE, opus::Channels::Mono, opus::Application::Voip)?;
        encoder.set_bitrate(opus::Bitrate::Bits(BITRATE))?;
        let frames = (seconds * f64::from(RATE) / FRAME as f64) as usize;
        let (mut pcm, mut buffer) = (vec![0f32; FRAME], vec![0u8; 4_000]);
        let (mut packets, mut frame_ms) = (Vec::with_capacity(frames), Vec::with_capacity(frames));
        let mut encode_ticks = 0;
        for frame in 0..frames {
            for (offset, sample) in pcm.iter_mut().enumerate() {
                *sample = signal(frame * FRAME + offset);
            }
            let start = clock::now();
            let size = encoder.encode_float(&pcm, &mut buffer)?;
            let ticks = clock::now() - start;
            encode_ticks += ticks;
            frame_ms.push(clock::ticks_to_ms(ticks));
            packets.push(buffer[..size].to_vec());
        }
        let audio_s = (frames * FRAME) as f64 / f64::from(RATE);
        let bytes: usize = packets.iter().map(Vec::len).sum();
        let decode_ms = decode(&packets, &mut pcm)?;
        Ok(json!({
            "signal": name,
            "audio_s": audio_s,
            "packets": packets.len(),
            "bytes": bytes,
            "kbps": bytes as f64 * 8.0 / audio_s / 1000.0,
            "megabytes_per_3_hours": bytes as f64 / audio_s * 3.0 * 3600.0 / 1e6,
            "encode_real_time_factor": clock::ticks_to_ms(encode_ticks) / 1000.0 / audio_s,
            "encode_frame_ms": stats::summarize(&frame_ms),
            "decode_real_time_factor": decode_ms / 1000.0 / audio_s,
        }))
    }

    /// Decodes every packet and returns the total time in milliseconds.
    fn decode(packets: &[Vec<u8>], pcm: &mut [f32]) -> Result<f64> {
        let mut decoder = opus::Decoder::new(RATE, opus::Channels::Mono)?;
        let start = clock::now();
        for packet in packets {
            decoder.decode_float(packet, pcm, false)?;
        }
        Ok(clock::elapsed_ms(start, clock::now()))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn encodes_a_second_of_sine_near_the_target_bitrate() {
            let result = encode("sine", 1.0, sine).unwrap();
            assert_eq!(result["packets"], 50);
            let kbps = result["kbps"].as_f64().unwrap();
            assert!(kbps > 4.0 && kbps < 40.0, "{kbps} kbps");
        }

        #[test]
        fn noise_stays_within_full_scale() {
            let loudest = (0..48_000).map(|index| noise(index).abs()).fold(0.0, f32::max);
            assert!(loudest <= 0.1 && loudest > 0.09);
        }
    }
}
