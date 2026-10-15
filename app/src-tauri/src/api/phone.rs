//! Insert > From phone in the shell (flag `integrations.phoneScan`; docs/help/phone-scan.md). The dialog starts a
//! session with `phoneStart` and ends it with `phoneStop` when it closes; the listener itself is in
//! `opennote_api::phone`. Photos wait here until the window takes them with `phoneTake` and pastes them onto the
//! open page. Nothing waits past the session: stopping it drops photos the window never took.

use std::{
    collections::VecDeque,
    net::IpAddr,
    sync::{Arc, Mutex, PoisonError},
    time::Instant,
};

use base64::Engine;
use opennote_api::phone::{lan_address, qr_rows, Closed, PhoneLimits, PhoneScan, Photo};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    ipc::{IpcError, IpcResult},
    platform_flags,
};

/// Photos waiting for the window, at most.
const MAX_WAITING: usize = 30;

#[derive(Default)]
pub struct PhoneState {
    scan: Mutex<Option<PhoneScan>>,
    photos: Arc<Mutex<VecDeque<Photo>>>,
}

impl PhoneState {
    /// Starts a session, ending any earlier one.
    pub fn start(&self, app: &AppHandle) -> IpcResult<Value> {
        if !platform_flags::is_on_for(app, platform_flags::PHONE_SCAN) {
            return Err(IpcError::new("off", "Insert from phone is off."));
        }
        self.stop();
        let Some(ip) = lan_address() else {
            return Err(IpcError::new(
                "noNetwork",
                "This PC isn't on a home or work network that a phone can reach.",
            ));
        };
        let (photos, notify) = (self.photos.clone(), app.clone());
        let scan = PhoneScan::start(IpAddr::V4(ip), PhoneLimits::default(), move |photo| {
            let mut waiting = photos.lock().unwrap_or_else(PoisonError::into_inner);
            if waiting.len() < MAX_WAITING {
                waiting.push_back(photo);
            }
            drop(waiting);
            let _ = notify.emit(super::EVENT, json!({ "kind": "phone", "what": "photo" }));
        })
        .map_err(|error| IpcError::new("io", error.to_string()))?;
        let url = scan.url();
        let left = scan.deadline().saturating_duration_since(Instant::now()).as_millis() as f64;
        let started = json!({
            "url": url,
            "qr": qr_rows(&url).unwrap_or_default(),
            "fingerprint": scan.fingerprint(),
            "expiresAt": crate::boot::now_epoch_ms() + left,
        });
        // The address is the PC's own on its network; the token is never logged.
        ::log::info!(
            "Insert from phone listens on {} until its dialog closes.",
            scan.address()
        );
        *self.scan.lock().unwrap_or_else(PoisonError::into_inner) = Some(scan);
        Ok(started)
    }

    /// Ends the session and drops photos nobody took.
    pub fn stop(&self) {
        let scan = self.scan.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(scan) = scan {
            scan.stop();
            ::log::info!("Insert from phone stopped listening.");
        }
        self.photos.lock().unwrap_or_else(PoisonError::into_inner).clear();
    }

    /// `open`, or why the session ended: `stopped`, `expired`, `tooManyTries`, `full`, or `none`.
    pub fn state(&self) -> &'static str {
        let mut scan = self.scan.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(running) = scan.as_ref() else {
            return "none";
        };
        let state = running.state();
        if state != Closed::Open {
            // The listener is closed already; this lets the thread go.
            if let Some(done) = scan.take() {
                done.stop();
            }
        }
        state_name(state)
    }

    /// The photos that arrived since the last take, as base64.
    pub fn take(&self) -> Value {
        let photos: Vec<Photo> = self
            .photos
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
            .collect();
        Value::Array(
            photos
                .into_iter()
                .map(|photo| {
                    json!({
                        "mime": photo.mime,
                        "width": photo.width,
                        "height": photo.height,
                        "data": base64::engine::general_purpose::STANDARD.encode(&photo.bytes),
                    })
                })
                .collect(),
        )
    }
}

pub fn state_name(state: Closed) -> &'static str {
    match state {
        Closed::Open => "open",
        Closed::Stopped => "stopped",
        Closed::Expired => "expired",
        Closed::TooManyTries => "tooManyTries",
        Closed::Full => "full",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_every_state_for_the_window() {
        let names: Vec<_> = [
            Closed::Open,
            Closed::Stopped,
            Closed::Expired,
            Closed::TooManyTries,
            Closed::Full,
        ]
        .into_iter()
        .map(state_name)
        .collect();
        assert_eq!(names, ["open", "stopped", "expired", "tooManyTries", "full"]);
    }

    #[test]
    fn taking_with_nothing_waiting_gives_an_empty_list() {
        let state = PhoneState::default();
        assert_eq!(state.take(), json!([]));
        assert_eq!(state.state(), "none");
    }
}
