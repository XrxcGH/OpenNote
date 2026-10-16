//! The recording guard: it watches a recording and the machine, and says when the person should look.
//!
//! The screen asks the guard a few times a second. It answers with the warnings in force and, when
//! recording must stop, why. The guard never stops a recording itself, so the screen can show the
//! notice and close the files in one step.
//!
//! The warnings are the ones in the feature table. The microphone may have been silent for 20
//! seconds, or may have stopped delivering audio at all. Disk space or battery may be running low,
//! with the minutes left. The writer may have failed, or fallen behind and dropped audio.
//!
//! System audio is allowed to be silent and to stop for long stretches, since loopback delivers
//! nothing while nothing plays. Only the microphone is watched for silence. Instead, the source says
//! when a track's device is gone. It also says when the person picked the default device and the
//! system has since moved its sound to another one, as when headphones are plugged in.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::environment::Environment;
use super::files::TrackKind;
use super::recording::Recording;

/// When the guard speaks up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Thresholds {
    /// A microphone silent this long raises a warning.
    pub silent_ms: u64,
    /// A microphone that delivers nothing for this long has probably been unplugged.
    pub stalled_ms: u64,
    /// Fewer minutes of recording than this fit on the disk.
    pub low_disk_minutes: u64,
    /// Recording must stop when less than this is free.
    pub stop_disk_bytes: u64,
    /// A battery below this percent, off mains power, raises a warning.
    pub low_battery_percent: u8,
}

impl Default for Thresholds {
    fn default() -> Self {
        Thresholds {
            silent_ms: 20_000,
            stalled_ms: 3_000,
            low_disk_minutes: 30,
            stop_disk_bytes: 50 * 1024 * 1024,
            low_battery_percent: 15,
        }
    }
}

/// One thing the person should know.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Warning {
    /// The microphone has recorded nothing but silence for this long.
    #[serde(rename_all = "camelCase")]
    MicrophoneSilent { seconds: u64 },
    /// A track has delivered no audio for this long, as if its device were gone.
    #[serde(rename_all = "camelCase")]
    DeviceStalled { track: TrackKind, seconds: u64 },
    /// The disk will fill in about this many minutes of recording.
    #[serde(rename_all = "camelCase")]
    LowDisk { minutes_left: u64, free_bytes: u64 },
    /// The battery is low and the machine is not plugged in.
    #[serde(rename_all = "camelCase")]
    LowBattery { percent: u8, minutes_left: Option<u32> },
    /// A track's writer has stopped, so the recording is no longer growing.
    #[serde(rename_all = "camelCase")]
    WriterFailed { track: TrackKind, message: String },
    /// The writer fell behind, and this many packets of audio were lost.
    #[serde(rename_all = "camelCase")]
    DroppedAudio { track: TrackKind, packets: u64 },
    /// A track's device is gone, and the track records silence until it, or a new default, is back.
    #[serde(rename_all = "camelCase")]
    DeviceLost { track: TrackKind },
    /// A track records a device that is no longer the system's default. For system audio, the sound
    /// now plays elsewhere, and switching the track to the default follows it.
    #[serde(rename_all = "camelCase")]
    NotDefaultDevice { track: TrackKind },
}

/// Why recording has to end now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StopReason {
    #[serde(rename_all = "camelCase")]
    DiskFull { free_bytes: u64 },
    #[serde(rename_all = "camelCase")]
    WriterFailed { message: String },
}

/// What the guard found.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub warnings: Vec<Warning>,
    /// Set when recording should stop. Stopping closes the files cleanly, and the notice can say how
    /// much was saved.
    pub stop: Option<StopReason>,
}

/// Watches one recording.
pub struct Guard {
    environment: Arc<dyn Environment>,
    thresholds: Thresholds,
    dir: PathBuf,
    /// The most bytes per second the recording has been seen to write, for the disk estimate.
    peak_rate: f64,
    last_sample: Option<(u64, u64)>,
}

/// What 32 kbps Opus costs on disk, with the Ogg pages: a little over 4 KB a second. The estimate
/// uses this until the recording has shown its own rate.
const DEFAULT_BYTES_PER_SECOND: f64 = 5_000.0;

impl Guard {
    pub fn new(dir: impl Into<PathBuf>, environment: Arc<dyn Environment>) -> Self {
        Guard {
            environment,
            thresholds: Thresholds::default(),
            dir: dir.into(),
            peak_rate: DEFAULT_BYTES_PER_SECOND,
            last_sample: None,
        }
    }

    pub fn with_thresholds(mut self, thresholds: Thresholds) -> Self {
        self.thresholds = thresholds;
        self
    }

    /// Checks a recording that is running. A paused recording is not watched for silence or stalls.
    pub fn check(&mut self, recording: &Recording) -> Status {
        let mut status = Status::default();
        self.watch_tracks(recording, &mut status);
        self.watch_disk(recording.bytes_on_disk(), recording.now_ns(), &mut status);
        self.watch_battery(&mut status);
        status
    }

    fn watch_tracks(&self, recording: &Recording, status: &mut Status) {
        let mut lost = Vec::new();
        for health in recording.health() {
            if health.device.lost {
                lost.push(health.kind);
                status.warnings.push(Warning::DeviceLost { track: health.kind });
            } else if health.device.not_default {
                status.warnings.push(Warning::NotDefaultDevice { track: health.kind });
            }
            if let Some(message) = health.failure {
                status.stop = status.stop.take().or(Some(StopReason::WriterFailed {
                    message: message.clone(),
                }));
                status.warnings.push(Warning::WriterFailed {
                    track: health.kind,
                    message,
                });
            } else if health.dropped_packets > 0 {
                status.warnings.push(Warning::DroppedAudio {
                    track: health.kind,
                    packets: health.dropped_packets,
                });
            }
        }
        if recording.is_paused() {
            return;
        }
        for watch in recording.watch() {
            // A lost device has its own warning, and only the microphone is expected to deliver.
            if watch.kind != TrackKind::Microphone || lost.contains(&watch.kind) {
                continue;
            }
            if watch.idle_ms >= self.thresholds.stalled_ms {
                status.warnings.push(Warning::DeviceStalled {
                    track: watch.kind,
                    seconds: watch.idle_ms / 1_000,
                });
            } else if watch.silent_ms >= self.thresholds.silent_ms {
                status.warnings.push(Warning::MicrophoneSilent {
                    seconds: watch.silent_ms / 1_000,
                });
            }
        }
    }

    fn watch_disk(&mut self, bytes_written: u64, now_ns: u64, status: &mut Status) {
        if let Some((bytes, at_ns)) = self.last_sample.filter(|&(_, at_ns)| now_ns > at_ns + 5_000_000_000) {
            let rate = bytes_written.saturating_sub(bytes) as f64 / ((now_ns - at_ns) as f64 / 1e9);
            self.peak_rate = self.peak_rate.max(rate);
            self.last_sample = Some((bytes_written, now_ns));
        } else if self.last_sample.is_none() {
            self.last_sample = Some((bytes_written, now_ns));
        }
        let Some(free_bytes) = self.environment.free_bytes(&self.dir) else {
            return;
        };
        if free_bytes < self.thresholds.stop_disk_bytes {
            status.stop = status.stop.take().or(Some(StopReason::DiskFull { free_bytes }));
        }
        let minutes_left = (free_bytes as f64 / self.peak_rate / 60.0) as u64;
        if minutes_left < self.thresholds.low_disk_minutes {
            status.warnings.push(Warning::LowDisk {
                minutes_left,
                free_bytes,
            });
        }
    }

    fn watch_battery(&self, status: &mut Status) {
        if let Some(battery) = self.environment.battery() {
            if !battery.plugged_in && battery.percent <= self.thresholds.low_battery_percent {
                status.warnings.push(Warning::LowBattery {
                    percent: battery.percent,
                    minutes_left: battery.minutes_left,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::super::environment::Battery;
    use super::*;

    /// A machine whose free space and battery the test sets.
    #[derive(Default)]
    struct Fake {
        free: Mutex<Option<u64>>,
        battery: Mutex<Option<Battery>>,
    }

    impl Environment for Fake {
        fn free_bytes(&self, _dir: &std::path::Path) -> Option<u64> {
            *self.free.lock().unwrap()
        }

        fn battery(&self) -> Option<Battery> {
            *self.battery.lock().unwrap()
        }
    }

    fn guard(fake: &Arc<Fake>) -> Guard {
        Guard::new(".", fake.clone())
    }

    #[test]
    fn plenty_of_disk_and_battery_say_nothing() {
        let fake = Arc::new(Fake::default());
        *fake.free.lock().unwrap() = Some(500 * 1024 * 1024 * 1024);
        *fake.battery.lock().unwrap() = Some(Battery {
            percent: 80,
            plugged_in: false,
            minutes_left: Some(300),
        });
        let mut status = Status::default();
        let mut guard = guard(&fake);
        guard.watch_disk(0, 0, &mut status);
        guard.watch_battery(&mut status);
        assert_eq!(status, Status::default());
    }

    #[test]
    fn low_disk_says_how_many_minutes_fit() {
        let fake = Arc::new(Fake::default());
        // 50 MB at 5,000 bytes a second is 167 minutes, and 3 MB less than the stop floor is not.
        *fake.free.lock().unwrap() = Some(60 * 1024 * 1024);
        let mut status = Status::default();
        let mut guard = guard(&fake);
        guard.thresholds.low_disk_minutes = 300;
        guard.watch_disk(0, 0, &mut status);
        assert_eq!(
            status.warnings,
            vec![Warning::LowDisk {
                minutes_left: 209,
                free_bytes: 60 * 1024 * 1024
            }]
        );
        assert_eq!(status.stop, None);
    }

    #[test]
    fn a_faster_recording_shortens_the_estimate() {
        let fake = Arc::new(Fake::default());
        *fake.free.lock().unwrap() = Some(600 * 1024 * 1024);
        let mut guard = guard(&fake);
        let mut status = Status::default();
        guard.watch_disk(0, 0, &mut status);
        // Ten seconds later the files have grown by 150 KB, which is 15,000 bytes a second.
        guard.watch_disk(150_000, 10_000_000_000, &mut status);
        let mut later = Status::default();
        guard.watch_disk(300_000, 20_000_000_000, &mut later);
        assert!((guard.peak_rate - 15_000.0).abs() < 1.0, "{}", guard.peak_rate);
        // 600 MB at 15,000 bytes a second is 699 minutes.
        assert!(guard.thresholds.low_disk_minutes < 699);
        assert!(later.warnings.is_empty());
    }

    #[test]
    fn almost_no_disk_stops_the_recording() {
        let fake = Arc::new(Fake::default());
        *fake.free.lock().unwrap() = Some(5 * 1024 * 1024);
        let mut status = Status::default();
        guard(&fake).watch_disk(0, 0, &mut status);
        assert_eq!(
            status.stop,
            Some(StopReason::DiskFull {
                free_bytes: 5 * 1024 * 1024
            })
        );
        assert!(matches!(status.warnings[0], Warning::LowDisk { .. }));
    }

    #[test]
    fn a_low_battery_warns_only_off_mains_power() {
        let fake = Arc::new(Fake::default());
        let guard = guard(&fake);
        let on_battery = |plugged_in| {
            *fake.battery.lock().unwrap() = Some(Battery {
                percent: 9,
                plugged_in,
                minutes_left: Some(25),
            });
            let mut status = Status::default();
            guard.watch_battery(&mut status);
            status.warnings
        };
        assert_eq!(
            on_battery(false),
            vec![Warning::LowBattery {
                percent: 9,
                minutes_left: Some(25)
            }]
        );
        assert!(on_battery(true).is_empty());
    }

    #[test]
    fn a_machine_that_cannot_say_gets_no_warnings() {
        let fake = Arc::new(Fake::default());
        let mut status = Status::default();
        let mut guard = guard(&fake);
        guard.watch_disk(0, 0, &mut status);
        guard.watch_battery(&mut status);
        assert_eq!(status, Status::default());
    }

    #[test]
    fn warnings_go_to_the_screen_as_tagged_json() {
        let warning = Warning::DeviceStalled {
            track: TrackKind::Microphone,
            seconds: 4,
        };
        let json = serde_json::to_string(&warning).unwrap();
        assert_eq!(json, r#"{"type":"deviceStalled","track":"microphone","seconds":4}"#);
        assert_eq!(serde_json::from_str::<Warning>(&json).unwrap(), warning);
    }
}
