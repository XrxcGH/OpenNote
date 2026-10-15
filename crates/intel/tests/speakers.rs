//! Telling voices apart, on synthetic speech: two voices that differ in pitch and in the shape of the throat, each
//! saying six stretches with the vowels changing. The audio goes through the same tee the transcription jobs use.

use std::f32::consts::PI;

use opennote_intel::speakers::{Listening, Tee};
use opennote_intel::transcribe::{AudioSource, MemoryAudio, SAMPLES_PER_SECOND};

const RATE: f32 = SAMPLES_PER_SECOND as f32;

/// A voice: a pulse train at the pitch, shaped by three resonances that the vowel moves about.
struct Voice {
    pitch: f32,
    formants: [f32; 3],
}

/// A small deterministic noise, so a run is the same each time.
struct Noise(u32);

impl Noise {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (self.0 >> 8) as f32 / (1u32 << 24) as f32 - 0.5
    }
}

fn say(voice: &Voice, vowel: f32, seconds: f32, noise: &mut Noise) -> Vec<f32> {
    let total = (seconds * RATE) as usize;
    let period = RATE / voice.pitch;
    let mut state = [[0.0f32; 2]; 3];
    let mut out = Vec::with_capacity(total);
    let mut next_pulse = 0.0f32;
    for i in 0..total {
        let mut x = noise.next() * 0.02;
        if i as f32 >= next_pulse {
            x += 1.0;
            next_pulse += period * (1.0 + noise.next() * 0.02);
        }
        // Each resonance is a two-pole filter, and the vowel moves its frequency by up to 15 percent.
        let mut y = x;
        for (k, formant) in voice.formants.iter().enumerate() {
            // The vowel moves through the stretch, as it does in speech, so each stretch averages many of them.
            let moving = vowel + 0.5 * (2.0 * PI * i as f32 / (0.3 * RATE) + k as f32).sin();
            let freq = formant * (1.0 + 0.15 * moving);
            let r = 0.96f32;
            let (a1, a2) = (2.0 * r * (2.0 * PI * freq / RATE).cos(), -r * r);
            let z = y + a1 * state[k][0] + a2 * state[k][1];
            state[k][1] = state[k][0];
            state[k][0] = z;
            y = z * (1.0 - r);
        }
        out.push(y);
    }
    // Speech at a normal level: the loudest sample is about a third of full scale.
    let mut peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    if peak == 0.0 {
        peak = 1.0;
    }
    out.iter_mut().for_each(|v| *v *= 0.3 / peak);
    out
}

fn quiet(seconds: f32, noise: &mut Noise) -> Vec<f32> {
    (0..(seconds * RATE) as usize).map(|_| noise.next() * 0.002).collect()
}

/// Audio of the voices in turn, and the start and end of each stretch in milliseconds.
fn conversation(order: &[usize]) -> (Vec<f32>, Vec<(u64, u64)>) {
    let voices = [
        Voice {
            pitch: 105.0,
            formants: [650.0, 1100.0, 2500.0],
        },
        Voice {
            pitch: 205.0,
            formants: [420.0, 2000.0, 3100.0],
        },
    ];
    let mut noise = Noise(7);
    let mut audio = quiet(0.5, &mut noise);
    let mut ranges = Vec::new();
    for (n, &who) in order.iter().enumerate() {
        let vowel = ((n * 5) % 7) as f32 / 7.0 - 0.5;
        let start = audio.len() as u64 * 1000 / u64::from(SAMPLES_PER_SECOND);
        audio.extend(say(&voices[who], vowel, 3.0, &mut noise));
        ranges.push((start, audio.len() as u64 * 1000 / u64::from(SAMPLES_PER_SECOND)));
        audio.extend(quiet(0.5, &mut noise));
    }
    (audio, ranges)
}

/// Reads all the audio through the tee, in the chunks an engine reads.
fn hear(audio: Vec<f32>) -> Listening {
    let listening = Listening::new();
    let mut tee = Tee::new(MemoryAudio::new(audio), listening.clone());
    let mut buffer = vec![0.0; 4800];
    while tee.read(&mut buffer).unwrap() > 0 {}
    listening
}

#[test]
fn two_voices_taking_turns_get_two_speakers() {
    let order = [0, 1, 0, 1, 1, 0];
    let (audio, ranges) = conversation(&order);
    let labels = hear(audio).label(&ranges);
    let want: Vec<Option<u32>> = order.iter().map(|&who| Some(who as u32 + 1)).collect();
    assert_eq!(labels, want);
}

#[test]
fn the_speaker_who_talks_first_is_speaker_one_even_if_the_voice_is_high() {
    let (audio, ranges) = conversation(&[1, 0, 1]);
    assert_eq!(hear(audio).label(&ranges), vec![Some(1), Some(2), Some(1)]);
}

#[test]
fn one_voice_saying_different_vowels_stays_one_speaker() {
    let (audio, ranges) = conversation(&[0, 0, 0, 0, 0, 0]);
    assert!(hear(audio).label(&ranges).iter().all(|label| *label == Some(1)));
}

#[test]
fn a_second_read_of_the_audio_does_not_double_the_prints() {
    let (audio, ranges) = conversation(&[0, 1, 0]);
    let listening = Listening::new();
    let mut tee = Tee::new(MemoryAudio::new(audio), listening.clone());
    let mut buffer = vec![0.0; 4800];
    while tee.read(&mut buffer).unwrap() > 0 {}
    tee.rewind().unwrap();
    while tee.read(&mut buffer).unwrap() > 0 {}
    assert_eq!(listening.label(&ranges), vec![Some(1), Some(2), Some(1)]);
}

#[test]
fn silence_gets_no_labels() {
    let listening = hear(vec![0.0; 16_000 * 5]);
    assert_eq!(listening.label(&[(0, 2000)]), vec![None]);
}
