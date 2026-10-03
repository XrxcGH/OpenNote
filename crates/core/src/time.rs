//! Timestamps (spec 2.5) and clocks.
//!
//! A timestamp is Unix milliseconds in UTC. Its text form is always the 24 characters
//! `YYYY-MM-DDTHH:MM:SS.sssZ`, with years from 0001 to 9999.

use std::fmt;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::de::{self, Deserializer, Visitor};
use serde::{Deserialize, Serialize, Serializer};
use thiserror::Error;

const MS_PER_DAY: i64 = 86_400_000;

/// A text timestamp that failed to parse.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum TimeError {
    /// The text doesn't have the form of spec 2.5.
    #[error("the timestamp has the wrong form at character {0}")]
    Syntax(usize),
    /// A field is out of range, such as month 13, or the time is outside the years 0001 to 9999.
    #[error("the timestamp's {0} is out of range")]
    Range(&'static str),
}

/// A point in time: Unix milliseconds in UTC.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Timestamp(i64);

impl Timestamp {
    /// `0001-01-01T00:00:00.000Z`, the earliest time the text form can hold.
    pub const MIN: Timestamp = Timestamp(-62_135_596_800_000);
    /// `9999-12-31T23:59:59.999Z`, the latest time the text form can hold.
    pub const MAX: Timestamp = Timestamp(253_402_300_799_999);
    /// The Unix epoch.
    pub const EPOCH: Timestamp = Timestamp(0);

    /// A timestamp from Unix milliseconds. Values outside [`Timestamp::MIN`] and [`Timestamp::MAX`] are kept,
    /// but their text form is clamped to that range.
    pub const fn from_unix_ms(ms: i64) -> Timestamp {
        Timestamp(ms)
    }

    /// Unix milliseconds.
    pub const fn unix_ms(self) -> i64 {
        self.0
    }

    /// Parses the text form. Also accepts a numeric offset such as `+02:00`, a missing fraction, lowercase `t`
    /// and `z`, and more than 3 fraction digits, which are truncated to milliseconds.
    pub fn parse(text: &str) -> Result<Timestamp, TimeError> {
        let mut p = Cursor {
            bytes: text.as_bytes(),
            at: 0,
        };
        let (year, month, day) = p.date()?;
        p.one_of(b"Tt")?;
        let (hour, minute, second) = p.clock()?;
        let ms = p.fraction()?;
        let offset_minutes = p.offset()?;
        if p.at != p.bytes.len() {
            return Err(TimeError::Syntax(p.at));
        }
        check_fields([year, month, day, hour, minute, second])?;
        let days = days_from_civil(year, month, day);
        let seconds = hour * 3_600 + minute * 60 + second - offset_minutes * 60;
        let total = days * MS_PER_DAY + seconds * 1_000 + ms;
        if !(Timestamp::MIN.0..=Timestamp::MAX.0).contains(&total) {
            return Err(TimeError::Range("year"));
        }
        Ok(Timestamp(total))
    }

    /// The 24-character text form, clamped to the years 0001 to 9999.
    pub fn to_rfc3339(self) -> String {
        let ms = self.0.clamp(Timestamp::MIN.0, Timestamp::MAX.0);
        let (year, month, day) = civil_from_days(ms.div_euclid(MS_PER_DAY));
        let in_day = ms.rem_euclid(MS_PER_DAY);
        let (hour, minute) = (in_day / 3_600_000, in_day / 60_000 % 60);
        let (second, milli) = (in_day / 1_000 % 60, in_day % 1_000);
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
    }

    /// This time plus a duration, saturating at the ends of `i64`.
    #[must_use]
    pub fn saturating_add(self, by: Duration) -> Timestamp {
        Timestamp(self.0.saturating_add(duration_ms(by)))
    }

    /// This time minus a duration, saturating at the ends of `i64`.
    #[must_use]
    pub fn saturating_sub(self, by: Duration) -> Timestamp {
        Timestamp(self.0.saturating_sub(duration_ms(by)))
    }

    /// The time from `earlier` to this time, or zero if `earlier` is later.
    pub fn since(self, earlier: Timestamp) -> Duration {
        let ms = self.0.saturating_sub(earlier.0).max(0);
        Duration::from_millis(u64::try_from(ms).unwrap_or(0))
    }
}

fn duration_ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

/// Checks the year, month, day, hour, minute, and second of a parsed timestamp.
fn check_fields([year, month, day, hour, minute, second]: [i64; 6]) -> Result<(), TimeError> {
    let checks = [
        ((1..=9_999).contains(&year), "year"),
        ((1..=12).contains(&month), "month"),
        ((1..=days_in_month(year, month)).contains(&day), "day"),
        ((0..24).contains(&hour), "hour"),
        ((0..60).contains(&minute), "minute"),
        ((0..60).contains(&second), "second"),
    ];
    match checks.iter().find(|(ok, _)| !ok) {
        Some((_, field)) => Err(TimeError::Range(field)),
        None => Ok(()),
    }
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days from 1970-01-01 to a date in the proleptic Gregorian calendar (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The date of a day number from [`days_from_civil`].
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Reads the fields of a text timestamp one by one.
struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn one_of(&mut self, allowed: &[u8]) -> Result<u8, TimeError> {
        match self.peek() {
            Some(byte) if allowed.contains(&byte) => {
                self.at += 1;
                Ok(byte)
            }
            _ => Err(TimeError::Syntax(self.at)),
        }
    }

    fn number(&mut self, digits: usize) -> Result<i64, TimeError> {
        let mut value = 0;
        for _ in 0..digits {
            let digit = self.one_of(b"0123456789")?;
            value = value * 10 + i64::from(digit - b'0');
        }
        Ok(value)
    }

    fn date(&mut self) -> Result<(i64, i64, i64), TimeError> {
        let year = self.number(4)?;
        self.one_of(b"-")?;
        let month = self.number(2)?;
        self.one_of(b"-")?;
        Ok((year, month, self.number(2)?))
    }

    fn clock(&mut self) -> Result<(i64, i64, i64), TimeError> {
        let hour = self.number(2)?;
        self.one_of(b":")?;
        let minute = self.number(2)?;
        self.one_of(b":")?;
        Ok((hour, minute, self.number(2)?))
    }

    /// An optional fraction of a second, truncated to milliseconds.
    fn fraction(&mut self) -> Result<i64, TimeError> {
        if self.peek() != Some(b'.') {
            return Ok(0);
        }
        self.at += 1;
        let mut ms = 0;
        let mut count = 0;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            if count < 3 {
                ms = ms * 10 + i64::from(self.bytes[self.at] - b'0');
            }
            count += 1;
            self.at += 1;
        }
        if count == 0 {
            return Err(TimeError::Syntax(self.at));
        }
        for _ in count..3 {
            ms *= 10;
        }
        Ok(ms)
    }

    /// `Z`, or an offset such as `+02:00`, in minutes east of UTC.
    fn offset(&mut self) -> Result<i64, TimeError> {
        let sign = match self.one_of(b"Zz+-")? {
            b'+' => 1,
            b'-' => -1,
            _ => return Ok(0),
        };
        let hours = self.number(2)?;
        self.one_of(b":")?;
        let minutes = self.number(2)?;
        if hours > 23 || minutes > 59 {
            return Err(TimeError::Range("offset"));
        }
        Ok(sign * (hours * 60 + minutes))
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_rfc3339())
    }
}

impl fmt::Debug for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_rfc3339())
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_rfc3339())
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Timestamp, D::Error> {
        // Parsed where the text lies, without a copy of it: pages and journals hold thousands of times.
        struct TimeVisitor;
        impl Visitor<'_> for TimeVisitor {
            type Value = Timestamp;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string")
            }
            fn visit_str<E: de::Error>(self, text: &str) -> Result<Timestamp, E> {
                Timestamp::parse(text).map_err(E::custom)
            }
            fn visit_bytes<E: de::Error>(self, bytes: &[u8]) -> Result<Timestamp, E> {
                let text =
                    std::str::from_utf8(bytes).map_err(|_| E::invalid_value(de::Unexpected::Bytes(bytes), &self))?;
                self.visit_str(text)
            }
        }
        deserializer.deserialize_str(TimeVisitor)
    }
}

/// A source of time. Every clock read in the core goes through one, so tests can control time.
pub trait Clock: Send + Sync {
    /// Wall time, anchored to the monotonic clock once, so it never jumps backward (spec 2.5).
    fn now(&self) -> Timestamp;
    /// Time since an arbitrary start, for timers.
    fn monotonic(&self) -> Duration;
}

/// The real clock. It reads the system time once, then advances with the monotonic clock.
#[derive(Debug)]
pub struct SystemClock {
    wall_at_start: i64,
    start: Instant,
}

impl SystemClock {
    /// Anchors a new clock to the current system time.
    pub fn new() -> SystemClock {
        let wall_at_start = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(since) => duration_ms(since),
            Err(before) => duration_ms(before.duration()).saturating_neg(),
        };
        SystemClock {
            wall_at_start,
            start: Instant::now(),
        }
    }
}

impl Default for SystemClock {
    fn default() -> SystemClock {
        SystemClock::new()
    }
}

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        Timestamp(self.wall_at_start.saturating_add(duration_ms(self.start.elapsed())))
    }

    fn monotonic(&self) -> Duration {
        self.start.elapsed()
    }
}

/// A clock that moves only when a test tells it to.
#[derive(Debug)]
pub struct TestClock {
    state: Mutex<(Timestamp, Duration)>,
}

impl TestClock {
    /// A clock at `start`, with the monotonic clock at zero.
    pub fn new(start: Timestamp) -> TestClock {
        TestClock {
            state: Mutex::new((start, Duration::ZERO)),
        }
    }

    /// Moves both the wall time and the monotonic clock forward.
    pub fn advance(&self, by: Duration) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.0 = state.0.saturating_add(by);
        state.1 = state.1.saturating_add(by);
    }

    /// Sets the wall time only, as a change to the system clock would.
    pub fn set_wall(&self, now: Timestamp) {
        self.state.lock().unwrap_or_else(PoisonError::into_inner).0 = now;
    }
}

impl Clock for TestClock {
    fn now(&self) -> Timestamp {
        self.state.lock().unwrap_or_else(PoisonError::into_inner).0
    }

    fn monotonic(&self) -> Duration {
        self.state.lock().unwrap_or_else(PoisonError::into_inner).1
    }
}

#[cfg(test)]
mod tests;
