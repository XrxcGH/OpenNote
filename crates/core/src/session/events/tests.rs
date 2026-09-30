use serde_json::json;

use super::*;
use crate::id::Id;

fn page() -> PageId {
    PageId::parse("01m3sa12426sg32pmtyffjaqcf").unwrap()
}

#[test]
fn events_serialize_as_the_interface_expects() {
    let failed = CoreEvent::SaveFailed {
        page: page(),
        kind: FsErrorKind::Busy,
        message: "sharing violation".to_owned(),
        retry_in: Some(Duration::from_secs(2)),
    };
    assert_eq!(
        serde_json::to_value(failed).unwrap(),
        json!({
            "event": "saveFailed",
            "page": "01m3sa12426sg32pmtyffjaqcf",
            "kind": "busy",
            "message": "sharing violation",
            "retryInMs": 2000
        })
    );
    let read_only = CoreEvent::ReadOnly {
        page: page(),
        reason: ReadOnlyReason::DamagedInk { strokes: 12 },
    };
    assert_eq!(
        serde_json::to_value(read_only).unwrap()["reason"],
        json!({"kind": "damagedInk", "strokes": 12})
    );
    let applied = CoreEvent::TxnApplied {
        page: page(),
        source: ClientId::parse("main-2").unwrap(),
        changes: AppliedChanges::default(),
    };
    let value = serde_json::to_value(applied).unwrap();
    assert_eq!(value["sourceClient"], "main-2");
    assert_eq!(value["changes"]["blocksChanged"], json!([]));
}

#[test]
fn recovery_reports_serialize() {
    let report = RecoveryReport {
        pages: vec![
            (page(), RecoveryOutcome::Replayed { txns: 3, strokes: 1 }),
            (
                page(),
                RecoveryOutcome::Deferred {
                    reason: DeferReason::NewerJournal,
                },
            ),
        ],
        waiting: vec![WaitingJournal {
            notebook: NotebookId(Id::from_parts(1, 1)),
            notebook_path: PathBuf::from("E:/Biology"),
            pages: 2,
            since: crate::time::Timestamp::EPOCH,
        }],
        latest_change: None,
    };
    let value = serde_json::to_value(report).unwrap();
    assert_eq!(
        value["pages"][0][1],
        json!({"kind": "replayed", "txns": 3, "strokes": 1})
    );
    assert_eq!(value["waiting"][0]["notebookPath"], "E:/Biology");
    let external = CoreEvent::ExternalChange {
        page: page(),
        action: ExternalAction::Conflict {
            other_device: "Windows device 7Q2M".into(),
        },
    };
    assert_eq!(
        serde_json::to_value(external).unwrap()["action"]["otherDevice"],
        "Windows device 7Q2M"
    );
}
