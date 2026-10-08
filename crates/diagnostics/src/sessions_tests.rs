use super::*;
use tempfile::tempdir;

fn log() -> (tempfile::TempDir, SessionLog) {
    let dir = tempdir().unwrap();
    let log = SessionLog::new(dir.path());
    (dir, log)
}

/// A session that starts and never ends cleanly.
fn crash(log: &SessionLog, at: u64) -> StartReport {
    log.begin(at)
}

#[test]
fn the_first_start_has_no_earlier_session() {
    let (_dir, log) = log();
    let report = log.begin(1_000);
    assert_eq!(report.previous, PreviousEnd::First);
    assert_eq!(report.crashes_in_a_row, 0);
    assert!(!report.offer_safe_mode);
    assert!(!report.previous_was_safe);
}

#[test]
fn a_session_that_ended_cleanly_is_clean() {
    let (_dir, log) = log();
    log.begin(1_000);
    log.end_clean().unwrap();
    let report = log.begin(2_000);
    assert_eq!(report.previous, PreviousEnd::Clean);
    assert_eq!(report.crashes_in_a_row, 0);
    assert!(!report.offer_safe_mode);
}

#[test]
fn one_crash_is_counted_but_not_enough_to_offer_safe_mode() {
    let (_dir, log) = log();
    crash(&log, 1_000);
    let report = log.begin(2_000);
    assert_eq!(report.previous, PreviousEnd::Crashed);
    assert_eq!(report.crashes_in_a_row, 1);
    assert!(!report.offer_safe_mode);
}

#[test]
fn two_crashes_in_a_row_offer_safe_mode() {
    let (_dir, log) = log();
    crash(&log, 1_000);
    crash(&log, 2_000);
    let report = log.begin(3_000);
    assert_eq!(report.crashes_in_a_row, SAFE_START_AFTER);
    assert!(report.offer_safe_mode);
    assert_eq!(report.previous, PreviousEnd::Crashed);
}

#[test]
fn the_offer_stays_until_a_session_ends_cleanly() {
    let (_dir, log) = log();
    crash(&log, 1_000);
    crash(&log, 2_000);
    assert!(log.begin(3_000).offer_safe_mode);
    assert!(log.begin(4_000).offer_safe_mode, "a third crash still offers it");
    log.end_clean().unwrap();
    let report = log.begin(5_000);
    assert_eq!(report.crashes_in_a_row, 0);
    assert!(!report.offer_safe_mode);
}

#[test]
fn a_clean_session_between_two_crashes_breaks_the_streak() {
    let (_dir, log) = log();
    crash(&log, 1_000);
    log.begin(2_000);
    log.end_clean().unwrap();
    crash(&log, 3_000);
    let report = log.begin(4_000);
    assert_eq!(report.crashes_in_a_row, 1);
    assert!(!report.offer_safe_mode);
}

#[test]
fn a_crash_in_safe_mode_is_reported_as_one() {
    let (_dir, log) = log();
    crash(&log, 1_000);
    crash(&log, 2_000);
    log.begin(3_000);
    log.enter_safe_mode().unwrap();
    let report = log.begin(4_000);
    assert!(
        report.previous_was_safe,
        "safe mode did not help, and the notice can say so"
    );
    assert!(report.offer_safe_mode);
    // The new session is not in safe mode until the person accepts again.
    let after = log.begin(5_000);
    assert!(!after.previous_was_safe);
}

#[test]
fn a_clean_end_in_safe_mode_ends_the_streak() {
    let (_dir, log) = log();
    crash(&log, 1_000);
    crash(&log, 2_000);
    log.begin(3_000);
    log.enter_safe_mode().unwrap();
    log.end_clean().unwrap();
    let report = log.begin(4_000);
    assert_eq!(report.previous, PreviousEnd::Clean);
    assert!(!report.previous_was_safe);
    assert!(!report.offer_safe_mode);
}

#[test]
fn ending_twice_or_before_starting_changes_nothing() {
    let (dir, log) = log();
    log.end_clean().unwrap();
    assert!(!dir.path().join(FILE_NAME).exists(), "no record is made from nothing");
    log.enter_safe_mode().unwrap();
    assert!(!dir.path().join(FILE_NAME).exists());
    log.begin(1_000);
    log.end_clean().unwrap();
    log.end_clean().unwrap();
    assert_eq!(
        log.stats(),
        SessionStats {
            sessions: 1,
            clean: 1,
            crashed: 0
        }
    );
}

#[test]
fn a_damaged_record_reads_as_a_first_start() {
    let (dir, log) = log();
    fs::write(dir.path().join(FILE_NAME), "{ not json").unwrap();
    let report = log.begin(1_000);
    assert_eq!(report.previous, PreviousEnd::First);
    assert!(!report.offer_safe_mode);
    // The bad file was replaced by a real record.
    assert_eq!(log.begin(2_000).previous, PreviousEnd::Crashed);
}

#[test]
fn a_record_with_wrong_types_reads_as_a_first_start() {
    let (dir, log) = log();
    fs::write(
        dir.path().join(FILE_NAME),
        r#"{"running": "yes", "crashesInARow": -4, "history": ["clean", 7]}"#,
    )
    .unwrap();
    assert_eq!(log.begin(1_000).previous, PreviousEnd::First);
}

#[test]
fn an_edited_streak_and_history_are_held_to_their_limits() {
    let (dir, log) = log();
    let history: Vec<&str> = std::iter::repeat_n("crashed", 500).collect();
    let record = serde_json::json!({
        "running": true,
        "crashesInARow": 4_000_000_000u64,
        "history": history,
    });
    fs::write(dir.path().join(FILE_NAME), record.to_string()).unwrap();
    let report = log.begin(1_000);
    assert_eq!(report.crashes_in_a_row, MAX_STREAK);
    assert!(log.stats().sessions as usize <= MAX_HISTORY);
}

#[test]
fn fields_this_version_does_not_know_are_ignored() {
    let (dir, log) = log();
    fs::write(
        dir.path().join(FILE_NAME),
        r#"{"format": 9, "running": true, "crashesInARow": 1, "history": [], "futureField": {"a": 1}}"#,
    )
    .unwrap();
    let report = log.begin(1_000);
    assert_eq!(report.previous, PreviousEnd::Crashed);
    assert_eq!(report.crashes_in_a_row, 2);
}

#[test]
fn the_stats_count_the_recent_sessions() {
    let (_dir, log) = log();
    log.begin(1_000);
    log.end_clean().unwrap();
    crash(&log, 2_000);
    log.begin(3_000);
    log.end_clean().unwrap();
    assert_eq!(
        log.stats(),
        SessionStats {
            sessions: 3,
            clean: 2,
            crashed: 1
        }
    );
}

#[test]
fn the_history_keeps_only_the_newest_sessions() {
    let (_dir, log) = log();
    for i in 0..(MAX_HISTORY as u64 + 20) {
        log.begin(i);
        log.end_clean().unwrap();
    }
    assert_eq!(log.stats().sessions as usize, MAX_HISTORY);
}

#[test]
fn the_record_holds_counts_and_times_only() {
    let (dir, log) = log();
    log.begin(1_790_000_000);
    log.enter_safe_mode().unwrap();
    let text = fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "crashesInARow",
            "format",
            "history",
            "running",
            "safeMode",
            "startedUnix"
        ]
    );
    assert!(!text.contains(dir.path().to_str().unwrap()), "no path is written");
}

#[test]
fn the_start_report_is_the_json_the_screen_reads() {
    let report = StartReport {
        previous: PreviousEnd::Crashed,
        crashes_in_a_row: 2,
        offer_safe_mode: true,
        previous_was_safe: false,
    };
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        serde_json::json!({
            "previous": "crashed",
            "crashesInARow": 2,
            "offerSafeMode": true,
            "previousWasSafe": false,
        })
    );
}

#[test]
fn a_folder_that_cannot_be_written_still_gives_a_report() {
    let dir = tempdir().unwrap();
    // A file where the folder should be: every write fails.
    let blocker = dir.path().join("blocked");
    fs::write(&blocker, "x").unwrap();
    let log = SessionLog::new(&blocker);
    let report = log.begin(1_000);
    assert_eq!(report.previous, PreviousEnd::First);
    assert_eq!(log.stats(), SessionStats::default());
    assert!(log.end_clean().is_ok());
}
