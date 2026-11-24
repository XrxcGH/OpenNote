//! Finds where the sound in a recording starts and ends, so the silence around it can be trimmed.

use super::runs::Range;
use crate::audio::{Result, FRAME_SAMPLES};
use crate::playback::Player;

/// Silence at one end of this length or more is worth trimming.
pub const WORTH_TRIMMING_NS: u64 = 500_000_000;
/// How much silence stays around the sound, so a word does not begin or end abruptly.
const MARGIN_NS: u64 = 200_000_000;
/// A block this loud is never called silence, even in a room as quiet as a studio.
const MIN_THRESHOLD: f32 = 0.004;
/// Blocks in a row that must be loud before it counts as sound. A click is not sound.
const SUSTAIN: usize = 3;
const BLOCK_NS: u64 = 20_000_000;

/// The positions of the first and last sound in the recording, with a margin, or none if it is silent.
/// The room's noise is the 10th percentile of the loudness of blocks of 20 ms, and speech is the 90th.
/// Sound is three times the noise, but never more than halfway (on a log scale) from the noise to the
/// speech. A loud word or a click does not raise the bar, so quiet speech in a noisy room is kept.
pub fn find_sound(player: &mut Player) -> Result<Option<Range>> {
    player.set_speed(1.0);
    player.set_skip_silence(false);
    player.seek_ns(0);
    let total = player.duration_ns();
    let mut levels = Vec::new();
    let mut block = vec![0f32; FRAME_SAMPLES];
    loop {
        // A short read is not the end: only a read of nothing is. Fill each block, so that block `n`
        // always starts at `n` times 20 ms.
        let mut count = 0;
        while count < block.len() {
            let got = player.render(&mut block[count..])?;
            if got == 0 {
                break;
            }
            count += got;
        }
        if count == 0 {
            break;
        }
        let energy: f32 = block[..count].iter().map(|s| s * s).sum();
        levels.push((energy / count as f32).sqrt());
        if count < block.len() {
            break;
        }
    }
    if levels.is_empty() {
        return Ok(None);
    }
    let mut sorted = levels.clone();
    sorted.sort_by(f32::total_cmp);
    let (floor, speech) = (sorted[sorted.len() / 10], sorted[sorted.len() * 9 / 10]);
    let threshold = (floor * 3.0).min((floor * speech).sqrt()).max(MIN_THRESHOLD);
    let loud = |from: usize| levels[from..].iter().take(SUSTAIN).all(|level| *level >= threshold);
    let first = (0..levels.len().saturating_sub(SUSTAIN - 1)).find(|&at| loud(at));
    let last = (0..levels.len().saturating_sub(SUSTAIN - 1)).rev().find(|&at| loud(at));
    Ok(first.zip(last).map(|(first, last)| {
        let start = (first as u64 * BLOCK_NS).saturating_sub(MARGIN_NS);
        let end = ((last + SUSTAIN) as u64 * BLOCK_NS + MARGIN_NS).min(total);
        (start, end)
    }))
}
