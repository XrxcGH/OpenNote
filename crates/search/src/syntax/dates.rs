//! Dates for search operators such as `before:2026-03-01` and `after:7d`, read in the person's local time.

const DAY_MS: i64 = 86_400_000;

/// The days since 1970-01-01 of a calendar date (proleptic Gregorian).
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let shifted = (month + 9) % 12;
    let day_of_year = (153 * shifted + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The calendar date of a count of days since 1970-01-01.
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    days_from_civil(
        if month == 12 { year + 1 } else { year },
        if month == 12 { 1 } else { month + 1 },
        1,
    ) - days_from_civil(year, month, 1)
}

/// A span of time as Unix milliseconds: `from` is included and `to` is not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub from: i64,
    pub to: i64,
}

/// Where the person is in time: the current moment and the offset of local time from UTC.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    pub now_ms: i64,
    pub utc_offset_minutes: i32,
}

impl Clock {
    fn local_midnight(&self, days: i64) -> i64 {
        days * DAY_MS - i64::from(self.utc_offset_minutes) * 60_000
    }

    fn today(&self) -> i64 {
        (self.now_ms + i64::from(self.utc_offset_minutes) * 60_000).div_euclid(DAY_MS)
    }

    fn day(&self, days: i64) -> Span {
        Span {
            from: self.local_midnight(days),
            to: self.local_midnight(days + 1),
        }
    }

    fn months(&self, year: i64, month: i64, count: i64) -> Option<Span> {
        let (end_year, end_month) = {
            let index = year * 12 + (month - 1) + count;
            (index.div_euclid(12), index.rem_euclid(12) + 1)
        };
        Some(Span {
            from: self.local_midnight(days_from_civil(year, month, 1)),
            to: self.local_midnight(days_from_civil(end_year, end_month, 1)),
        })
    }

    /// Reads a day, month, or year. Returns `None` for text that is not a date.
    ///
    /// The forms are `today`, `yesterday`, `tomorrow`, `2026-03-01`, `2026-03`, `2026`, and a time ago such as
    /// `7d`, `2w`, `3m`, or `1y`, which is the day that long ago.
    pub fn span(&self, text: &str) -> Option<Span> {
        let text = text.trim().to_ascii_lowercase();
        match text.as_str() {
            "today" => return Some(self.day(self.today())),
            "yesterday" => return Some(self.day(self.today() - 1)),
            "tomorrow" => return Some(self.day(self.today() + 1)),
            _ => {}
        }
        self.ago(&text).or_else(|| self.calendar(&text))
    }

    fn ago(&self, text: &str) -> Option<Span> {
        let unit = text.chars().last()?;
        let count: i64 = text[..text.len() - unit.len_utf8()].parse().ok()?;
        if !(0..=100_000).contains(&count) || !text.as_bytes()[0].is_ascii_digit() {
            return None;
        }
        let today = self.today();
        match unit {
            'd' => Some(self.day(today - count)),
            'w' => Some(self.day(today - count * 7)),
            'm' | 'y' => {
                let (year, month, day) = civil_from_days(today);
                let back = if unit == 'y' { count * 12 } else { count };
                let index = year * 12 + (month - 1) - back;
                let (year, month) = (index.div_euclid(12), index.rem_euclid(12) + 1);
                let day = day.min(days_in_month(year, month));
                Some(self.day(days_from_civil(year, month, day)))
            }
            _ => None,
        }
    }

    fn calendar(&self, text: &str) -> Option<Span> {
        let parts: Vec<&str> = text.split(['-', '/', '.']).collect();
        let number = |part: &str, width: usize| -> Option<i64> {
            (part.len() == width && part.bytes().all(|b| b.is_ascii_digit()))
                .then(|| part.parse().ok())
                .flatten()
        };
        let year = number(parts.first()?, 4)?;
        match parts.len() {
            1 => self.months(year, 1, 12),
            2 => {
                let month = number(parts[1], 2).or_else(|| number(parts[1], 1))?;
                (1..=12).contains(&month).then_some(())?;
                self.months(year, month, 1)
            }
            3 => {
                let month = number(parts[1], 2).or_else(|| number(parts[1], 1))?;
                let day = number(parts[2], 2).or_else(|| number(parts[2], 1))?;
                (1..=12).contains(&month).then_some(())?;
                (1..=days_in_month(year, month)).contains(&day).then_some(())?;
                Some(self.day(days_from_civil(year, month, day)))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARCH_5: i64 = 1_772_713_200_000; // 2026-03-05 12:20 UTC, a Thursday

    fn clock(offset: i32) -> Clock {
        Clock {
            now_ms: MARCH_5,
            utc_offset_minutes: offset,
        }
    }

    #[test]
    fn civil_dates_and_days_convert_both_ways() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        for days in (-800_000..800_000).step_by(997) {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2026, 2), 28);
        assert_eq!(days_in_month(2026, 12), 31);
    }

    #[test]
    fn a_day_runs_from_local_midnight_to_the_next() {
        let utc = clock(0).span("2026-03-05").unwrap();
        assert_eq!(utc.to - utc.from, DAY_MS);
        assert_eq!(utc.from, days_from_civil(2026, 3, 5) * DAY_MS);
        let seattle = clock(-480).span("2026-03-05").unwrap();
        assert_eq!(seattle.from, utc.from + 8 * 3_600_000);
        assert_eq!(clock(0).span("today"), Some(utc));
        assert_eq!(clock(0).span("Yesterday").unwrap().to, utc.from);
        assert_eq!(clock(0).span("tomorrow").unwrap().from, utc.to);
    }

    #[test]
    fn today_follows_local_time() {
        // 12:20 UTC is still the same day in Seattle and already the next in Auckland.
        assert_eq!(clock(-480).span("today"), clock(-480).span("2026-03-05"));
        assert_eq!(clock(13 * 60).span("today"), clock(13 * 60).span("2026-03-06"));
    }

    #[test]
    fn months_and_years_cover_every_day() {
        let february = clock(0).span("2026-02").unwrap();
        assert_eq!((february.to - february.from) / DAY_MS, 28);
        let year = clock(0).span("2024").unwrap();
        assert_eq!((year.to - year.from) / DAY_MS, 366);
        let december = clock(0).span("2026-12").unwrap();
        assert_eq!(december.to, clock(0).span("2027-01").unwrap().from);
        assert_eq!(clock(0).span("2026/3/5"), clock(0).span("2026-03-05"));
    }

    #[test]
    fn a_time_ago_is_a_day() {
        assert_eq!(clock(0).span("0d"), clock(0).span("today"));
        assert_eq!(clock(0).span("7d"), clock(0).span("2026-02-26"));
        assert_eq!(clock(0).span("2w"), clock(0).span("2026-02-19"));
        assert_eq!(clock(0).span("1m"), clock(0).span("2026-02-05"));
        assert_eq!(clock(0).span("1y"), clock(0).span("2025-03-05"));
    }

    #[test]
    fn a_month_ago_clamps_to_the_end_of_a_shorter_month() {
        let may_31 = Clock {
            now_ms: days_from_civil(2026, 5, 31) * DAY_MS + 3_600_000,
            utc_offset_minutes: 0,
        };
        assert_eq!(may_31.span("1m"), may_31.span("2026-04-30"));
    }

    #[test]
    fn other_text_is_not_a_date() {
        for text in [
            "",
            "soon",
            "2026-13",
            "2026-02-30",
            "2026-00-10",
            "26-03-05",
            "2026-03-05-1",
            "-3d",
            "d",
            "3x",
            "1.5d",
            "2026-3-",
        ] {
            assert_eq!(clock(0).span(text), None, "{text:?}");
        }
    }
}
