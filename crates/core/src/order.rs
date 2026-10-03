//! Order keys (spec 2.8): strings of 1 to 256 characters from `0-9A-Za-z` that sort items byte by byte.
//!
//! [`OrderKey::between`] ports the base-62 variant of the fractional-indexing algorithm that Rocicorp published
//! under the Creative Commons Zero license (<https://github.com/rocicorp/fractional-indexing>). A key has an
//! integer part, whose first character gives its length, and a fraction part without trailing zeros.
//! Readers only compare keys, so keys written by other tools may not follow that structure. For such
//! neighbors, `between` returns [`OrderError::Invalid`], and the caller gives the list new keys with
//! [`OrderKey::spread`].

use std::fmt;

use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize, Serializer};
use thiserror::Error;

/// The base-62 digits in byte order.
const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// The longest key the format allows (spec 16).
pub const MAX_KEY_LEN: usize = 256;

/// The smallest integer part, which has no key before it.
const SMALLEST_INTEGER: &str = "A00000000000000000000000000";

/// An order key that couldn't be parsed or made.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum OrderError {
    /// Empty, too long, or a character outside `0-9A-Za-z`.
    #[error("an order key is 1 to 256 characters from 0-9A-Za-z")]
    Malformed,
    /// A key that is valid in the format but doesn't have the structure `between` needs.
    #[error("the order key {0} can't be used to make a new key")]
    Invalid(String),
    /// The lower bound is not below the upper bound.
    #[error("the order key {0} is not below {1}")]
    NotAscending(String, String),
    /// The new key would be longer than 256 characters.
    #[error("the new order key would be longer than 256 characters")]
    TooLong,
    /// No key exists before the smallest key or after the largest one.
    #[error("there is no order key beyond {0}")]
    Exhausted(String),
}

/// A position among siblings. Keys compare byte by byte, and ties are broken by ID.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OrderKey(Box<str>);

impl OrderKey {
    /// Checks that `text` is 1 to 256 characters from `0-9A-Za-z`.
    pub fn parse(text: &str) -> Result<OrderKey, OrderError> {
        let valid = !text.is_empty() && text.len() <= MAX_KEY_LEN && text.bytes().all(|b| b.is_ascii_alphanumeric());
        if valid {
            Ok(OrderKey(text.into()))
        } else {
            Err(OrderError::Malformed)
        }
    }

    /// The key's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// A key strictly between `before` and `after`. `None` means no bound on that side.
    pub fn between(before: Option<&OrderKey>, after: Option<&OrderKey>) -> Result<OrderKey, OrderError> {
        let before = before.map(OrderKey::as_str);
        let after = after.map(OrderKey::as_str);
        for key in before.iter().chain(after.iter()) {
            validate_structure(key)?;
        }
        if let (Some(a), Some(b)) = (before, after) {
            if a >= b {
                return Err(OrderError::NotAscending(a.to_owned(), b.to_owned()));
            }
        }
        let key = key_between(before, after)?;
        if key.len() > MAX_KEY_LEN {
            return Err(OrderError::TooLong);
        }
        Ok(OrderKey(key.into()))
    }

    /// `n` keys in ascending order, strictly between `before` and `after`, spaced to keep them short.
    pub fn spread(before: Option<&OrderKey>, after: Option<&OrderKey>, n: usize) -> Result<Vec<OrderKey>, OrderError> {
        let mut keys = Vec::with_capacity(n);
        spread_into(before, after, n, &mut keys)?;
        Ok(keys)
    }

    /// Whether [`OrderKey::between`] can use this key as a bound.
    pub fn is_fractional(&self) -> bool {
        validate_structure(&self.0).is_ok()
    }
}

fn spread_into(
    before: Option<&OrderKey>,
    after: Option<&OrderKey>,
    n: usize,
    out: &mut Vec<OrderKey>,
) -> Result<(), OrderError> {
    match n {
        0 => Ok(()),
        1 => {
            out.push(OrderKey::between(before, after)?);
            Ok(())
        }
        _ if after.is_none() => {
            let mut last = before.cloned();
            for _ in 0..n {
                let next = OrderKey::between(last.as_ref(), None)?;
                out.push(next.clone());
                last = Some(next);
            }
            Ok(())
        }
        _ if before.is_none() => {
            let start = out.len();
            let mut first = after.cloned();
            for _ in 0..n {
                let next = OrderKey::between(None, first.as_ref())?;
                out.push(next.clone());
                first = Some(next);
            }
            out[start..].reverse();
            Ok(())
        }
        _ => {
            let mid = n / 2;
            let middle = OrderKey::between(before, after)?;
            spread_into(before, Some(&middle), mid, out)?;
            out.push(middle.clone());
            spread_into(Some(&middle), after, n - mid - 1, out)
        }
    }
}

fn digit_index(byte: u8) -> Option<usize> {
    DIGITS.iter().position(|&d| d == byte)
}

/// The length of the integer part, from its first character.
fn integer_len(head: u8) -> Option<usize> {
    match head {
        b'a'..=b'z' => Some(usize::from(head - b'a') + 2),
        b'A'..=b'Z' => Some(usize::from(b'Z' - head) + 2),
        _ => None,
    }
}

fn integer_part(key: &str) -> Result<&str, OrderError> {
    let head = key.bytes().next().ok_or(OrderError::Malformed)?;
    let len = integer_len(head).ok_or_else(|| OrderError::Invalid(key.to_owned()))?;
    key.get(..len).ok_or_else(|| OrderError::Invalid(key.to_owned()))
}

fn validate_structure(key: &str) -> Result<(), OrderError> {
    OrderKey::parse(key)?;
    if key == SMALLEST_INTEGER {
        return Err(OrderError::Invalid(key.to_owned()));
    }
    let integer = integer_part(key)?;
    if key.len() > integer.len() && key.ends_with('0') {
        return Err(OrderError::Invalid(key.to_owned()));
    }
    Ok(())
}

fn key_between(a: Option<&str>, b: Option<&str>) -> Result<String, OrderError> {
    match (a, b) {
        (None, None) => Ok("a0".to_owned()),
        (None, Some(b)) => key_before(b),
        (Some(a), None) => {
            let int_a = integer_part(a)?;
            match increment_integer(int_a) {
                Some(next) => Ok(next),
                None => Ok(format!("{int_a}{}", midpoint(&a[int_a.len()..], None)?)),
            }
        }
        (Some(a), Some(b)) => {
            let (int_a, int_b) = (integer_part(a)?, integer_part(b)?);
            if int_a == int_b {
                return Ok(format!(
                    "{int_a}{}",
                    midpoint(&a[int_a.len()..], Some(&b[int_b.len()..]))?
                ));
            }
            let next = increment_integer(int_a).ok_or_else(|| OrderError::Exhausted(a.to_owned()))?;
            if next.as_str() < b {
                Ok(next)
            } else {
                Ok(format!("{int_a}{}", midpoint(&a[int_a.len()..], None)?))
            }
        }
    }
}

fn key_before(b: &str) -> Result<String, OrderError> {
    let int_b = integer_part(b)?;
    let frac_b = &b[int_b.len()..];
    if int_b == SMALLEST_INTEGER {
        return Ok(format!("{int_b}{}", midpoint("", Some(frac_b))?));
    }
    if int_b.len() < b.len() {
        return Ok(int_b.to_owned());
    }
    decrement_integer(int_b).ok_or_else(|| OrderError::Exhausted(b.to_owned()))
}

/// A fraction strictly between the fractions `a` and `b`, which have no trailing zeros.
fn midpoint(a: &str, b: Option<&str>) -> Result<String, OrderError> {
    let (a, b) = (a.as_bytes(), b.map(str::as_bytes));
    if let Some(b) = b {
        let common = (0..b.len())
            .take_while(|&i| a.get(i).copied().unwrap_or(b'0') == b[i])
            .count();
        if common > 0 {
            let rest_a = std::str::from_utf8(a.get(common..).unwrap_or(&[])).unwrap_or("");
            let rest_b = std::str::from_utf8(&b[common..]).unwrap_or("");
            let prefix = std::str::from_utf8(&b[..common]).unwrap_or("");
            return Ok(format!("{prefix}{}", midpoint(rest_a, Some(rest_b))?));
        }
    }
    let digit_a = match a.first() {
        Some(&c) => digit_index(c).ok_or(OrderError::Malformed)?,
        None => 0,
    };
    let digit_b = match b.and_then(|b| b.first()) {
        Some(&c) => digit_index(c).ok_or(OrderError::Malformed)?,
        None => DIGITS.len(),
    };
    if digit_b.saturating_sub(digit_a) > 1 {
        // Rounds half up, as JavaScript's Math.round does in the reference.
        let mid = (digit_a + digit_b).div_ceil(2);
        return Ok(char::from(DIGITS[mid]).to_string());
    }
    match b {
        Some(b) if b.len() > 1 => Ok(char::from(b[0]).to_string()),
        _ => {
            let rest = std::str::from_utf8(a.get(1..).unwrap_or(&[])).unwrap_or("");
            Ok(format!("{}{}", char::from(DIGITS[digit_a]), midpoint(rest, None)?))
        }
    }
}

/// The next integer part, or `None` after the largest one.
fn increment_integer(x: &str) -> Option<String> {
    let bytes = x.as_bytes();
    let (&head, digits) = bytes.split_first()?;
    let mut digits = digits.to_vec();
    for slot in digits.iter_mut().rev() {
        let d = digit_index(*slot)? + 1;
        if d < DIGITS.len() {
            *slot = DIGITS[d];
            return String::from_utf8([&[head][..], &digits].concat()).ok();
        }
        *slot = DIGITS[0];
    }
    match head {
        b'Z' => Some("a0".to_owned()),
        b'z' => None,
        _ => {
            let next = head + 1;
            if next > b'a' {
                digits.push(DIGITS[0]);
            } else {
                digits.pop();
            }
            String::from_utf8([&[next][..], &digits].concat()).ok()
        }
    }
}

/// The previous integer part, or `None` before the smallest one.
fn decrement_integer(x: &str) -> Option<String> {
    let bytes = x.as_bytes();
    let (&head, digits) = bytes.split_first()?;
    let mut digits = digits.to_vec();
    let last = DIGITS[DIGITS.len() - 1];
    for slot in digits.iter_mut().rev() {
        let d = digit_index(*slot)?;
        if d > 0 {
            *slot = DIGITS[d - 1];
            return String::from_utf8([&[head][..], &digits].concat()).ok();
        }
        *slot = last;
    }
    match head {
        b'a' => Some(format!("Z{}", char::from(last))),
        b'A' => None,
        _ => {
            let previous = head - 1;
            if previous < b'Z' {
                digits.push(last);
            } else {
                digits.pop();
            }
            String::from_utf8([&[previous][..], &digits].concat()).ok()
        }
    }
}

impl fmt::Display for OrderKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Debug for OrderKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "OrderKey({})", self.0)
    }
}

impl Serialize for OrderKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for OrderKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<OrderKey, D::Error> {
        let text = String::deserialize(deserializer)?;
        OrderKey::parse(&text).map_err(de::Error::custom)
    }
}

#[cfg(test)]
mod tests;
