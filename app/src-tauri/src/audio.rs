//! Audio recording and playback for the interface (Phase 9; ADR 0007). The media crate does the work; this module
//! is the Tauri side of its service: one [`AudioService`] in the app's state, one command for each of its methods
//! (the interface's `hostOver` names them `audio_<method>`), and a few commands that edit a finished recording.
//!
//! Recordings are assets of the page, in the page's own folder in the notes folder (`<notebook>/<section>/<page>/
//! assets/<asset ID>-mic.ogg`, with a timeline file beside it), so they travel with the notes. The page keeps each
//! recording's entry in its view, under `recordings`, with a block of type `ext:org.opennote/recording` to say where
//! the recording sits. The core can't edit a block of a type it doesn't know, but it edits and keeps the view.
//!
//! The media crate writes the files, and the core owns the page's asset table. Before the interface saves an entry
//! that makes or changes tracks, it calls `audio_adopt_tracks`. That hands the open page an entry for each track
//! (`adopt_asset`), and the interface's `addAsset` edit puts them in the table. A track that is still growing is
//! marked `state: recording`, and the core's size and hash checks skip it. The entry written when the recording
//! stops replaces it. Without a table entry, the core's garbage collection would delete the file at 30 days.
//!
//! The interface asks for a page's folder with `audio_assets_dir`. Every command that takes a folder checks that it
//! is the `assets` folder of a page in an open notebook.

use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
};

use opennote_core::{
    store::layout::{NotebookLayout, ASSETS_DIR},
    PageId, SystemClock,
};
use opennote_media::{
    audio::{AudioError, DeviceInfo, RecordingSummary, Resolution},
    edit::{self, Range},
    layout::{asset_entry, RecordingEntry, RecordingPlan},
    service::{
        AudioService, ClockReading, Finished, PlaybackInfo, PlaybackStatus, Prepared, RecordingStatus, Services,
        StartRequest,
    },
    storage,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    core_bridge::{Bridge, CoreBridge},
    ipc::{codes, IpcError, IpcResult},
    paths::Paths,
};

/// The error codes the interface maps to messages (`audio.errors` in the strings).
pub mod error_codes {
    pub const DEVICE: &str = "audioDevice";
    pub const ENCODER: &str = "audioEncoder";
    pub const FORMAT: &str = "audioFormat";
    pub const CORRUPT: &str = "audioCorrupt";
    pub const WRITER: &str = "audioWriter";
    /// The recording asked to be recovered is the one running now, perhaps in another window.
    pub const RUNNING: &str = "audioRunning";
}

struct Inner {
    services: Services,
    service: Mutex<AudioService>,
}

/// The managed state behind the audio commands.
#[derive(Clone)]
pub struct AudioState(Arc<Inner>);

impl AudioState {
    /// The real devices.
    pub fn new(_paths: &Paths) -> AudioState {
        Self::with(Services::system(Arc::new(SystemClock::new())))
    }

    /// Any services, for tests.
    pub fn with(services: Services) -> AudioState {
        AudioState(Arc::new(Inner {
            service: Mutex::new(AudioService::new(services.clone())),
            services,
        }))
    }

    /// The devices, clocks, and codecs the commands run on, for the commands in `audio_more`.
    pub(crate) fn services(&self) -> &Services {
        &self.0.services
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, AudioService> {
        self.0.service.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stops a recording that is still running, so its files close cleanly. The app calls it on exit.
    pub fn shutdown(&self) {
        let mut service = self.lock();
        if service.recording_status().is_ok() {
            if let Err(error) = service.stop() {
                ::log::error!("Couldn't close the recording on exit: {error}");
            }
        }
        service.close_playback();
    }
}

/// The `assets` folder of a page of an open notebook, as the core lays it out. It may not exist yet.
pub(crate) fn page_assets_dir(bridge: &Bridge, page: PageId) -> Option<PathBuf> {
    let (notebook, _) = bridge.core.find_node(page.0)?;
    let tree = notebook.tree();
    let (section, _) = tree.find_page(page)?;
    Some(
        NotebookLayout::new(notebook.path())
            .page_dir(section.id, page)
            .join(ASSETS_DIR),
    )
}

/// The folder of a page's recordings: the page's own `assets` folder, made if it is not there.
fn assets_dir(bridge: &Bridge, page: &str) -> IpcResult<PathBuf> {
    let id = PageId::parse(page).map_err(|_| IpcError::invalid("page", "That isn't a page ID."))?;
    let dir = page_assets_dir(bridge, id).ok_or_else(|| IpcError::new("notFound", "That page isn't in a notebook."))?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// A folder from the interface, if it is the `assets` folder of a page of an open notebook, with the page.
pub(crate) fn checked_dir(bridge: &Bridge, dir: &str) -> IpcResult<(PathBuf, PageId)> {
    let path = PathBuf::from(dir);
    let plain = path
        .components()
        .all(|part| !matches!(part, Component::ParentDir | Component::CurDir));
    let page = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .and_then(|name| PageId::parse(name).ok());
    let wrong = || IpcError::invalid("assetsDir", "That isn't a folder of recordings.");
    let page = page.filter(|_| plain).ok_or_else(wrong)?;
    match page_assets_dir(bridge, page) {
        Some(expected) if crate::notes::same_path(&expected, &path) => Ok((expected, page)),
        _ => Err(wrong()),
    }
}

/// An asset table entry for each track of `entry`, as the files in `dir` are now. `growing` says the files are
/// still being written. It reads the finished files to hash them, so it runs off the async runtime's threads.
pub(crate) fn track_assets(
    services: &Services,
    dir: &Path,
    entry: &RecordingEntry,
    growing: bool,
) -> IpcResult<Vec<opennote_core::model::Asset>> {
    let created = services.session.now();
    RecordingPlan::from_entry(entry)
        .tracks
        .iter()
        .map(|track| asset_entry(dir, track, created, growing).map_err(audio_error))
        .collect()
}

/// Hands the open page its assets, for the interface's next `addAsset` edit.
fn adopt(bridge: &Bridge, page: PageId, assets: Vec<opennote_core::model::Asset>) -> IpcResult<()> {
    let handle = bridge
        .open
        .iter()
        .find(|((id, _), _)| *id == page)
        .map(|(_, handle)| handle.clone())
        .ok_or_else(|| IpcError::new("notFound", "This page isn't open."))?;
    for asset in assets {
        handle.adopt_asset(asset);
    }
    Ok(())
}

/// The audio error as the interface's error, with a code it has a message for.
pub fn audio_error(error: AudioError) -> IpcError {
    let code = match &error {
        AudioError::Io(_) => codes::IO,
        AudioError::Device(_) => error_codes::DEVICE,
        AudioError::Encoder(_) => error_codes::ENCODER,
        AudioError::Format(_) => error_codes::FORMAT,
        AudioError::Corrupt(_) => error_codes::CORRUPT,
        AudioError::Writer(_) => error_codes::WRITER,
    };
    IpcError::new(code, error.to_string())
}

pub(crate) fn blocking_failed(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::INTERNAL, error.to_string())
}

/// Runs slow work, such as opening devices or copying a long recording, off the async runtime's threads.
pub(crate) async fn blocking<T: Send + 'static>(
    state: &AudioState,
    work: impl FnOnce(&AudioState) -> IpcResult<T> + Send + 'static,
) -> IpcResult<T> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || work(&state))
        .await
        .map_err(blocking_failed)?
}

#[tauri::command]
pub async fn audio_assets_dir(bridge: State<'_, CoreBridge>, page: String) -> IpcResult<String> {
    let dir = bridge.with(|bridge| assets_dir(bridge, &page))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn audio_devices(state: State<'_, AudioState>) -> IpcResult<Vec<DeviceInfo>> {
    blocking(&state, |state| state.lock().devices().map_err(audio_error)).await
}

#[tauri::command]
pub async fn audio_clock(state: State<'_, AudioState>) -> IpcResult<ClockReading> {
    Ok(state.lock().clock())
}

#[tauri::command]
pub async fn audio_prepare(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    mut request: StartRequest,
) -> IpcResult<Prepared> {
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &request.assets_dir.to_string_lossy()))?;
    request.assets_dir = dir;
    blocking(&state, move |state| state.lock().prepare(request).map_err(audio_error)).await
}

/// Hands the open page the tracks of an entry, as the files in its `assets` folder are now: growing, or finished.
/// The interface calls it just before the `addAsset` edits that put them in the page's table.
#[tauri::command]
pub async fn audio_adopt_tracks(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
    growing: bool,
) -> IpcResult<()> {
    let (dir, page) = bridge.with(|bridge| checked_dir(bridge, &assets_dir))?;
    let assets = blocking(&state, move |state| {
        track_assets(&state.0.services, &dir, &entry, growing)
    })
    .await?;
    bridge.with(|bridge| adopt(bridge, page, assets))
}

#[tauri::command]
pub async fn audio_begin(state: State<'_, AudioState>) -> IpcResult<RecordingEntry> {
    blocking(&state, |state| {
        state.lock().begin().map_err(|failed| audio_error(failed.error))
    })
    .await
}

#[tauri::command]
pub async fn audio_recording_status(state: State<'_, AudioState>) -> IpcResult<RecordingStatus> {
    state.lock().recording_status().map_err(audio_error)
}

#[tauri::command]
pub async fn audio_pause_recording(state: State<'_, AudioState>) -> IpcResult<()> {
    state.lock().pause_recording().map_err(audio_error)
}

#[tauri::command]
pub async fn audio_resume_recording(state: State<'_, AudioState>) -> IpcResult<()> {
    state.lock().resume_recording().map_err(audio_error)
}

#[tauri::command]
pub async fn audio_switch_microphone(state: State<'_, AudioState>, id: Option<String>) -> IpcResult<Resolution> {
    blocking(&state, move |state| {
        state.lock().switch_microphone(id).map_err(audio_error)
    })
    .await
}

#[tauri::command]
pub async fn audio_switch_system_audio(state: State<'_, AudioState>, id: Option<String>) -> IpcResult<Resolution> {
    blocking(&state, move |state| {
        state.lock().switch_system_audio(id).map_err(audio_error)
    })
    .await
}

#[tauri::command]
pub async fn audio_stop(state: State<'_, AudioState>) -> IpcResult<Finished> {
    blocking(&state, |state| state.lock().stop().map_err(audio_error)).await
}

#[tauri::command]
pub async fn audio_recover(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
) -> IpcResult<Finished> {
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &assets_dir))?;
    blocking(&state, move |state| recover_unless_running(&state.lock(), &dir, &entry)).await
}

/// Recovers a recording a crash cut off, or refuses with `audioRunning` when it is the one running now. Every
/// window shares this process's recorder but keeps its own idea of what records, so a page opened in a second
/// window while the first records it must learn that from here and leave the entry alone.
fn recover_unless_running(service: &AudioService, dir: &Path, entry: &RecordingEntry) -> IpcResult<Finished> {
    if service.is_running(&entry.id) {
        return Err(IpcError::new(
            error_codes::RUNNING,
            "This recording is still running. Its entry is saved when it stops.",
        ));
    }
    service.recover(dir, entry).map_err(audio_error)
}

#[tauri::command]
pub async fn audio_open_playback(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
    device: Option<String>,
) -> IpcResult<PlaybackInfo> {
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &assets_dir))?;
    blocking(&state, move |state| {
        state
            .lock()
            .open_playback(&dir, &entry, device.as_deref())
            .map_err(audio_error)
    })
    .await
}

#[tauri::command]
pub async fn audio_play(state: State<'_, AudioState>) -> IpcResult<()> {
    state.lock().play().map_err(audio_error)
}

#[tauri::command]
pub async fn audio_pause_playback(state: State<'_, AudioState>) -> IpcResult<()> {
    state.lock().pause_playback().map_err(audio_error)
}

#[tauri::command]
pub async fn audio_seek(state: State<'_, AudioState>, position_ns: u64) -> IpcResult<()> {
    state.lock().seek(position_ns).map_err(audio_error)
}

#[tauri::command]
pub async fn audio_skip(state: State<'_, AudioState>, delta_ns: i64) -> IpcResult<()> {
    state.lock().skip(delta_ns).map_err(audio_error)
}

#[tauri::command]
pub async fn audio_set_speed(state: State<'_, AudioState>, speed: f32) -> IpcResult<()> {
    state.lock().set_speed(speed).map_err(audio_error)
}

#[tauri::command]
pub async fn audio_set_skip_silence(state: State<'_, AudioState>, on: bool) -> IpcResult<()> {
    state.lock().set_skip_silence(on).map_err(audio_error)
}

#[tauri::command]
pub async fn audio_playback_status(state: State<'_, AudioState>) -> IpcResult<PlaybackStatus> {
    state.lock().playback_status().map_err(audio_error)
}

#[tauri::command]
pub async fn audio_close_playback(state: State<'_, AudioState>) -> IpcResult<()> {
    state.lock().close_playback();
    Ok(())
}

/// A finished edit: the entry that takes the old one's place in the page, and the length it now has.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edited {
    pub entry: RecordingEntry,
    pub duration_ns: u64,
}

pub(crate) fn edited(summary: &RecordingSummary, previous: &RecordingEntry) -> Edited {
    Edited {
        entry: RecordingEntry::from_summary(summary, Some(previous)),
        duration_ns: opennote_media::positions::PositionMap::from_summary(summary).duration_ns(),
    }
}

/// Trims the silence at the start and end. The answer is none when there is nothing worth trimming. The old
/// files stay until the page has saved the new entry and the interface calls `audio_delete_files`.
#[tauri::command]
pub async fn audio_trim_silence(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
) -> IpcResult<Option<Edited>> {
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &assets_dir))?;
    blocking(&state, move |state| {
        let services = &state.0.services;
        let summary = entry.summary().map_err(audio_error)?;
        let plan = RecordingPlan::replacing(&summary, services.session.as_ref());
        let trimmed = edit::trim_silence(&dir, &summary, &plan, &services.decoder).map_err(audio_error)?;
        Ok(trimmed.map(|summary| edited(&summary, &entry)))
    })
    .await
}

/// Removes the part between two positions of the audio, in nanoseconds. Notes keep their timing.
#[tauri::command]
pub async fn audio_remove_part(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
    start_ns: u64,
    end_ns: u64,
) -> IpcResult<Edited> {
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &assets_dir))?;
    if end_ns <= start_ns {
        return Err(IpcError::invalid("endNs", "The part to remove ends before it starts."));
    }
    blocking(&state, move |state| {
        let services = &state.0.services;
        let summary = entry.summary().map_err(audio_error)?;
        let plan = RecordingPlan::replacing(&summary, services.session.as_ref());
        let range: Range = (start_ns, end_ns);
        let removed = edit::remove(&dir, &summary, &[range], &plan).map_err(audio_error)?;
        Ok(edited(&removed, &entry))
    })
    .await
}

/// Deletes the audio and timeline files of a recording the page no longer lists, such as the one an edit
/// replaced. It answers with the bytes freed.
#[tauri::command]
pub async fn audio_delete_files(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
) -> IpcResult<u64> {
    let (dir, _) = bridge.with(|bridge| checked_dir(bridge, &assets_dir))?;
    blocking(&state, move |_| {
        let summary = entry.summary().map_err(audio_error)?;
        storage::delete_audio(&dir, &summary).map_err(audio_error)
    })
    .await
}

/// Closes a recording that is still running when the app exits.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AudioState>() {
        state.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opennote_core::ops::resolve::{Edit, TxnRequest};
    use opennote_media::audio::{AudioSource, FixedCatalog, TrackKind};
    use opennote_media::service::DeviceFactory;
    use serde_json::{json, Value};

    struct NoDevices;

    impl DeviceFactory for NoDevices {
        fn microphone(&self, _id: Option<&str>) -> opennote_media::audio::Result<Box<dyn AudioSource>> {
            Err(AudioError::Device("There is no microphone.".into()))
        }
        fn system_audio(&self, _id: Option<&str>) -> opennote_media::audio::Result<Box<dyn AudioSource>> {
            Err(AudioError::Device("There is no output.".into()))
        }
        fn output(
            &self,
            _id: Option<&str>,
        ) -> opennote_media::audio::Result<Box<dyn opennote_media::playback::AudioOutput>> {
            Err(AudioError::Device("There is no output.".into()))
        }
    }

    fn services() -> Services {
        let mut services = Services::system(Arc::new(SystemClock::new()));
        services.devices = Arc::new(NoDevices);
        services.catalog = Arc::new(FixedCatalog(Vec::new()));
        services
    }

    fn state() -> AudioState {
        AudioState::with(services())
    }

    /// A bridge over a temporary notes folder with one notebook, section, and page; the page's ID.
    fn a_page(dir: &Path) -> (CoreBridge, PathBuf, String) {
        let notes = dir.join("Notes");
        let bridge = CoreBridge::at(dir.join("local"));
        let page = bridge
            .notes(Some(notes.clone()), |bridge| {
                let create = |bridge: &mut Bridge, kind: &str, parent: Option<String>| {
                    let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                    let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                    Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
                };
                let notebook = create(bridge, "notebook", None)?;
                let section = create(bridge, "section", Some(notebook))?;
                let page = create(bridge, "page", Some(section))?;
                bridge.handle(&page, "main-1")?;
                Ok(page)
            })
            .expect("a page");
        (bridge, notes, page)
    }

    fn apply(bridge: &CoreBridge, notes: &Path, page: &str, seq: u64, edits: Value) -> IpcResult<()> {
        bridge.notes(Some(notes.to_path_buf()), |bridge| {
            let handle = bridge.open_handle(page, "main-1")?;
            let request = TxnRequest {
                page: handle.id(),
                client: handle.client().clone(),
                client_seq: seq,
                coalesce: None,
                ui: None,
                edits: serde_json::from_value::<Vec<Edit>>(edits).expect("edits"),
            };
            handle
                .apply(request)
                .map(|_| ())
                .map_err(|error| IpcError::new(error.code(), error.to_string()))?;
            handle
                .save_now()
                .map(|_| ())
                .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
        })
    }

    fn assets_of(bridge: &CoreBridge, notes: &Path, page: &str) -> Value {
        bridge
            .notes(Some(notes.to_path_buf()), |bridge| {
                let envelope = bridge
                    .open_handle(page, "main-1")?
                    .envelope(None)
                    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
                let decoded = opennote_core::wire::envelope::decode(&envelope.bytes)
                    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
                let page: Value = serde_json::from_slice(decoded.page_json).expect("page JSON");
                Ok(page["assets"].clone())
            })
            .expect("the page's assets")
    }

    #[test]
    fn the_folder_is_the_pages_own_assets_folder_in_the_notes_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (bridge, notes, page) = a_page(dir.path());
        let folder = bridge.with(|bridge| assets_dir(bridge, &page)).unwrap();
        assert!(folder.is_dir());
        assert!(folder.starts_with(&notes), "{folder:?} is in the notes folder");
        assert_eq!(folder.file_name().unwrap(), "assets");
        assert_eq!(folder.parent().unwrap().file_name().unwrap().to_str().unwrap(), page);
        bridge.shutdown();
    }

    #[test]
    fn only_the_assets_folder_of_a_page_of_an_open_notebook_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let (bridge, _notes, page) = a_page(dir.path());
        let folder = bridge.with(|bridge| assets_dir(bridge, &page)).unwrap();
        let accepted = bridge
            .with(|bridge| checked_dir(bridge, folder.to_str().unwrap()))
            .unwrap();
        assert_eq!(accepted.0, folder);
        assert_eq!(accepted.1.to_string(), page);
        let outside = tempfile::tempdir().unwrap();
        let escaping = format!("{}/../..", folder.display());
        let page_dir = folder.parent().unwrap().to_path_buf();
        let nested = folder.join("deeper");
        let elsewhere = outside.path().join(&page).join("assets");
        for bad in [
            page_dir.as_path(),
            nested.as_path(),
            outside.path(),
            elsewhere.as_path(),
            Path::new(&escaping),
            Path::new(""),
        ] {
            let error = bridge
                .with(|bridge| checked_dir(bridge, bad.to_str().unwrap()))
                .unwrap_err();
            assert_eq!(error.code, codes::INVALID, "{bad:?}");
        }
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:\\Windows", "not-a-page"] {
            let error = bridge.with(|bridge| assets_dir(bridge, bad)).unwrap_err();
            assert!(
                error.code == codes::INVALID || error.code == "notFound",
                "{bad:?}: {}",
                error.code
            );
        }
        bridge.shutdown();
    }

    /// The page's table lists a recording from its first save, and the finished entry replaces the growing one.
    #[test]
    fn a_recording_is_listed_in_the_page_table_while_it_grows_and_when_it_ends() {
        let dir = tempfile::tempdir().unwrap();
        let (bridge, notes, page) = a_page(dir.path());
        let audio = state();
        let folder = bridge.with(|bridge| assets_dir(bridge, &page)).unwrap();
        let checked = bridge
            .with(|bridge| checked_dir(bridge, folder.to_str().unwrap()))
            .unwrap();
        let plan = RecordingPlan::generate(&[TrackKind::Microphone], audio.0.services.session.as_ref());
        let entry = RecordingEntry::starting(&plan, audio.0.services.session.now());
        let asset = entry.tracks[0].asset.clone();
        let file = folder.join(format!("{asset}-mic.ogg"));

        // Before the file exists: the page saves with a growing entry.
        let growing = track_assets(&audio.0.services, &checked.0, &entry, true).unwrap();
        bridge.with(|bridge| adopt(bridge, checked.1, growing)).unwrap();
        apply(
            &bridge,
            &notes,
            &page,
            1,
            json!([{ "edit": "addAsset", "asset": asset }]),
        )
        .unwrap();
        let listed = assets_of(&bridge, &notes, &page);
        assert_eq!(listed[&asset]["state"], "recording");

        // The file grows, and the page still saves.
        fs::write(&file, vec![7u8; 100]).unwrap();
        apply(
            &bridge,
            &notes,
            &page,
            2,
            json!([{ "edit": "addAsset", "asset": asset }]),
        )
        .unwrap();

        // It ends: the finished entry has the real size and hash and no state.
        fs::write(&file, vec![7u8; 4096]).unwrap();
        let finished = track_assets(&audio.0.services, &checked.0, &entry, false).unwrap();
        bridge.with(|bridge| adopt(bridge, checked.1, finished)).unwrap();
        apply(
            &bridge,
            &notes,
            &page,
            3,
            json!([{ "edit": "addAsset", "asset": asset }]),
        )
        .unwrap();
        let done = assets_of(&bridge, &notes, &page);
        assert_eq!(done[&asset]["bytes"], 4096);
        assert!(done[&asset].get("state").is_none(), "{done}");
        assert!(file.is_file());
        bridge.shutdown();
    }

    /// F5-5: the interface gives up on a recording only for `audioCorrupt`, and leaves `audioRunning` alone, so a
    /// recording with no files must answer the first, and the codes must differ.
    #[test]
    fn a_recording_with_no_files_is_corrupt_and_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let entry: RecordingEntry = serde_json::from_value(json!({
            "id": "r1",
            "state": "recording",
            "started": "2026-10-07T12:00:00Z",
            "tracks": [],
        }))
        .expect("an entry");
        let state = state();
        let service = state.lock();
        assert!(!service.is_running(&entry.id));
        let error = recover_unless_running(&service, dir.path(), &entry).unwrap_err();
        assert_eq!(error.code, error_codes::CORRUPT, "{}", error.message);
        assert_ne!(error_codes::RUNNING, error_codes::CORRUPT);
    }

    #[test]
    fn audio_errors_get_codes_the_interface_has_messages_for() {
        let code = |error: AudioError| audio_error(error).code;
        assert_eq!(code(AudioError::Device(String::new())), error_codes::DEVICE);
        assert_eq!(code(AudioError::Encoder(String::new())), error_codes::ENCODER);
        assert_eq!(code(AudioError::Format(String::new())), error_codes::FORMAT);
        assert_eq!(code(AudioError::Corrupt(String::new())), error_codes::CORRUPT);
        assert_eq!(code(AudioError::Writer(String::new())), error_codes::WRITER);
        assert_eq!(code(AudioError::Io(std::io::Error::other("x"))), codes::IO);
    }

    /// The whole path on this PC's devices: record two seconds from the default microphone, stop, and play it.
    /// Run it with `cargo test -p opennote --lib real_microphone -- --ignored` on a PC with a microphone.
    #[test]
    #[ignore = "opens the real microphone and speakers"]
    fn the_real_microphone_records_and_plays_back() {
        let dir = tempfile::tempdir().unwrap();
        let (bridge, _notes, page) = a_page(dir.path());
        let state = AudioState::with(Services::system(Arc::new(SystemClock::new())));
        let assets = bridge.with(|bridge| assets_dir(bridge, &page)).unwrap();
        let mut service = state.lock();
        let request = StartRequest {
            assets_dir: assets.clone(),
            microphone: None,
            system_audio: false,
            system_device: None,
        };
        service.prepare(request).expect("a microphone to prepare");
        service.begin().expect("the microphone to open");
        std::thread::sleep(std::time::Duration::from_secs(2));
        let status = service.recording_status().unwrap();
        assert!(status.bytes > 0, "the recording grew");
        let finished = service.stop().unwrap();
        assert_eq!(finished.entry.state, opennote_media::layout::RecordingState::Complete);
        let info = service
            .open_playback(&assets, &finished.entry, None)
            .expect("the speakers to open");
        assert!(info.duration_ns > 1_500_000_000, "about two seconds were recorded");
        service.play().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let playing = service.playback_status().unwrap();
        assert!(playing.position_ns > 0, "playback moved");
        service.close_playback();
    }

    #[test]
    fn nothing_runs_until_a_recording_begins() {
        let state = state();
        assert!(state.lock().recording_status().is_err());
        assert!(state.lock().begin().is_err());
        state.shutdown();
    }
}
