//! Grouping the stretches of a recording by voice.
//!
//! Each stretch gets a print: the mean of its cepstral coefficients and of its pitch, each measured against the
//! whole recording's own average and spread, so a quiet room or a cheap microphone moves every print alike.
//! Stretches then merge, closest first, by average distance, until the closest two groups are far apart; what is
//! left are the voices. A recording where nothing is far apart is one voice, so a single speaker is not split by
//! the words they say.

use super::features::{Frame, FRAMES_PER_SECOND, MFCC};

/// The most voices told apart. Beyond this the closest groups merge.
pub const MAX_SPEAKERS: usize = 8;

/// The fewest speech frames (0.4 s) a stretch needs to have a print of its own.
const MIN_SPEECH: usize = 40;
/// The fewest voiced frames a stretch needs for its pitch to count.
const MIN_VOICED: usize = 10;
/// How much the pitch counts against the 16 coefficients together.
const PITCH_WEIGHT: f32 = 3.0;
/// Two groups farther apart than this are two voices. The prints are measured in the recording's own spread, so
/// one voice saying different words stays near 1 to 3, and two clearly different voices are 5 or more apart.
const DIFFERENT_VOICES: f32 = 4.0;
/// A group with less speech than this (1.5 s) joins its nearest group.
const SMALL_GROUP: usize = 150;

/// The loudness below which nothing counts as speech, about 60 decibels under the loudest sound the format holds.
const MIN_ENERGY: f32 = -13.8;

/// The least spread assumed for a cepstral coefficient, so a recording of one steady voice is not stretched until its
/// small differences look large. Real speech varies more than this from sound to sound.
const MIN_SPREAD: f32 = 6.0;
/// The same for the pitch, as a natural log: about 15 percent.
const MIN_PITCH_SPREAD: f32 = 0.15;

const DIMENSIONS: usize = MFCC + 1;

struct Print {
    vector: [f32; DIMENSIONS],
    speech: usize,
}

/// The loudness above which a frame counts as speech: halfway between the quiet and the loud parts.
fn speech_gate(frames: &[Frame]) -> f32 {
    let mut energies: Vec<f32> = frames.iter().map(|f| f.energy).collect();
    energies.sort_by(f32::total_cmp);
    let low = energies[energies.len() / 20];
    let high = energies[energies.len() * 95 / 100];
    // Without a quiet part to tell from the loud part, all of it is speech.
    if high - low < 2.0 {
        return MIN_ENERGY;
    }
    (low + 0.5 * (high - low)).max(MIN_ENERGY)
}

struct Reference {
    mean: [f32; DIMENSIONS],
    spread: [f32; DIMENSIONS],
}

/// The average and spread of every measure over the speech of the whole recording.
fn reference(frames: &[Frame], gate: f32) -> Reference {
    let mut sum = [0.0f64; DIMENSIONS];
    let mut square = [0.0f64; DIMENSIONS];
    let mut count = [0.0f64; DIMENSIONS];
    for frame in frames.iter().filter(|f| f.energy > gate) {
        for (d, value) in values(frame).iter().enumerate() {
            if let Some(v) = value {
                sum[d] += f64::from(*v);
                square[d] += f64::from(*v) * f64::from(*v);
                count[d] += 1.0;
            }
        }
    }
    let mut mean = [0.0; DIMENSIONS];
    let mut spread = [1.0; DIMENSIONS];
    for d in 0..DIMENSIONS {
        if count[d] > 1.0 {
            let m = sum[d] / count[d];
            mean[d] = m as f32;
            let floor = if d < MFCC { MIN_SPREAD } else { MIN_PITCH_SPREAD };
            spread[d] = ((square[d] / count[d] - m * m).max(1e-6).sqrt() as f32).max(floor);
        }
    }
    Reference { mean, spread }
}

/// What a frame measures: the coefficients, and the pitch when it has one.
fn values(frame: &Frame) -> [Option<f32>; DIMENSIONS] {
    let mut out = [None; DIMENSIONS];
    for (d, c) in frame.mfcc.iter().enumerate() {
        out[d] = Some(*c);
    }
    if frame.log_f0 != 0.0 {
        out[MFCC] = Some(frame.log_f0);
    }
    out
}

/// The print of the frames from `from` to `to`, or none when there is too little speech to tell.
fn print_of(frames: &[Frame], from: usize, to: usize, gate: f32, reference: &Reference) -> Option<Print> {
    let slice = &frames[from.min(frames.len())..to.min(frames.len())];
    let speech: Vec<&Frame> = slice.iter().filter(|f| f.energy > gate).collect();
    if speech.len() < MIN_SPEECH {
        return None;
    }
    let mut vector = [0.0f32; DIMENSIONS];
    for (d, slot) in vector.iter_mut().enumerate() {
        let (mut sum, mut n) = (0.0, 0usize);
        for frame in &speech {
            if let Some(v) = values(frame)[d] {
                sum += v;
                n += 1;
            }
        }
        let enough = d < MFCC || n >= MIN_VOICED;
        if enough && n > 0 {
            let z = (sum / n as f32 - reference.mean[d]) / reference.spread[d];
            *slot = if d == MFCC { z * PITCH_WEIGHT } else { z };
        }
    }
    Some(Print {
        vector,
        speech: speech.len(),
    })
}

fn distance(a: &[f32; DIMENSIONS], b: &[f32; DIMENSIONS]) -> f32 {
    a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

struct Group {
    members: Vec<usize>,
}

fn between(prints: &[Print], a: &Group, b: &Group) -> f32 {
    let mut total = 0.0;
    for &i in &a.members {
        for &j in &b.members {
            total += distance(&prints[i].vector, &prints[j].vector);
        }
    }
    total / (a.members.len() * b.members.len()) as f32
}

fn closest(prints: &[Print], groups: &[Group]) -> (usize, usize, f32) {
    let mut best = (0, 1, f32::MAX);
    for i in 0..groups.len() {
        for j in i + 1..groups.len() {
            let d = between(prints, &groups[i], &groups[j]);
            if d < best.2 {
                best = (i, j, d);
            }
        }
    }
    best
}

/// Groups prints by voice. Each result is the group number of the print at the same place.
fn group(prints: &[Print]) -> Vec<usize> {
    let mut groups: Vec<Group> = (0..prints.len()).map(|i| Group { members: vec![i] }).collect();
    while groups.len() > 1 {
        let (i, j, height) = closest(prints, &groups);
        let enough_voices = groups.len() <= MAX_SPEAKERS;
        if enough_voices && height > DIFFERENT_VOICES {
            break;
        }
        let merged = groups.remove(j);
        groups[i].members.extend(merged.members);
    }
    // A voice heard for only a moment is most likely another voice's words.
    while groups.len() > 1 {
        let speech = |g: &Group| g.members.iter().map(|&m| prints[m].speech).sum::<usize>();
        let Some(small) = (0..groups.len())
            .filter(|&g| speech(&groups[g]) < SMALL_GROUP)
            .min_by_key(|&g| speech(&groups[g]))
        else {
            break;
        };
        let Some(nearest) = (0..groups.len()).filter(|&g| g != small).min_by(|&a, &b| {
            between(prints, &groups[small], &groups[a]).total_cmp(&between(prints, &groups[small], &groups[b]))
        }) else {
            break;
        };
        let taken = groups.remove(small);
        let nearest = if nearest > small { nearest - 1 } else { nearest };
        groups[nearest].members.extend(taken.members);
    }
    let mut out = vec![0; prints.len()];
    for (g, one) in groups.iter().enumerate() {
        for &m in &one.members {
            out[m] = g;
        }
    }
    out
}

/// The speaker, from 1, of each stretch given as start and end milliseconds, in the order voices first speak.
/// A stretch with too little speech takes the speaker of the stretch before it, or after it at the very start.
/// Nothing is labeled when there is under a second of audio or no stretch has enough speech.
pub fn label_ranges(frames: &[Frame], ranges: &[(u64, u64)]) -> Vec<Option<u32>> {
    let none = vec![None; ranges.len()];
    if frames.len() < FRAMES_PER_SECOND || ranges.is_empty() {
        return none;
    }
    let gate = speech_gate(frames);
    let reference = reference(frames, gate);
    let to_frame = |ms: u64| (ms as usize) * FRAMES_PER_SECOND / 1000;
    let prints: Vec<Option<Print>> = ranges
        .iter()
        .map(|&(start, end)| print_of(frames, to_frame(start), to_frame(end), gate, &reference))
        .collect();
    let have: Vec<usize> = (0..prints.len()).filter(|&i| prints[i].is_some()).collect();
    if have.is_empty() {
        return none;
    }
    let solid: Vec<Print> = prints
        .iter()
        .flatten()
        .map(|p| Print {
            vector: p.vector,
            speech: p.speech,
        })
        .collect();
    let grouped = group(&solid);
    // Number the groups by who speaks first.
    let mut order: Vec<usize> = Vec::new();
    for &g in &grouped {
        if !order.contains(&g) {
            order.push(g);
        }
    }
    let mut out: Vec<Option<u32>> = vec![None; ranges.len()];
    for (k, &i) in have.iter().enumerate() {
        // Every group is in `order`, so the position is always found.
        out[i] = order
            .iter()
            .position(|&g| g == grouped[k])
            .map(|place| place as u32 + 1);
    }
    // The quiet or short stretches follow their neighbors.
    let mut carried = out.iter().flatten().next().copied();
    for slot in &mut out {
        match slot {
            Some(n) => carried = Some(*n),
            None => *slot = carried,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(mean: f32, f0: f32, frames: usize, jitter: f32) -> Vec<Frame> {
        (0..frames)
            .map(|i| {
                let wobble = ((i * 7919 % 13) as f32 / 13.0 - 0.5) * jitter;
                let mut mfcc = [0.0; MFCC];
                for (d, c) in mfcc.iter_mut().enumerate() {
                    *c = mean * (d as f32 + 1.0).sqrt().sin() + wobble * ((d + i) % 3) as f32;
                }
                Frame {
                    energy: 0.0,
                    mfcc,
                    log_f0: f0 + wobble * 0.1,
                }
            })
            .collect()
    }

    fn quiet(frames: usize) -> Vec<Frame> {
        vec![
            Frame {
                energy: -20.0,
                mfcc: [0.0; MFCC],
                log_f0: 0.0,
            };
            frames
        ]
    }

    fn recording(parts: &[(f32, f32)]) -> (Vec<Frame>, Vec<(u64, u64)>) {
        let mut frames = Vec::new();
        let mut ranges = Vec::new();
        for &(mean, f0) in parts {
            let start = frames.len() as u64 * 10;
            frames.extend(voice(mean, f0, 300, 0.8));
            ranges.push((start, frames.len() as u64 * 10));
            frames.extend(quiet(30));
        }
        (frames, ranges)
    }

    #[test]
    fn two_alternating_voices_get_two_numbers() {
        let (frames, ranges) = recording(&[(3.0, 4.7), (-2.0, 5.3), (3.0, 4.7), (-2.0, 5.3), (3.0, 4.7)]);
        let labels = label_ranges(&frames, &ranges);
        assert_eq!(labels, vec![Some(1), Some(2), Some(1), Some(2), Some(1)]);
    }

    #[test]
    fn one_voice_is_one_speaker() {
        let (frames, ranges) = recording(&[(3.0, 4.7); 6]);
        assert!(label_ranges(&frames, &ranges).iter().all(|l| *l == Some(1)));
    }

    #[test]
    fn speakers_are_numbered_by_who_speaks_first() {
        let (frames, ranges) = recording(&[(-2.0, 5.3), (3.0, 4.7), (-2.0, 5.3)]);
        assert_eq!(label_ranges(&frames, &ranges), vec![Some(1), Some(2), Some(1)]);
    }

    #[test]
    fn a_short_stretch_follows_the_one_before_it() {
        let (mut frames, mut ranges) = recording(&[(3.0, 4.7), (-2.0, 5.3), (-2.0, 5.3)]);
        let start = frames.len() as u64 * 10;
        frames.extend(voice(3.0, 4.7, 10, 0.8));
        ranges.push((start, start + 100));
        let labels = label_ranges(&frames, &ranges);
        assert_eq!(labels[3], labels[2]);
    }

    #[test]
    fn too_little_audio_gets_no_labels() {
        assert_eq!(label_ranges(&voice(1.0, 4.0, 50, 0.1), &[(0, 500)]), vec![None]);
        assert!(label_ranges(&[], &[]).is_empty());
    }

    #[test]
    fn no_more_than_eight_voices_are_told_apart() {
        let parts: Vec<(f32, f32)> = (0..12).map(|i| (i as f32 * 4.0 - 20.0, 4.0 + i as f32 * 0.2)).collect();
        let (frames, ranges) = recording(&parts);
        let labels = label_ranges(&frames, &ranges);
        assert!(labels.iter().flatten().all(|n| *n as usize <= MAX_SPEAKERS));
    }
}
