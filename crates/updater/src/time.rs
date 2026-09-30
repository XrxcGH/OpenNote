//! Timestamps in `updates\state.json`, written as RFC 3339 in UTC with whole seconds, such as
//! `2026-10-14T18:05:00Z`. Only that form is read back; anything else reads as no time at all.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DAY: u64 = 86_400;

/// Formats a time as `YYYY-MM-DDTHH:MM:SSZ`. Times before 1970 format as the epoch.
pub fn format(time: SystemTime) -> String {
    let seconds = time.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let (year, month, day) = civil_from_days(seconds / DAY);
    let rest = seconds % DAY;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Reads a time written by [`format`].
pub fn parse(text: &str) -> Option<SystemTime> {
    let bytes = text.as_bytes();
    let separators = [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':'), (19, b'Z')];
    let is_separator = |at: usize| separators.iter().any(|&(position, _)| position == at);
    let digits = bytes
        .iter()
        .enumerate()
        .all(|(at, byte)| is_separator(at) || byte.is_ascii_digit());
    if bytes.len() != 20 || !digits || separators.iter().any(|&(at, byte)| bytes[at] != byte) {
        return None;
    }
    let number = |from: usize, to: usize| text.get(from..to)?.parse::<u64>().ok();
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hour, minute, second) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    let valid = (1970..=9999).contains(&year)
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && hour < 24
        && minute < 60
        && second < 60;
    if !valid {
        return None;
    }
    let seconds = days_from_civil(year, month, day) * DAY + hour * 3600 + minute * 60 + second;
    Some(UNIX_EPOCH + Duration::from_secs(seconds))
}

/// The date of a day number, counted from 1970-01-01 (Howard Hinnant's algorithm, for days after 1970).
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let day_of_era = z % 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

/// The day number of a date, the inverse of [`civil_from_days`].
fn days_from_civil(year: u64, month: u64, day: u64) -> u64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year / 400;
    let year_of_era = year % 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    (era * 146_097 + day_of_era).saturating_sub(719_468)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    fn at(seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(seconds)
    }

    #[test]
    fn formats_known_times() {
        assert_eq!(format(at(0)), "1970-01-01T00:00:00Z");
        assert_eq!(format(at(1_792_001_100)), "2026-10-14T18:05:00Z");
        assert_eq!(format(at(951_782_400)), "2000-02-29T00:00:00Z");
        assert_eq!(format(UNIX_EPOCH - Duration::from_secs(5)), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn reads_only_the_written_form() {
        assert_eq!(parse("2026-10-14T18:05:00Z"), Some(at(1_792_001_100)));
        for text in [
            "",
            "2026-10-14 18:05:00Z",
            "2026-10-14T18:05:00",
            "2026-13-14T18:05:00Z",
            "2026-10-14T24:05:00Z",
            "2026-10-14T18:05:00+01:00",
            "abcd-10-14T18:05:00Z",
            "1969-12-31T23:59:59Z",
        ] {
            assert_eq!(parse(text), None, "{text}");
        }
    }

    proptest! {
        #[test]
        fn round_trips_every_second(seconds in 0u64..253_402_300_800) {
            prop_assert_eq!(parse(&format(at(seconds))), Some(at(seconds)));
        }

        #[test]
        fn never_panics_on_any_text(text in "\\PC{0,24}") {
            let _ = parse(&text);
        }
    }
}
