#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use serde_json::json;

use super::*;

fn parse_str(text: &str) -> Result<Value, FormatError> {
    parse(text.as_bytes(), &Limits::default())
}

fn kind(text: &str) -> FormatErrorKind {
    parse_str(text).unwrap_err().kind
}

#[test]
fn reads_what_the_spec_allows() {
    assert_eq!(
        parse_str("{\"a\": [1, -2, 3.5, true, null, \"x\"]}").unwrap(),
        json!({"a": [1, -2, 3.5, true, null, "x"]})
    );
    assert_eq!(
        parse(b"\xEF\xBB\xBF{\"a\":1}", &Limits::default()).unwrap(),
        json!({"a": 1})
    );
    assert_eq!(parse_str("{\r\n\t\"a\" :\r\n 1 }\r\n").unwrap(), json!({"a": 1}));
    assert_eq!(
        parse_str(r#""é😀\/\b\f\n\r\t""#).unwrap(),
        json!("é😀/\u{8}\u{c}\n\r\t")
    );
    assert_eq!(parse_str("18446744073709551615").unwrap(), json!(u64::MAX));
    assert_eq!(parse_str("-9223372036854775808").unwrap(), json!(i64::MIN));
    assert!(parse_str("1e300").unwrap().is_f64());
    assert!(parse_str("123456789012345678901234567890").unwrap().is_f64());
    assert_eq!(parse_str("-0").unwrap(), json!(0));
}

#[test]
fn rejects_what_the_spec_forbids() {
    assert_eq!(kind("{\"a\": 1, \"a\": 2}"), FormatErrorKind::DuplicateKey);
    assert_eq!(kind(r#""\ud800""#), FormatErrorKind::Encoding);
    assert_eq!(kind(r#""\udc00""#), FormatErrorKind::Encoding);
    assert_eq!(kind(r#""\ud800A""#), FormatErrorKind::Encoding);
    assert_eq!(
        parse(b"\"\xff\"", &Limits::default()).unwrap_err().kind,
        FormatErrorKind::Encoding
    );
    assert_eq!(kind("1e999"), FormatErrorKind::Syntax);
    for bad in [
        "",
        "{",
        "[1,]",
        "{\"a\" 1}",
        "01",
        "1.",
        "+1",
        "tru",
        "\"a\u{1}\"",
        "{} {}",
        "NaN",
        "'a'",
    ] {
        assert!(parse_str(bad).is_err(), "{bad:?}");
    }
    let limits = Limits {
        page_json_bytes: 4,
        ..Limits::default()
    };
    assert_eq!(parse(b"[1, 2]", &limits).unwrap_err().kind, FormatErrorKind::Limit);
}

#[test]
fn nesting_stops_at_the_limit() {
    let nested = |depth: usize| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    assert!(parse_str(&nested(128)).is_ok());
    assert_eq!(kind(&nested(129)), FormatErrorKind::TooDeep);
    assert_eq!(kind(&nested(100_000)), FormatErrorKind::TooDeep);
}

#[test]
fn errors_carry_offsets() {
    let error = parse_str("{\"a\": 1, \"a\": 2}").unwrap_err();
    assert_eq!(error.offset, Some(9));
    assert_eq!(parse_str("[1, x]").unwrap_err().offset, Some(4));
}

#[test]
fn writes_strings_with_the_fewest_escapes() {
    let mut out = String::new();
    write_string(&mut out, "a\"b\\c\u{0}\u{1f}\u{7f}\n\t\u{8}\u{c}\r/é\u{2028}");
    assert_eq!(out, "\"a\\\"b\\\\c\\u0000\\u001f\u{7f}\\n\\t\\b\\f\\r/é\u{2028}\"");
}

#[test]
fn formats_fixed_numbers_in_the_shortest_form() {
    let cases = [
        (96.0, "96"),
        (96.5, "96.5"),
        (793.7, "793.7"),
        (-12.25, "-12.25"),
        (0.004, "0"),
        (-0.004, "0"),
        (-0.0, "0"),
        (1122.52, "1122.52"),
        (0.125, "0.13"),
        (10_000_000.0, "10000000"),
        (f64::NAN, "0"),
    ];
    for (value, text) in cases {
        assert_eq!(fixed(value, 2), text, "{value}");
    }
    assert_eq!(fixed(17.25, 1), "17.3");
    assert_eq!(fixed(0.000_001, 6), "0.000001");
}

#[test]
fn writes_arrays_objects_and_unknown_data_canonically() {
    let raw = json!({"z": [{"b": 2, "a": 1}], "a": [1.5, "x", null], "m": {}, "e": []});
    let extra = raw.as_object().unwrap().clone();
    let mut obj = Obj::new();
    obj.put("known", Json::Array(vec![Json::Int(1), Json::Geometry(2.345)]))
        .put("nested", Json::Array(vec![Json::Array(vec![])]));
    let text = String::from_utf8(write_document(&obj.finish(&extra))).unwrap();
    let expected = r#"{
  "known": [1, 2.35],
  "nested": [
    []
  ],
  "a": [1.5, "x", null],
  "e": [],
  "m": {},
  "z": [
    {
      "a": 1,
      "b": 2
    }
  ]
}
"#;
    assert_eq!(text, expected);
}

#[test]
fn unknown_keys_never_repeat_a_known_key() {
    let extra = json!({"title": "shadow", "zz": 1}).as_object().unwrap().clone();
    let mut obj = Obj::new();
    obj.put("title", Json::str("real"));
    let text = String::from_utf8(write_document(&obj.finish(&extra))).unwrap();
    assert_eq!(text, "{\n  \"title\": \"real\",\n  \"zz\": 1\n}\n");
    assert!(parse(text.as_bytes(), &Limits::default()).is_ok());
}

#[test]
fn floats_in_unknown_data_round_trip() {
    for value in [
        json!(0.1),
        json!(1.0),
        json!(-0.0),
        json!(1e300),
        json!(5e-324),
        json!(123456.789),
    ] {
        let doc = json!({"v": value});
        let extra = doc.as_object().unwrap().clone();
        let bytes = write_document(&Obj::new().finish(&extra));
        assert_eq!(parse(&bytes, &Limits::default()).unwrap(), doc, "{value}");
    }
}

#[test]
fn finds_top_level_strings() {
    assert_eq!(
        top_level_string(br#"{"a": {"title": 1}, "title": "t"}"#, "title").as_deref(),
        Some("t")
    );
    assert_eq!(
        top_level_string(br#"{"a": "}", "title": "t"}"#, "title").as_deref(),
        Some("t")
    );
    assert_eq!(
        top_level_string(br#"{"a": "\"", "b": [1, {"c": "]"}], "title": "t"}"#, "title").as_deref(),
        Some("t")
    );
    assert_eq!(top_level_string(br#"{"a": 1}"#, "title"), None);
    assert_eq!(top_level_string(br#"{"a": "#, "title"), None);
}
