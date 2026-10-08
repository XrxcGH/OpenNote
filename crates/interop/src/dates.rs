//! Reading the date formats that other note apps write.

use std::time::SystemTime;

use opennote_core::Timestamp;

/// Reads a date from front matter or ENEX. Dates with no zone are read as UTC, because the source does not say
/// which zone it meant and a wrong guess would only shift the date by hours.
///
/// Accepted forms: `2024-01-05T14:30:00Z`, `2024-01-05 14:30:00`, `2024-01-05 14:30`, `2024-01-05`, and
/// Evernote's `20240105T143000Z`.
pub fn parse_date(text: &str) -> Option<Timestamp> {
    let text = text.trim().trim_matches(['"', '\'']);
    let compact = compact_to_rfc3339(text);
    let text = compact.as_deref().unwrap_or(text);
    let mut normal = text.replacen(' ', "T", 1);
    if !normal.contains('T') {
        normal.push_str("T00:00:00");
    }
    let time = normal
        .split_once('T')
        .map_or(String::new(), |(_, time)| time.to_owned());
    if time.len() == 5 {
        normal.push_str(":00");
    }
    let has_zone = time.ends_with(['Z', 'z']) || time.contains(['+', '-']);
    if !has_zone {
        normal.push('Z');
    }
    Timestamp::parse(&normal).ok()
}

/// `20240105T143000Z` as `2024-01-05T14:30:00Z`.
fn compact_to_rfc3339(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let shape_ok = bytes.len() >= 15
        && bytes[8] == b'T'
        && bytes[..8].iter().all(u8::is_ascii_digit)
        && bytes[9..15].iter().all(u8::is_ascii_digit);
    shape_ok.then(|| {
        format!(
            "{}-{}-{}T{}:{}:{}{}",
            &text[..4],
            &text[4..6],
            &text[6..8],
            &text[9..11],
            &text[11..13],
            &text[13..15],
            &text[15..]
        )
    })
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// Reads the dates that people read: `October 1, 2026 9:30 AM`, `Oct 1, 2026`, `1 October 2026 14:05`, and the
/// ISO forms that [`parse_date`] reads. A zone in brackets, such as `(GMT+1)`, is ignored, so the time is read as
/// UTC like every other date without a zone.
pub fn parse_long_date(text: &str) -> Option<Timestamp> {
    if let Some(date) = parse_date(text).or_else(|| parse_date(&text.replace('/', "-"))) {
        return Some(date);
    }
    let cleaned: String = text
        .split('(')
        .next()
        .unwrap_or("")
        .replace([',', '@'], " ")
        .replace('/', "-");
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let month = words.iter().find_map(|w| {
        let lower = w.to_ascii_lowercase();
        MONTHS
            .iter()
            .position(|m| lower.len() >= 3 && m.starts_with(lower.trim_end_matches('.')))
    })?;
    let numbers: Vec<u32> = words
        .iter()
        .filter(|w| !w.contains(':'))
        .filter_map(|w| w.parse().ok())
        .collect();
    let year = numbers.iter().copied().find(|n| *n >= 1000)?;
    let day = numbers.iter().copied().find(|n| (1..=31).contains(n))?;
    let (mut hour, mut minute) = words
        .iter()
        .find(|w| w.contains(':'))
        .and_then(|w| w.split_once(':'))
        .and_then(|(h, m)| Some((h.parse::<u32>().ok()?, m.get(..2)?.parse::<u32>().ok()?)))
        .unwrap_or((0, 0));
    let meridiem = words
        .iter()
        .map(|w| w.to_ascii_lowercase())
        .find(|w| w == "am" || w == "pm");
    match meridiem.as_deref() {
        Some("pm") if hour < 12 => hour += 12,
        Some("am") if hour == 12 => hour = 0,
        _ => {}
    }
    minute = minute.min(59);
    parse_date(&format!(
        "{year:04}-{:02}-{day:02}T{hour:02}:{minute:02}:00Z",
        month + 1
    ))
}

/// A file's time as a timestamp.
pub fn from_system_time(time: SystemTime) -> Option<Timestamp> {
    let since = time.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    Some(Timestamp::from_unix_ms(i64::try_from(since.as_millis()).ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_formats_of_other_apps() {
        let expected = Timestamp::parse("2024-01-05T14:30:00.000Z").expect("a valid time");
        for text in [
            "2024-01-05T14:30:00Z",
            "2024-01-05 14:30:00",
            "2024-01-05 14:30",
            "20240105T143000Z",
            "\"2024-01-05 14:30:00Z\"",
        ] {
            assert_eq!(parse_date(text), Some(expected), "reading {text}");
        }
        let midnight = Timestamp::parse("2024-01-05T00:00:00Z").expect("a valid time");
        assert_eq!(parse_date("2024-01-05"), Some(midnight));
        assert_eq!(parse_date("last Tuesday"), None);
    }

    #[test]
    fn reads_dates_as_people_write_them() {
        let at = |text: &str| Timestamp::parse(text).expect("a valid time");
        assert_eq!(
            parse_long_date("October 1, 2026 9:30 AM"),
            Some(at("2026-10-01T09:30:00Z"))
        );
        assert_eq!(
            parse_long_date("October 1, 2026 12:05 PM"),
            Some(at("2026-10-01T12:05:00Z"))
        );
        assert_eq!(
            parse_long_date("Oct 1, 2026 12:05 AM"),
            Some(at("2026-10-01T00:05:00Z"))
        );
        assert_eq!(
            parse_long_date("1 October 2026 14:05"),
            Some(at("2026-10-01T14:05:00Z"))
        );
        assert_eq!(
            parse_long_date("@September 30, 2026 11:45 PM (GMT+1)"),
            Some(at("2026-09-30T23:45:00Z"))
        );
        assert_eq!(parse_long_date("2026/10/01"), Some(at("2026-10-01T00:00:00Z")));
        assert_eq!(parse_long_date("whenever"), None);
    }
}
