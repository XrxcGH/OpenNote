use super::*;

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

#[test]
fn round_trips_the_spec_example() {
    let t = ts("2026-09-30T14:03:22.114Z");
    assert_eq!(t.unix_ms(), 1_790_777_002_114);
    assert_eq!(t.to_rfc3339(), "2026-09-30T14:03:22.114Z");
    assert_eq!(t.to_rfc3339().len(), 24);
}

#[test]
fn matches_known_unix_times() {
    assert_eq!(ts("1970-01-01T00:00:00.000Z"), Timestamp::EPOCH);
    assert_eq!(ts("0001-01-01T00:00:00.000Z"), Timestamp::MIN);
    assert_eq!(ts("9999-12-31T23:59:59.999Z"), Timestamp::MAX);
    assert_eq!(ts("2000-03-01T00:00:00Z").unix_ms(), 951_868_800_000);
    assert_eq!(ts("1969-12-31T23:59:59.999Z").unix_ms(), -1);
}

#[test]
fn handles_leap_years() {
    assert!(Timestamp::parse("2024-02-29T12:00:00Z").is_ok());
    assert!(Timestamp::parse("2000-02-29T12:00:00Z").is_ok());
    assert_eq!(Timestamp::parse("1900-02-29T12:00:00Z"), Err(TimeError::Range("day")));
    assert_eq!(Timestamp::parse("2023-02-29T12:00:00Z"), Err(TimeError::Range("day")));
    let next = ts("2024-02-28T23:59:59.999Z").saturating_add(Duration::from_millis(1));
    assert_eq!(next.to_rfc3339(), "2024-02-29T00:00:00.000Z");
    let march = ts("2023-02-28T23:59:59.999Z").saturating_add(Duration::from_millis(1));
    assert_eq!(march.to_rfc3339(), "2023-03-01T00:00:00.000Z");
}

#[test]
fn applies_offsets() {
    assert_eq!(ts("2026-09-30T16:03:22.114+02:00"), ts("2026-09-30T14:03:22.114Z"));
    assert_eq!(ts("2026-09-30T09:33:22.114-04:30"), ts("2026-09-30T14:03:22.114Z"));
    assert_eq!(ts("2026-01-01T00:30:00+01:00").to_rfc3339(), "2025-12-31T23:30:00.000Z");
}

#[test]
fn accepts_loose_fractions_and_lowercase() {
    assert_eq!(ts("2026-09-30T14:03:22Z").to_rfc3339(), "2026-09-30T14:03:22.000Z");
    assert_eq!(ts("2026-09-30T14:03:22.1Z").to_rfc3339(), "2026-09-30T14:03:22.100Z");
    assert_eq!(
        ts("2026-09-30T14:03:22.1149999Z").to_rfc3339(),
        "2026-09-30T14:03:22.114Z"
    );
    assert_eq!(ts("2026-09-30t14:03:22.114z").to_rfc3339(), "2026-09-30T14:03:22.114Z");
}

#[test]
fn rejects_malformed_text() {
    for bad in [
        "",
        "2026-09-30",
        "2026-09-30 14:03:22Z",
        "2026-09-30T14:03:22",
        "2026-09-30T14:03:22.Z",
        "2026-9-30T14:03:22Z",
        "2026-09-30T14:03:22Z ",
        "2026-09-30T14:03:22+0200",
        "+2026-09-30T14:03:22Z",
    ] {
        assert!(matches!(Timestamp::parse(bad), Err(TimeError::Syntax(_))), "{bad:?}");
    }
}

#[test]
fn rejects_out_of_range_fields() {
    let cases = [
        ("0000-01-01T00:00:00Z", "year"),
        ("2026-13-01T00:00:00Z", "month"),
        ("2026-04-31T00:00:00Z", "day"),
        ("2026-01-01T24:00:00Z", "hour"),
        ("2026-01-01T00:60:00Z", "minute"),
        ("2026-01-01T00:00:60Z", "second"),
        ("2026-01-01T00:00:00+24:00", "offset"),
        ("0001-01-01T00:00:00+00:01", "year"),
        ("9999-12-31T23:59:59-00:01", "year"),
    ];
    for (text, field) in cases {
        assert_eq!(Timestamp::parse(text), Err(TimeError::Range(field)), "{text}");
    }
}

#[test]
fn clamps_the_text_form_to_the_year_limits() {
    assert_eq!(
        Timestamp::from_unix_ms(i64::MIN).to_rfc3339(),
        "0001-01-01T00:00:00.000Z"
    );
    assert_eq!(
        Timestamp::from_unix_ms(i64::MAX).to_rfc3339(),
        "9999-12-31T23:59:59.999Z"
    );
}

#[test]
fn every_day_of_four_centuries_round_trips() {
    let start = ts("1600-01-01T00:00:00Z").unix_ms();
    let mut previous = String::new();
    for day in 0..146_097 {
        let t = Timestamp::from_unix_ms(start + day * MS_PER_DAY + 43_200_123);
        let text = t.to_rfc3339();
        assert!(text > previous, "{text} after {previous}");
        assert_eq!(Timestamp::parse(&text), Ok(t));
        previous = text;
    }
}

#[test]
fn saturating_arithmetic_and_since() {
    let t = ts("2026-09-30T14:03:22.114Z");
    assert_eq!(
        t.saturating_add(Duration::from_secs(30 * 86_400)).to_rfc3339(),
        "2026-10-30T14:03:22.114Z"
    );
    assert_eq!(
        t.saturating_sub(Duration::from_millis(114)).to_rfc3339(),
        "2026-09-30T14:03:22.000Z"
    );
    assert_eq!(
        t.since(t.saturating_sub(Duration::from_secs(5))),
        Duration::from_secs(5)
    );
    assert_eq!(t.since(t.saturating_add(Duration::from_secs(5))), Duration::ZERO);
    assert_eq!(
        Timestamp::from_unix_ms(i64::MAX)
            .saturating_add(Duration::MAX)
            .unix_ms(),
        i64::MAX
    );
}

#[test]
fn serializes_as_text() {
    let t = ts("2026-09-30T14:03:22.114Z");
    assert_eq!(serde_json::to_string(&t).unwrap(), "\"2026-09-30T14:03:22.114Z\"");
    assert_eq!(
        serde_json::from_str::<Timestamp>("\"2026-09-30T16:03:22.114+02:00\"").unwrap(),
        t
    );
    assert!(serde_json::from_str::<Timestamp>("\"yesterday\"").is_err());
}

#[test]
fn test_clock_moves_only_when_told() {
    let clock = TestClock::new(ts("2026-09-30T14:00:00Z"));
    assert_eq!(clock.monotonic(), Duration::ZERO);
    clock.advance(Duration::from_millis(1_500));
    assert_eq!(clock.now().to_rfc3339(), "2026-09-30T14:00:01.500Z");
    assert_eq!(clock.monotonic(), Duration::from_millis(1_500));
    clock.set_wall(ts("2020-01-01T00:00:00Z"));
    assert_eq!(clock.monotonic(), Duration::from_millis(1_500));
    assert_eq!(clock.now().to_rfc3339(), "2020-01-01T00:00:00.000Z");
}

#[test]
fn system_clock_never_goes_backward() {
    let clock = SystemClock::new();
    let first = clock.now();
    assert!(first > ts("2020-01-01T00:00:00Z"));
    let later = clock.now();
    assert!(later >= first);
    assert!(clock.monotonic() <= Duration::from_secs(60));
}
