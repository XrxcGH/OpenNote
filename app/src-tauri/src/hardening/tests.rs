use std::sync::Mutex;

use opennote_crashreport::{Consent, Report, SendError, Settings, Transport};
use opennote_diagnostics::{selfcheck, BundleOptions, FixedDisk};

use super::*;
use crate::hardening::commands::{build_feedback, send_error, send_reviewed};

/// The offline and safe mode switches are global, so tests that read or change them take turns.
static SERIAL: Mutex<()> = Mutex::new(());

fn turn() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
}

fn hardening() -> (tempfile::TempDir, Hardening, Paths) {
    let dir = tempfile::tempdir().expect("a temp folder");
    let paths = Paths::under_profile(dir.path());
    std::fs::create_dir_all(&paths.local).expect("the local folder");
    (dir, Hardening::open(&paths), paths)
}

/// A transport that records what it was given, and can be told to fail.
#[derive(Default)]
struct Recorder {
    sent: Mutex<Vec<(String, String)>>,
    fail: bool,
}

impl Transport for Recorder {
    fn post(&self, endpoint: &str, body: &[u8]) -> Result<(), String> {
        if self.fail {
            return Err("unreachable".to_owned());
        }
        self.sent
            .lock()
            .unwrap()
            .push((endpoint.to_owned(), String::from_utf8_lossy(body).into_owned()));
        Ok(())
    }
}

fn opted_in(hardening: &Hardening, endpoint: &str) -> String {
    hardening
        .update(|privacy| privacy.crash_reports = Settings::opted_in(10, endpoint))
        .expect("the choices are saved");
    hardening
        .store
        .save(&Report::example("1.0.0", 100))
        .expect("the report is saved")
}

fn digest_of(hardening: &Hardening, id: &str) -> String {
    let scrubber = hardening.scrubber.lock().unwrap().clone();
    opennote_crashreport::prepare(&hardening.store, id, &hardening.privacy().crash_reports, &scrubber)
        .expect("a report that can be prepared")
        .digest()
        .to_owned()
}

#[test]
fn a_missing_or_damaged_choices_file_reads_as_no_consent_and_online() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PRIVACY_FILE);
    assert_eq!(PrivacyFile::read(&path), PrivacyFile::default());
    std::fs::write(&path, "{ not json").unwrap();
    let read = PrivacyFile::read(&path);
    assert!(!read.crash_reports.saving_allowed());
    assert!(!read.work_offline);
}

#[test]
fn a_yes_turns_saving_on_and_a_no_turns_it_off_and_both_are_kept() {
    let _turn = turn();
    let (_dir, hardening, paths) = hardening();
    hardening
        .update(|p| p.crash_reports.consent = Consent::accepted(5))
        .unwrap();
    assert!(hardening.privacy().crash_reports.saving_allowed());
    assert!(PrivacyFile::read(&paths.local.join(PRIVACY_FILE))
        .crash_reports
        .saving_allowed());
    hardening
        .update(|p| p.crash_reports.consent = Consent::declined(6))
        .unwrap();
    assert!(!hardening.privacy().crash_reports.enabled);
    assert!(!PrivacyFile::read(&paths.local.join(PRIVACY_FILE))
        .crash_reports
        .saving_allowed());
}

#[test]
fn work_offline_is_kept_and_read_back_at_the_next_start() {
    let _turn = turn();
    let (_dir, hardening, paths) = hardening();
    hardening.update(|p| p.work_offline = true).unwrap();
    assert!(offline());
    OFFLINE.store(false, Ordering::Relaxed);
    let again = Hardening::open(&paths);
    assert!(offline(), "the next start reads the switch from the file");
    again.update(|p| p.work_offline = false).unwrap();
    assert!(!offline());
}

#[test]
fn nothing_is_sent_without_a_yes_an_address_and_the_reviewed_digest() {
    let _turn = turn();
    let (_dir, hardening, _paths) = hardening();
    let transport = Recorder::default();
    let id = hardening.store.save(&Report::example("1.0.0", 100)).unwrap();
    // No yes yet.
    let refused = send_reviewed(&hardening, &transport, &id, "any").unwrap_err();
    assert_eq!(refused.code, "notOptedIn");
    // A yes, but no address.
    hardening
        .update(|p| p.crash_reports = Settings::opted_in(10, ""))
        .unwrap();
    assert_eq!(
        send_reviewed(&hardening, &transport, &id, "any").unwrap_err().code,
        "noAddress"
    );
    // An address, but not the digest of the text that was shown.
    hardening
        .update(|p| p.crash_reports = Settings::opted_in(10, "https://collector.example/v1"))
        .unwrap();
    assert_eq!(
        send_reviewed(&hardening, &transport, &id, "not the digest")
            .unwrap_err()
            .code,
        "notReviewed"
    );
    assert!(
        transport.sent.lock().unwrap().is_empty(),
        "the transport was never reached"
    );
}

#[test]
fn a_reviewed_report_is_sent_once_to_the_address_the_person_saw_and_the_time_is_kept() {
    let _turn = turn();
    let (_dir, hardening, _paths) = hardening();
    let transport = Recorder::default();
    let id = opted_in(&hardening, "https://collector.example/v1");
    let digest = digest_of(&hardening, &id);
    send_reviewed(&hardening, &transport, &id, &digest).unwrap();
    let sent = transport.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "https://collector.example/v1");
    assert!(sent[0].1.contains("0xc0000005"));
    assert!(hardening.privacy().report_sent_unix.is_some());
    assert_eq!(
        hardening.store.list().len(),
        1,
        "the report stays saved until the person deletes it"
    );
}

#[test]
fn a_failed_send_says_io_and_keeps_the_report() {
    let _turn = turn();
    let (_dir, hardening, _paths) = hardening();
    let id = opted_in(&hardening, "https://collector.example/v1");
    let digest = digest_of(&hardening, &id);
    let broken = Recorder {
        fail: true,
        ..Recorder::default()
    };
    assert_eq!(send_reviewed(&hardening, &broken, &id, &digest).unwrap_err().code, "io");
    assert!(hardening.privacy().report_sent_unix.is_none());
    assert_eq!(hardening.store.list().len(), 1);
}

#[test]
fn work_offline_stops_a_send_before_anything_is_prepared() {
    let _turn = turn();
    let (_dir, hardening, _paths) = hardening();
    let transport = Recorder::default();
    let id = opted_in(&hardening, "https://collector.example/v1");
    let digest = digest_of(&hardening, &id);
    hardening.update(|p| p.work_offline = true).unwrap();
    assert_eq!(
        send_reviewed(&hardening, &transport, &id, &digest).unwrap_err().code,
        "offline"
    );
    assert!(transport.sent.lock().unwrap().is_empty());
    hardening.update(|p| p.work_offline = false).unwrap();
}

#[test]
fn the_real_transport_refuses_while_working_offline() {
    let _turn = turn();
    OFFLINE.store(true, Ordering::Relaxed);
    let result = super::transport::HttpTransport.post("http://127.0.0.1:9/", b"{}");
    OFFLINE.store(false, Ordering::Relaxed);
    assert!(result.is_err());
}

#[test]
fn an_error_from_the_transport_never_carries_report_text() {
    let mapped = send_error(&SendError::Transport("secret text".to_owned()));
    assert_eq!(mapped.code, "io");
    assert!(!mapped.message.contains("secret"));
}

#[test]
fn safe_mode_is_recorded_and_the_record_survives_a_restart() {
    let _turn = turn();
    let (_dir, first, paths) = hardening();
    assert!(!first.start_report().offer_safe_mode);
    // Two sessions that never ended cleanly.
    let second = Hardening::open(&paths);
    assert_eq!(second.start_report().crashes_in_a_row, 1);
    let third = Hardening::open(&paths);
    assert!(
        third.start_report().offer_safe_mode,
        "two crashes in a row offer safe mode"
    );
    third.enter_safe_mode();
    assert!(safe_mode());
    SAFE_MODE.store(false, Ordering::Relaxed);
    third.end_clean();
    let fourth = Hardening::open(&paths);
    assert!(!fourth.start_report().offer_safe_mode, "a clean end resets the count");
    assert_eq!(fourth.stats().clean, 1);
}

#[test]
fn the_feedback_file_holds_what_was_asked_and_saves_only_the_text_that_was_shown() {
    let _turn = turn();
    let (dir, hardening, paths) = hardening();
    let check = selfcheck::run(
        &selfcheck::Inputs {
            now_unix: 1_790_000_000,
            app_data_dir: &paths.local,
            updates_dir: Some(&paths.updates),
            notebook: None,
            crash_store: Some(&hardening.store),
        },
        &FixedDisk(10 << 30),
    );
    let options = BundleOptions {
        description: "The page jumps when I scroll".to_owned(),
        include_logs: false,
        ..BundleOptions::default()
    };
    let built = build_feedback(&hardening, &paths, &check, None, &options, None, "130.0");
    assert!(built.review_text().contains("The page jumps when I scroll"));
    assert!(built.review_text().contains("- Recent log lines: not included"));
    assert!(!built.review_text().contains("=== Recent log lines ==="));
    let review = hardening.review.lock().unwrap().clone().expect("the review is kept");
    let target = dir.path().join("saved");
    std::fs::create_dir_all(&target).unwrap();
    assert!(review.save("not the digest", &target).is_err());
    let path = review.save(review.digest(), &target).unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), review.text());
}

#[test]
fn the_self_check_reads_every_notebook_of_the_notes_folder() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (local, notes) = (dir.path().join("local"), dir.path().join("Notes"));
    let bridge = crate::core_bridge::CoreBridge::at(local);
    bridge
        .notes(Some(notes.clone()), |bridge| {
            for title in ["Biology", "Cooking"] {
                let input = serde_json::json!({ "kind": "notebook", "placement": { "parentId": null, "beforeId": null }, "title": title });
                bridge.dispatch("notes_create", &serde_json::json!({ "input": input }))?;
            }
            Ok(())
        })
        .expect("two notebooks");
    let open = crate::hardening::commands::OpenNotebooks::new(bridge.notebooks()).expect("open notebooks");
    let probe: &dyn selfcheck::NotebookProbe = &open;
    assert_eq!(
        probe.path(),
        notes.as_path(),
        "the notes folder is what the disk check looks at"
    );
    let report = probe.verify().expect("the notebooks verify");
    assert!(report.is_clean(), "{:?}", report.problems);
    assert!(report.files >= 2, "both notebooks were read: {}", report.files);
    assert!(!probe.has_unsaved());
    bridge.shutdown();
}
