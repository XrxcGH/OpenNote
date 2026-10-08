//! Skips silence: long pauses in a recording are cut short, and everything else plays as it was.
//!
//! The gate looks at the audio in blocks of 20 ms. A pause plays for its first 140 ms. After that
//! the gate drops blocks until sound returns. It then plays the 60 ms that came just before the
//! sound, so a word doesn't begin out of nowhere. A pause of 200 ms or less is not touched.
//!
//! What counts as silent follows the recording. The gate tracks the quietest block of the last five
//! seconds, which is the room's noise, and calls anything under about three times that level
//! silence. Two limits keep that sensible. A fixed floor keeps digital silence from making every
//! faint sound count as speech. A ceiling of a third of the loudest recent level keeps steady loud
//! sound from counting as silence. The first half second is only used to learn
//! the room, and always plays.

use std::collections::VecDeque;

use crate::audio::FRAME_SAMPLES;

/// A pause plays this many blocks (140 ms) before the gate starts dropping.
const KEEP_BLOCKS: usize = 7;
/// This many blocks (60 ms) before the sound come back after a drop.
const LEAD_BLOCKS: usize = 3;
/// The blocks (half a second) that play whatever they hold, while the gate learns the room.
const LEARN_BLOCKS: u64 = 25;
/// The blocks (five seconds) that the noise floor looks back over.
const FLOOR_WINDOW: u64 = 250;
/// The lowest level that can count as sound.
const MIN_THRESHOLD: f32 = 0.004;
/// How many times the noise floor a block must be to count as sound.
const MARGIN: f32 = 3.0;
/// The share of the loudest recent level that always counts as sound.
const CEILING: f32 = 0.35;
/// How much of the loudest level is kept from one block to the next: a half-life of about 140 s.
const PEAK_KEEP: f32 = 0.9999;

#[derive(Debug, Default)]
pub struct SilenceGate {
    seen: u64,
    /// The loudest block lately, which fades slowly.
    peak: f32,
    /// The quietest levels in the window, oldest first, each quieter than the ones after it.
    floor: VecDeque<(u64, f32)>,
    run: usize,
    lead: VecDeque<Vec<f32>>,
}

impl SilenceGate {
    /// Forgets the current pause, for a seek. The noise floor stays, since the room is the same.
    pub fn reset(&mut self) {
        self.run = 0;
        self.lead.clear();
    }

    fn noise_floor(&mut self, rms: f32) -> f32 {
        while self.floor.back().is_some_and(|&(_, level)| level >= rms) {
            self.floor.pop_back();
        }
        self.floor.push_back((self.seen, rms));
        while self
            .floor
            .front()
            .is_some_and(|&(at, _)| at + FLOOR_WINDOW <= self.seen)
        {
            self.floor.pop_front();
        }
        self.floor.front().map_or(rms, |&(_, level)| level)
    }

    /// Takes one block of [`FRAME_SAMPLES`] samples. It appends to `out` the audio that should play
    /// for it, which is the block itself, nothing, or after a drop the lead-in and the block.
    /// It returns the number of samples left out for good.
    pub fn push(&mut self, block: &[f32], out: &mut Vec<f32>) -> usize {
        debug_assert_eq!(block.len(), FRAME_SAMPLES);
        self.seen += 1;
        let rms = (block.iter().map(|s| s * s).sum::<f32>() / block.len() as f32).sqrt();
        let floor = self.noise_floor(rms);
        self.peak = rms.max(self.peak * PEAK_KEEP);
        let threshold = (floor * MARGIN).min(self.peak * CEILING).max(MIN_THRESHOLD);
        if rms >= threshold {
            for lead in self.lead.drain(..) {
                out.extend_from_slice(&lead);
            }
            out.extend_from_slice(block);
            self.run = 0;
            return 0;
        }
        self.run += 1;
        if self.run <= KEEP_BLOCKS || self.seen <= LEARN_BLOCKS {
            out.extend_from_slice(block);
            return 0;
        }
        // Past the first 140 ms, the block waits as possible lead-in. The oldest one is dropped.
        self.lead.push_back(block.to_vec());
        if self.lead.len() > LEAD_BLOCKS {
            self.lead.pop_front();
            return FRAME_SAMPLES;
        }
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Blocks of speech played first, so the gate has learned the room.
    const WARM_UP: usize = 30;

    fn block(level: f32) -> Vec<f32> {
        (0..FRAME_SAMPLES)
            .map(|i| level * if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect()
    }

    /// Plays `pattern`, where each entry is a level for one block, and returns the blocks played
    /// and the samples dropped.
    fn play(pattern: &[f32]) -> (usize, usize) {
        let mut gate = SilenceGate::default();
        let (mut out, mut dropped) = (Vec::new(), 0);
        for level in std::iter::repeat_n(0.1, WARM_UP).chain(pattern.iter().copied()) {
            dropped += gate.push(&block(level), &mut out);
        }
        (out.len() / FRAME_SAMPLES - WARM_UP, dropped)
    }

    #[test]
    fn speech_with_short_pauses_plays_whole() {
        let mut pattern = vec![0.1; 10];
        pattern.extend([0.001; 8]);
        pattern.extend([0.1; 10]);
        assert_eq!(play(&pattern), (28, 0));
    }

    #[test]
    fn a_long_pause_is_cut_to_about_200_ms() {
        let mut pattern = vec![0.1; 10];
        pattern.extend([0.001; 100]);
        pattern.extend([0.1; 10]);
        // Ten blocks of speech, seven of pause, three of lead-in, and ten more of speech.
        let (played, dropped) = play(&pattern);
        assert_eq!(played, 30);
        assert_eq!(dropped, 90 * FRAME_SAMPLES);
    }

    #[test]
    fn a_noisy_room_still_has_silence() {
        // Background noise at 0.02 is the floor here, and speech at 0.2 is ten times louder.
        let mut pattern = vec![0.02; 200];
        pattern.extend([0.2; 5]);
        let (played, _) = play(&pattern);
        assert!(played < 20, "{played} blocks played");
    }

    #[test]
    fn digital_silence_does_not_make_faint_sounds_count() {
        let mut pattern = vec![0.0; 100];
        pattern.extend([0.003; 100]);
        pattern.extend([0.1; 5]);
        let (played, _) = play(&pattern);
        assert!(played < 25, "{played} blocks played");
    }

    #[test]
    fn the_first_half_second_always_plays() {
        let mut gate = SilenceGate::default();
        let mut out = Vec::new();
        for _ in 0..25 {
            gate.push(&block(0.0), &mut out);
        }
        assert_eq!(out.len(), 25 * FRAME_SAMPLES);
    }

    #[test]
    fn a_seek_forgets_the_pause_but_not_the_room() {
        let mut gate = SilenceGate::default();
        let mut out = Vec::new();
        for level in std::iter::repeat_n(0.1, 30).chain(std::iter::repeat_n(0.001, 60)) {
            gate.push(&block(level), &mut out);
        }
        assert!(!gate.lead.is_empty());
        gate.reset();
        assert_eq!((gate.run, gate.lead.len()), (0, 0));
        assert!(!gate.floor.is_empty());
    }
}
