use proptest::prelude::*;

use super::*;

fn key(text: &str) -> OrderKey {
    OrderKey::parse(text).unwrap()
}

fn between(a: Option<&str>, b: Option<&str>) -> Result<String, OrderError> {
    let a = a.map(key);
    let b = b.map(key);
    OrderKey::between(a.as_ref(), b.as_ref()).map(|k| k.as_str().to_owned())
}

/// The reference test vectors of the fractional-indexing library.
#[test]
fn matches_the_reference_vectors() {
    let cases: &[(Option<&str>, Option<&str>, &str)] = &[
        (None, None, "a0"),
        (None, Some("a0"), "Zz"),
        (None, Some("Zz"), "Zy"),
        (Some("a0"), None, "a1"),
        (Some("a1"), None, "a2"),
        (Some("a0"), Some("a1"), "a0V"),
        (Some("a1"), Some("a2"), "a1V"),
        (Some("a0V"), Some("a1"), "a0l"),
        (Some("Zz"), Some("a0"), "ZzV"),
        (Some("Zz"), Some("a1"), "a0"),
        (None, Some("Y00"), "Xzzz"),
        (Some("bzz"), None, "c000"),
        (Some("a0"), Some("a0V"), "a0G"),
        (Some("a0"), Some("a0G"), "a08"),
        (Some("b125"), Some("b129"), "b127"),
        (Some("a0"), Some("a1V"), "a1"),
        (Some("Zz"), Some("a01"), "a0"),
        (None, Some("a0V"), "a0"),
        (None, Some("b999"), "b99"),
        (
            None,
            Some("A000000000000000000000000001"),
            "A000000000000000000000000000V",
        ),
        (Some("zzzzzzzzzzzzzzzzzzzzzzzzzzy"), None, "zzzzzzzzzzzzzzzzzzzzzzzzzzz"),
        (
            Some("zzzzzzzzzzzzzzzzzzzzzzzzzzz"),
            None,
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzV",
        ),
    ];
    for &(a, b, expected) in cases {
        assert_eq!(between(a, b).as_deref(), Ok(expected), "between {a:?} and {b:?}");
    }
}

#[test]
fn rejects_the_reference_error_cases() {
    assert!(matches!(
        between(None, Some("A00000000000000000000000000")),
        Err(OrderError::Invalid(_))
    ));
    assert!(matches!(between(Some("a00"), None), Err(OrderError::Invalid(_))));
    assert!(matches!(between(Some("a00"), Some("a1")), Err(OrderError::Invalid(_))));
    assert!(matches!(between(Some("0"), Some("1")), Err(OrderError::Invalid(_))));
    assert!(matches!(
        between(Some("a1"), Some("a0")),
        Err(OrderError::NotAscending(_, _))
    ));
    assert!(matches!(
        between(Some("a1"), Some("a1")),
        Err(OrderError::NotAscending(_, _))
    ));
}

#[test]
fn spreads_like_the_reference() {
    let spread = |a: Option<&str>, b: Option<&str>, n: usize| -> String {
        let a = a.map(key);
        let b = b.map(key);
        let keys = OrderKey::spread(a.as_ref(), b.as_ref(), n).unwrap();
        keys.iter().map(OrderKey::as_str).collect::<Vec<_>>().join(" ")
    };
    assert_eq!(spread(None, None, 5), "a0 a1 a2 a3 a4");
    assert_eq!(spread(Some("a4"), None, 10), "a5 a6 a7 a8 a9 aA aB aC aD aE");
    assert_eq!(spread(None, Some("a0"), 5), "Zv Zw Zx Zy Zz");
    assert_eq!(
        spread(Some("a0"), Some("a2"), 20),
        "a04 a08 a0G a0K a0O a0V a0Z a0d a0l a0t a1 a14 a18 a1G a1O a1V a1Z a1d a1l a1t"
    );
    assert_eq!(spread(None, None, 0), "");
}

#[test]
fn parse_accepts_any_key_the_format_allows() {
    assert!(OrderKey::parse("0").is_ok());
    assert!(OrderKey::parse(&"z".repeat(256)).is_ok());
    for bad in ["", "a-0", "a 0", "á0", &"z".repeat(257)] {
        assert_eq!(OrderKey::parse(bad), Err(OrderError::Malformed), "{bad:?}");
    }
    assert!(!key("0").is_fractional());
    assert!(!key("a00").is_fractional());
    assert!(key("a0V").is_fractional());
}

#[test]
fn refuses_keys_longer_than_the_limit() {
    let long = format!("a0{}", "V".repeat(254));
    assert_eq!(long.len(), 256);
    assert_eq!(
        between(Some(&long), Some(&format!("a0{}W", "V".repeat(253)))),
        Err(OrderError::TooLong)
    );
}

#[test]
fn ten_thousand_appends_stay_at_four_characters() {
    let mut last: Option<OrderKey> = None;
    for _ in 0..10_000 {
        let next = OrderKey::between(last.as_ref(), None).unwrap();
        assert!(last.as_ref().is_none_or(|l| l < &next));
        assert!(next.as_str().len() <= 4, "{next}");
        last = Some(next);
    }
}

#[test]
fn serializes_as_text() {
    assert_eq!(serde_json::to_string(&key("a0V")).unwrap(), "\"a0V\"");
    assert_eq!(serde_json::from_str::<OrderKey>("\"Zz\"").unwrap(), key("Zz"));
    assert!(serde_json::from_str::<OrderKey>("\"a-b\"").is_err());
}

/// A valid fractional key: an integer part and a fraction without a trailing zero.
fn arb_key() -> impl Strategy<Value = OrderKey> {
    ("[a-c][0-9A-Za-z]{0,3}", "([0-9A-Za-z]{0,5}[1-9A-Za-z])?").prop_filter_map(
        "needs a full integer part",
        |(i, f)| {
            let len = usize::from(i.as_bytes()[0] - b'a') + 2;
            (i.len() == len).then(|| key(&format!("{i}{f}")))
        },
    )
}

proptest! {
    /// P7: a new key sorts strictly between its bounds.
    #[test]
    fn between_sorts_strictly_between(a in arb_key(), b in arb_key()) {
        prop_assume!(a != b);
        let (low, high) = if a < b { (a, b) } else { (b, a) };
        let mid = OrderKey::between(Some(&low), Some(&high)).unwrap();
        prop_assert!(low < mid && mid < high, "{low} < {mid} < {high}");
        prop_assert!(mid.is_fractional());
        let before = OrderKey::between(None, Some(&low)).unwrap();
        let after = OrderKey::between(Some(&high), None).unwrap();
        prop_assert!(before < low && high < after);
    }

    /// P7: spread keys ascend strictly within their bounds.
    #[test]
    fn spread_ascends_within_bounds(a in arb_key(), b in arb_key(), n in 0usize..40) {
        prop_assume!(a != b);
        let (low, high) = if a < b { (a, b) } else { (b, a) };
        let keys = OrderKey::spread(Some(&low), Some(&high), n).unwrap();
        prop_assert_eq!(keys.len(), n);
        let mut previous = low.clone();
        for k in keys.iter().chain(std::iter::once(&high)) {
            prop_assert!(&previous < k, "{} < {}", previous, k);
            previous = k.clone();
        }
    }
}
