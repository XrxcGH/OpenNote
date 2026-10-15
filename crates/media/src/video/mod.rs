//! A narrated video of a recording: the page as it was, the ink drawn again at the moment each stroke was drawn, and
//! the recording's audio underneath.
//!
//! The interface sends a [`Scene`]: the page without its ink as a picture, and each stroke with the capture time of each
//! point. [`Scene::place`] turns capture times into positions in the playable audio, so the video has no gaps where the
//! recording was paused. [`export`] draws a frame for each tick, reads the matching audio, and hands both to a
//! [`VideoSink`]. The sink is the platform's encoder (Media Foundation on Windows: H.264 video and AAC audio in an MP4
//! file), so this module needs no codec and its tests need no encoder.
//!
//! The drawing is plain software: it is the same on every machine, which is why a test can compare a frame with a
//! saved hash.

mod raster;

use serde::Deserialize;

use crate::audio::Result;
use crate::positions::PositionMap;
use crate::transcribe::PcmSource;

pub use raster::Renderer;

/// The sample rate of the audio handed to a sink.
pub const AUDIO_RATE: u64 = 48_000;

/// One point of a stroke, in pixels of the scene, at a time.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePoint {
    pub x: f32,
    pub y: f32,
    /// Capture time of the point, until [`Scene::place`] has made it a position.
    pub t_ns: u64,
}

/// A stroke: a color (RGBA), a width in pixels, and its points in the order they were drawn.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneStroke {
    pub color: [u8; 4],
    pub width: f32,
    pub points: Vec<ScenePoint>,
}

/// What the video shows.
#[derive(Debug, Clone)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    /// The page without ink, as BGRA rows from the top.
    pub base: Vec<u8>,
    pub strokes: Vec<SceneStroke>,
}

impl Scene {
    /// A scene over a picture in RGBA, which is how a canvas gives it.
    pub fn from_rgba(width: u32, height: u32, rgba: &[u8], strokes: Vec<SceneStroke>) -> Result<Scene> {
        let wanted = width as usize * height as usize * 4;
        if width == 0 || height == 0 || rgba.len() != wanted {
            return Err(crate::audio::AudioError::Format(
                "The picture of the page doesn't match its size.".into(),
            ));
        }
        let mut base = rgba.to_vec();
        for pixel in base.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        Ok(Scene {
            width,
            height,
            base,
            strokes,
        })
    }

    /// Turns the capture time of every point into a position in the audio. A point in a pause lands where the next
    /// audio starts, so a stroke drawn in a pause appears when the sound resumes.
    pub fn place(&mut self, map: &PositionMap) {
        for stroke in &mut self.strokes {
            for point in &mut stroke.points {
                point.t_ns = map.locate(point.t_ns).position_ns;
            }
        }
    }
}

/// Where the frames and the sound go.
pub trait VideoSink {
    /// A frame of BGRA rows from the top, at a time in nanoseconds.
    fn frame(&mut self, bgra: &[u8], at_ns: u64) -> Result<()>;
    /// Mono 16-bit samples at 48 kHz, starting at a time in nanoseconds.
    fn audio(&mut self, samples: &[i16], at_ns: u64) -> Result<()>;
    /// Writes the end of the file.
    fn finish(&mut self) -> Result<()>;
}

/// Draws the scene against the clock and hands each frame, and the sound that goes with it, to the sink. `progress`
/// is told the share done (0 to 1) about once a second of video.
pub fn export(
    scene: &Scene,
    pcm: &mut dyn PcmSource,
    duration_ns: u64,
    fps: u32,
    sink: &mut dyn VideoSink,
    progress: &mut dyn FnMut(f32),
) -> Result<()> {
    let fps = u64::from(fps.max(1));
    let frames = (duration_ns * fps).div_ceil(1_000_000_000).max(1);
    let mut renderer = Renderer::new(scene);
    let mut block = vec![0f32; (AUDIO_RATE / fps) as usize + 2];
    let mut samples: Vec<i16> = Vec::with_capacity(block.len());
    let mut audio_at = 0u64;
    for n in 0..frames {
        let at_ns = n * 1_000_000_000 / fps;
        sink.frame(renderer.frame(at_ns), at_ns)?;
        // The audio up to the next frame, so the sound never runs ahead of the picture by more than a frame.
        let upto = ((n + 1) * AUDIO_RATE / fps).min(duration_ns * AUDIO_RATE / 1_000_000_000);
        let mut want = upto.saturating_sub(audio_at);
        while want > 0 {
            let take = (want as usize).min(block.len());
            let got = pcm.read(&mut block[..take])?;
            if got == 0 {
                break;
            }
            samples.clear();
            samples.extend(block[..got].iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16));
            sink.audio(&samples, audio_at * 1_000_000_000 / AUDIO_RATE)?;
            audio_at += got as u64;
            want -= got as u64;
        }
        if n % fps == 0 {
            progress(n as f32 / frames as f32);
        }
    }
    sink.finish()?;
    progress(1.0);
    Ok(())
}

#[cfg(test)]
mod tests;
