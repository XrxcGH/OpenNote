//! A playback session: a [`Player`] on its own thread, feeding a sound device.
//!
//! Decoding reads files and stretches audio, which a device callback must never do. So a thread runs
//! the player and fills a ring buffer with about a quarter of a second of audio, and the device's
//! callback only copies from the ring. Commands go to the thread through a channel, and the position
//! and state come back through atomics, so a screen can read them as often as it likes.
//!
//! A seek or a pause has to silence the audio already in the ring. The thread counts the samples it
//! has queued, and tells the callback to discard everything queued up to that count.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use rtrb::{Consumer, Producer, RingBuffer};
use serde::{Deserialize, Serialize};

use super::audio_output::{AudioOutput, FillFn, OutputFormat};
use super::convert::{spread, Converter};
use super::player::Player;
use crate::audio::{AudioError, Result, TRACK_RATE};

/// How much audio the ring holds: 250 ms.
const RING_SAMPLES: usize = (TRACK_RATE / 4) as usize;
/// The most the thread renders at a time: 20 ms.
const CHUNK: usize = (TRACK_RATE / 50) as usize;
/// How long the thread sleeps when the ring is full or nothing plays.
const IDLE: Duration = Duration::from_millis(5);

/// Whether the session is playing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayState {
    Paused,
    Playing,
    /// The audio played to its end.
    Ended,
}

/// What a screen shows about playback.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: PlayState,
    pub position_ns: u64,
    pub duration_ns: u64,
    pub speed: f32,
    pub skip_silence: bool,
    /// Times the device ran out of audio, which sounds like a click.
    pub underruns: u64,
    /// Why playback stopped on its own, such as a file that could not be read.
    pub error: Option<String>,
}

enum Command {
    Play,
    Pause,
    Seek(u64),
    Skip(i64),
    Speed(f32),
    SkipSilence(bool),
    Stop,
}

#[derive(Default)]
struct Shared {
    state: AtomicU32,
    position_ns: AtomicU64,
    speed_bits: AtomicU32,
    skip_silence: AtomicBool,
    underruns: AtomicU64,
    discard_until: AtomicU64,
    popped: AtomicU64,
    error: Mutex<Option<String>>,
}

const PAUSED: u32 = 0;
const PLAYING: u32 = 1;
const ENDED: u32 = 2;

/// A running session. Dropping it stops the thread and the device.
pub struct PlaybackSession {
    commands: Sender<Command>,
    shared: Arc<Shared>,
    duration_ns: u64,
    thread: Option<JoinHandle<Box<dyn AudioOutput>>>,
}

impl PlaybackSession {
    /// Starts a session that is paused at the start of the recording.
    pub fn start(player: Player, mut output: Box<dyn AudioOutput>) -> Result<Self> {
        let shared = Arc::new(Shared::default());
        shared.speed_bits.store(1.0f32.to_bits(), Ordering::Relaxed);
        let (producer, consumer) = RingBuffer::new(RING_SAMPLES);
        output.start(device_callback(output.format(), consumer, Arc::clone(&shared)))?;
        let duration_ns = player.duration_ns();
        let (commands, receiver) = mpsc::channel();
        let worker = Worker {
            player,
            producer,
            receiver,
            shared: Arc::clone(&shared),
            pushed: 0,
            playing: false,
            draining: false,
            rewind_on_play: false,
            carried: Vec::new(),
        };
        let thread = thread::Builder::new()
            .name("opennote-audio-playback".into())
            .spawn(move || {
                worker.run();
                output
            })
            .map_err(|error| AudioError::Device(error.to_string()))?;
        Ok(PlaybackSession {
            commands,
            shared,
            duration_ns,
            thread: Some(thread),
        })
    }

    fn send(&self, command: Command) {
        // The thread ends only when the session stops, and then there is nothing to command.
        let _ = self.commands.send(command);
    }

    /// Plays from the current position. After a pause it goes back two seconds first.
    pub fn play(&self) {
        self.send(Command::Play);
    }

    pub fn pause(&self) {
        self.send(Command::Pause);
    }

    pub fn seek_ns(&self, position_ns: u64) {
        self.send(Command::Seek(position_ns));
    }

    /// Jumps from the current position, as the ten-second skip keys do.
    pub fn skip_ns(&self, delta_ns: i64) {
        self.send(Command::Skip(delta_ns));
    }

    pub fn set_speed(&self, speed: f32) {
        self.send(Command::Speed(speed));
    }

    pub fn set_skip_silence(&self, on: bool) {
        self.send(Command::SkipSilence(on));
    }

    pub fn status(&self) -> Status {
        let shared = &self.shared;
        Status {
            state: match shared.state.load(Ordering::Relaxed) {
                PLAYING => PlayState::Playing,
                ENDED => PlayState::Ended,
                _ => PlayState::Paused,
            },
            position_ns: shared.position_ns.load(Ordering::Relaxed).min(self.duration_ns),
            duration_ns: self.duration_ns,
            speed: f32::from_bits(shared.speed_bits.load(Ordering::Relaxed)),
            skip_silence: shared.skip_silence.load(Ordering::Relaxed),
            underruns: shared.underruns.load(Ordering::Relaxed),
            error: shared.error.lock().ok().and_then(|error| error.clone()),
        }
    }

    /// Stops the thread and the device.
    pub fn stop(mut self) {
        self.shut_down();
    }

    fn shut_down(&mut self) {
        self.send(Command::Stop);
        if let Some(thread) = self.thread.take() {
            if let Ok(mut output) = thread.join() {
                output.stop();
            }
        }
    }
}

impl Drop for PlaybackSession {
    fn drop(&mut self) {
        self.shut_down();
    }
}

/// The function the device calls: it takes samples from the ring and converts them.
fn device_callback(format: OutputFormat, mut ring: Consumer<f32>, shared: Arc<Shared>) -> FillFn {
    let mut converter = Converter::new(format.rate);
    let channels = usize::from(format.channels).max(1);
    Box::new(move |buffer| {
        // Throw away what a seek or a pause made stale.
        let mut popped = shared.popped.load(Ordering::Relaxed);
        let stale = shared.discard_until.load(Ordering::Acquire).saturating_sub(popped);
        for _ in 0..stale {
            if ring.pop().is_err() {
                break;
            }
            popped += 1;
        }
        let mut missed = false;
        let mut next = || {
            ring.pop().map_or_else(
                |_| {
                    missed = true;
                    0.0
                },
                |sample| {
                    popped += 1;
                    sample
                },
            )
        };
        for frame in buffer.chunks_mut(channels) {
            spread(frame, converter.next(&mut next));
        }
        shared.popped.store(popped, Ordering::Relaxed);
        if missed && shared.state.load(Ordering::Relaxed) == PLAYING {
            shared.underruns.fetch_add(1, Ordering::Relaxed);
        }
    })
}

struct Worker {
    player: Player,
    producer: Producer<f32>,
    receiver: Receiver<Command>,
    shared: Arc<Shared>,
    /// Samples queued in the ring so far, which the device counts as it takes them.
    pushed: u64,
    playing: bool,
    /// Whether all the audio is queued and the device is playing out the last of it.
    draining: bool,
    /// Whether the next play follows a pause, and so goes back a little.
    rewind_on_play: bool,
    /// Audio that was rendered but did not fit in the ring yet.
    carried: Vec<f32>,
}

impl Worker {
    fn run(mut self) {
        self.publish();
        loop {
            match self.receiver.try_recv() {
                Ok(Command::Stop) | Err(TryRecvError::Disconnected) => return,
                Ok(command) => self.handle(command),
                Err(TryRecvError::Empty) => {
                    if !self.pump() {
                        thread::sleep(IDLE);
                    }
                }
            }
            self.publish();
        }
    }

    /// Where the listener is: the player has read ahead by what the ring holds.
    fn heard_ns(&self) -> u64 {
        // Samples that a seek or pause told the device to discard count as taken already.
        let taken = self
            .shared
            .popped
            .load(Ordering::Relaxed)
            .max(self.shared.discard_until.load(Ordering::Relaxed));
        let queued = self.pushed.saturating_sub(taken) + self.carried.len() as u64;
        let ahead_ns = (queued as f64 * 1e9 / f64::from(TRACK_RATE) * f64::from(self.player.speed())) as u64;
        self.player.position_ns().saturating_sub(ahead_ns)
    }

    /// Silences what is queued and puts the player back where the listener is.
    fn flush(&mut self) {
        let heard = self.heard_ns();
        self.carried.clear();
        self.draining = false;
        self.shared.discard_until.store(self.pushed, Ordering::Release);
        self.player.seek_ns(heard);
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Play => {
                if self.playing || self.draining {
                    return;
                }
                if self.shared.state.load(Ordering::Relaxed) == ENDED {
                    self.player.seek_ns(0);
                } else if std::mem::take(&mut self.rewind_on_play) {
                    // The ring was flushed when playback paused, so the rewind starts at the listener.
                    self.player.rewind_for_resume();
                }
                self.shared.state.store(PLAYING, Ordering::Relaxed);
                self.playing = true;
            }
            Command::Pause => {
                if self.playing || self.draining {
                    self.flush();
                    self.playing = false;
                    self.rewind_on_play = true;
                    self.shared.state.store(PAUSED, Ordering::Relaxed);
                }
            }
            Command::Seek(ns) => {
                self.flush();
                self.player.seek_ns(ns);
                self.rewind_on_play = false;
                self.reopen();
            }
            Command::Skip(delta) => {
                self.flush();
                self.player.skip_ns(delta);
                self.rewind_on_play = false;
                self.reopen();
            }
            Command::Speed(speed) => {
                self.flush();
                self.player.set_speed(speed);
            }
            Command::SkipSilence(on) => {
                self.flush();
                self.player.set_skip_silence(on);
            }
            Command::Stop => {}
        }
    }

    /// Renders more audio into the ring if there is room. It says whether it did any work.
    fn pump(&mut self) -> bool {
        if !self.playing {
            return false;
        }
        if self.carried.is_empty() {
            let mut chunk = vec![0f32; CHUNK];
            match self.player.render(&mut chunk) {
                Ok(count) => chunk.truncate(count),
                Err(error) => {
                    *self.shared.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(error.to_string());
                    self.playing = false;
                    return false;
                }
            }
            self.carried = chunk;
        }
        let room = self.producer.slots();
        let count = room.min(self.carried.len());
        for sample in self.carried.drain(..count) {
            // The slot was counted above, and only this thread pushes.
            let _ = self.producer.push(sample);
        }
        self.pushed += count as u64;
        if self.carried.is_empty() && self.player.is_ended() {
            self.playing = false;
            self.draining = true;
        }
        count > 0
    }

    /// After a seek in a session that had ended, playback is paused at the new place.
    fn reopen(&mut self) {
        if self.shared.state.load(Ordering::Relaxed) == ENDED {
            self.shared.state.store(PAUSED, Ordering::Relaxed);
        }
    }

    fn publish(&mut self) {
        let shared = &self.shared;
        let drained = self.pushed <= shared.popped.load(Ordering::Relaxed);
        if self.draining && drained {
            self.draining = false;
            shared.state.store(ENDED, Ordering::Relaxed);
        } else if self.playing || self.draining {
            shared.state.store(PLAYING, Ordering::Relaxed);
        }
        shared.position_ns.store(self.heard_ns(), Ordering::Relaxed);
        shared
            .speed_bits
            .store(self.player.speed().to_bits(), Ordering::Relaxed);
        shared
            .skip_silence
            .store(self.player.skips_silence(), Ordering::Relaxed);
    }
}
