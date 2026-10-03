//! The JSON the interface reads and writes. The fixtures in `tests/fixtures` are checked here against the real
//! types, and `app/src/features/diagnostics/contract.test.ts` checks the same files against the interface's
//! types and functions, so a change on one side that breaks the other fails a test. To rewrite the fixtures after
//! a deliberate change, run these tests with `OPENNOTE_UPDATE_FIXTURES=1`.

use std::fs;
use std::path::PathBuf;

use opennote_crashreport::{Consent, Decision, Kind, Report, Summary, WORDING_VERSION};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

/// Checks `value` against the fixture `name`, in both directions: it serializes to the fixture, and the fixture
/// reads back as the same value.
fn assert_fixture<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(name: &str, value: &T) {
    let path = fixture_path(name);
    let actual = serde_json::to_value(value).unwrap();
    if std::env::var_os("OPENNOTE_UPDATE_FIXTURES").is_some() {
        fs::write(&path, serde_json::to_string_pretty(&actual).unwrap() + "\n").unwrap();
    }
    let text = fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {}", path.display()));
    let expected: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(actual, expected, "{name} differs from the real type's JSON");
    let back: T = serde_json::from_value(expected).unwrap();
    assert_eq!(&back, value, "{name} does not read back as the same value");
}

#[test]
fn a_report_is_the_json_the_interface_shows() {
    let mut report = Report::example("1.0.0-beta.2", 1_790_000_000);
    report.kind = Kind::Exception;
    assert_fixture("report.json", &report);
}

#[test]
fn the_list_of_reports_is_the_json_the_interface_lists() {
    let list = vec![
        Summary {
            id: "crash-1790000100-0".into(),
            time_unix: 1_790_000_100,
            kind: Kind::Panic,
            app_version: "1.0.0-beta.2".into(),
            size_bytes: 1_204,
        },
        Summary {
            id: "crash-1790000000-0".into(),
            time_unix: 1_790_000_000,
            kind: Kind::Exception,
            app_version: "1.0.0-beta.1".into(),
            size_bytes: 988,
        },
    ];
    assert_fixture("summaries.json", &list);
}

#[test]
fn consent_is_the_json_the_interface_stores() {
    let states = vec![
        Consent::default(),
        Consent::declined(1_790_000_000),
        Consent::accepted(1_790_000_100),
        Consent {
            decision: Decision::Accepted,
            wording_version: WORDING_VERSION + 1,
            decided_unix: Some(1_790_000_200),
        },
    ];
    assert_fixture("consent.json", &states);
}
