//! The commands of the audio lane's later features (quality of life after Phase 9).
//!
//! They split a recording, make a voice-enhanced copy, and compress a recording. They list what recordings take and
//! export a recording as audio. They turn a dropped audio or video file into a recording. They snap the screen and
//! run the meeting prompt's watcher. `audio.rs` has the recording and playback commands. The media crate pieces
//! that these use are described in `crates/media/src`.
//!
//! An edit writes new files and leaves the old ones, as in `audio.rs`: the interface saves the page with the new entry
//! and then calls `audio_delete_files` for the old one.

mod decode;
pub mod meeting;
pub mod snap;

use std::{
    fs,
    path::{Path, PathBuf},
};

use opennote_core::{
    session::notebook::HistoryScope, store::layout::NotebookLayout, store::layout::ASSETS_DIR, PageId,
};
use opennote_media::{
    audio::{ClockAnchor, TrackKind},
    convert::{self, Quality, Settings},
    edit,
    layout::{RecordingEntry, RecordingPlan},
    positions::PositionMap,
    storage,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::InvokeBody, State};

use crate::{
    audio::{audio_error, blocking, checked_dir, edited, AudioState, Edited},
    core_bridge::CoreBridge,
    images::import::percent_decode,
    ipc::{codes, IpcError, IpcResult},
    page_export::ExportGrants,
};

fn quality_of(name: &str) -> Quality {
    if name == "smallest" {
        Quality::Smallest
    } else {
        Quality::Smaller
    }
}

/// A recording split in two. The first half keeps the recording's ID, and the second is a new recording.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    pub first: Edited,
    pub second: Edited,
}

/// Splits a recording at a position, in nanoseconds into the audio.
#[tauri::command]
pub async fn audio_split(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
    at_ns: u64,
) -> IpcResult<Split> {
    let (dir, _) = bridge
        .run(move |bridge| bridge.with(|bridge| checked_dir(bridge, &assets_dir)))
        .await?;
    blocking(&state, move |state| {
        let services = state.services();
        let summary = entry.summary().map_err(audio_error)?;
        let kinds: Vec<TrackKind> = summary.tracks.iter().map(|track| track.kind).collect();
        let first = RecordingPlan::replacing(&summary, services.session.as_ref());
        let second = RecordingPlan::generate(&kinds, services.session.as_ref());
        let [a, b] = edit::split(&dir, &summary, at_ns, [&first, &second]).map_err(audio_error)?;
        Ok(Split {
            first: edited(&a, &entry),
            second: edited(&b, &entry),
        })
    })
    .await
}

/// A copy of the recording with the noise reduced and the voice leveled. The tracks of the answer are the copy's;
/// the interface keeps them beside the original's, and the original stays.
#[tauri::command]
pub async fn audio_enhance(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
) -> IpcResult<Edited> {
    let (dir, _) = bridge
        .run(move |bridge| bridge.with(|bridge| checked_dir(bridge, &assets_dir)))
        .await?;
    blocking(&state, move |state| {
        let services = state.services();
        let summary = entry.summary().map_err(audio_error)?;
        let plan = RecordingPlan::replacing(&summary, services.session.as_ref());
        let copy = convert::enhance(
            &dir,
            &summary,
            &plan,
            &services.decoder,
            &services.encoder,
            Settings::default(),
        )
        .map_err(audio_error)?;
        Ok(edited(&copy, &entry))
    })
    .await
}

/// A smaller copy of the recording that takes the original's place.
#[tauri::command]
pub async fn audio_compress(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    assets_dir: String,
    entry: RecordingEntry,
    quality: String,
) -> IpcResult<Edited> {
    let (dir, _) = bridge
        .run(move |bridge| bridge.with(|bridge| checked_dir(bridge, &assets_dir)))
        .await?;
    blocking(&state, move |state| {
        let services = state.services();
        let summary = entry.summary().map_err(audio_error)?;
        let plan = RecordingPlan::replacing(&summary, services.session.as_ref());
        let copy =
            convert::compress(&dir, &summary, &plan, &services.decoder, quality_of(&quality)).map_err(audio_error)?;
        Ok(edited(&copy, &entry))
    })
    .await
}

/// One recording in the storage list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    pub notebook: String,
    pub section: String,
    pub page: String,
    pub page_title: String,
    pub assets_dir: String,
    pub entry: RecordingEntry,
    pub duration_ns: u64,
    /// The audio and timeline files together.
    pub bytes: u64,
    pub frees_smaller: u64,
    pub frees_smallest: u64,
}

/// What every recording of every open notebook takes, largest first. Pages in locked sections are left out.
#[tauri::command]
pub async fn audio_storage_scan(state: State<'_, AudioState>, bridge: State<'_, CoreBridge>) -> IpcResult<Vec<Stored>> {
    let notebooks = bridge.run(|bridge| Ok(bridge.notebooks())).await?;
    blocking(&state, move |_| {
        let mut found = Vec::new();
        for notebook in notebooks {
            let tree = notebook.tree();
            let layout = NotebookLayout::new(notebook.path());
            for section in tree.sections.iter().filter(|section| !section.encrypted) {
                for page in &section.pages {
                    let page_dir = layout.page_dir(section.id, page.id);
                    let assets = page_dir.join(ASSETS_DIR);
                    if !assets.is_dir() {
                        continue;
                    }
                    for entry in recordings_of(&page_dir) {
                        let Ok(summary) = entry.summary() else { continue };
                        let usage = storage::usage(&assets, &summary);
                        found.push(Stored {
                            notebook: tree.title.clone(),
                            section: section.title.clone(),
                            page: page.id.to_string(),
                            page_title: page.title.clone(),
                            assets_dir: assets.to_string_lossy().into_owned(),
                            duration_ns: usage.duration_ns,
                            bytes: usage.total_bytes,
                            frees_smaller: storage::space_freed_by_compressing(&assets, &summary, Quality::Smaller),
                            frees_smallest: storage::space_freed_by_compressing(&assets, &summary, Quality::Smallest),
                            entry,
                        });
                    }
                }
            }
        }
        found.sort_by_key(|stored| std::cmp::Reverse(stored.bytes));
        Ok(found)
    })
    .await
}

/// The finished recordings in a page's `page.json`, which keeps them in its view.
fn recordings_of(page_dir: &Path) -> Vec<RecordingEntry> {
    let Ok(text) = fs::read_to_string(NotebookLayout::page_json(page_dir)) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    json.pointer("/view/recordings")
        .and_then(Value::as_object)
        .map(|held| {
            held.values()
                .filter_map(|value| serde_json::from_value::<RecordingEntry>(value.clone()).ok())
                .filter(|entry| !entry.tracks.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Deletes a page's saved versions, so audio taken out of the page can't be brought back from them. Named versions go
/// too, because one of them may hold the part that was removed.
#[tauri::command]
pub async fn audio_purge_history(bridge: State<'_, CoreBridge>, page: String) -> IpcResult<u32> {
    let id = PageId::parse(&page).map_err(|_| IpcError::invalid("page", "That isn't a page ID."))?;
    let notebook = bridge
        .run(move |bridge| {
            bridge.with(|bridge| {
                bridge
                    .core
                    .find_node(id.0)
                    .map(|(notebook, _)| notebook)
                    .ok_or_else(|| IpcError::new("notFound", "That page isn't in a notebook."))
            })
        })
        .await?;
    tauri::async_runtime::spawn_blocking(move || {
        notebook
            .delete_history(HistoryScope::Page(id), false)
            .map(|deleted| deleted.versions)
            .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
    })
    .await
    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}

/// Saves a recording as one audio file at a path that `export_pick_save` chose. The format is `wav` or `opus`. It
/// answers with the size of the file.
#[tauri::command]
pub async fn audio_export(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    grants: State<'_, ExportGrants>,
    assets_dir: String,
    entry: RecordingEntry,
    dest: String,
    format: String,
) -> IpcResult<u64> {
    let (dir, _) = bridge
        .run(move |bridge| bridge.with(|bridge| checked_dir(bridge, &assets_dir)))
        .await?;
    let dest = PathBuf::from(dest);
    if !grants.take(&dest) {
        return Err(IpcError::invalid("dest", "Choose where to save before exporting."));
    }
    let size = blocking(&state, move |state| {
        let services = state.services();
        let summary = entry.summary().map_err(audio_error)?;
        // The file is written beside the chosen one and moved over it, so a failure leaves the old file alone.
        let temp = dest.with_extension("opennote-part");
        let _ = fs::remove_file(&temp);
        let written = match format.as_str() {
            "wav" => convert::export_wav(&dir, &summary, &services.decoder, &temp),
            "opus" => convert::export_opus(&dir, &summary, &services.decoder, &services.encoder, &temp),
            _ => {
                return Err(IpcError::invalid(
                    "format",
                    "That isn't an audio format OpenNote writes.",
                ))
            }
        }
        .map_err(audio_error)?;
        fs::rename(&temp, &dest).inspect_err(|_| {
            let _ = fs::remove_file(&temp);
        })?;
        Ok((written, dest))
    })
    .await?;
    grants.mark_written(size.1);
    Ok(size.0)
}

/// What an imported file made.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub entry: RecordingEntry,
    pub duration_ns: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportHeader {
    assets_dir: String,
    name: String,
}

/// The longest file that is turned into a recording: four hours of 48 kHz samples take 2.7 GB as floats.
const MAX_IMPORT_NS: u64 = 4 * 3_600 * 1_000_000_000;

/// Makes a recording of an audio or video file's sound. The body is the file's bytes and the `x-opennote-import`
/// header (percent-encoded JSON) names the page's `assets` folder and the file. The file is written beside the page's
/// recordings only while it is decoded.
#[tauri::command]
pub async fn audio_import_file(
    state: State<'_, AudioState>,
    bridge: State<'_, CoreBridge>,
    request: tauri::ipc::Request<'_>,
) -> IpcResult<Imported> {
    let header = request
        .headers()
        .get("x-opennote-import")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-import", "The import header is missing."))?;
    let header: ImportHeader = serde_json::from_str(&percent_decode(header))
        .map_err(|_| IpcError::invalid("x-opennote-import", "The import header isn't valid JSON."))?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The file must come as raw bytes.")),
    };
    let assets_dir = header.assets_dir.clone();
    let (dir, _) = bridge
        .run(move |bridge| bridge.with(|bridge| checked_dir(bridge, &assets_dir)))
        .await?;
    blocking(&state, move |state| {
        let services = state.services();
        let extension: String = Path::new(&header.name)
            .extension()
            .map(|ext| {
                ext.to_string_lossy()
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .take(5)
                    .collect()
            })
            .unwrap_or_default();
        let temp = dir.join(format!(".import-{}.{extension}", std::process::id()));
        fs::write(&temp, &body)?;
        let decoded = decode::decode_file(&temp, MAX_IMPORT_NS);
        let _ = fs::remove_file(&temp);
        let samples = decoded?;
        let plan = RecordingPlan::generate(&[TrackKind::Microphone], services.session.as_ref());
        let wall = opennote_media::layout::wall_clock(services.session.clone());
        let clock = ClockAnchor::now(services.clock.as_ref(), wall.as_ref());
        let summary = convert::import_pcm(&dir, &plan, samples, clock, clock.capture_ns, &services.encoder)
            .map_err(audio_error)?;
        Ok(Imported {
            entry: RecordingEntry::from_summary(&summary, None),
            duration_ns: PositionMap::from_summary(&summary).duration_ns(),
        })
    })
    .await
}
