use std::cell::RefCell;

use super::*;
use crate::report::{Kind, Report, FORMAT};

/// A transport that records what it is given.
#[derive(Default)]
struct Recorder {
    posts: RefCell<Vec<(String, Vec<u8>)>>,
    fail: bool,
}

impl Transport for Recorder {
    fn post(&self, endpoint: &str, body: &[u8]) -> Result<(), String> {
        self.posts.borrow_mut().push((endpoint.to_owned(), body.to_vec()));
        if self.fail {
            Err("connection refused".to_owned())
        } else {
            Ok(())
        }
    }
}

fn report(time_unix: u64) -> Report {
    Report {
        format: FORMAT,
        kind: Kind::Exception,
        app_version: "1.0.0".into(),
        os: "Windows".into(),
        time_unix,
        message: None,
        location: None,
        exception_code: Some("0xc0000005".into()),
        frames: Vec::new(),
        backtrace: Vec::new(),
    }
}

fn configured() -> Settings {
    Settings::opted_in(1, "https://crashes.example.org/report")
}

fn store_with(reports: &[u64]) -> (tempfile::TempDir, CrashStore, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let store = CrashStore::new(dir.path());
    let ids = reports.iter().map(|&time| store.save(&report(time)).unwrap()).collect();
    (dir, store, ids)
}

#[test]
fn nothing_is_sent_by_default() {
    let settings = Settings::default();
    assert!(!settings.enabled);
    assert!(settings.endpoint.is_empty());
    let (_guard, store, ids) = store_with(&[1]);
    let result = prepare(&store, &ids[0], &settings, &Scrubber::new());
    assert!(matches!(result, Err(SendError::NotOptedIn)));
    // Opting in is not enough without an address, and an address is not enough without opting in.
    for endpoint in ["", "  \t"] {
        let blank = Settings::opted_in(1, endpoint);
        assert!(matches!(
            prepare(&store, &ids[0], &blank, &Scrubber::new()),
            Err(SendError::NotConfigured)
        ));
    }
    let not_opted_in = Settings {
        endpoint: "https://crashes.example.org/report".into(),
        ..Settings::default()
    };
    assert!(matches!(
        prepare(&store, &ids[0], &not_opted_in, &Scrubber::new()),
        Err(SendError::NotOptedIn)
    ));
}

#[test]
fn nothing_is_prepared_after_a_no_or_for_older_wording() {
    use crate::consent::{Consent, Decision, WORDING_VERSION};

    let (_guard, store, ids) = store_with(&[1]);
    let address = "https://crashes.example.org/report";
    let declined = Settings {
        consent: Consent::declined(2),
        ..Settings::opted_in(1, address)
    };
    let old_wording = Settings {
        consent: Consent {
            decision: Decision::Accepted,
            wording_version: WORDING_VERSION - 1,
            decided_unix: Some(1),
        },
        ..Settings::opted_in(1, address)
    };
    for settings in [declined, old_wording] {
        assert!(matches!(
            prepare(&store, &ids[0], &settings, &Scrubber::new()),
            Err(SendError::NotOptedIn)
        ));
    }
    // The switch alone does not save: it counts only with a current yes.
    let switch_only = Settings {
        enabled: true,
        ..Settings::default()
    };
    assert!(!switch_only.saving_allowed());
    assert!(Settings::opted_in(1, "").saving_allowed());
    let switched_off = Settings {
        enabled: false,
        ..Settings::opted_in(1, "")
    };
    assert!(!switched_off.saving_allowed());
}

#[test]
fn only_secure_or_local_addresses_are_accepted() {
    for good in [
        "https://crashes.example.org/report",
        " https://crashes.example.org ",
        "http://localhost",
        "http://localhost:8080/report",
        "http://127.0.0.1:9000/",
        "http://[::1]:9000/",
        "http://localhost:8080",
        "http://localhost?x=1",
        "https://crashes.example.org/a@b",
    ] {
        assert!(check_endpoint(good).is_ok(), "{good:?}");
    }
    for bad in [
        "http://crashes.example.org/report",
        "http://localhost.example.org/report",
        "http://127.0.0.1.example.org/",
        "ftp://crashes.example.org",
        "https://",
        "https:///report",
        "crashes.example.org",
        "https://a b.example.org",
        "https://example.org/\nHost: evil",
        // A user part hides a remote host behind a local-looking start.
        "http://localhost:x@collector.example.net/report",
        "http://127.0.0.1:@collector.example.net/",
        "http://[::1]:80@collector.example.net/",
        "http://localhost:99999999/",
        "http://localhost\\@collector.example.net/",
        "https://crashes.example.org@collector.example.net/",
    ] {
        assert!(
            matches!(check_endpoint(bad), Err(SendError::InvalidEndpoint)),
            "{bad:?}"
        );
    }
    assert!(check_endpoint(&format!("https://{}", "a".repeat(2100))).is_err());
}

#[test]
fn a_report_goes_out_only_after_review_and_agreement() {
    let (_guard, store, ids) = store_with(&[1]);
    let transport = Recorder::default();
    let pending = prepare(&store, &ids[0], &configured(), &Scrubber::new()).unwrap();
    assert_eq!(pending.id(), ids[0]);
    assert_eq!(pending.endpoint(), "https://crashes.example.org/report");
    assert!(pending.payload().contains("0xc0000005"));
    assert!(transport.posts.borrow().is_empty(), "preparing sends nothing");

    assert!(matches!(pending.agree("not the digest"), Err(SendError::NotReviewed)));
    assert!(matches!(pending.agree(""), Err(SendError::NotReviewed)));
    let agreement = pending.agree(pending.digest()).unwrap();
    send(&pending, agreement, &transport).unwrap();

    let posts = transport.posts.borrow();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].0, "https://crashes.example.org/report");
    assert_eq!(posts[0].1, pending.payload().as_bytes());
    assert!(
        store.load(&ids[0], &Scrubber::new()).is_ok(),
        "sending keeps the report"
    );
}

#[test]
fn what_is_sent_is_what_was_shown() {
    let (_guard, store, ids) = store_with(&[1]);
    let transport = Recorder::default();
    let pending = prepare(&store, &ids[0], &configured(), &Scrubber::new()).unwrap();
    let shown = pending.payload().to_owned();
    // The file changes after the person looked at it.
    std::fs::write(store.dir().join(format!("{}.json", ids[0])), report(999).to_json()).unwrap();
    send(&pending, pending.agree(pending.digest()).unwrap(), &transport).unwrap();
    assert_eq!(transport.posts.borrow()[0].1, shown.as_bytes());
}

#[test]
fn an_agreement_is_for_one_report() {
    let (_guard, store, ids) = store_with(&[1, 2]);
    let transport = Recorder::default();
    let first = prepare(&store, &ids[0], &configured(), &Scrubber::new()).unwrap();
    let second = prepare(&store, &ids[1], &configured(), &Scrubber::new()).unwrap();
    let agreement = first.agree(first.digest()).unwrap();
    assert!(matches!(
        send(&second, agreement, &transport),
        Err(SendError::WrongAgreement)
    ));
    assert!(transport.posts.borrow().is_empty());
}

#[test]
fn the_payload_is_scrubbed_again_before_review() {
    let (_guard, store, _) = store_with(&[]);
    let mut dirty = report(7);
    dirty.message = Some("could not save C:\\Users\\jdoe\\Holiday Plans\\page.json".into());
    let id = store.save(&dirty).unwrap();
    let pending = prepare(&store, &id, &configured(), &Scrubber::new()).unwrap();
    assert!(!pending.payload().contains("jdoe") && !pending.payload().contains("Holiday"));
}

#[test]
fn a_failed_delivery_can_be_tried_again_after_a_new_agreement() {
    let (_guard, store, ids) = store_with(&[1]);
    let pending = prepare(&store, &ids[0], &configured(), &Scrubber::new()).unwrap();
    let failing = Recorder {
        fail: true,
        ..Recorder::default()
    };
    let error = send(&pending, pending.agree(pending.digest()).unwrap(), &failing).unwrap_err();
    assert!(matches!(&error, SendError::Transport(text) if text == "connection refused"));
    let working = Recorder::default();
    send(&pending, pending.agree(pending.digest()).unwrap(), &working).unwrap();
    assert_eq!(working.posts.borrow().len(), 1);
}

#[test]
fn unknown_reports_and_bad_ids_fail_before_anything_is_prepared() {
    let (_guard, store, _) = store_with(&[]);
    let scrubber = Scrubber::new();
    assert!(matches!(
        prepare(&store, "crash-1-0", &configured(), &scrubber),
        Err(SendError::Store(StoreError::Missing(_)))
    ));
    assert!(matches!(
        prepare(&store, "../x", &configured(), &scrubber),
        Err(SendError::Store(StoreError::BadId(_)))
    ));
}

#[test]
fn settings_read_from_partial_json() {
    let settings: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(settings, Settings::default());
    let settings: Settings = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
    assert!(settings.enabled && settings.endpoint.is_empty());
}
