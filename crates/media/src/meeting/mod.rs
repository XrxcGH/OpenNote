//! Meeting detection: notices that another app has started using the microphone, so the app can offer to
//! record the call.
//!
//! This is off by default and is turned on only in Settings. When it is on, it watches one thing: whether
//! another app is using the microphone, and which app. It never hears what is said and never records. It
//! only produces a [`Prompt`], and the person answers "Record this meeting", "Not now", or "Never for this
//! app". It asks once per call, and it stays quiet while a recording is already running.
//!
//! The watcher is a small state machine that a timer drives with [`MeetingWatcher::poll`]. Where the
//! names come from is a [`MicrophoneUsers`]. On Windows that is the registry, where the system keeps a
//! record of which apps hold the microphone (see [`registry`]).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::audio::Result;

#[cfg(windows)]
pub mod registry;

/// Use of the microphone must last this long before a prompt, so a quick check of the microphone does not
/// count as a call.
pub const SETTLE_NS: u64 = 3_000_000_000;
/// An app that stops using the microphone for this long has ended its call. The next use is a new call.
pub const CALL_ENDS_NS: u64 = 30_000_000_000;

/// The names of the apps that are using the microphone right now.
pub trait MicrophoneUsers: Send {
    fn current(&mut self) -> Result<Vec<String>>;
}

/// What the person chose in Settings. It is stored with the other settings.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingSettings {
    /// Off until the person turns it on.
    pub enabled: bool,
    /// Apps the person chose "Never for this app" for, in lowercase.
    pub never_for: Vec<String>,
}

/// An offer to record a meeting. The screen shows it with its three choices and a reminder to tell others
/// before recording.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub app: String,
}

struct Call {
    first_seen_ns: u64,
    last_seen_ns: u64,
    asked: bool,
}

pub struct MeetingWatcher {
    settings: MeetingSettings,
    users: Box<dyn MicrophoneUsers>,
    /// Apps whose use of the microphone is never a meeting, such as this app itself.
    own: Vec<String>,
    calls: HashMap<String, Call>,
    recording: bool,
}

impl MeetingWatcher {
    /// `own` lists the names this app goes by, so that its own recording is never taken for a meeting.
    pub fn new(settings: MeetingSettings, users: Box<dyn MicrophoneUsers>, own: &[&str]) -> Self {
        MeetingWatcher {
            settings,
            users,
            own: own.iter().map(|name| name.to_lowercase()).collect(),
            calls: HashMap::new(),
            recording: false,
        }
    }

    pub fn settings(&self) -> &MeetingSettings {
        &self.settings
    }

    /// Takes the person's choices as the screen holds them: whether detection is on, and the apps never to ask about.
    pub fn apply(&mut self, settings: MeetingSettings) {
        let enabled = settings.enabled;
        self.settings.never_for = settings.never_for.iter().map(|name| name.to_lowercase()).collect();
        self.set_enabled(enabled);
    }

    /// Turns detection on or off. Turning it off forgets the calls in progress.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.settings.enabled = enabled;
        if !enabled {
            self.calls.clear();
        }
    }

    /// Tells the watcher whether a recording is running. It never prompts during one, and it does not ask
    /// about a call that began before the recording ended.
    pub fn set_recording(&mut self, recording: bool) {
        self.recording = recording;
    }

    /// "Never for this app". The returned settings are what to save.
    pub fn never_for(&mut self, app: &str) -> &MeetingSettings {
        let name = app.to_lowercase();
        if !self.settings.never_for.contains(&name) {
            self.settings.never_for.push(name.clone());
        }
        self.calls.retain(|key, _| key.to_lowercase() != name);
        &self.settings
    }

    /// Takes "Never for this app" back.
    pub fn allow_again(&mut self, app: &str) -> &MeetingSettings {
        let name = app.to_lowercase();
        self.settings.never_for.retain(|never| *never != name);
        &self.settings
    }

    /// Looks at who is using the microphone at `now_ns` and returns a prompt if a call has just settled.
    /// When detection is off, it reads nothing at all.
    pub fn poll(&mut self, now_ns: u64) -> Result<Option<Prompt>> {
        if !self.settings.enabled {
            return Ok(None);
        }
        for name in self.users.current()? {
            let key = name.to_lowercase();
            if self.own.contains(&key) || self.settings.never_for.contains(&key) {
                continue;
            }
            let call = self.calls.entry(name).or_insert(Call {
                first_seen_ns: now_ns,
                last_seen_ns: now_ns,
                // A call that started during a recording is already being recorded.
                asked: self.recording,
            });
            call.last_seen_ns = now_ns;
            call.asked |= self.recording;
        }
        self.calls
            .retain(|_, call| now_ns.saturating_sub(call.last_seen_ns) <= CALL_ENDS_NS);
        if self.recording {
            return Ok(None);
        }
        let mut waiting: Vec<_> = self
            .calls
            .iter_mut()
            .filter(|(_, call)| {
                // Only an app that is using the microphone now, and has done so long enough.
                !call.asked && call.last_seen_ns == now_ns && now_ns.saturating_sub(call.first_seen_ns) >= SETTLE_NS
            })
            .collect();
        waiting.sort_by_key(|(name, call)| (call.first_seen_ns, (*name).clone()));
        Ok(waiting.into_iter().next().map(|(name, call)| {
            call.asked = true;
            Prompt { app: name.clone() }
        }))
    }
}

/// The name of an app from the key that Windows files its microphone use under. A desktop app's key is its
/// path with `#` for each backslash, and a packaged app's key is its package name with a publisher after
/// an underscore.
pub fn app_name_from_key(key: &str) -> String {
    let name = if key.contains('#') {
        let file = key.rsplit('#').next().unwrap_or(key);
        file.strip_suffix(".exe")
            .or_else(|| file.strip_suffix(".EXE"))
            .unwrap_or(file)
    } else {
        key.split('_').next().unwrap_or(key)
    };
    name.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const SECOND: u64 = 1_000_000_000;

    /// Who is using the microphone, which a test sets between polls.
    #[derive(Clone, Default)]
    struct Script(Arc<Mutex<Vec<String>>>);

    impl Script {
        fn set(&self, apps: &[&str]) {
            *self.0.lock().unwrap() = apps.iter().map(|app| (*app).to_owned()).collect();
        }
    }

    impl MicrophoneUsers for Script {
        fn current(&mut self) -> Result<Vec<String>> {
            Ok(self.0.lock().unwrap().clone())
        }
    }

    fn watcher(enabled: bool) -> (MeetingWatcher, Script) {
        let script = Script::default();
        let settings = MeetingSettings {
            enabled,
            ..MeetingSettings::default()
        };
        (
            MeetingWatcher::new(settings, Box::new(script.clone()), &["OpenNote"]),
            script,
        )
    }

    #[test]
    fn it_is_off_until_turned_on_and_then_reads_nothing_when_off() {
        assert!(!MeetingSettings::default().enabled);
        let (mut watcher, script) = watcher(false);
        script.set(&["Teams"]);
        assert_eq!(watcher.poll(100 * SECOND).unwrap(), None);
        watcher.set_enabled(true);
        assert_eq!(watcher.poll(101 * SECOND).unwrap(), None, "not settled yet");
    }

    #[test]
    fn a_call_prompts_once_after_it_settles() {
        let (mut watcher, script) = watcher(true);
        script.set(&["Teams"]);
        assert_eq!(watcher.poll(10 * SECOND).unwrap(), None);
        assert_eq!(watcher.poll(12 * SECOND).unwrap(), None);
        assert_eq!(watcher.poll(13 * SECOND).unwrap(), Some(Prompt { app: "Teams".into() }));
        // "Not now" is just not answering. The same call does not ask again.
        assert_eq!(watcher.poll(14 * SECOND).unwrap(), None);
        assert_eq!(watcher.poll(500 * SECOND).unwrap(), None);
    }

    #[test]
    fn a_brief_check_of_the_microphone_is_not_a_call() {
        let (mut watcher, script) = watcher(true);
        script.set(&["Teams"]);
        watcher.poll(10 * SECOND).unwrap();
        script.set(&[]);
        assert_eq!(watcher.poll(11 * SECOND).unwrap(), None);
        assert_eq!(watcher.poll(60 * SECOND).unwrap(), None);
    }

    #[test]
    fn the_same_app_in_a_later_call_asks_again() {
        let (mut watcher, script) = watcher(true);
        script.set(&["Zoom"]);
        watcher.poll(0).unwrap();
        assert!(watcher.poll(4 * SECOND).unwrap().is_some());
        script.set(&[]);
        watcher.poll(10 * SECOND).unwrap();
        watcher.poll(60 * SECOND).unwrap(); // the call ended more than 30 s ago
        script.set(&["Zoom"]);
        watcher.poll(100 * SECOND).unwrap();
        assert_eq!(watcher.poll(104 * SECOND).unwrap(), Some(Prompt { app: "Zoom".into() }));
    }

    #[test]
    fn a_short_drop_out_is_still_the_same_call() {
        let (mut watcher, script) = watcher(true);
        script.set(&["Meet"]);
        watcher.poll(0).unwrap();
        assert!(watcher.poll(4 * SECOND).unwrap().is_some());
        script.set(&[]);
        watcher.poll(10 * SECOND).unwrap();
        script.set(&["Meet"]);
        assert_eq!(watcher.poll(20 * SECOND).unwrap(), None);
    }

    #[test]
    fn it_never_asks_for_this_app_or_during_a_recording() {
        let (mut watcher, script) = watcher(true);
        script.set(&["OpenNote", "Skype"]);
        watcher.poll(0).unwrap();
        assert_eq!(watcher.poll(5 * SECOND).unwrap(), Some(Prompt { app: "Skype".into() }));
        assert_eq!(watcher.never_for("Skype").never_for, ["skype"]);
        script.set(&["Skype"]);
        watcher.poll(100 * SECOND).unwrap();
        assert_eq!(watcher.poll(110 * SECOND).unwrap(), None);
        assert!(watcher.allow_again("SKYPE").never_for.is_empty());

        watcher.set_recording(true);
        script.set(&["Discord"]);
        watcher.poll(200 * SECOND).unwrap();
        assert_eq!(watcher.poll(210 * SECOND).unwrap(), None);
        // The call began during the recording, so stopping does not turn it into a prompt.
        watcher.set_recording(false);
        assert_eq!(watcher.poll(220 * SECOND).unwrap(), None);
    }

    #[test]
    fn app_names_come_from_both_kinds_of_key() {
        assert_eq!(app_name_from_key("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(app_name_from_key("MSTeams_8wekyb3d8bbwe"), "MSTeams");
        assert_eq!(
            app_name_from_key("Microsoft.WindowsCamera_8wekyb3d8bbwe"),
            "Microsoft.WindowsCamera"
        );
    }

    #[test]
    fn settings_round_trip_as_json_with_defaults() {
        let saved = serde_json::to_string(&MeetingSettings {
            enabled: true,
            never_for: vec!["skype".into()],
        })
        .unwrap();
        assert_eq!(saved, r#"{"enabled":true,"neverFor":["skype"]}"#);
        let empty: MeetingSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, MeetingSettings::default());
    }
}
