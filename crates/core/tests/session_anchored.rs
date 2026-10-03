//! Typing in a text block keeps grouping into one undo step while the ink anchored to that text moves with it
//! (amendment C6), and the anchor survives the round trip through a saved page.

mod real_core;

use opennote_core::id::{BlockId, Id};
use opennote_core::model::Frame;
use opennote_core::ops::resolve::{Edit, NewBlock};
use opennote_core::ops::{CoalesceKey, CoalesceKind};
use real_core::{page_json, Real};
use serde_json::json;

fn new_block(id: BlockId, type_name: &str, data: serde_json::Value) -> Edit {
    let block = NewBlock {
        id,
        type_name: type_name.into(),
        frame: Some(Frame {
            x: Some(10.0),
            y: Some(10.0),
            ..Frame::default()
        }),
        data: data.as_object().cloned().unwrap(),
        fallback: None,
    };
    Edit::InsertBlock {
        block,
        after: None,
        before: None,
    }
}

#[test]
fn typing_that_moves_anchored_ink_is_one_undo_step() {
    let mut real = Real::new();
    let handle = real.open();
    let text = BlockId(Id::from_parts(1_800_000_000_000, 5));
    let ink = BlockId(Id::from_parts(1_800_000_000_000, 6));
    let anchor = json!({"block": text.to_string(), "at": 0, "quote": {"exact": "First"}});
    let setup = vec![
        new_block(text, "text", json!({"markdown": "First"})),
        new_block(ink, "ink", json!({"role": "anchored", "anchor": anchor})),
    ];
    handle.apply(real.request(setup)).unwrap();

    let key = CoalesceKey {
        kind: CoalesceKind::Typing,
        target: text.to_string(),
    };
    let mut markdown = "First".to_owned();
    for (n, word) in ["a", "b", "c"].into_iter().enumerate() {
        markdown.push_str(word);
        let nudge = Edit::PatchBlock {
            block: ink,
            lock: None,
            data: json!({"anchor": {"dy": 12 + n}}).as_object().cloned(),
            fallback: None,
        };
        let edits = vec![
            Edit::SetText {
                block: text,
                markdown: markdown.clone(),
            },
            nudge,
        ];
        let mut request = real.request(edits);
        request.coalesce = Some(key.clone());
        handle.apply(request).unwrap();
    }
    let page = page_json(&handle);
    let moved = page["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == ink.to_string());
    assert_eq!(moved.unwrap()["data"]["anchor"]["dy"], 14);
    assert_eq!(moved.unwrap()["data"]["anchor"]["quote"]["exact"], "First");

    // One step for the typing, one for the setup, and nothing more.
    assert!(handle.undo(&real.client).unwrap().is_some());
    assert!(handle.undo(&real.client).unwrap().is_some());
    assert!(handle.undo(&real.client).unwrap().is_none());
}
