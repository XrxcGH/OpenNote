//! The watcher behind the meeting prompt. The interface asks every few seconds, passing the person's choices, and the
//! watcher answers with the app that has just started a call, once per call. It reads only which apps use the
//! microphone, never what is said, and reads nothing at all while the setting is off.

use std::{
    sync::{Mutex, OnceLock, PoisonError},
    time::Instant,
};

use opennote_media::meeting::{MeetingSettings, MeetingWatcher, MicrophoneUsers};
use serde::Serialize;

use crate::ipc::{codes, IpcError, IpcResult};

/// The offer: the app whose call it is.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPrompt {
    pub app: String,
}

#[cfg(windows)]
fn users() -> Box<dyn MicrophoneUsers> {
    Box::<opennote_media::meeting::registry::RegistryUsers>::default()
}

/// Other systems have no record to read yet, so nothing is ever offered.
#[cfg(not(windows))]
fn users() -> Box<dyn MicrophoneUsers> {
    struct Nobody;
    impl MicrophoneUsers for Nobody {
        fn current(&mut self) -> opennote_media::audio::Result<Vec<String>> {
            Ok(Vec::new())
        }
    }
    Box::new(Nobody)
}

struct Watch {
    watcher: MeetingWatcher,
    started: Instant,
}

fn watch() -> &'static Mutex<Watch> {
    static WATCH: OnceLock<Mutex<Watch>> = OnceLock::new();
    WATCH.get_or_init(|| {
        let exe = std::env::current_exe()
            .ok()
            .and_then(|path| path.file_stem().map(|stem| stem.to_string_lossy().into_owned()))
            .unwrap_or_default();
        let own = ["opennote", exe.as_str()];
        Mutex::new(Watch {
            watcher: MeetingWatcher::new(MeetingSettings::default(), users(), &own),
            started: Instant::now(),
        })
    })
}

/// Looks at who uses the microphone. `enabled` and `never_for` are the person's choices, and `recording` says
/// whether a recording runs, which keeps the prompt quiet.
#[tauri::command]
pub async fn audio_meeting_poll(enabled: bool, never_for: Vec<String>, recording: bool) -> IpcResult<Option<MeetingPrompt>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = watch().lock().unwrap_or_else(PoisonError::into_inner);
        guard.watcher.apply(MeetingSettings { enabled, never_for });
        guard.watcher.set_recording(recording);
        let now = u64::try_from(guard.started.elapsed().as_nanos()).unwrap_or(u64::MAX);
        guard
            .watcher
            .poll(now)
            .map(|prompt| prompt.map(|prompt| MeetingPrompt { app: prompt.app }))
            .map_err(crate::audio::audio_error)
    })
    .await
    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}
