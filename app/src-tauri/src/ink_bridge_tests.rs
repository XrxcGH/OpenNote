//! Tests of the ink commands over pages the notes commands made: strokes live in the page's folder in its notebook.

use std::{fs, path::Path, sync::Arc};

use opennote_core::{
    format::{points::encode_points, segment::encode_records},
    model::{Channels, InkRecord, Point, Stroke, StrokeStyle},
    BlockId, StrokeId, Timestamp,
};
use serde_json::{json, Value};

use super::*;
use crate::core_bridge::Bridge;

const INK: &str = "01k6f00000000000000000k001";

fn stroke(id: &str) -> Vec<u8> {
    let points = [
        Point {
            x: 640,
            y: 1_280,
            pressure: 32_768,
            ..Point::default()
        },
        Point {
            x: 720,
            y: 1_440,
            pressure: 36_044,
            ..Point::default()
        },
    ];
    let channels = Channels(Channels::PRESSURE);
    let mut encoded = Vec::new();
    let bbox = encode_points(&points, channels, &mut encoded).expect("points encode");
    let stroke = Stroke {
        id: StrokeId::parse(id).expect("a stroke ID"),
        block: BlockId::parse(INK).expect("a block ID"),
        start: Timestamp::from_unix_ms(1_790_777_258_345),
        start_unknown: false,
        style: StrokeStyle {
            tool: 0,
            palette: 1,
            color: [0x2b, 0x25, 0x21, 0xff],
            width: 2.0,
        },
        transform: None,
        origin: None,
        bbox,
        channels,
        point_count: 2,
        points: Arc::from(encoded),
    };
    encode_records(&[InkRecord::Stroke(Arc::new(stroke))])
}

fn body(header: &Value, records: &[u8]) -> Vec<u8> {
    let json = serde_json::to_vec(header).expect("JSON");
    let mut out = u32::try_from(json.len()).expect("short").to_le_bytes().to_vec();
    out.extend_from_slice(&json);
    out.extend_from_slice(records);
    out
}

fn header(page: &str, seq: u64, edits: Value) -> Value {
    json!({ "page": page, "client": "main-1", "clientSeq": seq, "edits": edits })
}

fn new_layer() -> Value {
    json!([{ "edit": "insertBlock", "block": {
        "id": INK, "type": "ink", "frame": { "x": 0, "y": 0 }, "data": { "role": "layer" }
    } }])
}

/// A notebook with a section and a page in `notes`; returns the page's ID.
fn a_page(bridge: &CoreBridge, notes: &Path) -> String {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let create = |bridge: &mut Bridge, kind: &str, parent: Option<String>| {
                let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
            };
            let notebook = create(bridge, "notebook", None)?;
            let section = create(bridge, "section", Some(notebook))?;
            create(bridge, "page", Some(section))
        })
        .expect("a page")
}

/// Opens the page for `main-1` and adds one stroke with its ink layer, as the page view's first stroke does.
fn draw(bridge: &CoreBridge, notes: &Path, page: &str, records: &[u8]) -> TxnAck {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let handle = bridge.handle(page, "main-1")?;
            let sent = body(&header(page, 1, new_layer()), records);
            let (parsed, rest) = split_body(&sent)?;
            add_strokes(&handle, parsed, rest)
        })
        .expect("draws")
}

/// The page's live strokes as `main-1` reads them after opening it.
fn strokes(bridge: &CoreBridge, notes: &Path, page: &str) -> Vec<u8> {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            Ok(bridge.handle(page, "main-1")?.read_strokes(None, None).records)
        })
        .expect("reads")
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("a folder");
    for entry in fs::read_dir(from).expect("a listing") {
        let entry = entry.expect("an entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("a type").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).expect("a copy");
        }
    }
}

#[test]
fn a_body_splits_into_its_header_and_records() {
    let records = stroke("01k6f00000000000000000s001");
    let sent = body(&header("01k6f00000000000000000p001", 3, json!([])), &records);
    let (parsed, rest) = split_body(&sent).expect("splits");
    assert_eq!(parsed.client_seq, 3);
    assert_eq!(parsed.page, "01k6f00000000000000000p001");
    assert_eq!(rest, records.as_slice());
}

#[test]
fn a_short_or_damaged_body_is_invalid() {
    assert_eq!(split_body(&[1, 0]).err().map(|e| e.code), Some("invalid".to_owned()));
    assert_eq!(
        split_body(&[200, 0, 0, 0, b'{']).err().map(|e| e.code),
        Some("invalid".to_owned())
    );
    let bad = body(&json!({ "page": 1 }), &[]);
    assert_eq!(split_body(&bad).err().map(|e| e.code), Some("invalid".to_owned()));
}

#[test]
fn strokes_and_their_layer_land_in_one_step_and_undo_together() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let records = stroke("01k6f00000000000000000s001");
    assert!(draw(&bridge, &notes, &page, &records).can_undo);
    assert_eq!(strokes(&bridge, &notes, &page), records);
    let undone = bridge
        .with(|bridge| {
            let handle = bridge.open_handle(&page, "main-1")?;
            let frame = handle
                .undo(handle.client())
                .map_err(|error| IpcError::new(error.code(), error.to_string()))?;
            Ok((frame.is_some(), handle.read_strokes(None, None).strokes))
        })
        .expect("undoes");
    bridge.shutdown();
    assert_eq!(undone, (true, 0));
}

#[test]
fn a_stroke_without_its_ink_block_is_refused() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let refused = bridge
        .notes(Some(notes), |bridge| {
            let handle = bridge.handle(&page, "main-1")?;
            let sent = body(&header(&page, 1, json!([])), &stroke("01k6f00000000000000000s002"));
            let (parsed, rest) = split_body(&sent)?;
            Ok(add_strokes(&handle, parsed, rest).expect_err("no ink block"))
        })
        .expect("the bridge");
    bridge.shutdown();
    assert_ne!(refused.code, "internal");
}

#[test]
fn strokes_need_an_open_session_of_a_page_in_a_notebook() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let (unopened, unknown) = bridge
        .notes(Some(notes), |bridge| {
            let unopened = bridge.open_handle(&page, "main-1").map(|_| ()).unwrap_err();
            let unknown = bridge
                .handle("01k6f00000000000000000p009", "main-1")
                .map(|_| ())
                .unwrap_err();
            Ok((unopened.code, unknown.code))
        })
        .expect("the bridge");
    bridge.shutdown();
    assert_eq!((unopened.as_str(), unknown.as_str()), ("notFound", "notFound"));
}

#[test]
fn strokes_survive_a_restart_and_travel_with_a_copied_notes_folder() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let records = stroke("01k6f00000000000000000s003");
    draw(&bridge, &notes, &page, &records);
    bridge.shutdown();

    // In one process, the first core keeps the notebook's device lock, so this one reads it read-only, from disk.
    let again = CoreBridge::at(dir.path().join("local"));
    assert_eq!(strokes(&again, &notes, &page), records, "after a restart");
    again.shutdown();

    // A second device: a copy of the notes folder and none of this device's files.
    let copy = dir.path().join("Copy");
    copy_dir(&notes, &copy);
    let other = CoreBridge::at(dir.path().join("other"));
    assert_eq!(strokes(&other, &copy, &page), records, "in a copied notes folder");
    other.shutdown();
}

#[test]
fn strokes_go_to_trash_and_back_with_their_page() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let records = stroke("01k6f00000000000000000s004");
    draw(&bridge, &notes, &page, &records);

    // Undo of the delete: the receipt puts the page back.
    let receipt = bridge
        .notes(Some(notes.clone()), |bridge| {
            bridge.dispatch("notes_trash", &json!({ "ids": [page] }))
        })
        .expect("trashes");
    bridge
        .notes(Some(notes.clone()), |bridge| {
            bridge.dispatch("notes_restore", &json!({ "receiptId": receipt["id"] }))
        })
        .expect("restores");
    assert_eq!(strokes(&bridge, &notes, &page), records, "after Undo");

    // Trash, then Restore from the Trash view.
    let trash = |bridge: &CoreBridge, notes: &Path| {
        bridge
            .notes(Some(notes.to_path_buf()), |bridge| {
                bridge.dispatch("notes_trash", &json!({ "ids": [page] }))
            })
            .expect("trashes");
    };
    let restore = |bridge: &CoreBridge, notes: &Path| {
        bridge
            .notes(Some(notes.to_path_buf()), |bridge| {
                bridge.dispatch("notes_restore_from_trash", &json!({ "ids": [page] }))
            })
            .expect("restores from Trash");
    };
    trash(&bridge, &notes);
    restore(&bridge, &notes);
    assert_eq!(strokes(&bridge, &notes, &page), records, "after Restore");

    // A page in Trash keeps its strokes in the notes folder: a copy of the folder restores it with them.
    trash(&bridge, &notes);
    bridge.shutdown();
    let copy = dir.path().join("Copy");
    copy_dir(&notes, &copy);
    let other = CoreBridge::at(dir.path().join("other"));
    restore(&other, &copy);
    assert_eq!(
        strokes(&other, &copy, &page),
        records,
        "restored in a copied notes folder"
    );
    other.shutdown();
}
