//! The cases in tests/fixtures, which the TypeScript client in app/src/core/audio also passes. If the
//! two implementations ever disagree, one of these tests fails.

use opennote_media::positions::PositionMap;
use opennote_media::stamps::{Entry, Stamp, StampIndex, Target, TextMarks};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn number(value: &Value) -> u64 {
    value.as_u64().unwrap()
}

#[test]
fn the_position_map_matches_the_shared_cases() {
    let cases = fixture("position-map.json");
    let ranges: Vec<(u64, u64)> = cases["ranges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| (number(&pair[0]), number(&pair[1])))
        .collect();
    let map = PositionMap::from_ranges(&ranges);
    assert_eq!(map.duration_ns(), number(&cases["durationNs"]));
    assert_eq!(serde_json::to_value(map.spans()).unwrap(), cases["spans"]);
    for case in cases["locate"].as_array().unwrap() {
        let located = map.locate(number(&case["captureNs"]));
        assert_eq!(located.position_ns, number(&case["positionNs"]), "{case}");
        assert_eq!(located.exact, case["exact"].as_bool().unwrap(), "{case}");
    }
    for case in cases["captureAt"].as_array().unwrap() {
        let expected = case["captureNs"].as_u64();
        assert_eq!(map.capture_at(number(&case["positionNs"])), expected, "{case}");
    }
}

fn stamp_of<'a>(step: &'a Value, capture_key: &str) -> Option<Stamp<'a>> {
    let stamp = step.get("stamp")?;
    Some(Stamp {
        recording: stamp["recording"].as_str().unwrap(),
        capture_ns: number(&stamp[capture_key]) * 1_000_000,
    })
}

/// Applies the steps of a case to new marks.
fn run(steps: &Value) -> TextMarks {
    let mut marks = TextMarks::default();
    for step in steps.as_array().unwrap() {
        if let Some(typed) = step.get("type") {
            for index in 0..number(&typed["count"]) {
                let at_ms = number(&typed["startMs"]) + index * number(&typed["everyMs"]);
                let stamp = Stamp {
                    recording: typed["recording"].as_str().unwrap(),
                    capture_ns: at_ms * 1_000_000,
                };
                marks.edit((number(&typed["at"]) + index) as u32, 0, 1, Some(stamp));
            }
        } else {
            let edit = &step["edit"];
            let stamp = stamp_of(edit, "captureMs");
            marks.edit(
                number(&edit["at"]) as u32,
                number(&edit["deleted"]) as u32,
                number(&edit["inserted"]) as u32,
                stamp,
            );
        }
    }
    marks
}

#[test]
fn text_marks_match_the_shared_cases() {
    let cases = fixture("text-marks.json");
    for case in cases["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let marks = run(&case["steps"]);
        let recordings: Vec<&str> = marks.recordings.iter().map(String::as_str).collect();
        let expected: Vec<&str> = case["recordings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap())
            .collect();
        assert_eq!(recordings, expected, "{name}");
        let found: Vec<Value> = marks
            .marks
            .iter()
            .map(|m| serde_json::json!([m.from, m.to, m.recording, m.start_ns, m.end_ns]))
            .collect();
        assert_eq!(Value::Array(found), case["marks"], "{name}");
        for lookup in case["timeAt"].as_array().unwrap() {
            let found = marks.time_at(number(&lookup[0]) as u32);
            let expected = lookup[1].as_str().map(|recording| (recording, number(&lookup[2])));
            assert_eq!(found, expected, "{name}: {lookup}");
        }
    }

    let active = &cases["active"];
    let marks = run(&active["steps"]);
    for query in active["queries"].as_array().unwrap() {
        let found: Vec<u64> = marks
            .active_at(
                query["recording"].as_str().unwrap(),
                number(&query["captureNs"]),
                number(&query["tailNs"]),
            )
            .iter()
            .map(|mark| u64::from(mark.from))
            .collect();
        let expected: Vec<u64> = query["from"].as_array().unwrap().iter().map(number).collect();
        assert_eq!(found, expected, "{query}");
    }
}

fn stroke_ids(entries: &[&Entry]) -> Vec<String> {
    entries
        .iter()
        .filter_map(|entry| match &entry.target {
            Target::Stroke { id } => Some(id.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_stamp_index_matches_the_shared_cases() {
    let cases = fixture("stamp-index.json");
    let entries: Vec<Entry> = serde_json::from_value(cases["entries"].clone()).unwrap();
    let index = StampIndex::new(entries);
    let ranges: Vec<(u64, u64)> = cases["ranges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| (number(&pair[0]), number(&pair[1])))
        .collect();
    let map = PositionMap::from_ranges(&ranges);

    for query in cases["active"].as_array().unwrap() {
        let found = index.active_at(
            query["recording"].as_str().unwrap(),
            number(&query["captureNs"]),
            number(&query["tailNs"]),
        );
        let expected: Vec<String> = query["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap().to_owned())
            .collect();
        assert_eq!(stroke_ids(&found), expected, "{query}");
    }
    for case in cases["seek"].as_array().unwrap() {
        let target: Target = serde_json::from_value(case["target"].clone()).unwrap();
        let seek = index.seek_for(&target, |_| Some(&map));
        match case["recording"].as_str() {
            None => assert!(seek.is_none(), "{case}"),
            Some(recording) => {
                let seek = seek.expect("a seek");
                assert_eq!(seek.recording, recording);
                assert_eq!(seek.position_ns, number(&case["positionNs"]), "{case}");
                assert_eq!(seek.exact, case["exact"].as_bool().unwrap(), "{case}");
            }
        }
    }
    let flag_id = |entry: Option<&Entry>| match entry.map(|e| &e.target) {
        Some(Target::Flag { id }) => Some(id.clone()),
        _ => None,
    };
    for case in cases["nextFlag"].as_array().unwrap() {
        let found = flag_id(index.next_after("r1", number(&case["after"]), Target::is_flag));
        assert_eq!(found.as_deref(), case["id"].as_str(), "{case}");
    }
    for case in cases["previousFlag"].as_array().unwrap() {
        let found = flag_id(index.previous_before("r1", number(&case["before"]), Target::is_flag));
        assert_eq!(found.as_deref(), case["id"].as_str(), "{case}");
    }
}
