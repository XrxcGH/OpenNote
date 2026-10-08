//! The service end to end, on stand-in devices: prepare a recording, begin it, watch it, pause it,
//! switch microphones, stop it, open it for playback, and recover one that a crash cut off. The page
//! saves go through the core's real page store, on the real file system.

mod common;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use common::{noise, wait_until, SECOND};
use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::format::CanonicalCodec;
use opennote_core::model::Page;
use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::FileStamp;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::page_store::{PageStore, PageStoreConfig, SaveError, SaveRequest};
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::sample::{sample_device, sample_page};
use opennote_core::{AssetId, Clock as CoreClock, Limits, TestClock, Timestamp, Timings};
use opennote_media::audio::encoder::{EncoderFactory, FrameEncoder};
use opennote_media::audio::recovery::recover_track;
use opennote_media::audio::synthetic::{synthetic, ManualClock, SyntheticHandle};
use opennote_media::audio::{
    AudioSource, DeviceInfo, Direction, Environment, FixedCatalog, Options, SourceFormat, StopReason, Warning,
};
use opennote_media::audio::{DeviceState, TrackFiles, TrackKind};
use opennote_media::layout::{RecordingEntry, RecordingState};
use opennote_media::pcm_codec::{pcm_decoder_factory, pcm_encoder_factory};
use opennote_media::playback::session::PlayState;
use opennote_media::playback::{AudioOutput, ManualOutput, OutputFormat};
use opennote_media::service::{AudioService, DeviceFactory, Services, StartRequest};
use serde_json::Value;

const START: u64 = 4 * SECOND;
const MONO: SourceFormat = SourceFormat {
    rate: 48_000,
    channels: 1,
};

/// Hands out generated sources and a test output, and remembers the handles that drive the sources.
#[derive(Default)]
struct Fake {
    handles: Mutex<Vec<SyntheticHandle>>,
    output: Mutex<Option<ManualOutput>>,
    asked: Mutex<Vec<String>>,
    /// Makes the microphone fail to open, as an unplugged one does.
    broken: Mutex<bool>,
}

impl Fake {
    fn source(&self, label: &str, id: Option<&str>, clock: u64) -> Box<dyn AudioSource> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("{label}:{}", id.unwrap_or("default")));
        let (source, handle) = synthetic(MONO, noise(), clock);
        self.handles.lock().unwrap().push(handle);
        Box::new(source)
    }

    fn handle(&self, index: usize) -> SyntheticHandle {
        self.handles.lock().unwrap()[index].clone()
    }
}

impl DeviceFactory for Fake {
    fn microphone(&self, id: Option<&str>) -> opennote_media::audio::Result<Box<dyn AudioSource>> {
        if *self.broken.lock().unwrap() {
            return Err(opennote_media::audio::AudioError::Device(
                "The microphone is gone.".into(),
            ));
        }
        let at = self
            .handles
            .lock()
            .unwrap()
            .last()
            .map_or(START, SyntheticHandle::now_ns);
        Ok(self.source("mic", id, at))
    }

    fn system_audio(&self, id: Option<&str>) -> opennote_media::audio::Result<Box<dyn AudioSource>> {
        Ok(self.source("system", id, START))
    }

    fn output(&self, _id: Option<&str>) -> opennote_media::audio::Result<Box<dyn AudioOutput>> {
        let output = ManualOutput::new(OutputFormat {
            rate: 48_000,
            channels: 2,
        });
        *self.output.lock().unwrap() = Some(output.clone());
        Ok(Box::new(output))
    }
}

struct Machine {
    free: Mutex<u64>,
}

impl Environment for Machine {
    fn free_bytes(&self, _dir: &Path) -> Option<u64> {
        Some(*self.free.lock().unwrap())
    }

    fn battery(&self) -> Option<opennote_media::audio::Battery> {
        None
    }
}

fn device(id: &str, direction: Direction, is_default: bool) -> DeviceInfo {
    DeviceInfo {
        id: id.into(),
        name: format!("Device {id}"),
        direction,
        is_default,
        sample_rate: Some(48_000),
        channels: Some(2),
    }
}

struct Setup {
    service: AudioService,
    fake: Arc<Fake>,
    clock: Arc<ManualClock>,
    machine: Arc<Machine>,
}

fn setup() -> Setup {
    setup_with(pcm_encoder_factory())
}

fn setup_with(encoder: EncoderFactory) -> Setup {
    let fake = Arc::new(Fake::default());
    let clock = ManualClock::new(START);
    let machine = Arc::new(Machine {
        free: Mutex::new(1 << 40),
    });
    let session: Arc<dyn CoreClock> = Arc::new(TestClock::new(Timestamp::from_unix_ms(1_800_000_000_000)));
    let services = Services {
        catalog: Arc::new(FixedCatalog(vec![
            device("built-in", Direction::Input, true),
            device("headset", Direction::Input, false),
            device("speakers", Direction::Output, true),
        ])),
        environment: machine.clone(),
        devices: fake.clone(),
        clock: clock.clone(),
        session,
        encoder,
        decoder: pcm_decoder_factory(),
        options: Options {
            sync: false,
            ring_seconds: 60,
            ..Options::default()
        },
    };
    Setup {
        service: AudioService::new(services),
        fake,
        clock,
        machine,
    }
}

fn request(dir: &Path, system_audio: bool) -> StartRequest {
    StartRequest {
        assets_dir: dir.to_path_buf(),
        microphone: Some("headset".into()),
        system_audio,
        system_device: None,
    }
}

#[test]
fn a_recording_goes_from_prepare_to_a_saved_entry() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    let prepared = setup.service.prepare(request(dir.path(), false)).unwrap();
    assert_eq!(prepared.microphone.device.id, "headset");
    assert!(!prepared.microphone.fell_back);
    assert_eq!(prepared.entry.state, RecordingState::Recording);
    assert_eq!(prepared.assets.len(), 1);
    assert_eq!(prepared.assets[0]["state"], "recording");
    // Nothing is on disk until the page has the entry.
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);

    let begun = setup.service.begin().unwrap();
    assert!(begun.clock.is_some());
    assert_eq!(setup.fake.asked.lock().unwrap().clone(), vec!["mic:headset"]);

    let handle = setup.fake.handle(0);
    handle.produce_ms(2_000);
    setup.clock.set_ns(handle.now_ns());
    wait_until(|| setup.service.recording_status().is_ok_and(|status| status.bytes > 0));
    let status = setup.service.recording_status().unwrap();
    assert!(
        !status.paused && status.warnings.is_empty() && status.stop.is_none(),
        "{status:?}"
    );
    assert_eq!(status.levels.len(), 1);
    assert_eq!(status.now.capture_ns, handle.now_ns());

    let finished = setup.service.stop().unwrap();
    assert_eq!(finished.entry.state, RecordingState::Complete);
    assert_eq!(finished.entry.id, prepared.entry.id);
    assert_eq!(finished.assets[0].get("state"), None);
    assert_eq!(finished.assets[0]["id"], prepared.assets[0]["id"]);
    assert!(finished.assets[0]["bytes"].as_u64().unwrap() > 1_000);
    assert!(setup.service.recording_status().is_err());
}

#[test]
fn a_second_recording_cannot_start_while_one_runs() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    setup.service.prepare(request(dir.path(), false)).unwrap();
    setup.service.begin().unwrap();
    assert!(setup.service.prepare(request(dir.path(), false)).is_err());
    assert!(setup.service.begin().is_err());
    setup.service.stop().unwrap();
    assert!(setup.service.stop().is_err());
}

#[test]
fn a_missing_microphone_falls_back_to_the_default_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    let mut asked = request(dir.path(), true);
    asked.microphone = Some("unplugged".into());
    let prepared = setup.service.prepare(asked).unwrap();
    assert!(prepared.microphone.fell_back);
    assert_eq!(prepared.microphone.device.id, "built-in");
    assert_eq!(prepared.system_audio.as_ref().unwrap().device.id, "speakers");
    assert_eq!(prepared.entry.tracks.len(), 2);
    setup.service.begin().unwrap();
    // Neither is pinned, so both follow the default as it changes.
    assert_eq!(
        setup.fake.asked.lock().unwrap().clone(),
        vec!["mic:default", "system:default"]
    );
    setup.service.stop().unwrap();
}

/// The guard's warnings about devices.
fn device_warnings(setup: &mut Setup) -> Vec<Warning> {
    let status = setup.service.recording_status().unwrap();
    status
        .warnings
        .into_iter()
        .filter(|warning| matches!(warning, Warning::DeviceLost { .. } | Warning::NotDefaultDevice { .. }))
        .collect()
}

#[test]
fn system_audio_follows_the_default_and_the_guard_says_when_its_device_is_gone_or_moved() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    let mut asked = request(dir.path(), true);
    asked.system_device = Some("speakers".into());
    setup.service.prepare(asked).unwrap();
    setup.service.begin().unwrap();
    assert_eq!(
        setup.fake.asked.lock().unwrap()[1],
        "system:speakers",
        "picked, so pinned"
    );
    assert_eq!(device_warnings(&mut setup), vec![]);

    // Headphones were plugged in, and the system plays through them now.
    setup.fake.handle(1).set_device_state(DeviceState {
        lost: false,
        not_default: true,
    });
    assert_eq!(
        device_warnings(&mut setup),
        vec![Warning::NotDefaultDevice {
            track: TrackKind::SystemAudio
        }]
    );
    let followed = setup.service.switch_system_audio(None).unwrap();
    assert_eq!(followed.device.id, "speakers");
    assert_eq!(setup.fake.asked.lock().unwrap()[2], "system:default");
    assert!(!setup.fake.handle(1).is_running());
    assert_eq!(device_warnings(&mut setup), vec![]);

    // The device the track follows is gone and nothing replaced it.
    setup.fake.handle(2).set_device_state(DeviceState {
        lost: true,
        not_default: false,
    });
    assert_eq!(
        device_warnings(&mut setup),
        vec![Warning::DeviceLost {
            track: TrackKind::SystemAudio
        }]
    );
    let finished = setup.service.stop().unwrap();
    assert_eq!(finished.summary.tracks.len(), 2);
}

#[test]
fn a_recording_without_system_audio_cannot_switch_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    setup.service.prepare(request(dir.path(), false)).unwrap();
    setup.service.begin().unwrap();
    assert!(setup.service.switch_system_audio(None).is_err());
    setup.service.stop().unwrap();
}

#[test]
fn the_microphone_changes_without_stopping_and_the_disk_can_end_a_recording() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    setup.service.prepare(request(dir.path(), false)).unwrap();
    setup.service.begin().unwrap();
    setup.fake.handle(0).produce_ms(1_000);
    let switched = setup.service.switch_microphone(Some("built-in".into())).unwrap();
    assert_eq!(switched.device.id, "built-in");
    setup.fake.handle(1).produce_ms(1_000);

    *setup.machine.free.lock().unwrap() = 1024 * 1024;
    let status = setup.service.recording_status().unwrap();
    assert!(matches!(status.stop, Some(StopReason::DiskFull { .. })));
    assert!(status
        .warnings
        .iter()
        .any(|warning| matches!(warning, Warning::LowDisk { .. })));
    let finished = setup.service.stop().unwrap();
    assert!(finished.summary.tracks[0].timeline.frames >= 96_000);
}

#[test]
fn the_running_recording_is_not_recovered_when_its_page_opens_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    let prepared = setup.service.prepare(request(dir.path(), false)).unwrap();
    // Prepared but not begun: the files don't exist yet, and the entry must stay.
    let refused = setup.service.recover(dir.path(), &prepared.entry).unwrap_err();
    assert!(refused.to_string().contains("still running"), "{refused}");
    assert!(
        setup.service.is_running(&prepared.entry.id),
        "a prepared recording counts as running"
    );
    setup.service.begin().unwrap();
    assert!(setup.service.is_running(&prepared.entry.id));
    assert!(!setup.service.is_running("another-recording"));
    let handle = setup.fake.handle(0);
    handle.produce_ms(1_000);
    wait_until(|| {
        setup
            .service
            .recording_status()
            .is_ok_and(|status| status.bytes > 4_000)
    });
    // The page was switched away from and back, and opens with the entry still in `recording`.
    assert!(setup.service.recover(dir.path(), &prepared.entry).is_err());
    handle.produce_ms(1_000);
    let finished = setup.service.stop().unwrap();
    assert!(!setup.service.is_running(&prepared.entry.id));
    assert_eq!(finished.entry.state, RecordingState::Complete);
    assert_eq!(finished.summary.tracks[0].timeline.frames, 96_000);
    // Once it has stopped, the same entry recovers to the same audio, untouched.
    let again = setup.service.recover(dir.path(), &prepared.entry).unwrap();
    assert_eq!(again.summary.tracks[0].timeline, finished.summary.tracks[0].timeline);
    for key in ["bytes", "sha256"] {
        assert_eq!(again.assets[0][key], finished.assets[0][key], "{key}");
    }
}

/// An encoder that fails after a number of frames, as a write to a full disk does.
struct Failing {
    inner: Box<dyn FrameEncoder>,
    frames_left: usize,
}

impl FrameEncoder for Failing {
    fn pre_skip(&self) -> u16 {
        self.inner.pre_skip()
    }

    fn encode(&mut self, pcm: &[f32], out: &mut Vec<u8>) -> opennote_media::audio::Result<()> {
        if self.frames_left == 0 {
            return Err(opennote_media::audio::AudioError::Encoder(
                "There is no space left.".into(),
            ));
        }
        self.frames_left -= 1;
        self.inner.encode(pcm, out)
    }
}

/// Encoders whose second one, the system audio's, fails after one second of 20 ms frames.
fn second_encoder_fails() -> EncoderFactory {
    let made = Arc::new(Mutex::new(0));
    Arc::new(move || {
        let mut made = made.lock().unwrap();
        *made += 1;
        let inner = pcm_encoder_factory()()?;
        let frames_left = if *made == 2 { 50 } else { usize::MAX };
        Ok(Box::new(Failing { inner, frames_left }) as Box<dyn FrameEncoder>)
    })
}

#[test]
fn a_track_whose_writer_failed_keeps_its_audio_and_the_rest_of_the_recording_when_it_stops() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup_with(second_encoder_fails());
    let prepared = setup.service.prepare(request(dir.path(), true)).unwrap();
    setup.service.begin().unwrap();
    setup.service.pause_recording().unwrap();
    setup.service.resume_recording().unwrap();
    setup.fake.handle(0).produce_ms(2_000);
    setup.fake.handle(1).produce_ms(2_000);
    wait_until(|| {
        setup
            .service
            .recording_status()
            .is_ok_and(|status| matches!(status.stop, Some(StopReason::WriterFailed { .. })))
    });

    let finished = setup.service.stop().unwrap();
    assert_eq!(finished.entry.state, RecordingState::Recovered);
    assert_eq!(finished.failures.len(), 1);
    assert_eq!(finished.failures[0].kind, TrackKind::SystemAudio);
    assert!(finished.failures[0].saved);
    assert!(
        finished.failures[0].message.contains("no space left"),
        "{:?}",
        finished.failures
    );
    assert_eq!(finished.summary.pauses.len(), 1, "the pauses are kept");
    let frames: Vec<u64> = finished
        .summary
        .tracks
        .iter()
        .map(|track| track.timeline.frames)
        .collect();
    assert_eq!(frames[0], 96_000);
    assert!((40_000..=48_000).contains(&frames[1]), "{frames:?}");
    assert_eq!(finished.assets.len(), 2);
    assert!(finished.assets.iter().all(|asset| asset.get("state").is_none()));
    // The failed track's file is closed, so it plays and a later recovery changes nothing.
    let system = &prepared.entry.tracks[1];
    let files = TrackFiles::new(dir.path(), &system.asset, TrackKind::SystemAudio).unwrap();
    let closed = recover_track(&files).unwrap();
    assert!(closed.was_complete && closed.bytes_cut == 0);
    assert_eq!(closed.timeline, finished.summary.tracks[1].timeline);
}

#[test]
fn a_finished_recording_opens_for_playback_with_the_map_the_screen_needs() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    setup.service.prepare(request(dir.path(), false)).unwrap();
    setup.service.begin().unwrap();
    setup.fake.handle(0).produce_ms(3_000);
    let finished = setup.service.stop().unwrap();

    let info = setup.service.open_playback(dir.path(), &finished.entry, None).unwrap();
    assert_eq!(info.duration_ns, 3 * SECOND);
    assert_eq!(info.map.duration_ns(), 3 * SECOND);
    assert_eq!(setup.service.playback_status().unwrap().state, PlayState::Paused);
    setup.service.set_speed(1.5).unwrap();
    setup.service.seek(SECOND).unwrap();
    setup.service.play().unwrap();
    wait_until(|| {
        setup
            .service
            .playback_status()
            .is_ok_and(|status| status.state == PlayState::Playing)
    });
    let output = setup.fake.output.lock().unwrap().clone().unwrap();
    let mut heard = false;
    wait_until(|| {
        heard |= output.pull(480).iter().any(|sample| *sample != 0.0);
        heard
    });
    setup.service.pause_playback().unwrap();
    setup.service.close_playback();
    assert!(setup.service.play().is_err());
}

#[test]
fn a_crash_leaves_an_entry_that_recovery_turns_into_a_saved_recording() {
    let dir = tempfile::tempdir().unwrap();
    let mut setup = setup();
    let prepared = setup.service.prepare(request(dir.path(), false)).unwrap();
    setup.service.begin().unwrap();
    let handle = setup.fake.handle(0);
    handle.produce_ms(2_000);
    wait_until(|| {
        setup
            .service
            .recording_status()
            .is_ok_and(|status| status.bytes > 4_000)
    });
    // Copy what is on disk as a crash would leave it, and then let the original finish.
    let crashed = tempfile::tempdir().unwrap();
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let path = entry.unwrap().path();
        std::fs::copy(&path, crashed.path().join(path.file_name().unwrap())).unwrap();
    }
    setup.service.stop().unwrap();

    let recovered = setup.service.recover(crashed.path(), &prepared.entry).unwrap();
    assert_eq!(recovered.entry.state, RecordingState::Recovered);
    assert!(recovered.summary.tracks[0].timeline.frames > 0);
    assert_eq!(recovered.assets.len(), 1);
    assert_eq!(recovered.assets[0].get("state"), None);
}

/// A page folder that the core's page store saves, as the app will.
struct PageFolder {
    store: PageStore,
    dir: PathBuf,
    page: Page,
    stamp: Option<FileStamp>,
}

impl PageFolder {
    /// The sample page in `root`, with its image on disk.
    fn new(root: &Path) -> Self {
        let dir = root.join("page");
        let page = sample_page();
        for asset in page.assets.values() {
            let path = NotebookLayout::asset_path(&dir, asset).unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, vec![7u8; asset.bytes as usize]).unwrap();
        }
        let store = PageStore::new(PageStoreConfig {
            fs: Arc::new(StdFs::new(&Timings::default())),
            codec: Arc::new(CanonicalCodec),
            clock: Arc::new(TestClock::new(Timestamp::from_unix_ms(1_800_000_000_000))),
            device: sample_device(),
            writer: "OpenNote test".into(),
            limits: Limits::default(),
        });
        PageFolder {
            store,
            dir,
            page,
            stamp: None,
        }
    }

    fn assets_dir(&self) -> PathBuf {
        self.dir.join("assets")
    }

    /// Puts the recording entry in `recordings` and the assets in the table, from the JSON that the
    /// service returns, as the screen will. The IDs in `remove` leave the page.
    fn put(&mut self, entry: &RecordingEntry, assets: &[Value], remove: &[String]) {
        let mut json: Value = serde_json::from_slice(&write_page(&self.page)).unwrap();
        let table = json["assets"].as_object_mut().unwrap();
        for id in remove {
            table.remove(id);
        }
        for asset in assets {
            let mut asset = asset.clone();
            let id = asset.as_object_mut().unwrap().remove("id").unwrap();
            table.insert(id.as_str().unwrap().to_owned(), asset);
        }
        let read = read_page(&serde_json::to_vec(&json).unwrap(), &Limits::default()).unwrap();
        self.page.assets = read.page.assets;
        let mut items: Vec<Value> = self
            .page
            .recordings
            .take()
            .and_then(|items| items.as_array().cloned())
            .unwrap_or_default();
        items.retain(|item| item["id"] != entry.id.as_str());
        if !remove.contains(&entry.id) {
            items.push(entry.to_json());
        }
        self.page.recordings = Some(Value::Array(items));
    }

    fn save(&mut self) -> Result<(), SaveError> {
        let pending = self.page.ink.pending().len();
        let outcome = self.store.save(
            &self.dir,
            SaveRequest {
                page: &self.page,
                pending: self.page.ink.pending(),
                through_seq: 0,
                base_stamp: self.stamp,
                journal: None,
                compaction: CompactionPlan::None,
            },
        )?;
        self.page.revision = outcome.revision.clone();
        self.page
            .ink
            .commit(pending, outcome.segments.clone(), outcome.dead_bytes);
        self.stamp = Some(outcome.stamp);
        Ok(())
    }
}

#[test]
fn every_save_of_the_page_works_while_a_recording_starts_runs_and_stops() {
    let root = tempfile::tempdir().unwrap();
    let mut folder = PageFolder::new(root.path());
    let mut setup = setup();

    // The entry and the growing assets are saved before any audio file exists.
    let prepared = setup.service.prepare(request(&folder.assets_dir(), false)).unwrap();
    folder.put(&prepared.entry, &prepared.assets, &[]);
    folder.save().expect("the save before the recording begins");

    let begun = setup.service.begin().unwrap();
    folder.put(&begun, &[], &[]);
    folder.save().expect("the save that adds the clock anchor");
    setup.fake.handle(0).produce_ms(2_000);
    wait_until(|| {
        setup
            .service
            .recording_status()
            .is_ok_and(|status| status.bytes > 4_000)
    });
    folder.page.title = "Notes taken while recording".into();
    folder.save().expect("an autosave while the file grows");
    let loaded = folder.store.load(&folder.dir).unwrap();
    assert!(loaded.missing.is_empty(), "{:?}", loaded.missing);
    assert!(!loaded.page.format.access.is_read_only());

    let finished = setup.service.stop().unwrap();
    folder.put(&finished.entry, &finished.assets, &[]);
    folder.save().expect("the save of the finished recording");
    let loaded = folder.store.load(&folder.dir).unwrap();
    let asset = &loaded.page.assets[&AssetId::parse(&prepared.entry.tracks[0].asset).unwrap()];
    assert!(!asset.is_recording());
    assert!(asset.bytes > 4_000);
    assert!(loaded.missing.is_empty() && !loaded.page.format.access.is_read_only());
}

#[test]
fn a_recording_that_cannot_begin_says_what_the_page_removes() {
    let root = tempfile::tempdir().unwrap();
    let mut folder = PageFolder::new(root.path());
    let mut setup = setup();
    let prepared = setup.service.prepare(request(&folder.assets_dir(), false)).unwrap();
    folder.put(&prepared.entry, &prepared.assets, &[]);
    folder.save().unwrap();

    *setup.fake.broken.lock().unwrap() = true;
    let failed = setup.service.begin().unwrap_err();
    assert!(failed.to_string().contains("microphone is gone"), "{failed}");
    let discard = failed.discard.expect("the prepared recording");
    assert_eq!(discard, prepared.discard());
    assert_eq!(
        std::fs::read_dir(folder.assets_dir()).unwrap().count(),
        1,
        "only the image"
    );

    let mut remove = discard.assets.clone();
    remove.push(discard.entry.clone());
    folder.put(&prepared.entry, &[], &remove);
    folder.save().unwrap();
    let loaded = folder.store.load(&folder.dir).unwrap().page;
    assert_eq!(loaded.assets.len(), 1);
    assert_eq!(loaded.recordings, Some(Value::Array(Vec::new())));
    // Nothing is left pending, so another begin needs another prepare.
    assert!(setup.service.begin().unwrap_err().discard.is_none());
}
