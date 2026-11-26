//! Numbers and units: Word's twips and half-points become the points of OpenNote's values (spec 2.6, `R-NUM-2`).

use serde_json::Value;

/// A number as JSON: an integer when it is whole, so `36` stays `36` and never `36.0`.
pub(super) fn num(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        Value::from(v as i64)
    } else {
        Value::from(v)
    }
}

/// Twips (twentieths of a point) in points. Twips are whole numbers, so the result falls on a 0.05 step.
pub(super) fn twips(t: i32) -> f64 {
    f64::from(t) / 20.0
}

/// A number written without trailing zeros, such as `10.5` or `11`.
pub(super) fn text(v: f64) -> String {
    let rounded = (v * 100.0).round() / 100.0;
    let mut out = format!("{rounded:.2}");
    while out.ends_with('0') {
        out.pop();
    }
    if out.ends_with('.') {
        out.pop();
    }
    if out == "-0" {
        out = "0".to_owned();
    }
    out
}

/// A color as OpenNote writes it: `#` and six lowercase hex digits.
pub(super) fn hex(rgb: &str) -> String {
    format!("#{}", rgb.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_drop_trailing_zeros() {
        assert_eq!(text(10.5), "10.5");
        assert_eq!(text(11.0), "11");
        assert_eq!(text(-1.25), "-1.25");
        assert_eq!(num(36.0), Value::from(36));
        assert_eq!(num(-18.0), Value::from(-18));
        assert_eq!(num(1.15), Value::from(1.15));
        assert_eq!(twips(720), 36.0);
    }
}
