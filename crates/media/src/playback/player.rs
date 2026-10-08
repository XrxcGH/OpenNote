//! The playback engine: a recording's audio, with seek, speed, and skipping of silence.
//!
//! The engine has no clock and no device. A caller asks it for samples with [`Player::render`].
//! It works out where in the recording to read, whether to stretch the audio or cut a pause short,
//! and where playback has got to. The session in [`super::session`] calls it from a thread and feeds
//! a sound device. Tests call it directly and look at the samples.
//!
//! Positions are nanoseconds into the recording's audio, as the [`PositionMap`] counts them, so a
//! stroke's position (see `stamps`) can be passed to [`Player::seek_ns`] as it is.

use std::collections::VecDeque;

use super::mixer::{ns_to_samples, samples_to_ns, Mixer};
use super::skip::SilenceGate;
use super::stretch::{Stretcher, MAX_SPEED, MIN_SPEED};
use crate::audio::{AudioError, Result, FRAME_SAMPLES};

/// How far resuming after a pause goes back, so that no words are missed.
pub const RESUME_REWIND_NS: u64 = 2_000_000_000;
/// How far the skip keys jump.
pub const SKIP_NS: u64 = 10_000_000_000;

/// The audio that feeds the stretcher, and the record of where each part of it came from.
struct Source {
    mixer: Mixer,
    /// The sample of the recording that the mixer reads next.
    position: u64,
    gate: Option<SilenceGate>,
    held: Vec<f32>,
    held_at: usize,
    block: Vec<f32>,
    /// How many samples this source has handed out since the last reset.
    emitted: u64,
    /// Pairs of (samples handed out, recording sample), one for each stretch of contiguous audio.
    marks: VecDeque<(u64, u64)>,
}

impl Source {
    fn new(mixer: Mixer) -> Self {
        Source {
            mixer,
            position: 0,
            gate: None,
            held: Vec::new(),
            held_at: 0,
            block: vec![0.0; FRAME_SAMPLES],
            emitted: 0,
            marks: VecDeque::new(),
        }
    }

    /// Starts handing out audio from `sample` of the recording.
    fn reset(&mut self, sample: u64) {
        self.position = sample;
        self.held.clear();
        self.held_at = 0;
        self.emitted = 0;
        self.marks.clear();
        if let Some(gate) = &mut self.gate {
            gate.reset();
        }
    }

    fn mark(&mut self, recording_sample: u64) {
        self.marks.push_back((self.emitted, recording_sample));
    }

    /// The recording sample that the audio handed out at `index` came from.
    fn recording_sample(&self, index: u64) -> u64 {
        let at = self.marks.partition_point(|&(start, _)| start <= index);
        at.checked_sub(1)
            .map_or(self.position, |i| self.marks[i].1 + (index - self.marks[i].0))
    }

    /// Forgets marks that no one will look up again.
    fn prune(&mut self, before: u64) {
        while self.marks.len() > 1 && self.marks[1].0 <= before {
            self.marks.pop_front();
        }
    }

    /// Hands out up to `buf.len()` samples. It returns fewer only at the end of the audio.
    fn pull(&mut self, buf: &mut [f32]) -> Result<usize> {
        if self.gate.is_none() {
            return self.pull_plain(buf);
        }
        let mut written = 0;
        while written < buf.len() {
            if self.held_at == self.held.len() && !self.fill_held()? {
                break;
            }
            let count = (buf.len() - written).min(self.held.len() - self.held_at);
            buf[written..written + count].copy_from_slice(&self.held[self.held_at..self.held_at + count]);
            self.held_at += count;
            written += count;
            self.emitted += count as u64;
        }
        Ok(written)
    }

    fn pull_plain(&mut self, buf: &mut [f32]) -> Result<usize> {
        let mut written = 0;
        while written < buf.len() {
            let got = self.mixer.render(self.position, &mut buf[written..])?;
            if got == 0 {
                break;
            }
            self.mark(self.position);
            self.emitted += got as u64;
            self.position += got as u64;
            written += got;
        }
        Ok(written)
    }

    /// Reads blocks through the gate until it lets some audio pass. It is false at the end.
    fn fill_held(&mut self) -> Result<bool> {
        self.held.clear();
        self.held_at = 0;
        while self.held.is_empty() {
            let mut have = 0;
            while have < FRAME_SAMPLES {
                let got = self.mixer.render(self.position, &mut self.block[have..])?;
                if got == 0 {
                    return Ok(false);
                }
                self.position += got as u64;
                have += got;
            }
            let gate = self.gate.as_mut().expect("this path runs only with a gate");
            let first = self.position - FRAME_SAMPLES as u64;
            gate.push(&self.block, &mut self.held);
            if !self.held.is_empty() {
                // Lead-in blocks come before the block just read, so the audio starts earlier.
                let lead = (self.held.len() - FRAME_SAMPLES) as u64;
                self.marks.push_back((self.emitted, first - lead));
            }
        }
        Ok(true)
    }
}

pub struct Player {
    source: Source,
    stretcher: Stretcher,
    speed: f32,
    duration: u64,
    ended: bool,
}

impl Player {
    pub fn new(mixer: Mixer) -> Self {
        let duration = mixer.duration_samples();
        Player {
            source: Source::new(mixer),
            stretcher: Stretcher::new(),
            speed: 1.0,
            duration,
            ended: false,
        }
    }

    /// The length of the recording's audio.
    pub fn duration_ns(&self) -> u64 {
        samples_to_ns(self.duration)
    }

    /// Where playback has got to: the position of the audio rendered last.
    pub fn position_ns(&self) -> u64 {
        samples_to_ns(self.position_samples().min(self.duration))
    }

    fn position_samples(&self) -> u64 {
        if self.stretching() {
            self.source.recording_sample(self.stretcher.input_position())
        } else {
            self.source
                .position
                .saturating_sub((self.source.held.len() - self.source.held_at) as u64)
        }
    }

    /// Whether the audio has played to its end.
    pub fn is_ended(&self) -> bool {
        self.ended
    }

    pub fn speed(&self) -> f32 {
        self.speed
    }

    pub fn skips_silence(&self) -> bool {
        self.source.gate.is_some()
    }

    /// Jumps to a position, which is clamped to the recording.
    pub fn seek_ns(&mut self, position_ns: u64) {
        let sample = ns_to_samples(position_ns).min(self.duration);
        self.source.reset(sample);
        self.stretcher.reset();
        self.ended = false;
    }

    /// Jumps forward or back from where playback is now.
    pub fn skip_ns(&mut self, delta_ns: i64) {
        let now = self.position_ns();
        let target = if delta_ns < 0 {
            now.saturating_sub(delta_ns.unsigned_abs())
        } else {
            now.saturating_add(delta_ns.unsigned_abs())
        };
        self.seek_ns(target);
    }

    /// Goes back to catch the words before a pause, as resuming does.
    pub fn rewind_for_resume(&mut self) {
        self.skip_ns(-(RESUME_REWIND_NS as i64));
    }

    /// Sets the speed from 0.5 to 3, without changing the pitch.
    pub fn set_speed(&mut self, speed: f32) {
        let speed = if speed.is_finite() { speed } else { 1.0 };
        let speed = speed.clamp(MIN_SPEED, MAX_SPEED);
        let was_stretching = self.stretching();
        let position = self.position_ns();
        self.speed = speed;
        self.stretcher.set_speed(speed);
        if was_stretching != self.stretching() {
            self.seek_ns(position);
        }
    }

    /// Turns the skipping of long pauses on or off.
    pub fn set_skip_silence(&mut self, on: bool) {
        if on == self.source.gate.is_some() {
            return;
        }
        let position = self.position_ns();
        self.source.gate = on.then(SilenceGate::default);
        self.seek_ns(position);
    }

    /// Whether the audio goes through the stretcher, which it skips at normal speed.
    fn stretching(&self) -> bool {
        (self.speed - 1.0).abs() > 0.001
    }

    /// Fills `out` with samples at 48 kHz. It writes fewer than `out.len()` only at the end.
    pub fn render(&mut self, out: &mut [f32]) -> Result<usize> {
        let written = if self.stretching() {
            let mut failure = None;
            let source = &mut self.source;
            let count = self.stretcher.process(out, &mut |buf| match source.pull(buf) {
                Ok(count) => count,
                Err(error) => {
                    failure = Some(error);
                    0
                }
            });
            if let Some(error) = failure {
                return Err(error);
            }
            self.source.prune(self.stretcher.input_position().saturating_sub(8_192));
            count
        } else {
            self.source.pull(out)?
        };
        if written < out.len() {
            self.ended = true;
        }
        Ok(written)
    }
}

impl std::fmt::Debug for Player {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Player")
            .field("position_ns", &self.position_ns())
            .field("speed", &self.speed)
            .finish()
    }
}

/// An error for a recording that has no audio to play.
pub fn nothing_to_play() -> AudioError {
    AudioError::Corrupt("This recording has no audio to play.".into())
}
