//! Recognizing the date and time lines that OneNote writes under a page title.

use crate::dates::parse_long_date;

/// Whether a line is a date and nothing else, such as `Friday, October 2, 2026`.
pub(super) fn looks_like_date(text: &str) -> bool {
    text.chars().count() <= 45
        && !text.contains(':')
        && text.chars().filter(char::is_ascii_digit).count() >= 5
        && parse_long_date(text).is_some()
}

/// Whether a line is a time and nothing else, such as `9:30 AM` or `14:05`.
pub(super) fn looks_like_time(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let body = lower.trim_end_matches("am").trim_end_matches("pm").trim();
    body.split_once(':').is_some_and(|(h, m)| {
        !h.is_empty() && h.len() <= 2 && m.len() == 2 && h.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_and_times_are_recognized_narrowly() {
        assert!(looks_like_date("Saturday, October 3, 2026"));
        assert!(looks_like_date("3 October 2026"));
        assert!(!looks_like_date("In October 2026 we plan to meet"));
        assert!(!looks_like_date("Version 3, 2026"));
        assert!(looks_like_time("9:30 AM") && looks_like_time("14:05") && !looks_like_time("9:30 sharp"));
    }
}
