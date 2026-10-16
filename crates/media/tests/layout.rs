//! A recording in a page of the note format: names that pass the asset rules, asset entries, and a
//! `recordings` entry that the core keeps through a save and a load.

mod common;

use std::path::Path;

use common::{noise, pcm_recorder, SECOND};
use opennote_core::format::names::check_asset_file_name;
use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::testing::sample::sample_page;
use opennote_core::{AssetId, Limits, SystemClock, Timestamp};
use opennote_media::audio::recovery::recover_recording;
use opennote_media::audio::synthetic::{synthetic, ManualClock, SyntheticHandle};
use opennote_media::audio::{AudioSource, SourceFormat, TrackFiles, TrackKind};
use opennote_media::layout::{asset_entry, audio_file_name, RecordingEntry, RecordingPlan, RecordingState};
use opennote_media::pcm_codec::pcm_decoder_factory;
use opennote_media::playback::open_recording;
use sha2::{Digest, Sha256};

const START: u64 = 5 * SECOND;
const MONO: SourceFormat = SourceFormat {
    rate: 48_000,
    channels: 1,
};

fn plan() -> RecordingPlan {
    RecordingPlan::generate(&[TrackKind::Microphone, TrackKind::SystemAudio], &SystemClock::new())
}

type Sources = Vec<(TrackKind, Box<dyn AudioSource>)>;

fn sources() -> (Sources, [SyntheticHandle; 2]) {
    let (mic, mic_handle) = synthetic(MONO, noise(), START);
    let (system, system_handle) = synthetic(MONO, noise(), START);
    let sources: Sources = vec![
        (TrackKind::Microphone, Box::new(mic)),
        (TrackKind::SystemAudio, Box::new(system)),
    ];
    (sources, [mic_handle, system_handle])
}

#[test]
fn track_files_are_assets_that_garbage_collection_treats_as_assets() {
    let plan = plan();
    for track in &plan.tracks {
        let id = AssetId::parse(&track.asset).unwrap();
        let name = audio_file_name(&track.asset, track.kind).unwrap();
        assert!(check_asset_file_name(id, &name), "{name}");
        // The recorder writes the same name, and the timeline file starts with the same ID.
        let files = TrackFiles::new(Path::new("assets"), &track.asset, track.kind).unwrap();
        assert_eq!(files.audio.file_name().unwrap().to_str().unwrap(), name);
        let timeline = files.timeline.file_name().unwrap().to_str().unwrap().to_owned();
        assert!(
            timeline.starts_with(&track.asset) && timeline.ends_with(".timeline"),
            "{timeline}"
        );
    }
    assert!(audio_file_name("not-an-id", TrackKind::Microphone).is_err());
    assert_ne!(plan.tracks[0].asset, plan.tracks[1].asset);
}

#[test]
fn a_recording_goes_through_a_page_and_plays_back() {
    let dir = tempfile::tempdir().unwrap();
    let plan = plan();
    let clock = ManualClock::new(START);
    let recorder = pcm_recorder(dir.path(), clock);

    // Before recording: the entry and the growing assets are saved first.
    let mut starting = RecordingEntry::starting(&plan, Timestamp::from_unix_ms(1_800_000_000_000));
    starting.extra.insert(
        "flags".into(),
        serde_json::json!([{ "id": "f1", "label": "Key point" }]),
    );
    assert_eq!(starting.state, RecordingState::Recording);
    let growing = asset_entry(dir.path(), &plan.tracks[0], Timestamp::from_unix_ms(1), true).unwrap();
    assert_eq!(growing.extra["state"], "recording");

    let (sources, handles) = sources();
    let recording = plan.start(&recorder, sources).unwrap();
    handles[0].produce_ms(2_000);
    handles[1].produce_ms(1_000);
    let summary = recording.stop().unwrap();

    let entry = RecordingEntry::from_summary(&summary, Some(&starting));
    assert_eq!(entry.state, RecordingState::Complete);
    assert_eq!(entry.extra["flags"][0]["label"], "Key point");
    let mut page = sample_page();
    page.recordings = Some(serde_json::json!([entry.to_json()]));
    for track in &plan.tracks {
        let asset = asset_entry(dir.path(), track, Timestamp::from_unix_ms(1), false).unwrap();
        assert!(!asset.extra.contains_key("state"));
        page.assets.insert(asset.id, asset);
    }

    // The core saves and loads the page, and keeps the recordings entry as it is.
    let bytes = write_page(&page);
    let loaded = read_page(&bytes, &Limits::default()).unwrap().page;
    assert_eq!(loaded.recordings, page.recordings);
    let items = loaded.recordings.unwrap();
    let back: RecordingEntry = serde_json::from_value(items[0].clone()).unwrap();
    assert_eq!(back, entry);

    // The entry alone is enough to play the recording.
    let mut player = open_recording(dir.path(), &back.summary().unwrap(), &pcm_decoder_factory()).unwrap();
    assert_eq!(player.duration_ns(), 2 * SECOND);
    let mut audio = vec![0.0; 96_000];
    assert_eq!(player.render(&mut audio).unwrap(), 96_000);
}

#[test]
fn a_finished_asset_has_the_real_size_and_hash() {
    let dir = tempfile::tempdir().unwrap();
    let plan = plan();
    let (sources, handles) = sources();
    let recording = plan
        .start(&pcm_recorder(dir.path(), ManualClock::new(START)), sources)
        .unwrap();
    handles[0].produce_ms(500);
    handles[1].produce_ms(500);
    let summary = recording.stop().unwrap();

    let track = &plan.tracks[0];
    let asset = asset_entry(dir.path(), track, Timestamp::from_unix_ms(7), false).unwrap();
    let bytes = std::fs::read(dir.path().join(&summary.tracks[0].audio_file)).unwrap();
    assert_eq!(asset.bytes, bytes.len() as u64);
    assert_eq!(asset.sha256.as_slice(), Sha256::digest(&bytes).as_slice());
    assert_eq!((asset.mime.as_str(), asset.name.as_str()), ("audio/ogg", "mic.ogg"));
    assert_eq!(asset.file, summary.tracks[0].audio_file);
}

#[test]
fn an_entry_left_in_the_recording_state_names_the_files_to_recover() {
    let dir = tempfile::tempdir().unwrap();
    let plan = plan();
    let (sources, handles) = sources();
    let recording = plan
        .start(&pcm_recorder(dir.path(), ManualClock::new(START)), sources)
        .unwrap();
    handles[0].produce_ms(1_000);
    handles[1].produce_ms(1_000);
    common::wait_until(|| recording.health().iter().all(|track| track.frames == 48_000));
    // Copy the files as a crash would leave them, while the recording is still open.
    let crashed = tempfile::tempdir().unwrap();
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let path = entry.unwrap().path();
        std::fs::copy(&path, crashed.path().join(path.file_name().unwrap())).unwrap();
    }
    recording.stop().unwrap();

    let starting = RecordingEntry::starting(&plan, Timestamp::from_unix_ms(1_800_000_000_000));
    let restored = RecordingPlan::from_entry(&starting);
    assert_eq!(restored, plan);
    let recovered = recover_recording(crashed.path(), &restored.id, &restored.tracks).unwrap();
    let entry = RecordingEntry::from_summary(&recovered.summary, Some(&starting));
    assert_eq!(entry.state, RecordingState::Recovered);
    assert_eq!(entry.tracks.len(), 2);
    assert!(entry.summary().is_ok());
}

#[test]
fn an_edit_planned_to_replace_a_recording_keeps_its_id_and_its_flags() {
    let dir = tempfile::tempdir().unwrap();
    let plan = plan();
    let (sources, handles) = sources();
    let recording = plan
        .start(&pcm_recorder(dir.path(), ManualClock::new(START)), sources)
        .unwrap();
    handles[0].produce_ms(2_000);
    handles[1].produce_ms(2_000);
    let summary = recording.stop().unwrap();
    let mut entry = RecordingEntry::from_summary(&summary, None);
    entry.extra.insert(
        "flags".into(),
        serde_json::json!([{ "id": "f1", "recording": entry.id, "captureNs": START, "label": "" }]),
    );

    let output = RecordingPlan::replacing(&summary, &SystemClock::new());
    assert_eq!(output.id, summary.id);
    for (new, old) in output.tracks.iter().zip(&plan.tracks) {
        assert_eq!(new.kind, old.kind);
        assert_ne!(new.asset, old.asset, "assets never change, so the edit writes new ones");
        assert!(audio_file_name(&new.asset, new.kind).is_ok());
    }
    let trimmed = opennote_media::edit::keep(dir.path(), &summary, &[(0, SECOND)], &output).unwrap();
    let edited = RecordingEntry::from_summary(&trimmed, Some(&entry));
    assert_eq!(edited.id, entry.id);
    assert_eq!(edited.extra["flags"][0]["recording"], entry.id.as_str());
}

#[test]
fn an_entry_without_a_clock_cannot_be_played_yet() {
    let starting = RecordingEntry::starting(&plan(), Timestamp::from_unix_ms(0));
    assert!(starting.summary().is_err());
}
