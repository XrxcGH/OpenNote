use opennote_intel::{
    wire::{OcrRequest, ReadAloudRequest, SummarizeRequest},
    Feature, IntelError,
};
use serde_json::json;

use super::{ipc_error, IntelSettingsPatch, IntelState, FILE_NAME};

fn state_in(folder: &tempfile::TempDir) -> IntelState {
    IntelState::at(folder.path().join(FILE_NAME))
}

fn turn_on(state: &IntelState, patch: serde_json::Value) {
    let patch: IntelSettingsPatch = serde_json::from_value(patch).expect("a settings patch");
    state.update(&patch).expect("the settings are saved");
}

fn summary_request() -> SummarizeRequest {
    serde_json::from_value(json!({
        "text": "Cells make energy. The mitochondria is the powerhouse of the cell. Plants also use chloroplasts.",
        "options": { "maxSentences": 1 },
    }))
    .expect("a summarize request")
}

#[test]
fn every_feature_starts_off() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    assert!(Feature::ALL.iter().all(|&feature| !state.settings().is_on(feature)));
    let status = state.status();
    assert_eq!(status.len(), Feature::ALL.len());
    assert!(status.iter().all(|one| !one.enabled));
}

#[test]
fn a_feature_that_is_off_refuses_before_it_does_any_work() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    assert_eq!(
        state.summarize(&summary_request()).unwrap_err(),
        IntelError::Disabled(Feature::Summaries)
    );
    let image: OcrRequest = serde_json::from_value(json!({
        "source": { "kind": "pixels", "width": 1, "height": 1, "format": "gray8", "pixels": "AA==" },
    }))
    .unwrap();
    assert_eq!(
        state.ocr_recognize(image).unwrap_err(),
        IntelError::Disabled(Feature::Ocr)
    );
    let read: ReadAloudRequest = serde_json::from_value(json!({ "text": "Hello there." })).unwrap();
    assert_eq!(
        state.read_aloud_start(read).unwrap_err(),
        IntelError::Disabled(Feature::ReadAloud)
    );
    assert_eq!(state.voices().unwrap_err(), IntelError::Disabled(Feature::ReadAloud));
}

#[test]
fn the_error_the_interface_gets_carries_the_feature_to_offer() {
    let error = ipc_error(&IntelError::Disabled(Feature::ReadAloud));
    assert_eq!(
        (error.code.as_str(), error.field.as_deref()),
        ("disabled", Some("readAloud"))
    );
    let error = ipc_error(&IntelError::VoiceUnavailable);
    assert_eq!((error.code.as_str(), error.field), ("voiceUnavailable", None));
}

#[test]
fn turning_a_feature_on_saves_it_and_a_restart_keeps_it() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    turn_on(&state, json!({ "summaries": true }));
    let again = state_in(&folder);
    assert!(again.settings().summaries);
    assert!(!again.settings().ocr);
}

#[test]
fn a_summary_runs_only_while_the_feature_is_on() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    // Engines exist from the first request, so turning the feature on and off reaches ones already made.
    assert!(state.summarize(&summary_request()).is_err());
    turn_on(&state, json!({ "summaries": true }));
    let summary = state.summarize(&summary_request()).expect("a summary");
    assert_eq!(summary.sentences.len(), 1);
    turn_on(&state, json!({ "summaries": false }));
    assert_eq!(
        state.summarize(&summary_request()).unwrap_err(),
        IntelError::Disabled(Feature::Summaries)
    );
}

#[test]
fn a_patch_changes_only_the_features_it_names() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    turn_on(&state, json!({ "ocr": true, "readAloud": true }));
    turn_on(&state, json!({ "ocr": false }));
    let settings = state.settings();
    assert!(!settings.ocr && settings.read_aloud && !settings.summaries);
}

#[test]
fn a_patch_that_changes_nothing_writes_nothing() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    turn_on(&state, json!({}));
    assert!(!folder.path().join(FILE_NAME).exists());
}

#[test]
fn a_damaged_file_leaves_everything_off() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join(FILE_NAME), "{ not json").unwrap();
    let state = state_in(&folder);
    assert_eq!(state.settings(), opennote_intel::IntelSettings::default());
}

#[test]
fn an_unknown_session_is_an_error_not_a_hang() {
    let folder = tempfile::tempdir().unwrap();
    let state = state_in(&folder);
    assert!(state.read_aloud_next("session-404").is_err());
    assert!(state.clip_audio("clip-404").is_err());
}
