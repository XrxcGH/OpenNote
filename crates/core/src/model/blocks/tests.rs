use super::*;
use crate::id::Id;
use crate::model::{BlockData, Frame, JsonMap, OtherData, TextData};
use crate::time::Timestamp;

fn id(n: u64) -> BlockId {
    BlockId(Id::from_parts(n, u128::from(n)))
}

fn block(n: u64, order: &str, frame: Option<(f64, f64)>) -> Arc<Block> {
    Arc::new(Block {
        id: id(n),
        order: OrderKey::parse(order).unwrap(),
        frame: frame.map(|(x, y)| Frame {
            x: Some(x),
            y: Some(y),
            ..Frame::default()
        }),
        lock: None,
        created: Timestamp::EPOCH,
        modified: Timestamp::EPOCH,
        data: BlockData::Text(TextData {
            markdown: format!("block {n}").into(),
            ..TextData::default()
        }),
        fallback: None,
        extra: JsonMap::new(),
    })
}

fn ids(blocks: &Blocks) -> Vec<u64> {
    blocks.iter().map(|b| b.id.0.time_ms()).collect()
}

#[test]
fn iterates_by_order_key_then_id() {
    let mut blocks = Blocks::new();
    for (n, order) in [(3, "a1"), (1, "a2"), (2, "a1"), (4, "a0")] {
        blocks.insert(block(n, order, None)).unwrap();
    }
    assert_eq!(ids(&blocks), [4, 2, 3, 1]);
    assert_eq!(blocks.len(), 4);
    assert_eq!(blocks.last_key().map(OrderKey::as_str), Some("a2"));
}

#[test]
fn rejects_a_used_id() {
    let mut blocks = Blocks::new();
    blocks.insert(block(1, "a0", None)).unwrap();
    assert_eq!(
        blocks.insert(block(1, "a1", None)),
        Err(ModelError::DuplicateId(id(1).0))
    );
    assert_eq!(ids(&blocks), [1]);
}

#[test]
fn replace_moves_the_block_in_order() {
    let mut blocks = Blocks::new();
    blocks.insert(block(1, "a0", None)).unwrap();
    blocks.insert(block(2, "a1", None)).unwrap();
    let old = blocks.replace(block(1, "a2", None)).unwrap();
    assert_eq!(old.order.as_str(), "a0");
    assert_eq!(ids(&blocks), [2, 1]);
    assert_eq!(
        blocks.replace(block(9, "a0", None)),
        Err(ModelError::MissingId(id(9).0))
    );
}

#[test]
fn remove_and_neighbors() {
    let mut blocks = Blocks::new();
    for (n, order) in [(1, "a0"), (2, "a1"), (3, "a2")] {
        blocks.insert(block(n, order, None)).unwrap();
    }
    fn keys<'a>((a, b): (Option<&'a OrderKey>, Option<&'a OrderKey>)) -> (Option<&'a str>, Option<&'a str>) {
        (a.map(OrderKey::as_str), b.map(OrderKey::as_str))
    }
    assert_eq!(keys(blocks.neighbors(id(2))), (Some("a0"), Some("a2")));
    assert_eq!(keys(blocks.neighbors(id(1))), (None, Some("a1")));
    assert_eq!(keys(blocks.neighbors(id(3))), (Some("a1"), None));
    assert_eq!(keys(blocks.neighbors(id(9))), (None, None));
    assert_eq!(blocks.remove(id(2)).map(|b| b.id), Some(id(2)));
    assert_eq!(blocks.remove(id(2)), None);
    assert_eq!(keys(blocks.neighbors(id(1))), (None, Some("a2")));
    assert!(!blocks.contains(id(2)));
}

#[test]
fn reading_order_puts_flowing_blocks_first_then_rows() {
    let mut blocks = Blocks::new();
    let layout = [
        (1, "a0", Some((500.0, 100.0))),
        (2, "a1", Some((100.0, 105.0))),
        (3, "a2", None),
        (4, "a3", Some((100.0, 300.0))),
        (5, "a4", Some((300.0, 108.0))),
        (6, "a5", None),
        (7, "a6", Some((50.0, 110.0))),
    ];
    for (n, order, frame) in layout {
        blocks.insert(block(n, order, frame)).unwrap();
    }
    let order: Vec<u64> = blocks.reading_order(&[]).iter().map(|b| b.0.time_ms()).collect();
    // Row one starts at y 100 and takes blocks up to y 108. Block 7, at y 110, starts row two.
    assert_eq!(order, [3, 6, 2, 5, 1, 7, 4]);
}

#[test]
fn a_page_reading_order_comes_first() {
    let mut blocks = Blocks::new();
    for (n, order, frame) in [
        (1, "a0", Some((0.0, 0.0))),
        (2, "a1", None),
        (3, "a2", Some((0.0, 50.0))),
    ] {
        blocks.insert(block(n, order, frame)).unwrap();
    }
    let order: Vec<u64> = blocks
        .reading_order(&[id(3), id(9), id(3)])
        .iter()
        .map(|b| b.0.time_ms())
        .collect();
    assert_eq!(order, [3, 2, 1]);
}

#[test]
fn frames_float_only_with_x_and_y() {
    assert!(Frame {
        x: Some(0.0),
        y: Some(0.0),
        ..Frame::default()
    }
    .is_floating());
    assert!(!Frame {
        x: Some(0.0),
        w: Some(10.0),
        ..Frame::default()
    }
    .is_floating());
    let json = serde_json::to_string(&Frame {
        x: Some(96.0),
        w: Some(624.0),
        ..Frame::default()
    })
    .unwrap();
    assert_eq!(json, r#"{"x":96.0,"w":624.0}"#);
    let parsed: Frame = serde_json::from_str(r#"{"x": 1, "y": 2, "future": true}"#).unwrap();
    assert_eq!((parsed.x, parsed.y), (Some(1.0), Some(2.0)));
    assert_eq!(parsed.extra.get("future"), Some(&serde_json::Value::Bool(true)));
}

#[test]
fn type_names_follow_the_data() {
    let text = block(1, "a0", None);
    assert_eq!(text.type_name(), "text");
    let mut other = Block::clone(&text);
    other.data = BlockData::Other(OtherData {
        type_name: "ext:org.example/kanban".into(),
        data: JsonMap::new(),
        unreadable: None,
    });
    assert_eq!(other.type_name(), "ext:org.example/kanban");
}
